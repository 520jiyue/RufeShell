use std::{
    collections::HashMap,
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::Instant,
};

use russh_sftp::protocol::OpenFlags;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use uuid::Uuid;

use crate::{
    domain::{
        AppError, ConflictPolicy, TransferConflict, TransferDirection, TransferStatus, TransferTask,
    },
    sessions::{validate_remote_path, SessionManager},
};

const CHUNK_SIZE: usize = 64 * 1024;
const PART_SUFFIX: &str = ".fps.part";

struct TransferRuntime {
    task: StdMutex<TransferTask>,
    paused: AtomicBool,
    cancelled: AtomicBool,
    verify_checksum: bool,
}

impl TransferRuntime {
    fn snapshot(&self) -> TransferTask {
        self.task.lock().expect("传输任务锁").clone()
    }
}

pub struct TransferManager {
    tasks: StdMutex<HashMap<String, Arc<TransferRuntime>>>,
    order: StdMutex<Vec<String>>,
}

impl Default for TransferManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TransferManager {
    pub fn new() -> Self {
        Self {
            tasks: StdMutex::new(HashMap::new()),
            order: StdMutex::new(Vec::new()),
        }
    }

    pub fn list(&self) -> Vec<TransferTask> {
        let tasks = self.tasks.lock().expect("传输列表锁");
        let order = self.order.lock().expect("传输顺序锁");
        order
            .iter()
            .rev()
            .filter_map(|id| tasks.get(id).map(|rt| rt.snapshot()))
            .collect()
    }

