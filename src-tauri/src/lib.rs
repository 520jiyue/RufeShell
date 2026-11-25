mod credentials;
pub mod domain;
mod forwarding;
mod host_keys;
mod local_pty;
mod ops;
pub mod sessions;
mod store;
mod transfers;

use std::sync::Arc;

use domain::{
    AppError, ConflictPolicy, ConnectionBundle, ConnectionDraft, DockerContainer,
    ExportedConnection, FileDiffEntry, ForwardRuleDraft, ForwardRuleInfo, HostKeyInfo, LocalEntry,
    LocalShellKind, ProcessDetail, RemoteEntry, SystemMetrics, SystemdUnit, TransferConflict,
    TransferDirection, TransferTask, WorkbenchState,
};
pub use domain::{AuthKind, ConnectionProfile};
use forwarding::ForwardManager;
use host_keys::HostKeyStore;
use local_pty::LocalPtyManager;
pub use sessions::{
    discover_host_key as discover_remote_host_key, host_key_fingerprint, SessionEvent,
    SessionManager,
};
use store::{Store, WorkbenchStore};
use tauri::{AppHandle, Emitter, Manager, State};
use transfers::TransferManager;

#[cfg(target_os = "windows")]
#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: *mut std::ffi::c_void,
        dw_attribute: u32,
        pv_attribute: *const u32,
        cb_attribute: u32,
    ) -> i32;
}

#[cfg(target_os = "windows")]
fn hide_frameless_window_border(app: &tauri::App) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(hwnd) = window.hwnd() {
            const DWMWA_BORDER_COLOR: u32 = 34;
            const DWMWA_COLOR_NONE: u32 = 0xFFFFFFFE;
            unsafe {
                let _ = DwmSetWindowAttribute(
                    hwnd.0,
                    DWMWA_BORDER_COLOR,
                    &DWMWA_COLOR_NONE,
                    std::mem::size_of::<u32>() as u32,
                );
            }
        }
    }
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
    workbench: WorkbenchStore,
    host_keys: HostKeyStore,
    sessions: Arc<SessionManager>,
    local_pty: LocalPtyManager,
    transfers: TransferManager,
    forwards: ForwardManager,
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
fn update_connection(
    id: String,
    draft: ConnectionDraft,
    password: Option<String>,
    state: State<'_, AppState>,
) -> Result<ConnectionProfile, AppError> {
    let existing = state.store.get(&id)?;
    let profile = ConnectionProfile::with_id(existing.id, draft)?;
    if profile.auth == domain::AuthKind::Password {
        if let Some(password) = password.filter(|value| !value.is_empty()) {
            credentials::save(&profile.id, &password)?;
        }
    }
    state.store.upsert(profile.clone())?;
    Ok(profile)
}

#[tauri::command]
fn duplicate_connection(
    id: String,
    state: State<'_, AppState>,
) -> Result<ConnectionProfile, AppError> {
    let source = state.store.get(&id)?;
    let mut copy = source.clone();
    copy.id = uuid::Uuid::new_v4().to_string();
    copy.name = format!("{} (副本)", source.name);
    copy.updated_at = chrono::Utc::now().timestamp();
    if copy.auth == domain::AuthKind::Password {
        credentials::copy(&source.id, &copy.id)?;
    }
    state.store.upsert(copy.clone())?;
    let mut wb = state.workbench.load()?;
    if let Some(meta) = wb.connection_meta.get(&source.id).cloned() {
        wb.connection_meta.insert(copy.id.clone(), meta);
        state.workbench.save(wb)?;
    }
    Ok(copy)
}

#[tauri::command]
fn delete_connection(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.store.delete(&id)?;
    let mut wb = state.workbench.load()?;
    if wb.connection_meta.remove(&id).is_some() {
        state.workbench.save(wb)?;
    }
    credentials::delete(&id)
}

#[tauri::command]
fn export_connections(path: String, state: State<'_, AppState>) -> Result<usize, AppError> {
    let profiles = state.store.list()?;
    let wb = state.workbench.load()?;
    let exported = profiles
        .into_iter()
        .map(|profile| ExportedConnection {
            meta: wb
                .connection_meta
                .get(&profile.id)
                .cloned()
                .unwrap_or_default(),
            name: profile.name,
            host: profile.host,
            port: profile.port,
            username: profile.username,
            auth: profile.auth,
            private_key_path: profile.private_key_path,
        })
        .collect::<Vec<_>>();
    let count = exported.len();
    let bundle = ConnectionBundle {
        schema_version: 1,
        exported_at: chrono::Utc::now().timestamp(),
        connections: exported,
    };
    let json = serde_json::to_vec_pretty(&bundle)
        .map_err(|error| AppError::Storage(error.to_string()))?;
    std::fs::write(&path, json).map_err(|error| AppError::Io(error.to_string()))?;
    Ok(count)
}

