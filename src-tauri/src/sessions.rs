use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use russh::{
    client,
    keys::{HashAlg, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate},
    ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Disconnect,
};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use serde::Serialize;
use tokio::{
    io::AsyncWriteExt,
    sync::{broadcast, oneshot, Mutex},
};
use uuid::Uuid;

use crate::domain::{
    AppError, AuthKind, ConnectionProfile, HostKeyInfo, MountMetric, ProcessMetric, RemoteEntry,
    SessionStatus, SystemMetrics,
};

type ClientHandle = client::Handle<ClientHandler>;
type TerminalWriter = ChannelWriteHalf<client::Msg>;

struct ClientHandler {
    host_key: String,
    expected_host_key: Option<String>,
}

fn client_handler(host_key: String, expected_host_key: Option<String>) -> ClientHandler {
    ClientHandler {
        host_key,
        expected_host_key,
    }
}

impl client::Handler for ClientHandler {
    type Error = AppError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let actual = public_key_openssh(&server_public_key.public_key())?;
        if actual != self.host_key {
            return Err(AppError::Ssh("服务器返回了不一致的主机公钥".into()));
        }
        if self
            .expected_host_key
            .as_deref()
            .is_some_and(|expected| expected != actual)
        {
            return Ok(false);
        }
        Ok(true)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionEvent {
    Status {
        session_id: String,
        status: SessionStatus,
        message: Option<String>,
    },
    Output {
        session_id: String,
        data: String,
    },
}

struct Session {
    handle: Arc<Mutex<ClientHandle>>,
    monitor: Mutex<Option<ClientHandle>>,
    terminal: Mutex<Option<TerminalWriter>>,
    sftp: Mutex<Option<Arc<SftpSession>>>,
    events: broadcast::Sender<SessionEvent>,
    cpu_sample: StdMutex<Option<(u64, u64)>>,
    profile: ConnectionProfile,
    password: Option<String>,
    host_key: String,
}

pub struct SessionManager {
    sessions: Arc<StdMutex<HashMap<String, Arc<Session>>>>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(StdMutex::new(HashMap::new())),
        }
    }

    pub async fn connect(
        &self,
        profile: ConnectionProfile,
        password: Option<String>,
        expected_host_key: Option<String>,
    ) -> Result<String, AppError> {
        let (events, _) = broadcast::channel(512);
        let id = Uuid::new_v4().to_string();
        emit(&events, &id, SessionStatus::Connecting, None);
        let config = Arc::new(client::Config {
            inactivity_timeout: None,
            keepalive_interval: Some(Duration::from_secs(20)),
            nodelay: true,
            ..Default::default()
        });
        let address = (profile.host.as_str(), profile.port);
        let handler = client_handler(
            expected_host_key.clone().unwrap_or_default(),
            expected_host_key.clone(),
        );
        let mut handle = client::connect(config, address, handler)
            .await
            .map_err(|error| AppError::Ssh(error.to_string()))?;
        if expected_host_key.is_none() {
            return Err(AppError::Ssh("缺少已确认的主机公钥".into()));
        }
        emit(&events, &id, SessionStatus::Authenticating, None);

        let authenticated = match profile.auth {
            AuthKind::Password => {
                let password = password
                    .as_ref()
                    .ok_or_else(|| AppError::Credential("密码未保存或无法读取".into()))?;
                handle
                    .authenticate_password(&profile.username, password)
                    .await?
            }
            AuthKind::PrivateKey => {
                let path = profile
                    .private_key_path
                    .as_deref()
                    .ok_or_else(|| AppError::Validation("私钥路径为空".into()))?;
                let key = russh::keys::load_secret_key(path, None)
                    .map_err(|error| AppError::Credential(format!("私钥读取失败：{error}")))?;
                let hash = handle.best_supported_rsa_hash().await?.flatten();
                let key = PrivateKeyWithHashAlg::new(Arc::new(key), hash);
                handle
                    .authenticate_publickey(&profile.username, key)
                    .await?
            }
        };
        if !authenticated.success() {
            return Err(AppError::AuthenticationFailed);
        }

        let mut terminal = handle.channel_open_session().await?;
        terminal
            .request_pty(true, "xterm-256color", 120, 32, 0, 0, &[])
            .await?;
        wait_for_request(&mut terminal, "终端").await?;
        terminal.request_shell(true).await?;
        wait_for_request(&mut terminal, "Shell").await?;
        let (reader, writer) = terminal.split();
        let handle = Arc::new(Mutex::new(handle));
        let session = Arc::new(Session {
            handle,
            terminal: Mutex::new(Some(writer)),
            sftp: Mutex::new(None),
            events: events.clone(),
            cpu_sample: StdMutex::new(None),
            profile,
            password,
            host_key: expected_host_key.expect("已验证主机公钥"),
            monitor: Mutex::new(None),
        });
        self.sessions
            .lock()
            .expect("会话锁不可用")
            .insert(id.clone(), session);
        emit(&events, &id, SessionStatus::Connected, None);
        tokio::spawn(read_terminal(id.clone(), reader, events));
        Ok(id)
    }

    pub fn subscribe(&self, id: &str) -> Result<broadcast::Receiver<SessionEvent>, AppError> {
        let receiver = self.subscribe_events(id)?;
        let session = self.get(id)?;
        emit(&session.events, id, SessionStatus::Connected, None);
        Ok(receiver)
    }

    pub fn subscribe_events(
        &self,
        id: &str,
    ) -> Result<broadcast::Receiver<SessionEvent>, AppError> {
        Ok(self.get(id)?.events.subscribe())
    }

    pub fn status(&self, id: &str) -> Result<SessionStatus, AppError> {
        self.get(id)?;
        Ok(SessionStatus::Connected)
    }

    pub async fn input(&self, id: &str, bytes: Vec<u8>) -> Result<(), AppError> {
        let session = self.get(id)?;
        let terminal = session.terminal.lock().await;
        let terminal = terminal.as_ref().ok_or(AppError::SessionNotFound)?;
        terminal.data_bytes(bytes).await?;
        Ok(())
    }

    pub async fn resize(&self, id: &str, columns: u32, rows: u32) -> Result<(), AppError> {
        if columns == 0 || rows == 0 {
            return Ok(());
        }
        let session = self.get(id)?;
        let terminal = session.terminal.lock().await;
        let terminal = terminal.as_ref().ok_or(AppError::SessionNotFound)?;
        terminal.window_change(columns, rows, 0, 0).await?;
        Ok(())
    }

    pub async fn disconnect(&self, id: &str) -> Result<(), AppError> {
        let session = self
            .sessions
            .lock()
            .expect("会话锁不可用")
            .remove(id)
            .ok_or(AppError::SessionNotFound)?;
        session
            .handle
            .lock()
            .await
            .disconnect(Disconnect::ByApplication, "用户关闭会话", "zh-CN")
            .await?;
        session.monitor.lock().await.take();
        emit(&session.events, id, SessionStatus::Closed, None);
        Ok(())
    }

    pub async fn list_directory(&self, id: &str, path: &str) -> Result<Vec<RemoteEntry>, AppError> {
        validate_remote_path(path)?;
        let session = self.get(id)?;
        let sftp = self.sftp(&session).await?;
        let entries = sftp.read_dir(path).await?;
        let mut result = entries
            .map(|entry| {
                let metadata = entry.metadata();
                RemoteEntry {
                    name: entry.file_name(),
                    path: entry.path(),
                    is_dir: entry.file_type().is_dir(),
                    size: metadata.size.unwrap_or(0),
                    modified_at: metadata.mtime.map(i64::from),
                    permissions: metadata.permissions,
                }
            })
            .collect::<Vec<_>>();
        result.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(result)
    }

    pub async fn download_file(
        &self,
        id: &str,
        remote: &str,
        local: &str,
    ) -> Result<u64, AppError> {
        validate_remote_path(remote)?;
        let local = safe_local_file(local)?;
        if local.exists() {
            return Err(AppError::Validation(
                "本地目标已存在，请选择新的文件路径".into(),
            ));
        }
        let session = self.get(id)?;
        let sftp = self.sftp(&session).await?;
        let mut remote_file = sftp.open(remote).await?;
        let mut local_file = tokio::fs::File::create_new(&local).await?;
        let bytes = tokio::io::copy(&mut remote_file, &mut local_file).await?;
        local_file.flush().await?;
        remote_file.close().await?;
        Ok(bytes)
    }

    pub async fn upload_file(&self, id: &str, local: &str, remote: &str) -> Result<u64, AppError> {
        validate_remote_path(remote)?;
        let local = PathBuf::from(local);
        let metadata = tokio::fs::metadata(&local).await?;
        if !metadata.is_file() {
            return Err(AppError::Validation("只能上传普通文件".into()));
        }
        if self.sftp_exists(&self.get(id)?, remote).await? {
            return Err(AppError::Validation("远端目标已存在，未执行覆盖".into()));
        }
        let session = self.get(id)?;
        let sftp = self.sftp(&session).await?;
        let mut local_file = tokio::fs::File::open(local).await?;
        let mut remote_file = sftp
            .open_with_flags(
                remote,
                OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
            )
            .await?;
        let bytes = tokio::io::copy(&mut local_file, &mut remote_file).await?;
        remote_file.flush().await?;
        remote_file.close().await?;
        Ok(bytes)
    }

    pub async fn read_text_file(&self, id: &str, remote: &str) -> Result<String, AppError> {
        validate_remote_path(remote)?;
        let session = self.get(id)?;
        let sftp = self.sftp(&session).await?;
        let metadata = sftp.metadata(remote).await?;
        if metadata.file_type().is_dir() {
            return Err(AppError::Validation("目录不能使用文本编辑器".into()));
        }
        if metadata.size.unwrap_or(0) > 1024 * 1024 {
            return Err(AppError::Validation(
                "快速查看仅支持不超过 1 MB 的文件，请下载后编辑".into(),
            ));
        }
        let mut file = sftp.open(remote).await?;
        let mut bytes = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut file, &mut bytes).await?;
        file.close().await?;
        if bytes.contains(&0) {
            return Err(AppError::Validation(
                "这是二进制文件，不能快速编辑，请下载后处理".into(),
            ));
        }
        String::from_utf8(bytes)
            .map_err(|_| AppError::Validation("仅支持 UTF-8 文本文件，请下载后编辑".into()))
    }

    pub async fn write_text_file(
        &self,
        id: &str,
        remote: &str,
        text: String,
    ) -> Result<(), AppError> {
        validate_remote_path(remote)?;
        if text.len() > 1024 * 1024 {
            return Err(AppError::Validation("编辑后的文件不能超过 1 MB".into()));
        }
        let session = self.get(id)?;
        let sftp = self.sftp(&session).await?;
        if !sftp.try_exists(remote).await? {
            return Err(AppError::Validation("远程文件已不存在，未执行保存".into()));
        }
        sftp.write(remote, text.as_bytes()).await?;
        Ok(())
    }

    pub async fn system_metrics(&self, id: &str) -> Result<SystemMetrics, AppError> {
        let session = self.get(id)?;
        let mut slot = session.monitor.lock().await;
        let result = async {
        if slot.is_none() {
            *slot = Some(self.connect_monitor(&session).await?);
        }
        let handle = slot.as_mut().expect("监控连接已建立");
        let mut channel = handle.channel_open_session().await?;
        channel
            .exec(true, "printf '\\036HOST\\n'; hostname; printf '\\036SYSTEM\\n'; uname -srm; printf '\\036CPU\\n'; cat /proc/stat; sleep 0.6; printf '\\036CPU\\n'; cat /proc/stat; printf '\\036MEMORY\\n'; cat /proc/meminfo; printf '\\036LOAD\\n'; cat /proc/loadavg; printf '\\036DISK\\n'; df -P -k /; printf '\\036MOUNTS\\n'; df -P -k -x tmpfs -x devtmpfs -x overlay; printf '\\036UPTIME\\n'; cat /proc/uptime; printf '\\036NETWORK\\n'; cat /proc/net/dev; printf '\\036PROCESSES\\n'; ps -eo comm,pcpu,rss --sort=-pcpu; printf '\\036COMPLETE\\n'")
            .await?;
        wait_for_request(&mut channel, "资源监控").await?;
        let mut output = Vec::new();
        let mut exit_status = None;
        let mut stderr = Vec::new();
        let mut complete = false;
        tokio::time::timeout(Duration::from_secs(10), async {
            while !complete {
                let Some(message) = channel.wait().await else {
                    break;
                };
                match message {
                    ChannelMsg::Data { data } => {
                        if output.len() + data.len() > 128 * 1024 {
                            return Err(AppError::Ssh("服务器监控输出异常".into()));
                        }
                        output.extend_from_slice(&data);
                        complete = output
                            .windows("\u{1e}COMPLETE\n".len())
                            .any(|window| window == "\u{1e}COMPLETE\n".as_bytes());
                    }
                    ChannelMsg::ExtendedData { data, .. } => {
                        let remaining = 4096usize.saturating_sub(stderr.len());
                        stderr.extend_from_slice(&data[..data.len().min(remaining)]);
                    }
                    ChannelMsg::ExitStatus {
                        exit_status: status,
                    } => exit_status = Some(status),
                    ChannelMsg::Eof | ChannelMsg::Close => break,
                    _ => {}
                }
            }
            Ok(())
        })
        .await
        .map_err(|_| AppError::Ssh("读取服务器资源超时".into()))??;
        if !complete {
            return Err(AppError::Ssh("服务器资源采集未完成，将自动重试".into()));
        }
        let text = String::from_utf8(output)
            .map_err(|_| AppError::Ssh("服务器监控数据格式错误".into()))?;
        let text = text.split("\u{1e}COMPLETE\n").next().unwrap_or_default();
        if exit_status.is_some_and(|status| status != 0) {
            let detail = String::from_utf8_lossy(&stderr);
            return Err(AppError::Ssh(format!(
                "服务器资源采集失败：{}",
                detail.trim()
            )));
        }
        if !text.starts_with("\u{1e}HOST\n") || !text.contains("\u{1e}UPTIME\n") {
            return Err(AppError::Ssh(
                "服务器资源数据不完整，请确认 Linux 的 /proc 和 df 命令可用".into(),
            ));
        }
        let samples = text
            .lines()
            .filter(|line| line.starts_with("cpu "))
            .collect::<Vec<_>>();
        let normalized = text
            .lines()
            .filter(|line| !line.starts_with("cpu "))
            .collect::<Vec<_>>()
            .join("\n");
        let normalized = format!(
            "\u{1e}CPU\n{}\n{normalized}",
            samples.last().copied().unwrap_or_default()
        );
        let previous = if samples.len() > 1 {
            Some(cpu_times(samples[0])?)
        } else {
            *session.cpu_sample.lock().expect("监控锁不可用")
        };
        let last_cpu = samples.last().copied().unwrap_or_default();
        let metrics = parse_metrics(&normalized, previous)?;
        let (total, idle) = cpu_times(last_cpu)?;
        *session.cpu_sample.lock().expect("监控锁不可用") = Some((total, idle));
        Ok(metrics)
        }
        .await;
        if result.is_err() {
            *slot = None;
        }
        result
    }

    async fn connect_monitor(&self, session: &Arc<Session>) -> Result<ClientHandle, AppError> {
        let config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_secs(30)),
            keepalive_interval: Some(Duration::from_secs(15)),
            nodelay: true,
            ..Default::default()
        });
        let handler = client_handler(session.host_key.clone(), Some(session.host_key.clone()));
        let mut handle = tokio::time::timeout(
            Duration::from_secs(8),
            client::connect(
                config,
                (session.profile.host.as_str(), session.profile.port),
                handler,
            ),
        )
        .await
        .map_err(|_| AppError::Ssh("资源监控连接超时".into()))?
        .map_err(|error| AppError::Ssh(format!("资源监控连接失败：{error}")))?;
        let authenticated = match &session.profile.auth {
            AuthKind::Password => {
                let password = session
                    .password
                    .as_ref()
                    .ok_or_else(|| AppError::Credential("监控无法读取密码".into()))?;
                handle
                    .authenticate_password(&session.profile.username, password)
                    .await?
            }
            AuthKind::PrivateKey => {
                let path = session
                    .profile
                    .private_key_path
                    .as_deref()
                    .ok_or_else(|| AppError::Validation("私钥路径为空".into()))?;
                let key = russh::keys::load_secret_key(path, None)
                    .map_err(|error| AppError::Credential(format!("私钥读取失败：{error}")))?;
                let hash = handle.best_supported_rsa_hash().await?.flatten();
                handle
                    .authenticate_publickey(
                        &session.profile.username,
                        PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                    )
                    .await?
            }
        };
        if !authenticated.success() {
            return Err(AppError::AuthenticationFailed);
        }
        Ok(handle)
    }

    async fn sftp_exists(&self, session: &Arc<Session>, path: &str) -> Result<bool, AppError> {
        Ok(self.sftp(session).await?.try_exists(path).await?)
    }

    async fn sftp(&self, session: &Arc<Session>) -> Result<Arc<SftpSession>, AppError> {
        let mut slot = session.sftp.lock().await;
        if let Some(sftp) = slot.as_ref() {
            return Ok(sftp.clone());
        }
        let mut channel = session.handle.lock().await.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        wait_for_request(&mut channel, "SFTP").await?;
        let sftp = Arc::new(SftpSession::new(channel.into_stream()).await?);
        sftp.set_timeout(30);
        *slot = Some(sftp.clone());
        Ok(sftp)
    }

    fn get(&self, id: &str) -> Result<Arc<Session>, AppError> {
        self.sessions
            .lock()
            .expect("会话锁不可用")
            .get(id)
            .cloned()
            .ok_or(AppError::SessionNotFound)
    }
}