    pub async fn inspect_conflicts(
        &self,
        sessions: &SessionManager,
        session_id: &str,
        direction: TransferDirection,
        pairs: Vec<(String, String)>,
    ) -> Result<Vec<TransferConflict>, AppError> {
        let sftp = sessions.sftp_for(session_id).await?;
        let mut conflicts = Vec::new();

        for (local_path, remote_path) in pairs {
            validate_remote_path(&remote_path)?;
            let file_name = Path::new(&local_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_owned();

            match direction {
                TransferDirection::Upload => {
                    let local_meta = tokio::fs::metadata(&local_path).await?;
                    if local_meta.is_dir() {
                        continue;
                    }
                    let target_exists = sftp.try_exists(&remote_path).await?;
                    let part_path = format!("{remote_path}{PART_SUFFIX}");
                    let part_bytes = if sftp.try_exists(&part_path).await? {
                        sftp.metadata(&part_path).await?.size.unwrap_or(0)
                    } else {
                        0
                    };
                    if target_exists || part_bytes > 0 {
                        let remote_meta = if target_exists {
                            Some(sftp.metadata(&remote_path).await?)
                        } else {
                            None
                        };
                        conflicts.push(TransferConflict {
                            local_path,
                            remote_path,
                            file_name,
                            source_size: local_meta.len(),
                            target_size: remote_meta.as_ref().and_then(|m| m.size).unwrap_or(0),
                            source_modified_at: local_meta
                                .modified()
                                .ok()
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs() as i64),
                            target_modified_at: remote_meta
                                .and_then(|m| m.mtime)
                                .map(i64::from),
                            part_bytes,
                        });
                    }
                }
                TransferDirection::Download => {
                    let remote_meta = sftp.metadata(&remote_path).await?;
                    if remote_meta.file_type().is_dir() {
                        continue;
                    }
                    let local = Path::new(&local_path);
                    let part_path = PathBuf::from(format!("{local_path}{PART_SUFFIX}"));
                    let part_bytes = tokio::fs::metadata(&part_path)
                        .await
                        .map(|m| m.len())
                        .unwrap_or(0);
                    if local.exists() || part_bytes > 0 {
                        let local_meta = tokio::fs::metadata(local).await.ok();
                        conflicts.push(TransferConflict {
                            local_path,
                            remote_path,
                            file_name,
                            source_size: remote_meta.size.unwrap_or(0),
                            target_size: local_meta.as_ref().map_or(0, |m| m.len()),
                            source_modified_at: remote_meta.mtime.map(i64::from),
                            target_modified_at: local_meta
                                .and_then(|m| m.modified().ok())
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs() as i64),
                            part_bytes,
                        });
                    }
                }
            }
        }
        Ok(conflicts)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn enqueue_file(
        &self,
        app: AppHandle,
        sessions: Arc<SessionManager>,
        session_id: String,
        direction: TransferDirection,
        local_path: String,
        remote_path: String,
        conflict_policy: ConflictPolicy,
        verify_checksum: bool,
    ) -> Result<TransferTask, AppError> {
        validate_remote_path(&remote_path)?;
        let file_name = Path::new(&local_path)
            .file_name()
            .and_then(|n| n.to_str())
            .or_else(|| remote_path.rsplit('/').next())
            .unwrap_or("file")
            .to_owned();

        let id = Uuid::new_v4().to_string();
        let task = TransferTask {
            id: id.clone(),
            session_id,
            direction,
            local_path,
            remote_path,
            file_name,
            total_bytes: 0,
            transferred_bytes: 0,
            speed_bps: 0,
            eta_seconds: None,
            status: TransferStatus::Queued,
            error: None,
            checksum_verified: None,
            checksum_detail: None,
            conflict_policy,
        };

        let runtime = Arc::new(TransferRuntime {
            task: StdMutex::new(task.clone()),
            paused: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            verify_checksum,
        });

        self.tasks
            .lock()
            .expect("传输列表锁")
            .insert(id.clone(), runtime.clone());
        self.order.lock().expect("传输顺序锁").push(id);

        emit_task(&app, &runtime);
        tokio::spawn(run_transfer(app, sessions, runtime));
        Ok(task)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn enqueue_directory(
        &self,
        app: AppHandle,
        sessions: Arc<SessionManager>,
        session_id: String,
        direction: TransferDirection,
        local_dir: String,
        remote_dir: String,
        conflict_policy: ConflictPolicy,
        verify_checksum: bool,
    ) -> Result<Vec<TransferTask>, AppError> {
        validate_remote_path(&remote_dir)?;
        let sftp = sessions.sftp_for(&session_id).await?;
        let mut created = Vec::new();

        match direction {
            TransferDirection::Upload => {
                let root = PathBuf::from(&local_dir);
                if !root.is_dir() {
                    return Err(AppError::Validation("请选择有效的本地文件夹".into()));
                }
                let dir_name = root
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or_else(|| AppError::Validation("无效的文件夹名称".into()))?;
                let remote_root = format!("{}/{}", remote_dir.trim_end_matches('/'), dir_name);
                ensure_remote_dir(&sftp, &remote_root).await?;

                let mut stack = vec![(root, remote_root)];
                while let Some((curr_local, curr_remote)) = stack.pop() {
                    let mut entries = tokio::fs::read_dir(&curr_local).await?;
                    while let Some(entry) = entries.next_entry().await? {
                        let path = entry.path();
                        let name = entry.file_name().to_string_lossy().into_owned();
                        let target_remote = format!("{curr_remote}/{name}");
                        if path.is_dir() {
                            ensure_remote_dir(&sftp, &target_remote).await?;
                            stack.push((path, target_remote));
                        } else if path.is_file() {
                            created.push(self.enqueue_file(
                                app.clone(),
                                sessions.clone(),
                                session_id.clone(),
                                TransferDirection::Upload,
                                path.to_string_lossy().into_owned(),
                                target_remote,
                                conflict_policy.clone(),
                                verify_checksum,
                            )?);
                        }
                    }
                }
            }
            TransferDirection::Download => {
                let remote_clean = remote_dir.trim_end_matches('/');
                let dir_name = remote_clean.rsplit('/').next().unwrap_or("download");
                let local_root = PathBuf::from(&local_dir).join(dir_name);
                tokio::fs::create_dir_all(&local_root).await?;

                let mut stack = vec![(remote_clean.to_owned(), local_root)];
                while let Some((curr_remote, curr_local)) = stack.pop() {
                    for entry in sftp.read_dir(&curr_remote).await? {
                        let name = entry.file_name();
                        if name == "." || name == ".." {
                            continue;
                        }
                        let child_remote = entry.path();
                        let child_local = curr_local.join(&name);
                        if entry.file_type().is_dir() {
                            tokio::fs::create_dir_all(&child_local).await?;
                            stack.push((child_remote, child_local));
                        } else {
                            created.push(self.enqueue_file(
                                app.clone(),
                                sessions.clone(),
                                session_id.clone(),
                                TransferDirection::Download,
                                child_local.to_string_lossy().into_owned(),
                                child_remote,
                                conflict_policy.clone(),
                                verify_checksum,
                            )?);
                        }
                    }
                }
            }
        }

        Ok(created)
    }

    pub fn pause(&self, app: &AppHandle, id: &str) -> Result<TransferTask, AppError> {
        let rt = self.get(id)?;
        rt.paused.store(true, Ordering::Relaxed);
        let snap = rt.snapshot();
        emit_task(app, &rt);
        Ok(snap)
    }

    pub fn resume(
        &self,
        app: AppHandle,
        sessions: Arc<SessionManager>,
        id: &str,
    ) -> Result<TransferTask, AppError> {
        let rt = self.get(id)?;
        let status = rt.snapshot().status;
        if status == TransferStatus::Paused || status == TransferStatus::Failed {
            rt.paused.store(false, Ordering::Relaxed);
            rt.cancelled.store(false, Ordering::Relaxed);
            {
                let mut guard = rt.task.lock().expect("传输任务锁");
                guard.status = TransferStatus::Queued;
                guard.error = None;
                guard.conflict_policy = ConflictPolicy::Resume;
            }
            emit_task(&app, &rt);
            tokio::spawn(run_transfer(app, sessions, rt.clone()));
        }
        Ok(rt.snapshot())
    }

    pub fn cancel(&self, app: &AppHandle, id: &str) -> Result<TransferTask, AppError> {
        let rt = self.get(id)?;
        rt.cancelled.store(true, Ordering::Relaxed);
        {
            let mut guard = rt.task.lock().expect("传输任务锁");
            if matches!(
                guard.status,
                TransferStatus::Queued | TransferStatus::Paused
            ) {
                guard.status = TransferStatus::Cancelled;
            }
        }
        let snap = rt.snapshot();
        emit_task(app, &rt);
        Ok(snap)
    }

    pub fn clear_finished(&self) -> Vec<TransferTask> {
        let mut tasks = self.tasks.lock().expect("传输列表锁");
        let mut order = self.order.lock().expect("传输顺序锁");
        order.retain(|id| {
            let keep = tasks.get(id).is_some_and(|rt| {
                matches!(
                    rt.snapshot().status,
                    TransferStatus::Queued | TransferStatus::Running | TransferStatus::Paused
                )
            });
            if !keep {
                tasks.remove(id);
            }
            keep
        });
        order
            .iter()
            .rev()
            .filter_map(|id| tasks.get(id).map(|rt| rt.snapshot()))
            .collect()
    }

    fn get(&self, id: &str) -> Result<Arc<TransferRuntime>, AppError> {
        self.tasks
            .lock()
            .expect("传输列表锁")
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::Validation("传输任务不存在".into()))
    }
}

