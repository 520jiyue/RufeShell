use std::{
    collections::HashMap,
    net::{Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex as StdMutex,
    },
};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Notify,
    task::JoinHandle,
};
use uuid::Uuid;

use crate::{
    domain::{AppError, ForwardKind, ForwardRuleDraft, ForwardRuleInfo},
    sessions::{ForwardedTarget, SessionManager},
};

struct ForwardRuntime {
    id: String,
    session_id: String,
    kind: ForwardKind,
    bind_host: String,
    bind_port: u16,
    target_host: String,
    target_port: u16,
    active: AtomicBool,
    active_connections: Arc<AtomicU64>,
    bytes_sent: Arc<AtomicU64>,
    bytes_received: Arc<AtomicU64>,
    error: StdMutex<Option<String>>,
    stop_notify: Arc<Notify>,
    task: StdMutex<Option<JoinHandle<()>>>,
}

impl ForwardRuntime {
    fn snapshot(&self) -> ForwardRuleInfo {
        ForwardRuleInfo {
            id: self.id.clone(),
            session_id: self.session_id.clone(),
            kind: self.kind.clone(),
            bind_host: self.bind_host.clone(),
            bind_port: self.bind_port,
            target_host: self.target_host.clone(),
            target_port: self.target_port,
            active: self.active.load(Ordering::Relaxed),
            active_connections: self.active_connections.load(Ordering::Relaxed),
            bytes_sent: self.bytes_sent.load(Ordering::Relaxed),
            bytes_received: self.bytes_received.load(Ordering::Relaxed),
            error: self.error.lock().expect("转发错误锁").clone(),
        }
    }
}

pub struct ForwardManager {
    rules: StdMutex<HashMap<String, Arc<ForwardRuntime>>>,
    order: StdMutex<Vec<String>>,
}

impl Default for ForwardManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ForwardManager {
    pub fn new() -> Self {
        Self {
            rules: StdMutex::new(HashMap::new()),
            order: StdMutex::new(Vec::new()),
        }
    }

    pub fn list(&self, session_id: Option<&str>) -> Vec<ForwardRuleInfo> {
        let rules = self.rules.lock().expect("转发列表锁");
        let order = self.order.lock().expect("转发顺序锁");
        order
            .iter()
            .filter_map(|id| rules.get(id))
            .filter(|rt| session_id.is_none_or(|sid| rt.session_id == sid))
            .map(|rt| rt.snapshot())
            .collect()
    }

    pub async fn add_and_start(
        &self,
        session_id: String,
        draft: ForwardRuleDraft,
        sessions: &SessionManager,
    ) -> Result<ForwardRuleInfo, AppError> {
        let bind_host = if draft.bind_host.trim().is_empty() {
            "127.0.0.1".to_owned()
        } else {
            draft.bind_host.trim().to_owned()
        };
        if draft.bind_port == 0 {
            return Err(AppError::Validation("绑定端口必须在 1–65535 之间".into()));
        }
        if !matches!(draft.kind, ForwardKind::Dynamic)
            && (draft.target_host.trim().is_empty() || draft.target_port == 0)
        {
            return Err(AppError::Validation("目标主机和端口不能为空".into()));
        }

        let id = Uuid::new_v4().to_string();
        let runtime = Arc::new(ForwardRuntime {
            id: id.clone(),
            session_id,
            kind: draft.kind,
            bind_host,
            bind_port: draft.bind_port,
            target_host: draft.target_host.trim().to_owned(),
            target_port: draft.target_port,
            active: AtomicBool::new(false),
            active_connections: Arc::new(AtomicU64::new(0)),
            bytes_sent: Arc::new(AtomicU64::new(0)),
            bytes_received: Arc::new(AtomicU64::new(0)),
            error: StdMutex::new(None),
            stop_notify: Arc::new(Notify::new()),
            task: StdMutex::new(None),
        });

        self.rules
            .lock()
            .expect("转发列表锁")
            .insert(id.clone(), runtime.clone());
        self.order.lock().expect("转发顺序锁").push(id.clone());

        if let Err(err) = start_runtime(&runtime, sessions).await {
            *runtime.error.lock().expect("转发错误锁") = Some(err.to_string());
            return Err(err);
        }

        Ok(runtime.snapshot())
    }