async fn wait_for_request(
    channel: &mut russh::Channel<client::Msg>,
    name: &str,
) -> Result<(), AppError> {
    tokio::time::timeout(Duration::from_secs(8), async {
        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Success => return Ok(()),
                ChannelMsg::Failure => return Err(AppError::Ssh(format!("服务器拒绝启动{name}"))),
                ChannelMsg::Eof | ChannelMsg::Close => {
                    return Err(AppError::Ssh(format!("{name}通道在启动前关闭")))
                }
                _ => {}
            }
        }
        Err(AppError::Ssh(format!("{name}通道已断开")))
    })
    .await
    .map_err(|_| AppError::Ssh(format!("{name}启动超时，请检查服务器配置")))?
}

fn section<'a>(text: &'a str, name: &str) -> &'a str {
    let marker = format!("\u{1e}{name}\n");
    let start = text.find(&marker).map_or(0, |index| index + marker.len());
    text[start..].split('\u{1e}').next().unwrap_or_default()
}

fn cpu_times(text: &str) -> Result<(u64, u64), AppError> {
    let values = text
        .lines()
        .find(|line| line.starts_with("cpu "))
        .and_then(|line| {
            line.split_whitespace()
                .skip(1)
                .map(|value| value.parse::<u64>().ok())
                .collect::<Option<Vec<_>>>()
        })
        .ok_or_else(|| AppError::Ssh("无法读取 CPU 数据".into()))?;
    let total = values.iter().sum();
    let idle = values.get(3).copied().unwrap_or(0) + values.get(4).copied().unwrap_or(0);
    Ok((total, idle))
}