async fn ensure_remote_dir(
    sftp: &russh_sftp::client::SftpSession,
    path: &str,
) -> Result<(), AppError> {
    if !sftp.try_exists(path).await? {
        sftp.create_dir(path).await?;
    }
    Ok(())
}

fn emit_task(app: &AppHandle, rt: &TransferRuntime) {
    let _ = app.emit("transfer-event", rt.snapshot());
}

async fn run_transfer(
    app: AppHandle,
    sessions: Arc<SessionManager>,
    rt: Arc<TransferRuntime>,
) {
    {
        let mut guard = rt.task.lock().expect("传输任务锁");
        guard.status = TransferStatus::Running;
        guard.error = None;
    }
    emit_task(&app, &rt);

    let snap = rt.snapshot();
    let result = match snap.direction {
        TransferDirection::Upload => execute_upload(&app, &sessions, &rt).await,
        TransferDirection::Download => execute_download(&app, &sessions, &rt).await,
    };

    match result {
        Ok(final_status) => {
            let mut guard = rt.task.lock().expect("传输任务锁");
            guard.status = final_status;
            guard.speed_bps = 0;
            guard.eta_seconds = None;
        }
        Err(err) => {
            let mut guard = rt.task.lock().expect("传输任务锁");
            guard.status = if rt.cancelled.load(Ordering::Relaxed) {
                TransferStatus::Cancelled
            } else if rt.paused.load(Ordering::Relaxed) {
                TransferStatus::Paused
            } else {
                TransferStatus::Failed
            };
            guard.speed_bps = 0;
            guard.eta_seconds = None;
            if guard.status == TransferStatus::Failed {
                guard.error = Some(err.to_string());
            }
        }
    }
    emit_task(&app, &rt);
}