    pub async fn start(
        &self,
        id: &str,
        sessions: &SessionManager,
    ) -> Result<ForwardRuleInfo, AppError> {
        let runtime = self
            .rules
            .lock()
            .expect("转发列表锁")
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::Validation("端口转发规则不存在".into()))?;
        if runtime.active.load(Ordering::Relaxed) {
            return Ok(runtime.snapshot());
        }
        *runtime.error.lock().expect("转发错误锁") = None;
        start_runtime(&runtime, sessions).await?;
        Ok(runtime.snapshot())
    }

    pub async fn stop(
        &self,
        id: &str,
        sessions: &SessionManager,
    ) -> Result<ForwardRuleInfo, AppError> {
        let runtime = self
            .rules
            .lock()
            .expect("转发列表锁")
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::Validation("端口转发规则不存在".into()))?;
        stop_runtime(&runtime, sessions).await;
        Ok(runtime.snapshot())
    }

    pub async fn remove(&self, id: &str, sessions: &SessionManager) -> Result<(), AppError> {
        let runtime = self.rules.lock().expect("转发列表锁").remove(id);
        self.order.lock().expect("转发顺序锁").retain(|item| item != id);
        if let Some(runtime) = runtime {
            stop_runtime(&runtime, sessions).await;
        }
        Ok(())
    }

    pub async fn stop_session_forwards(&self, session_id: &str, sessions: &SessionManager) {
        let list = {
            let rules = self.rules.lock().expect("转发列表锁");
            rules
                .values()
                .filter(|rt| rt.session_id == session_id && rt.active.load(Ordering::Relaxed))
                .cloned()
                .collect::<Vec<_>>()
        };
        for rt in list {
            stop_runtime(&rt, sessions).await;
        }
    }
}