#[tauri::command]
fn import_connections(path: String, state: State<'_, AppState>) -> Result<usize, AppError> {
    let bytes = std::fs::read(&path).map_err(|error| AppError::Io(error.to_string()))?;
    let bundle: ConnectionBundle = serde_json::from_slice(&bytes)
        .map_err(|error| AppError::Validation(format!("导入文件格式无效：{error}")))?;
    let existing = state.store.list()?;
    let mut wb = state.workbench.load()?;
    let mut imported = 0usize;
    for entry in bundle.connections {
        let duplicate = existing.iter().any(|item| {
            item.name == entry.name
                && item.host == entry.host
                && item.port == entry.port
                && item.username == entry.username
        });
        if duplicate {
            continue;
        }
        let profile = ConnectionProfile::from_draft(ConnectionDraft {
            name: entry.name,
            host: entry.host,
            port: entry.port,
            username: entry.username,
            auth: entry.auth,
            private_key_path: entry.private_key_path,
        })?;
        wb.connection_meta.insert(profile.id.clone(), entry.meta);
        state.store.upsert(profile)?;
        imported += 1;
    }
    state.workbench.save(wb)?;
    Ok(imported)
}

#[tauri::command]
fn load_workbench_state(state: State<'_, AppState>) -> Result<WorkbenchState, AppError> {
    state.workbench.load()
}

#[tauri::command]
fn save_workbench_state(
    workbench_state: WorkbenchState,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.workbench.save(workbench_state)
}

#[tauri::command]
fn save_text_log(path: String, content: String) -> Result<usize, AppError> {
    let bytes = content.as_bytes();
    std::fs::write(&path, bytes).map_err(|error| AppError::Io(error.to_string()))?;
    Ok(bytes.len())
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
    let wb = state.workbench.load().unwrap_or_default();
    let effective_timeout = wb
        .connection_meta
        .get(&profile_id)
        .and_then(|meta| meta.connect_timeout_secs)
        .unwrap_or(wb.settings.connect_timeout_secs);
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
        .connect_with_timeout(profile, password, Some(host_key), effective_timeout)
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
    timeout_secs: Option<u64>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let profile = state.store.get(&profile_id)?;
    let wb = state.workbench.load().unwrap_or_default();
    let effective_timeout = timeout_secs
        .or_else(|| {
            wb.connection_meta
                .get(&profile_id)
                .and_then(|meta| meta.connect_timeout_secs)
        })
        .unwrap_or(wb.settings.connect_timeout_secs);
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
        .connect_with_timeout(profile, password, Some(host_key), effective_timeout)
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
fn is_elevated() -> bool {
    local_pty::is_process_elevated()
}

#[tauri::command]
async fn relaunch_as_admin(app: AppHandle) -> Result<(), AppError> {
    if local_pty::is_process_elevated() {
        return Ok(());
    }
    local_pty::relaunch_as_admin()?;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(120));
        app.exit(0);
    });
    Ok(())
}

#[tauri::command]
async fn open_elevated_local_terminal(kind: LocalShellKind) -> Result<(), AppError> {
    local_pty::spawn_elevated_shell(kind)
}

#[tauri::command]
async fn open_local_terminal(
    kind: LocalShellKind,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let (session_id, events) = state.local_pty.spawn(kind)?;
    tauri::async_runtime::spawn(forward_events(session_id.clone(), events, app));
    Ok(session_id)
}

#[tauri::command]
async fn terminal_input(
    session_id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if state.local_pty.contains(&session_id) {
        return state.local_pty.input(&session_id, data.as_bytes());
    }
    state.sessions.input(&session_id, data.into_bytes()).await
}