async fn execute_upload(
    app: &AppHandle,
    sessions: &SessionManager,
    rt: &TransferRuntime,
) -> Result<TransferStatus, AppError> {
    let snap = rt.snapshot();
    let sftp = sessions.sftp_for(&snap.session_id).await?;
    let local_meta = tokio::fs::metadata(&snap.local_path).await?;
    if !local_meta.is_file() {
        return Err(AppError::Validation("只能上传普通文件".into()));
    }
    let total = local_meta.len();
    {
        rt.task.lock().expect("传输任务锁").total_bytes = total;
    }

    let mut target_remote = snap.remote_path.clone();
    let exists = sftp.try_exists(&target_remote).await?;
    if exists {
        match snap.conflict_policy {
            ConflictPolicy::Skip => return Ok(TransferStatus::Completed),
            ConflictPolicy::Rename => {
                target_remote = next_remote_name(&sftp, &target_remote).await?;
                rt.task.lock().expect("传输任务锁").remote_path = target_remote.clone();
            }
            ConflictPolicy::Ask => {
                return Err(AppError::Validation("远端目标已存在，未执行覆盖".into()));
            }
            ConflictPolicy::Overwrite | ConflictPolicy::Resume => {}
        }
    }

    let part_remote = format!("{target_remote}{PART_SUFFIX}");
    let mut resume_offset = 0u64;
    if matches!(snap.conflict_policy, ConflictPolicy::Resume) && sftp.try_exists(&part_remote).await?
    {
        let part_len = sftp.metadata(&part_remote).await?.size.unwrap_or(0);
        if part_len < total {
            resume_offset = part_len;
        }
    }

    let mut local_file = tokio::fs::File::open(&snap.local_path).await?;
    let mut remote_file = if resume_offset > 0 {
        local_file.seek(SeekFrom::Start(resume_offset)).await?;
        let mut f = sftp
            .open_with_flags(&part_remote, OpenFlags::WRITE | OpenFlags::APPEND)
            .await?;
        let _ = f.seek(SeekFrom::Start(resume_offset)).await;
        f
    } else {
        if sftp.try_exists(&part_remote).await? {
            let _ = sftp.remove_file(&part_remote).await;
        }
        sftp.open_with_flags(
            &part_remote,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await?
    };

    let mut transferred = resume_offset;
    let started = Instant::now();
    let mut last_emit = Instant::now();
    let mut buf = vec![0u8; CHUNK_SIZE];

    loop {
        if rt.cancelled.load(Ordering::Relaxed) {
            let _ = remote_file.close().await;
            let _ = sftp.remove_file(&part_remote).await;
            return Ok(TransferStatus::Cancelled);
        }
        if rt.paused.load(Ordering::Relaxed) {
            let _ = remote_file.flush().await;
            let _ = remote_file.close().await;
            return Ok(TransferStatus::Paused);
        }

        let n = local_file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        remote_file.write_all(&buf[..n]).await?;
        transferred += n as u64;

        if last_emit.elapsed().as_millis() >= 120 {
            update_progress(rt, transferred, total, resume_offset, started);
            emit_task(app, rt);
            last_emit = Instant::now();
        }
    }

    remote_file.flush().await?;
    remote_file.close().await?;

    if sftp.try_exists(&target_remote).await? {
        sftp.remove_file(&target_remote).await?;
    }
    sftp.rename(&part_remote, &target_remote).await?;

    update_progress(rt, total, total, resume_offset, started);

    if rt.verify_checksum {
        let local_hash = sha256_local_file(&snap.local_path).await?;
        let (verified, detail) =
            verify_remote_sha256(sessions, &snap.session_id, &target_remote, &local_hash).await;
        let mut guard = rt.task.lock().expect("传输任务锁");
        guard.checksum_verified = verified;
        guard.checksum_detail = Some(detail);
    }

    Ok(TransferStatus::Completed)
}

async fn execute_download(
    app: &AppHandle,
    sessions: &SessionManager,
    rt: &TransferRuntime,
) -> Result<TransferStatus, AppError> {
    let snap = rt.snapshot();
    let sftp = sessions.sftp_for(&snap.session_id).await?;
    let remote_meta = sftp.metadata(&snap.remote_path).await?;
    if remote_meta.file_type().is_dir() {
        return Err(AppError::Validation("目录请使用目录下载".into()));
    }
    let total = remote_meta.size.unwrap_or(0);
    {
        rt.task.lock().expect("传输任务锁").total_bytes = total;
    }

    let mut target_local = PathBuf::from(&snap.local_path);
    if target_local.exists() {
        match snap.conflict_policy {
            ConflictPolicy::Skip => return Ok(TransferStatus::Completed),
            ConflictPolicy::Rename => {
                target_local = next_local_name(&target_local);
                rt.task.lock().expect("传输任务锁").local_path =
                    target_local.to_string_lossy().into_owned();
            }
            ConflictPolicy::Ask => {
                return Err(AppError::Validation("本地目标已存在，未执行覆盖".into()));
            }
            ConflictPolicy::Overwrite | ConflictPolicy::Resume => {}
        }
    }

    if let Some(parent) = target_local.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let part_local = PathBuf::from(format!("{}{PART_SUFFIX}", target_local.to_string_lossy()));
    let mut resume_offset = 0u64;
    if matches!(snap.conflict_policy, ConflictPolicy::Resume) && part_local.exists() {
        let part_len = tokio::fs::metadata(&part_local).await?.len();
        if part_len < total {
            resume_offset = part_len;
        }
    }

    let mut remote_file = sftp.open(&snap.remote_path).await?;
    if resume_offset > 0 {
        remote_file.seek(SeekFrom::Start(resume_offset)).await?;
    }

    let mut local_file = if resume_offset > 0 {
        let mut f = tokio::fs::OpenOptions::new()
            .write(true)
            .open(&part_local)
            .await?;
        f.seek(SeekFrom::Start(resume_offset)).await?;
        f
    } else {
        tokio::fs::File::create(&part_local).await?
    };

    let mut transferred = resume_offset;
    let started = Instant::now();
    let mut last_emit = Instant::now();
    let mut buf = vec![0u8; CHUNK_SIZE];

    loop {
        if rt.cancelled.load(Ordering::Relaxed) {
            let _ = local_file.flush().await;
            drop(local_file);
            let _ = tokio::fs::remove_file(&part_local).await;
            return Ok(TransferStatus::Cancelled);
        }
        if rt.paused.load(Ordering::Relaxed) {
            let _ = local_file.flush().await;
            return Ok(TransferStatus::Paused);
        }

        let n = remote_file.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        local_file.write_all(&buf[..n]).await?;
        transferred += n as u64;

        if last_emit.elapsed().as_millis() >= 120 {
            update_progress(rt, transferred, total, resume_offset, started);
            emit_task(app, rt);
            last_emit = Instant::now();
        }
    }

    local_file.flush().await?;
    drop(local_file);
    let _ = remote_file.close().await;

    if target_local.exists() {
        tokio::fs::remove_file(&target_local).await?;
    }
    tokio::fs::rename(&part_local, &target_local).await?;

    update_progress(rt, transferred, total, resume_offset, started);

    if rt.verify_checksum {
        let local_hash = sha256_local_file(&target_local.to_string_lossy()).await?;
        let (verified, detail) =
            verify_remote_sha256(sessions, &snap.session_id, &snap.remote_path, &local_hash).await;
        let mut guard = rt.task.lock().expect("传输任务锁");
        guard.checksum_verified = verified;
        guard.checksum_detail = Some(detail);
    }

    Ok(TransferStatus::Completed)
}

fn update_progress(
    rt: &TransferRuntime,
    transferred: u64,
    total: u64,
    start_offset: u64,
    started: Instant,
) {
    let elapsed = started.elapsed().as_secs_f64().max(0.05);
    let delta = transferred.saturating_sub(start_offset) as f64;
    let speed = (delta / elapsed) as u64;
    let remaining = total.saturating_sub(transferred);
    let eta = remaining.checked_div(speed);

    let mut guard = rt.task.lock().expect("传输任务锁");
    guard.transferred_bytes = transferred;
    guard.speed_bps = speed;
    guard.eta_seconds = eta;
}

async fn next_remote_name(
    sftp: &russh_sftp::client::SftpSession,
    path: &str,
) -> Result<String, AppError> {
    let (dir, filename) = match path.rsplit_once('/') {
        Some((d, f)) => (d, f),
        None => ("", path),
    };
    let (stem, ext) = match filename.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s, Some(e)),
        _ => (filename, None),
    };
    for index in 1..=999 {
        let candidate_name = match ext {
            Some(e) => format!("{stem} ({index}).{e}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = if dir.is_empty() {
            format!("/{candidate_name}")
        } else {
            format!("{dir}/{candidate_name}")
        };
        if !sftp.try_exists(&candidate).await? {
            return Ok(candidate);
        }
    }
    Err(AppError::Validation("无法生成不冲突的文件名".into()))
}