fn parse_metrics(text: &str, previous: Option<(u64, u64)>) -> Result<SystemMetrics, AppError> {
    let (total, idle) = cpu_times(section(text, "CPU"))?;
    let cpu_percent = previous.and_then(|(old_total, old_idle)| {
        let elapsed = total.checked_sub(old_total)?;
        let idle_elapsed = idle.checked_sub(old_idle)?;
        (elapsed >= idle_elapsed).then(|| (elapsed - idle_elapsed) as f32 / elapsed as f32 * 100.0)
    });
    let mut memory = HashMap::new();
    for line in section(text, "MEMORY").lines() {
        let mut fields = line.split_whitespace();
        if let (Some(name), Some(value)) = (fields.next(), fields.next()) {
            if let Ok(value) = value.parse::<u64>() {
                memory.insert(name.trim_end_matches(':'), value * 1024);
            }
        }
    }
    let memory_total = *memory.get("MemTotal").unwrap_or(&0);
    let available = *memory
        .get("MemAvailable")
        .or_else(|| memory.get("MemFree"))
        .unwrap_or(&0);
    let memory_used = memory_total.saturating_sub(available);
    let swap_total = *memory.get("SwapTotal").unwrap_or(&0);
    let swap_used = swap_total.saturating_sub(*memory.get("SwapFree").unwrap_or(&0));
    let loads = section(text, "LOAD")
        .split_whitespace()
        .take(3)
        .map(|value| value.parse::<f32>().unwrap_or(0.0))
        .collect::<Vec<_>>();
    let disk = section(text, "DISK")
        .lines()
        .nth(1)
        .ok_or_else(|| AppError::Ssh("无法读取磁盘数据".into()))?;
    let disk_fields = disk.split_whitespace().collect::<Vec<_>>();
    let disk_total = disk_fields
        .get(1)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
        * 1024;
    let disk_used = disk_fields
        .get(2)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
        * 1024;
    let disk_percent = disk_fields
        .get(4)
        .and_then(|value| value.trim_end_matches('%').parse::<f32>().ok())
        .unwrap_or(0.0);
    let uptime_seconds = section(text, "UPTIME")
        .split_whitespace()
        .next()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0) as u64;
    let mut network_receive_bytes = 0;
    let mut network_transmit_bytes = 0;
    for line in section(text, "NETWORK").lines() {
        let Some((interface, values)) = line.split_once(':') else {
            continue;
        };
        if interface.trim() == "lo" {
            continue;
        }
        let values = values.split_whitespace().collect::<Vec<_>>();
        network_receive_bytes += values
            .first()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
        network_transmit_bytes += values
            .get(8)
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
    }
    let processes = section(text, "PROCESSES")
        .lines()
        .skip(1)
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let name = fields.next()?.to_owned();
            let cpu_percent = fields.next()?.parse().ok()?;
            let memory_bytes = fields.next()?.parse::<u64>().ok()? * 1024;
            Some(ProcessMetric {
                name,
                cpu_percent,
                memory_bytes,
            })
        })
        .take(6)
        .collect();
    let mounts = section(text, "MOUNTS")
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields = line.split_whitespace().collect::<Vec<_>>();
            if fields.len() < 6 {
                return None;
            }
            let total = fields[1].parse::<u64>().ok()? * 1024;
            let available = fields[3].parse::<u64>().ok()? * 1024;
            let percent = fields[4].trim_end_matches('%').parse().ok()?;
            Some(MountMetric {
                path: fields[5..].join(" "),
                available,
                total,
                percent,
            })
        })
        .take(12)
        .collect();
    Ok(SystemMetrics {
        hostname: section(text, "HOST").trim().to_owned(),
        system: section(text, "SYSTEM").trim().to_owned(),
        cpu_percent,
        memory_percent: percent(memory_used, memory_total),
        memory_used,
        memory_total,
        load_average: [
            loads.first().copied().unwrap_or(0.0),
            loads.get(1).copied().unwrap_or(0.0),
            loads.get(2).copied().unwrap_or(0.0),
        ],
        disk_percent,
        disk_used,
        disk_total,
        uptime_seconds,
        swap_percent: percent(swap_used, swap_total),
        swap_used,
        swap_total,
        network_receive_bytes,
        network_transmit_bytes,
        processes,
        mounts,
    })
}