async fn start_runtime(
    runtime: &Arc<ForwardRuntime>,
    sessions: &SessionManager,
) -> Result<(), AppError> {
    match runtime.kind {
        ForwardKind::Local | ForwardKind::Dynamic => {
            let addr = format!("{}:{}", runtime.bind_host, runtime.bind_port);
            let listener = TcpListener::bind(&addr)
                .await
                .map_err(|err| AppError::Io(format!("无法监听 {addr}：{err}")))?;
            let handle = sessions.handle_for(&runtime.session_id)?;
            runtime.active.store(true, Ordering::Relaxed);
            let rt = runtime.clone();
            let stop = runtime.stop_notify.clone();
            let join = tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = stop.notified() => break,
                        accepted = listener.accept() => {
                            let Ok((stream, peer)) = accepted else { break; };
                            let rt_conn = rt.clone();
                            let handle_conn = handle.clone();
                            tokio::spawn(async move {
                                rt_conn.active_connections.fetch_add(1, Ordering::Relaxed);
                                let res = match rt_conn.kind {
                                    ForwardKind::Local => handle_local_conn(stream, peer, &rt_conn, &handle_conn).await,
                                    ForwardKind::Dynamic => handle_socks5_conn(stream, peer, &rt_conn, &handle_conn).await,
                                    ForwardKind::Remote => Ok(()),
                                };
                                if let Err(err) = res {
                                    *rt_conn.error.lock().expect("转发错误锁") = Some(err.to_string());
                                }
                                rt_conn.active_connections.fetch_sub(1, Ordering::Relaxed);
                            });
                        }
                    }
                }
                rt.active.store(false, Ordering::Relaxed);
            });
            *runtime.task.lock().expect("转发任务锁") = Some(join);
        }
        ForwardKind::Remote => {
            let handle = sessions.handle_for(&runtime.session_id)?;
            let registry = sessions.forwarded_for(&runtime.session_id)?;
            let target = ForwardedTarget {
                target_host: runtime.target_host.clone(),
                target_port: runtime.target_port,
                active_connections: runtime.active_connections.clone(),
                bytes_sent: runtime.bytes_sent.clone(),
                bytes_received: runtime.bytes_received.clone(),
            };
            registry
                .lock()
                .expect("远程转发注册锁")
                .insert((runtime.bind_host.clone(), runtime.bind_port), target);
            let res = handle
                .lock()
                .await
                .tcpip_forward(runtime.bind_host.as_str(), u32::from(runtime.bind_port))
                .await;
            if let Err(err) = res {
                registry
                    .lock()
                    .expect("远程转发注册锁")
                    .remove(&(runtime.bind_host.clone(), runtime.bind_port));
                return Err(AppError::Ssh(format!("远程转发启动失败：{err}")));
            }
            runtime.active.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

async fn stop_runtime(runtime: &Arc<ForwardRuntime>, sessions: &SessionManager) {
    if !runtime.active.swap(false, Ordering::Relaxed) {
        return;
    }
    match runtime.kind {
        ForwardKind::Local | ForwardKind::Dynamic => {
            runtime.stop_notify.notify_waiters();
            if let Some(task) = runtime.task.lock().expect("转发任务锁").take() {
                task.abort();
            }
        }
        ForwardKind::Remote => {
            if let Ok(registry) = sessions.forwarded_for(&runtime.session_id) {
                registry
                    .lock()
                    .expect("远程转发注册锁")
                    .remove(&(runtime.bind_host.clone(), runtime.bind_port));
            }
            if let Ok(handle) = sessions.handle_for(&runtime.session_id) {
                let _ = handle
                    .lock()
                    .await
                    .cancel_tcpip_forward(runtime.bind_host.as_str(), u32::from(runtime.bind_port))
                    .await;
            }
        }
    }
}

async fn handle_local_conn(
    mut stream: TcpStream,
    peer: SocketAddr,
    rt: &ForwardRuntime,
    handle: &Arc<tokio::sync::Mutex<crate::sessions::ClientHandle>>,
) -> Result<(), AppError> {
    let channel = handle
        .lock()
        .await
        .channel_open_direct_tcpip(
            rt.target_host.as_str(),
            u32::from(rt.target_port),
            peer.ip().to_string(),
            u32::from(peer.port()),
        )
        .await?;
    let mut ssh_stream = channel.into_stream();
    let (sent, recv) = tokio::io::copy_bidirectional(&mut stream, &mut ssh_stream).await?;
    rt.bytes_sent.fetch_add(sent, Ordering::Relaxed);
    rt.bytes_received.fetch_add(recv, Ordering::Relaxed);
    Ok(())
}

async fn handle_socks5_conn(
    mut stream: TcpStream,
    peer: SocketAddr,
    rt: &ForwardRuntime,
    handle: &Arc<tokio::sync::Mutex<crate::sessions::ClientHandle>>,
) -> Result<(), AppError> {
    let mut header = [0u8; 2];
    stream.read_exact(&mut header).await?;
    if header[0] != 0x05 {
        return Err(AppError::Validation("仅支持 SOCKS5 协议".into()));
    }
    let mut methods = vec![0u8; header[1] as usize];
    stream.read_exact(&mut methods).await?;
    stream.write_all(&[0x05, 0x00]).await?;

    let mut req = [0u8; 4];
    stream.read_exact(&mut req).await?;
    if req[0] != 0x05 || req[1] != 0x01 {
        let _ = stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await;
        return Err(AppError::Validation("SOCKS5 仅支持 CONNECT 命令".into()));
    }

    let target_host = match req[3] {
        0x01 => {
            let mut ip = [0u8; 4];
            stream.read_exact(&mut ip).await?;
            Ipv4Addr::from(ip).to_string()
        }
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await?;
            let mut domain = vec![0u8; len[0] as usize];
            stream.read_exact(&mut domain).await?;
            String::from_utf8(domain).map_err(|_| AppError::Validation("无效域名".into()))?
        }
        0x04 => {
            let mut ip = [0u8; 16];
            stream.read_exact(&mut ip).await?;
            Ipv6Addr::from(ip).to_string()
        }
        _ => {
            let _ = stream
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await;
            return Err(AppError::Validation("不支持的 SOCKS5 地址类型".into()));
        }
    };

    let mut port_buf = [0u8; 2];
    stream.read_exact(&mut port_buf).await?;
    let target_port = u16::from_be_bytes(port_buf);

    let channel = handle
        .lock()
        .await
        .channel_open_direct_tcpip(
            target_host,
            u32::from(target_port),
            peer.ip().to_string(),
            u32::from(peer.port()),
        )
        .await;

    let channel = match channel {
        Ok(ch) => ch,
        Err(err) => {
            let _ = stream
                .write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await;
            return Err(err.into());
        }
    };

    stream
        .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await?;
    let mut ssh_stream = channel.into_stream();
    let (sent, recv) = tokio::io::copy_bidirectional(&mut stream, &mut ssh_stream).await?;
    rt.bytes_sent.fetch_add(sent, Ordering::Relaxed);
    rt.bytes_received.fetch_add(recv, Ordering::Relaxed);
    Ok(())
}