fn next_local_name(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path.extension().and_then(|e| e.to_str());
    for index in 1..=999 {
        let name = match ext {
            Some(e) => format!("{stem} ({index}).{e}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    path.to_path_buf()
}

async fn sha256_local_file(path: &str) -> Result<String, AppError> {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let mut file = std::fs::File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = std::io::Read::read(&mut file, &mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        let digest = hasher.finalize();
        Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
    })
    .await
    .map_err(|err| AppError::Io(err.to_string()))?
}

async fn verify_remote_sha256(
    sessions: &SessionManager,
    session_id: &str,
    remote_path: &str,
    local_hash: &str,
) -> (Option<bool>, String) {
    let escaped = remote_path.replace('\'', "'\\''");
    let cmd = format!("sha256sum '{escaped}' 2>/dev/null || shasum -a 256 '{escaped}' 2>/dev/null");
    match sessions.exec_command(session_id, &cmd).await {
        Ok(output) => {
            if let Some(remote_hash) = output.split_whitespace().next() {
                if remote_hash.len() == 64 {
                    let matched = remote_hash.eq_ignore_ascii_case(local_hash);
                    return (
                        Some(matched),
                        format!(
                            "SHA-256 {}",
                            if matched {
                                format!("校验通过 ({}…)", &local_hash[..10])
                            } else {
                                "不一致".to_owned()
                            }
                        ),
                    );
                }
            }
            (None, format!("本地 SHA-256: {}…（远端无校验工具）", &local_hash[..10]))
        }
        Err(_) => (None, format!("本地 SHA-256: {}…", &local_hash[..10])),
    }
}