fn percent(used: u64, total: u64) -> f32 {
    if total == 0 {
        0.0
    } else {
        used as f32 / total as f32 * 100.0
    }
}

#[cfg(test)]
mod metrics_tests {
    use super::*;

    #[test]
    fn parses_linux_resource_metrics() {
        let text = "\u{1e}HOST\nserver\n\u{1e}SYSTEM\nLinux 6.1 x86_64\n\u{1e}CPU\ncpu 100 0 100 700 100 0 0 0 0 0\n\u{1e}MEMORY\nMemTotal: 1000 kB\nMemAvailable: 250 kB\nSwapTotal: 500 kB\nSwapFree: 250 kB\n\u{1e}LOAD\n0.10 0.20 0.30 1/100 1\n\u{1e}DISK\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 1000 250 750 25% /\n\u{1e}MOUNTS\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 1000 250 750 25% /\n\u{1e}UPTIME\n3600.50 0.00\n\u{1e}NETWORK\neth0: 1024 0 0 0 0 0 0 0 2048 0 0 0 0 0 0 0\n\u{1e}PROCESSES\nCOMMAND %CPU RSS\nserver 12.5 128\n";
        let metrics = parse_metrics(text, Some((900, 700))).unwrap();
        assert_eq!(metrics.hostname, "server");
        assert_eq!(metrics.cpu_percent, Some(0.0));
        assert_eq!(metrics.memory_percent, 75.0);
        assert_eq!(metrics.disk_used, 250 * 1024);
        assert_eq!(metrics.uptime_seconds, 3600);
        assert_eq!(metrics.swap_percent, 50.0);
        assert_eq!(metrics.network_receive_bytes, 1024);
        assert_eq!(metrics.processes[0].name, "server");
        assert_eq!(metrics.mounts[0].path, "/");
        let busy = text.replace("cpu 100 0 100 700", "cpu 150 0 100 700");
        let busy_percent = parse_metrics(&busy, Some((900, 700)))
            .unwrap()
            .cpu_percent
            .unwrap();
        assert!((busy_percent - 100.0 / 3.0).abs() < 0.001);
    }
}

