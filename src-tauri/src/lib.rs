mod credentials;
pub mod domain;
mod host_keys;
pub mod sessions;
mod store;
#[cfg(debug_assertions)]
pub mod test_support;

use domain::{AppError, ConnectionDraft, HostKeyInfo, RemoteEntry, SystemMetrics};
pub use domain::{AuthKind, ConnectionProfile};
use host_keys::HostKeyStore;
pub use sessions::{
    discover_host_key as discover_remote_host_key, host_key_fingerprint, SessionEvent,
    SessionManager,
};
use store::Store;
use tauri::{AppHandle, Emitter, State};

#[cfg(debug_assertions)]
#[tauri::command]
fn e2e_drag_drop(paths: Vec<String>, x: f64, y: f64, app: AppHandle) -> Result<(), AppError> {
    app.emit(
        "tauri://drag-drop",
        serde_json::json!({ "paths": paths, "position": { "x": x, "y": y } }),
    )
    .map_err(|error| AppError::Validation(error.to_string()))
}

#[doc(hidden)]
pub fn credential_round_trip_test(id: &str, password: &str) -> Result<(), AppError> {
    credentials::save(id, password)?;
    let result = credentials::get(id).map(|stored| stored == password);
    let cleanup = credentials::delete(id);
    match (result, cleanup) {
        (Ok(true), Ok(())) => Ok(()),
        (Ok(false), _) => Err(AppError::Credential("临时凭据读回内容不一致".into())),
        (Err(error), _) => Err(error),
        (_, Err(error)) => Err(error),
    }
}

struct AppState {
    store: Store,
    host_keys: HostKeyStore,
    sessions: SessionManager,
}

#[tauri::command]
fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionProfile>, AppError> {
    state.store.list()
}