#[tauri::command]
fn session_status(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<domain::SessionStatus, AppError> {
    if state.local_pty.contains(&session_id) {
        return Ok(domain::SessionStatus::Connected);
    }
    state.sessions.status(&session_id)
}

#[tauri::command]
async fn terminal_resize(
    session_id: String,
    columns: u32,
    rows: u32,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    if state.local_pty.contains(&session_id) {
        return state.local_pty.resize(&session_id, columns, rows);
    }
    state.sessions.resize(&session_id, columns, rows).await
}

#[tauri::command]
async fn disconnect(session_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    if state.local_pty.contains(&session_id) {
        return state.local_pty.disconnect(&session_id);
    }
    state
        .forwards
        .stop_session_forwards(&session_id, &state.sessions)
        .await;
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
    create_backup: Option<bool>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let backup = create_backup.unwrap_or_else(|| {
        state
            .workbench
            .load()
            .map(|wb| wb.settings.create_backup_on_edit)
            .unwrap_or(false)
    });
    state
        .sessions
        .backup_and_write_text_file(&session_id, &remote_path, text, backup)
        .await
}

#[tauri::command]
async fn create_remote_file(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state.sessions.create_remote_file(&session_id, &path).await
}

#[tauri::command]
async fn create_remote_directory(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .sessions
        .create_remote_directory(&session_id, &path)
        .await
}

#[tauri::command]
async fn rename_remote_entry(
    session_id: String,
    old_path: String,
    new_path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .sessions
        .rename_remote_entry(&session_id, &old_path, &new_path)
        .await
}

#[tauri::command]
async fn delete_remote_entry(
    session_id: String,
    path: String,
    recursive: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .sessions
        .delete_remote_entry(&session_id, &path, recursive)
        .await
}

#[tauri::command]
async fn get_remote_permissions(
    session_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<u32, AppError> {
    state
        .sessions
        .get_remote_permissions(&session_id, &path)
        .await
}

#[tauri::command]
async fn set_remote_permissions(
    session_id: String,
    path: String,
    mode: u32,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    state
        .sessions
        .set_remote_permissions(&session_id, &path, mode)
        .await
}

#[tauri::command]
fn list_transfers(state: State<'_, AppState>) -> Vec<TransferTask> {
    state.transfers.list()
}

#[tauri::command]
async fn inspect_transfer_conflicts(
    session_id: String,
    direction: TransferDirection,
    pairs: Vec<(String, String)>,
    state: State<'_, AppState>,
) -> Result<Vec<TransferConflict>, AppError> {
    state
        .transfers
        .inspect_conflicts(&state.sessions, &session_id, direction, pairs)
        .await
}

#[tauri::command]
fn enqueue_transfer(
    session_id: String,
    direction: TransferDirection,
    local_path: String,
    remote_path: String,
    conflict_policy: ConflictPolicy,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TransferTask, AppError> {
    let verify = state
        .workbench
        .load()
        .map(|wb| wb.settings.verify_transfer_checksum)
        .unwrap_or(true);
    state.transfers.enqueue_file(
        app,
        state.sessions.clone(),
        session_id,
        direction,
        local_path,
        remote_path,
        conflict_policy,
        verify,
    )
}

#[tauri::command]
async fn enqueue_directory_transfer(
    session_id: String,
    direction: TransferDirection,
    local_dir: String,
    remote_dir: String,
    conflict_policy: ConflictPolicy,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<TransferTask>, AppError> {
    let verify = state
        .workbench
        .load()
        .map(|wb| wb.settings.verify_transfer_checksum)
        .unwrap_or(true);
    state
        .transfers
        .enqueue_directory(
            app,
            state.sessions.clone(),
            session_id,
            direction,
            local_dir,
            remote_dir,
            conflict_policy,
            verify,
        )
        .await
}

#[tauri::command]
fn pause_transfer(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TransferTask, AppError> {
    state.transfers.pause(&app, &id)
}

#[tauri::command]
fn resume_transfer(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TransferTask, AppError> {
    state.transfers.resume(app, state.sessions.clone(), &id)
}

#[tauri::command]
fn cancel_transfer(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<TransferTask, AppError> {
    state.transfers.cancel(&app, &id)
}

#[tauri::command]
fn clear_finished_transfers(state: State<'_, AppState>) -> Vec<TransferTask> {
    state.transfers.clear_finished()
}

#[tauri::command]
fn local_quick_paths() -> Vec<(String, String)> {
    ops::local_quick_paths()
}

#[tauri::command]
fn list_local_directory(path: String) -> Result<(String, Vec<LocalEntry>), AppError> {
    ops::list_local_directory(&path)
}

#[tauri::command]
async fn compare_local_remote(
    session_id: String,
    local_dir: String,
    remote_dir: String,
    state: State<'_, AppState>,
) -> Result<Vec<FileDiffEntry>, AppError> {
    ops::compare_local_remote(&state.sessions, &session_id, &local_dir, &remote_dir).await
}

#[tauri::command]
fn list_forwards(session_id: Option<String>, state: State<'_, AppState>) -> Vec<ForwardRuleInfo> {
    state.forwards.list(session_id.as_deref())
}

#[tauri::command]
async fn add_forward(
    session_id: String,
    draft: ForwardRuleDraft,
    state: State<'_, AppState>,
) -> Result<ForwardRuleInfo, AppError> {
    state
        .forwards
        .add_and_start(session_id, draft, &state.sessions)
        .await
}

#[tauri::command]
async fn start_forward(id: String, state: State<'_, AppState>) -> Result<ForwardRuleInfo, AppError> {
    state.forwards.start(&id, &state.sessions).await
}

#[tauri::command]
async fn stop_forward(id: String, state: State<'_, AppState>) -> Result<ForwardRuleInfo, AppError> {
    state.forwards.stop(&id, &state.sessions).await
}

#[tauri::command]
async fn remove_forward(id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    state.forwards.remove(&id, &state.sessions).await
}

#[tauri::command]
async fn list_processes_detailed(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ProcessDetail>, AppError> {
    ops::list_processes_detailed(&state.sessions, &session_id).await
}

#[tauri::command]
async fn kill_process(
    session_id: String,
    pid: u32,
    force: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    ops::kill_process(&state.sessions, &session_id, pid, force).await
}

#[tauri::command]
async fn list_systemd_services(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<SystemdUnit>, AppError> {
    ops::list_systemd_services(&state.sessions, &session_id).await
}

#[tauri::command]
async fn control_systemd_service(
    session_id: String,
    unit: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    ops::control_systemd_service(&state.sessions, &session_id, &unit, &action).await
}

#[tauri::command]
async fn read_systemd_logs(
    session_id: String,
    unit: String,
    lines: u16,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    ops::read_systemd_logs(&state.sessions, &session_id, &unit, lines).await
}

#[tauri::command]
async fn list_docker_containers(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<DockerContainer>, AppError> {
    ops::list_docker_containers(&state.sessions, &session_id).await
}

#[tauri::command]
async fn control_docker_container(
    session_id: String,
    container_id: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    ops::control_docker_container(&state.sessions, &session_id, &container_id, &action).await
}

#[tauri::command]
async fn read_docker_logs(
    session_id: String,
    container_id: String,
    tail: u16,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    ops::read_docker_logs(&state.sessions, &session_id, &container_id, tail).await
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
    let data_dir = dirs_data();
    let store = Store::open(data_dir.clone()).expect("无法初始化本地连接数据库");
    let workbench = WorkbenchStore::open(data_dir.clone()).expect("无法初始化工作台配置数据库");
    let host_keys = HostKeyStore::open(data_dir).expect("无法初始化主机密钥数据库");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            #[cfg(target_os = "windows")]
            hide_frameless_window_border(_app);
            Ok(())
        })
        .manage(AppState {
            store,
            workbench,
            host_keys,
            sessions: Arc::new(SessionManager::new()),
            local_pty: LocalPtyManager::new(),
            transfers: TransferManager::new(),
            forwards: ForwardManager::new(),
        })
        .invoke_handler(tauri::generate_handler![
            list_connections,
            save_connection,
            update_connection,
            duplicate_connection,
            delete_connection,
            export_connections,
            import_connections,
            load_workbench_state,
            save_workbench_state,
            save_text_log,
            discover_host_key,
            connect,
            connect_saved,
            is_elevated,
            relaunch_as_admin,
            open_elevated_local_terminal,
            open_local_terminal,
            session_status,
            terminal_input,
            terminal_resize,
            disconnect,
            list_directory,
            download_file,
            upload_file,
            read_text_file,
            write_text_file,
            create_remote_file,
            create_remote_directory,
            rename_remote_entry,
            delete_remote_entry,
            get_remote_permissions,
            set_remote_permissions,
            list_transfers,
            inspect_transfer_conflicts,
            enqueue_transfer,
            enqueue_directory_transfer,
            pause_transfer,
            resume_transfer,
            cancel_transfer,
            clear_finished_transfers,
            local_quick_paths,
            list_local_directory,
            compare_local_remote,
            list_forwards,
            add_forward,
            start_forward,
            stop_forward,
            remove_forward,
            list_processes_detailed,
            kill_process,
            list_systemd_services,
            control_systemd_service,
            read_systemd_logs,
            list_docker_containers,
            control_docker_container,
            read_docker_logs,
            system_metrics,
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 RufeShell");
}

fn dirs_data() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("RUFESHELL_DATA_DIR") {
        return path.into();
    }
    if let Ok(path) = std::env::var("FINALPOWERSHELL_DATA_DIR") {
        return path.into();
    }
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("HOME"))
        .unwrap_or_else(|| ".".into());
    let target = std::path::PathBuf::from(&base).join("RufeShell");
    let legacy = std::path::PathBuf::from(base).join("FinalPowerShell");
    if !target.exists() && legacy.exists() {
        let _ = std::fs::create_dir_all(&target);
        if let Ok(entries) = std::fs::read_dir(&legacy) {
            for entry in entries.flatten() {
                let src = entry.path();
                if src.is_file() {
                    if let Some(name) = src.file_name() {
                        let _ = std::fs::copy(&src, target.join(name));
                    }
                }
            }
        }
    }
    target
}