async fn read_terminal(
    id: String,
    mut terminal: ChannelReadHalf,
    events: broadcast::Sender<SessionEvent>,
) {
    loop {
        match terminal.wait().await {
            Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                let _ = events.send(SessionEvent::Output {
                    session_id: id.clone(),
                    data: BASE64.encode(data),
                });
            }
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                emit(
                    &events,
                    &id,
                    SessionStatus::Closed,
                    Some("远端会话已关闭".into()),
                );
                break;
            }
            _ => {}
        }
    }
}

fn emit(
    events: &broadcast::Sender<SessionEvent>,
    id: &str,
    status: SessionStatus,
    message: Option<String>,
) {
    let _ = events.send(SessionEvent::Status {
        session_id: id.to_owned(),
        status,
        message,
    });
}

fn public_key_openssh(key: &PublicKey) -> Result<String, AppError> {
    key.to_openssh()
        .map_err(|error| AppError::Ssh(format!("主机密钥格式错误：{error}")))
}

pub fn host_key_fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

pub async fn discover_host_key(host: &str, port: u16) -> Result<HostKeyInfo, AppError> {
    struct DiscoveryHandler {
        sender: Option<oneshot::Sender<HostKeyInfo>>,
    }

    impl client::Handler for DiscoveryHandler {
        type Error = AppError;

        async fn check_server_key(
            &mut self,
            key: &PublicKeyOrCertificate,
        ) -> Result<bool, Self::Error> {
            let key = key.public_key();
            let actual = public_key_openssh(&key)?;
            if let Some(sender) = self.sender.take() {
                let _ = sender.send(host_key_info(&key, &actual));
            }
            Ok(false)
        }
    }

    let (sender, mut receiver) = oneshot::channel();
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(15)),
        ..Default::default()
    });
    let handler = DiscoveryHandler {
        sender: Some(sender),
    };
    let address = (host.to_owned(), port);
    let mut connection = tokio::spawn(client::connect(config, address, handler));
    let connection_result = tokio::select! {
        biased;
        received = &mut receiver => {
            connection.abort();
            let _ = connection.await;
            return received.map_err(|_| AppError::Ssh("服务器未提供主机公钥".into()));
        }
        result = &mut connection => {
            if let Ok(info) = receiver.try_recv() {
                return Ok(info);
            }
            result
        }
        _ = tokio::time::sleep(Duration::from_secs(12)) => {
            connection.abort();
            let _ = connection.await;
            return Err(AppError::Ssh("读取服务器身份超时，请检查 SSH 服务".into()));
        }
    };
    let message = match connection_result {
        Ok(Ok(_)) => "服务器未提供主机公钥".to_owned(),
        Ok(Err(error)) => error.to_string(),
        Err(error) => error.to_string(),
    };
    Err(AppError::Ssh(message))
}