#[tauri::command]
fn save_connection(
    draft: ConnectionDraft,
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<ConnectionProfile, AppError> {
    let profile = ConnectionProfile::from_draft(draft)?;
    if profile.auth == domain::AuthKind::Password {
        let password = password
            .filter(|value| !value.is_empty())
            .ok_or_else(|| AppError::Validation("使用密码认证时必须填写密码".into()))?;
        credentials::save(&profile.id, &password)?;
    }
    state.store.upsert(profile.clone())?;
    Ok(profile)
}

#[tauri::command]
fn delete_connection(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.store.delete(&id)?;
    credentials::delete(&id)
}

#[tauri::command]
async fn connect(
    profile_id: String,
    host_key: String,
    remember: bool,
    password: Option<String>,
    save_password: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let profile = state.store.get(&profile_id)?;
    if remember {
        state
            .host_keys
            .save(&profile.host, profile.port, &host_key)?;
    }
    let supplied_password = password.filter(|value| !value.is_empty());
    if let (true, Some(password)) = (save_password, supplied_password.as_deref()) {
        credentials::save(&profile_id, password)?;
    }
    let password = if profile.auth == domain::AuthKind::Password {
        match supplied_password.clone() {
            Some(password) => Some(password),
            None => Some(credentials::get(&profile_id)?),
        }
    } else {
        None
    };
    let session_id = state
        .sessions
        .connect(profile, password, Some(host_key))
        .await?;
    let events = state.sessions.subscribe_events(&session_id)?;
    tauri::async_runtime::spawn(forward_events(session_id.clone(), events, app.clone()));
    app.emit(
        "session-event",
        SessionEvent::Status {
            session_id: session_id.clone(),
            status: domain::SessionStatus::Connected,
            message: None,
        },
    )
    .map_err(|error| AppError::Ssh(format!("无法通知连接状态：{error}")))?;
    Ok(session_id)
}

#[tauri::command]
async fn connect_saved(
    profile_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let profile = state.store.get(&profile_id)?;
    let host_key = state
        .host_keys
        .get(&profile.host, profile.port)
        .ok_or_else(|| AppError::Validation("首次连接需要确认服务器身份".into()))?;
    let password = if profile.auth == domain::AuthKind::Password {
        Some(credentials::get(&profile_id)?)
    } else {
        None
    };
    let session_id = state
        .sessions
        .connect(profile, password, Some(host_key))
        .await?;
    let events = state.sessions.subscribe_events(&session_id)?;
    tauri::async_runtime::spawn(forward_events(session_id.clone(), events, app.clone()));
    app.emit(
        "session-event",
        SessionEvent::Status {
            session_id: session_id.clone(),
            status: domain::SessionStatus::Connected,
            message: None,
        },
    )
    .map_err(|error| AppError::Ssh(format!("无法通知连接状态：{error}")))?;
    Ok(session_id)
}

#[tauri::command]
async fn discover_host_key(
    profile_id: String,
    state: State<'_, AppState>,
) -> Result<HostKeyInfo, AppError> {
    let profile = state.store.get(&profile_id)?;
    let mut info = sessions::discover_host_key(&profile.host, profile.port).await?;
    if let Some(saved) = state.host_keys.get(&profile.host, profile.port) {
        if saved == info.host_key {
            info.code = "host_key_known";
        } else {
            info.changed = true;
            let saved_key = russh::keys::PublicKey::from_openssh(&saved)
                .map_err(|error| AppError::Storage(error.to_string()))?;
            info.previous_fingerprint = Some(sessions::host_key_fingerprint(&saved_key));
        }
    }
    Ok(info)
}

async fn forward_events(
    session_id: String,
    mut events: tokio::sync::broadcast::Receiver<SessionEvent>,
    app: AppHandle,
) {
    loop {
        match events.recv().await {
            Ok(event) => {
                let _ = app.emit("session-event", event);
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                let _ = app.emit(
                    "session-warning",
                    serde_json::json!({
                        "session_id": session_id,
                        "message": "终端输出过快，部分显示帧已丢弃；远程会话仍保持连接。"
                    }),
                );
            }
            Err(_) => break,
        }
    }
}

#[tauri::command]
async fn terminal_input(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.sessions.input(&session_id, data.into_bytes()).await
}

#[tauri::command]
fn session_status(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<domain::SessionStatus, AppError> {
    state.sessions.status(&session_id)
}

#[tauri::command]
async fn terminal_resize(
    session_id: String,
    columns: u32,
    rows: u32,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.sessions.resize(&session_id, columns, rows).await
}

#[tauri::command]
async fn disconnect(session_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.sessions.disconnect(&session_id).await
}

#[tauri::command]
async fn list_directory(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<RemoteEntry>, AppError> {
    state.sessions.list_directory(&session_id, &path).await
}

#[tauri::command]
async fn download_file(
    session_id: String,
    remote_path: String,
    local_path: String,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    state
        .sessions
        .download_file(&session_id, &remote_path, &local_path)
        .await
}

#[tauri::command]
async fn upload_file(
    session_id: String,
    local_path: String,
    remote_path: String,
    state: State<'_, AppState>,
) -> Result<u64, AppError> {
    state
        .sessions
        .upload_file(&session_id, &local_path, &remote_path)
        .await
}

#[tauri::command]
async fn read_text_file(
    session_id: String,
    remote_path: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    state
        .sessions
        .read_text_file(&session_id, &remote_path)
        .await
}

#[tauri::command]
async fn write_text_file(
    session_id: String,
    remote_path: String,
    text: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .sessions
        .write_text_file(&session_id, &remote_path, text)
        .await
}

#[tauri::command]
async fn system_metrics(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<SystemMetrics, AppError> {
    state.sessions.system_metrics(&session_id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if cfg!(debug_assertions) && std::env::var_os("FINALPOWERSHELL_E2E").is_some() {
        tauri::async_runtime::block_on(run_e2e());
        return;
    }
    let data_dir = dirs_data();
    let store = Store::open(data_dir.clone()).expect("无法初始化本地连接数据库");
    let host_keys = HostKeyStore::open(data_dir).expect("无法初始化主机密钥数据库");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            store,
            host_keys,
            sessions: SessionManager::new(),
        })
        .invoke_handler(tauri::generate_handler![
            list_connections,
            save_connection,
            delete_connection,
            discover_host_key,
            connect,
            connect_saved,
            session_status,
            terminal_input,
            terminal_resize,
            disconnect,
            list_directory,
            download_file,
            upload_file,
            read_text_file,
            write_text_file,
            system_metrics,
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 FinalPowerShell");
}

#[cfg(debug_assertions)]
async fn run_e2e() {
    let server = test_support::start_test_server().await;
    let data_dir = std::path::PathBuf::from("../.preview-data/e2e");
    let store = Store::open(data_dir.clone()).expect("无法初始化测试数据库");
    let profile = ConnectionProfile {
        id: "local-e2e".into(),
        name: "自动测试服务器".into(),
        host: "127.0.0.1".into(),
        port: server.port,
        username: "integration".into(),
        auth: AuthKind::Password,
        private_key_path: None,
        updated_at: 0,
    };
    store.upsert(profile).expect("无法保存测试连接");
    credentials::save("local-e2e", "temporary-test-password").expect("无法保存临时测试密码");
    let host_keys = HostKeyStore::open(data_dir).expect("无法初始化测试主机密钥");
    host_keys
        .save("127.0.0.1", server.port, &server.host_key)
        .expect("无法保存测试主机密钥");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            store,
            host_keys,
            sessions: SessionManager::new(),
        })
        .invoke_handler(tauri::generate_handler![
            list_connections,
            save_connection,
            delete_connection,
            e2e_drag_drop,
            discover_host_key,
            connect,
            connect_saved,
            session_status,
            terminal_input,
            terminal_resize,
            disconnect,
            list_directory,
            download_file,
            upload_file,
            read_text_file,
            write_text_file,
            system_metrics,
        ])
        .run(tauri::generate_context!())
        .expect("无法启动自动测试窗口");
}

fn dirs_data() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("FINALPOWERSHELL_DATA_DIR") {
        return path.into();
    }
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("HOME"))
        .unwrap_or_else(|| ".".into());
    std::path::PathBuf::from(base).join("FinalPowerShell")
}