fn host_key_info(key: &PublicKey, actual: &str) -> HostKeyInfo {
    HostKeyInfo {
        code: "host_key_confirmation",
        algorithm: key.algorithm().to_string(),
        fingerprint: host_key_fingerprint(key),
        host_key: actual.to_owned(),
        changed: false,
        previous_fingerprint: None,
    }
}

fn validate_remote_path(path: &str) -> Result<(), AppError> {
    if path.is_empty() || path.contains('\0') || path.split('/').any(|part| part == "..") {
        return Err(AppError::Validation("远端路径无效".into()));
    }
    Ok(())
}

fn safe_local_file(path: &str) -> Result<PathBuf, AppError> {
    let path = PathBuf::from(path);
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Validation("本地文件路径无效".into()))?;
    if name == "." || name == ".." || path.parent().is_none() {
        return Err(AppError::Validation("本地文件路径无效".into()));
    }
    let parent = path.parent().expect("已检查父目录");
    if !parent.is_dir() {
        return Err(AppError::Validation("本地目标目录不存在".into()));
    }
    if path.symlink_metadata().is_ok() {
        return Err(AppError::Validation("本地目标已存在，未执行覆盖".into()));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_remote_traversal() {
        assert!(validate_remote_path("/etc/../shadow").is_err());
        assert!(validate_remote_path("/var/log").is_ok());
    }

    #[test]
    fn rejects_existing_local_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("existing.txt");
        std::fs::write(&path, "preserve").unwrap();
        assert!(safe_local_file(path.to_str().unwrap()).is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "preserve");
    }
}
