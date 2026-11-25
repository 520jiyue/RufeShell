use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{
    domain::{AppError, LocalShellKind, SessionStatus},
    sessions::SessionEvent,
};

#[derive(Clone)]
pub struct LocalPtyManager {
    sessions: Arc<Mutex<HashMap<String, Arc<LocalPtySession>>>>,
}

impl Default for LocalPtyManager {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalPtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn spawn(&self, kind: LocalShellKind) -> Result<(String, broadcast::Receiver<SessionEvent>), AppError> {
        self.spawn_with_elevation(kind, false)
    }

    pub fn spawn_elevated(
        &self,
        kind: LocalShellKind,
    ) -> Result<(String, broadcast::Receiver<SessionEvent>), AppError> {
        self.spawn_with_elevation(kind, !is_process_elevated())
    }

    fn spawn_with_elevation(
        &self,
        kind: LocalShellKind,
        elevated_bridge: bool,
    ) -> Result<(String, broadcast::Receiver<SessionEvent>), AppError> {
        let id = format!("local-{}", Uuid::new_v4());
        let (events, receiver) = broadcast::channel(512);
        let session = if elevated_bridge {
            spawn_elevated_bridge_session(id.clone(), kind, events.clone())?
        } else {
            spawn_conpty(id.clone(), kind, events.clone())?
        };
        self.sessions
            .lock()
            .expect("本地终端锁不可用")
            .insert(id.clone(), Arc::new(session));
        let _ = events.send(SessionEvent::Status {
            session_id: id.clone(),
            status: SessionStatus::Connected,
            message: None,
        });
        Ok((id, receiver))
    }

    pub fn input(&self, id: &str, bytes: &[u8]) -> Result<(), AppError> {
        let session = self.get(id)?;
        session.write_input(bytes)
    }

    pub fn resize(&self, id: &str, columns: u32, rows: u32) -> Result<(), AppError> {
        if columns == 0 || rows == 0 {
            return Ok(());
        }
        let session = self.get(id)?;
        session.resize(columns as i16, rows as i16)
    }

    pub fn disconnect(&self, id: &str) -> Result<(), AppError> {
        let session = self
            .sessions
            .lock()
            .expect("本地终端锁不可用")
            .remove(id)
            .ok_or(AppError::SessionNotFound)?;
        session.close();
        let _ = session.events().send(SessionEvent::Status {
            session_id: id.to_owned(),
            status: SessionStatus::Closed,
            message: None,
        });
        Ok(())
    }

    pub fn contains(&self, id: &str) -> bool {
        self.sessions
            .lock()
            .expect("本地终端锁不可用")
            .contains_key(id)
    }

    fn get(&self, id: &str) -> Result<Arc<LocalPtySession>, AppError> {
        self.sessions
            .lock()
            .expect("本地终端锁不可用")
            .get(id)
            .cloned()
            .ok_or(AppError::SessionNotFound)
    }
}

pub fn is_process_elevated() -> bool {
    platform::is_process_elevated()
}

pub fn relaunch_as_admin() -> Result<(), AppError> {
    platform::relaunch_as_admin()
}

pub fn maybe_run_elevated_pty_bridge() -> Option<i32> {
    platform::maybe_run_elevated_pty_bridge()
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{
        ffi::c_void,
        fs::File,
        io::{self, Read, Write},
        os::windows::{
            ffi::OsStrExt,
            io::{FromRawHandle, RawHandle},
            process::CommandExt,
        },
        ptr,
        sync::{
            atomic::{AtomicBool, Ordering},
            OnceLock,
        },
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::{
            CloseHandle, GetLastError, ERROR_CANCELLED, ERROR_PIPE_CONNECTED, HANDLE,
            INVALID_HANDLE_VALUE,
        },
        Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
        Storage::FileSystem::{
            CreateFileW, ReadFile, WriteFile, FILE_FLAG_FIRST_PIPE_INSTANCE, OPEN_EXISTING,
        },
        System::{
            Console::{
                ClosePseudoConsole, CreatePseudoConsole, FreeConsole, ResizePseudoConsole, COORD,
                HPCON,
            },
            Pipes::{
                CreateNamedPipeW, CreatePipe, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_TYPE_BYTE, PIPE_WAIT,
            },
            Threading::{
                CreateProcessW, DeleteProcThreadAttributeList, GetCurrentProcess,
                InitializeProcThreadAttributeList, OpenProcessToken, TerminateProcess,
                UpdateProcThreadAttribute, EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST,
                PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, STARTF_USESTDHANDLES,
                STARTUPINFOEXW,
            },
        },
    };

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> isize;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn ConnectNamedPipe(h_named_pipe: HANDLE, lp_overlapped: *mut c_void) -> i32;
    }

    const SW_HIDE: i32 = 0;
    const SW_SHOWNORMAL: i32 = 1;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const PIPE_ACCESS_INBOUND: u32 = 1;
    const PIPE_ACCESS_OUTBOUND: u32 = 2;
    const GENERIC_READ_ACCESS: u32 = 0x8000_0000;
    const GENERIC_WRITE_ACCESS: u32 = 0x4000_0000;

    const FRAME_OUTPUT: u8 = 1;
    const FRAME_CLOSED: u8 = 2;
    const FRAME_INPUT: u8 = 1;
    const FRAME_RESIZE: u8 = 2;
    const FRAME_CLOSE: u8 = 3;
    const BRIDGE_ARG: &str = "--pty-bridge";

    fn to_wide(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
        value.as_ref().encode_wide().chain(Some(0)).collect()
    }

    pub fn is_process_elevated() -> bool {
        unsafe {
            let mut token: HANDLE = ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return false;
            }
            let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut ret_len = 0u32;
            let ok = GetTokenInformation(
                token,
                TokenElevation,
                (&mut elevation as *mut TOKEN_ELEVATION).cast(),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut ret_len,
            );
            CloseHandle(token);
            ok != 0 && elevation.TokenIsElevated != 0
        }
    }

    fn shell_execute_runas(
        exe: &std::ffi::OsStr,
        params: Option<&std::ffi::OsStr>,
        cwd: Option<&std::ffi::OsStr>,
        show_cmd: i32,
    ) -> Result<(), AppError> {
        let verb_w = to_wide("runas");
        let file_w = to_wide(exe);
        let params_w = params.map(to_wide);
        let cwd_w = cwd.map(to_wide);

        let result = unsafe {
            ShellExecuteW(
                ptr::null_mut(),
                verb_w.as_ptr(),
                file_w.as_ptr(),
                params_w.as_ref().map_or(ptr::null(), |p| p.as_ptr()),
                cwd_w.as_ref().map_or(ptr::null(), |d| d.as_ptr()),
                show_cmd,
            )
        };

        if result > 32 {
            return Ok(());
        }

        let code = unsafe { GetLastError() };
        if result == 5 || code == ERROR_CANCELLED {
            return Err(AppError::Validation("已取消管理员授权，或权限请求被拒绝".into()));
        }
        Err(AppError::Io(format!(
            "以管理员权限启动失败（ShellExecute 错误码 {result} / 系统错误 {code}）"
        )))
    }

    pub fn relaunch_as_admin() -> Result<(), AppError> {
        if is_process_elevated() {
            return Ok(());
        }
        let exe = std::env::current_exe()
            .map_err(|err| AppError::Io(format!("无法获取当前程序路径：{err}")))?;
        let cwd = std::env::current_dir().ok();
        shell_execute_runas(
            exe.as_os_str(),
            None,
            cwd.as_deref().map(std::path::Path::as_os_str),
            SW_SHOWNORMAL,
        )
    }

    pub fn resolve_shell_spec(kind: LocalShellKind) -> (&'static str, &'static str) {
        static HAS_PWSH: OnceLock<bool> = OnceLock::new();
        match kind {
            LocalShellKind::PowerShell => {
                let has_pwsh = *HAS_PWSH.get_or_init(|| {
                    std::process::Command::new("pwsh.exe")
                        .arg("--version")
                        .creation_flags(CREATE_NO_WINDOW)
                        .output()
                        .is_ok()
                });
                if has_pwsh {
                    ("pwsh.exe", "-NoLogo")
                } else {
                    ("powershell.exe", "-NoLogo")
                }
            }
            LocalShellKind::Cmd => ("cmd.exe", ""),
            LocalShellKind::Wsl => ("wsl.exe", ""),
        }
    }

    fn shell_kind_slug(kind: LocalShellKind) -> &'static str {
        match kind {
            LocalShellKind::PowerShell => "power_shell",
            LocalShellKind::Cmd => "cmd",
            LocalShellKind::Wsl => "wsl",
        }
    }

    fn parse_shell_kind_slug(slug: &str) -> Option<LocalShellKind> {
        match slug {
            "power_shell" => Some(LocalShellKind::PowerShell),
            "cmd" => Some(LocalShellKind::Cmd),
            "wsl" => Some(LocalShellKind::Wsl),
            _ => None,
        }
    }

    fn pipe_paths(bridge_id: &str) -> (String, String) {
        (
            format!(r"\\.\pipe\rufeshell-pty-{bridge_id}-out"),
            format!(r"\\.\pipe\rufeshell-pty-{bridge_id}-in"),
        )
    }

    fn write_frame(writer: &mut impl Write, tag: u8, payload: &[u8]) -> io::Result<()> {
        let mut header = [0u8; 5];
        header[0] = tag;
        header[1..5].copy_from_slice(&(payload.len() as u32).to_le_bytes());
        writer.write_all(&header)?;
        if !payload.is_empty() {
            writer.write_all(payload)?;
        }
        writer.flush()
    }

    fn read_frame(reader: &mut impl Read) -> io::Result<Option<(u8, Vec<u8>)>> {
        let mut header = [0u8; 5];
        match reader.read_exact(&mut header) {
            Ok(()) => {}
            Err(err) if err.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(err) => return Err(err),
        }
        let len = u32::from_le_bytes([header[1], header[2], header[3], header[4]]) as usize;
        if len > 8 * 1024 * 1024 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "桥接帧长度异常",
            ));
        }
        let mut payload = vec![0u8; len];
        if len > 0 {
            reader.read_exact(&mut payload)?;
        }
        Ok(Some((header[0], payload)))
    }

    struct RawHandleGuard(HANDLE);
    unsafe impl Send for RawHandleGuard {}

    impl RawHandleGuard {
        fn into_file(self) -> File {
            let h = self.0;
            std::mem::forget(self);
            unsafe { File::from_raw_handle(h as RawHandle) }
        }
    }

    impl Drop for RawHandleGuard {
        fn drop(&mut self) {
            if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    fn create_single_pipe(name: &str, access: u32) -> Result<RawHandleGuard, AppError> {
        let wide = to_wide(name);
        let handle = unsafe {
            CreateNamedPipeW(
                wide.as_ptr(),
                access | FILE_FLAG_FIRST_PIPE_INSTANCE,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                1,
                65536,
                65536,
                0,
                ptr::null(),
            )
        };
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return Err(AppError::Io(format!(
                "创建管理员终端通信管道失败：{}",
                io::Error::last_os_error()
            )));
        }
        Ok(RawHandleGuard(handle))
    }

    fn connect_pipe_with_timeout(
        guard: RawHandleGuard,
        name: &str,
        wake_access: u32,
        timeout: Duration,
    ) -> Result<File, AppError> {
        let handle_val = guard.0 as usize;
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancelled_worker = cancelled.clone();
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();

        std::thread::spawn(move || {
            let ok = unsafe { ConnectNamedPipe(handle_val as HANDLE, ptr::null_mut()) };
            if cancelled_worker.load(Ordering::Acquire) {
                return;
            }
            if ok != 0 {
                let _ = tx.send(Ok(()));
                return;
            }
            let code = unsafe { GetLastError() };
            if code == ERROR_PIPE_CONNECTED {
                let _ = tx.send(Ok(()));
            } else {
                let _ = tx.send(Err(format!("管道连接失败（系统错误 {code}）")));
            }
        });

        match rx.recv_timeout(timeout) {
            Ok(Ok(())) => Ok(guard.into_file()),
            Ok(Err(msg)) => Err(AppError::Io(msg)),
            Err(_) => {
                cancelled.store(true, Ordering::Release);
                let wide = to_wide(name);
                let dummy = unsafe {
                    CreateFileW(
                        wide.as_ptr(),
                        wake_access,
                        0,
                        ptr::null(),
                        OPEN_EXISTING,
                        0,
                        ptr::null_mut(),
                    )
                };
                if dummy != INVALID_HANDLE_VALUE && !dummy.is_null() {
                    unsafe { CloseHandle(dummy) };
                }
                Err(AppError::Io("等待管理员终端桥接响应超时".into()))
            }
        }
    }

    fn open_pipe_client(name: &str, access: u32, timeout: Duration) -> Result<File, AppError> {
        let wide = to_wide(name);
        let start = Instant::now();
        loop {
            let handle = unsafe {
                CreateFileW(
                    wide.as_ptr(),
                    access,
                    0,
                    ptr::null(),
                    OPEN_EXISTING,
                    0,
                    ptr::null_mut(),
                )
            };
            if handle != INVALID_HANDLE_VALUE && !handle.is_null() {
                return Ok(unsafe { File::from_raw_handle(handle as RawHandle) });
            }
            if start.elapsed() >= timeout {
                return Err(AppError::Io(format!(
                    "无法连接终端管道 {name}：{}",
                    io::Error::last_os_error()
                )));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    struct HandleBox(HANDLE);
    unsafe impl Send for HandleBox {}
    unsafe impl Sync for HandleBox {}

    pub(super) struct ConPtyInner {
        hpc: HPCON,
        in_write: HANDLE,
        process_handle: HANDLE,
        closed: bool,
    }
    unsafe impl Send for ConPtyInner {}

    impl ConPtyInner {
        fn write_input(&self, bytes: &[u8]) -> Result<(), AppError> {
            if self.closed {
                return Err(AppError::SessionNotFound);
            }
            let mut written = 0u32;
            let ok = unsafe {
                WriteFile(
                    self.in_write,
                    bytes.as_ptr(),
                    bytes.len() as u32,
                    &mut written,
                    ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(AppError::Io("写入本地终端失败".into()));
            }
            Ok(())
        }

        fn resize(&self, cols: i16, rows: i16) -> Result<(), AppError> {
            if self.closed {
                return Ok(());
            }
            let size = COORD {
                X: cols.max(20),
                Y: rows.max(5),
            };
            let hr = unsafe { ResizePseudoConsole(self.hpc, size) };
            if hr != 0 {
                return Err(AppError::Io(format!("调整本地终端尺寸失败: {hr}")));
            }
            Ok(())
        }

        fn close(&mut self) {
            if self.closed {
                return;
            }
            self.closed = true;
            unsafe {
                ClosePseudoConsole(self.hpc);
                CloseHandle(self.in_write);
                TerminateProcess(self.process_handle, 0);
                CloseHandle(self.process_handle);
            }
        }
    }

    pub(super) struct BridgeSession {
        in_pipe: Mutex<Option<File>>,
        closed: AtomicBool,
        events: broadcast::Sender<SessionEvent>,
    }

    pub enum LocalPtySession {
        InProcess {
            inner: Mutex<ConPtyInner>,
            events: broadcast::Sender<SessionEvent>,
        },
        Bridge(BridgeSession),
    }

    impl LocalPtySession {
        pub fn events(&self) -> &broadcast::Sender<SessionEvent> {
            match self {
                Self::InProcess { events, .. } => events,
                Self::Bridge(bridge) => &bridge.events,
            }
        }

        pub fn write_input(&self, bytes: &[u8]) -> Result<(), AppError> {
            match self {
                Self::InProcess { inner, .. } => inner.lock().expect("PTY 锁不可用").write_input(bytes),
                Self::Bridge(bridge) => {
                    if bridge.closed.load(Ordering::Acquire) {
                        return Err(AppError::SessionNotFound);
                    }
                    let mut guard = bridge.in_pipe.lock().expect("桥接管道锁不可用");
                    let file = guard.as_mut().ok_or(AppError::SessionNotFound)?;
                    write_frame(file, FRAME_INPUT, bytes)
                        .map_err(|_| AppError::Io("写入管理员终端失败".into()))
                }
            }
        }

        pub fn resize(&self, cols: i16, rows: i16) -> Result<(), AppError> {
            match self {
                Self::InProcess { inner, .. } => inner.lock().expect("PTY 锁不可用").resize(cols, rows),
                Self::Bridge(bridge) => {
                    if bridge.closed.load(Ordering::Acquire) {
                        return Ok(());
                    }
                    let mut guard = bridge.in_pipe.lock().expect("桥接管道锁不可用");
                    let Some(file) = guard.as_mut() else {
                        return Ok(());
                    };
                    let mut payload = [0u8; 4];
                    payload[0..2].copy_from_slice(&cols.max(20).to_le_bytes());
                    payload[2..4].copy_from_slice(&rows.max(5).to_le_bytes());
                    let _ = write_frame(file, FRAME_RESIZE, &payload);
                    Ok(())
                }
            }
        }

        pub fn close(&self) {
            match self {
                Self::InProcess { inner, .. } => inner.lock().expect("PTY 锁不可用").close(),
                Self::Bridge(bridge) => {
                    if bridge.closed.swap(true, Ordering::AcqRel) {
                        return;
                    }
                    let mut guard = bridge.in_pipe.lock().expect("桥接管道锁不可用");
                    if let Some(mut file) = guard.take() {
                        let _ = write_frame(&mut file, FRAME_CLOSE, &[]);
                    }
                }
            }
        }
    }

    impl Drop for LocalPtySession {
        fn drop(&mut self) {
            self.close();
        }
    }

    fn shell_command_line(kind: LocalShellKind) -> Vec<u16> {
        let (exe, args) = resolve_shell_spec(kind);
        let cmd = if args.is_empty() {
            exe.to_owned()
        } else {
            format!("{exe} {args}")
        };
        to_wide(&cmd)
    }

    fn spawn_conpty_core<F, E>(
        kind: LocalShellKind,
        mut on_output: F,
        on_exit: E,
    ) -> Result<ConPtyInner, AppError>
    where
        F: FnMut(&[u8]) + Send + 'static,
        E: FnOnce() + Send + 'static,
    {
        let mut in_read: HANDLE = INVALID_HANDLE_VALUE;
        let mut in_write: HANDLE = INVALID_HANDLE_VALUE;
        let mut out_read: HANDLE = INVALID_HANDLE_VALUE;
        let mut out_write: HANDLE = INVALID_HANDLE_VALUE;

        unsafe {
            if CreatePipe(&mut in_read, &mut in_write, ptr::null(), 0) == 0 {
                return Err(AppError::Io("无法创建输入管道".into()));
            }
            if CreatePipe(&mut out_read, &mut out_write, ptr::null(), 0) == 0 {
                CloseHandle(in_read);
                CloseHandle(in_write);
                return Err(AppError::Io("无法创建输出管道".into()));
            }

            let mut hpc: HPCON = 0;
            let size = COORD { X: 120, Y: 32 };
            let hr = CreatePseudoConsole(size, in_read, out_write, 0, &mut hpc);
            if hr != 0 {
                CloseHandle(in_read);
                CloseHandle(in_write);
                CloseHandle(out_read);
                CloseHandle(out_write);
                return Err(AppError::Io(format!("创建 ConPTY 失败: {hr:#x}")));
            }

            let mut attr_size = 0usize;
            InitializeProcThreadAttributeList(ptr::null_mut(), 1, 0, &mut attr_size);
            let mut attr_buf = vec![0u8; attr_size];
            let attr_list = attr_buf.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;

            if InitializeProcThreadAttributeList(attr_list, 1, 0, &mut attr_size) == 0 {
                ClosePseudoConsole(hpc);
                CloseHandle(in_read);
                CloseHandle(in_write);
                CloseHandle(out_read);
                CloseHandle(out_write);
                return Err(AppError::Io("初始化进程属性列表失败".into()));
            }

            if UpdateProcThreadAttribute(
                attr_list,
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                hpc as *const c_void,
                std::mem::size_of::<HPCON>(),
                ptr::null_mut(),
                ptr::null(),
            ) == 0
            {
                DeleteProcThreadAttributeList(attr_list);
                ClosePseudoConsole(hpc);
                CloseHandle(in_read);
                CloseHandle(in_write);
                CloseHandle(out_read);
                CloseHandle(out_write);
                return Err(AppError::Io("绑定 ConPTY 属性失败".into()));
            }

            let mut startup = STARTUPINFOEXW::default();
            startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
            startup.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
            startup.StartupInfo.hStdError = INVALID_HANDLE_VALUE;
            startup.lpAttributeList = attr_list;

            let mut cmdline = shell_command_line(kind);
            let mut proc_info = PROCESS_INFORMATION::default();
            let working_dir = std::env::var_os("USERPROFILE").map(to_wide);

            let created = CreateProcessW(
                ptr::null(),
                cmdline.as_mut_ptr(),
                ptr::null(),
                ptr::null(),
                0,
                EXTENDED_STARTUPINFO_PRESENT,
                ptr::null(),
                working_dir.as_ref().map_or(ptr::null(), |dir| dir.as_ptr()),
                &startup.StartupInfo,
                &mut proc_info,
            );

            DeleteProcThreadAttributeList(attr_list);
            CloseHandle(in_read);
            CloseHandle(out_write);

            if created == 0 {
                let err = std::io::Error::last_os_error();
                ClosePseudoConsole(hpc);
                CloseHandle(in_write);
                CloseHandle(out_read);
                return Err(AppError::Io(format!("启动本地终端失败：{err}")));
            }

            CloseHandle(proc_info.hThread);

            let out_read_box = HandleBox(out_read);
            std::thread::spawn(move || {
                let handle = out_read_box;
                let mut buf = [0u8; 4096];
                loop {
                    let mut read = 0u32;
                    let ok = ReadFile(
                        handle.0,
                        buf.as_mut_ptr(),
                        buf.len() as u32,
                        &mut read,
                        ptr::null_mut(),
                    );
                    if ok == 0 || read == 0 {
                        break;
                    }
                    on_output(&buf[..read as usize]);
                }
                CloseHandle(handle.0);
                on_exit();
            });

            Ok(ConPtyInner {
                hpc,
                in_write,
                process_handle: proc_info.hProcess,
                closed: false,
            })
        }
    }

    pub fn spawn_conpty(
        id: String,
        kind: LocalShellKind,
        events: broadcast::Sender<SessionEvent>,
    ) -> Result<LocalPtySession, AppError> {
        let out_events = events.clone();
        let out_id = id.clone();
        let exit_events = events.clone();
        let exit_id = id;
        let inner = spawn_conpty_core(
            kind,
            move |bytes| {
                let _ = out_events.send(SessionEvent::Output {
                    session_id: out_id.clone(),
                    data: BASE64.encode(bytes),
                });
            },
            move || {
                let _ = exit_events.send(SessionEvent::Status {
                    session_id: exit_id,
                    status: SessionStatus::Closed,
                    message: Some("本地终端已退出".into()),
                });
            },
        )?;
        Ok(LocalPtySession::InProcess {
            inner: Mutex::new(inner),
            events,
        })
    }

    pub fn spawn_elevated_bridge_session(
        id: String,
        kind: LocalShellKind,
        events: broadcast::Sender<SessionEvent>,
    ) -> Result<LocalPtySession, AppError> {
        let bridge_id = Uuid::new_v4().simple().to_string();
        let (out_name, in_name) = pipe_paths(&bridge_id);
        let out_guard = create_single_pipe(&out_name, PIPE_ACCESS_INBOUND)?;
        let in_guard = create_single_pipe(&in_name, PIPE_ACCESS_OUTBOUND)?;

        let exe = std::env::current_exe()
            .map_err(|err| AppError::Io(format!("无法获取当前程序路径：{err}")))?;
        let params = format!("{BRIDGE_ARG} {bridge_id} {}", shell_kind_slug(kind));
        let cwd = std::env::var_os("USERPROFILE");

        shell_execute_runas(
            exe.as_os_str(),
            Some(std::ffi::OsStr::new(&params)),
            cwd.as_deref(),
            SW_HIDE,
        )?;

        let out_file = connect_pipe_with_timeout(
            out_guard,
            &out_name,
            GENERIC_WRITE_ACCESS,
            Duration::from_secs(12),
        )?;
        let in_file = connect_pipe_with_timeout(
            in_guard,
            &in_name,
            GENERIC_READ_ACCESS,
            Duration::from_secs(6),
        )?;

        spawn_bridge_reader(id, out_file, events.clone());
        Ok(LocalPtySession::Bridge(BridgeSession {
            in_pipe: Mutex::new(Some(in_file)),
            closed: AtomicBool::new(false),
            events,
        }))
    }

    fn spawn_bridge_reader(id: String, mut out_file: File, events: broadcast::Sender<SessionEvent>) {
        std::thread::spawn(move || {
            let mut close_msg: Option<String> = None;
            loop {
                match read_frame(&mut out_file) {
                    Ok(Some((FRAME_OUTPUT, payload))) => {
                        let _ = events.send(SessionEvent::Output {
                            session_id: id.clone(),
                            data: BASE64.encode(&payload),
                        });
                    }
                    Ok(Some((FRAME_CLOSED, payload))) => {
                        let msg = String::from_utf8_lossy(&payload).trim().to_owned();
                        if !msg.is_empty() {
                            close_msg = Some(msg);
                        }
                        break;
                    }
                    Ok(Some(_)) => {}
                    Ok(None) | Err(_) => break,
                }
            }
            let _ = events.send(SessionEvent::Status {
                session_id: id,
                status: SessionStatus::Closed,
                message: close_msg.or_else(|| Some("管理员本地终端已退出".into())),
            });
        });
    }

    pub fn run_pty_bridge_worker(bridge_id: &str, kind: LocalShellKind) -> Result<(), AppError> {
        let (out_name, in_name) = pipe_paths(bridge_id);
        let out_file = open_pipe_client(&out_name, GENERIC_WRITE_ACCESS, Duration::from_secs(5))?;
        let mut in_file = open_pipe_client(&in_name, GENERIC_READ_ACCESS, Duration::from_secs(5))?;

        let out_writer = Arc::new(Mutex::new(out_file));
        let out_writer_data = out_writer.clone();
        let out_writer_exit = out_writer.clone();

        let pty = match spawn_conpty_core(
            kind,
            move |bytes| {
                if let Ok(mut w) = out_writer_data.lock() {
                    let _ = write_frame(&mut *w, FRAME_OUTPUT, bytes);
                }
            },
            move || {
                if let Ok(mut w) = out_writer_exit.lock() {
                    let _ = write_frame(&mut *w, FRAME_CLOSED, "管理员本地终端已退出".as_bytes());
                }
            },
        ) {
            Ok(inner) => Arc::new(Mutex::new(inner)),
            Err(err) => {
                if let Ok(mut w) = out_writer.lock() {
                    let _ = write_frame(&mut *w, FRAME_CLOSED, err.to_string().as_bytes());
                }
                return Err(err);
            }
        };

        while let Ok(Some((tag, payload))) = read_frame(&mut in_file) {
            match tag {
                FRAME_INPUT => {
                    if let Ok(guard) = pty.lock() {
                        if guard.write_input(&payload).is_err() {
                            break;
                        }
                    }
                }
                FRAME_RESIZE if payload.len() >= 4 => {
                    let cols = i16::from_le_bytes([payload[0], payload[1]]);
                    let rows = i16::from_le_bytes([payload[2], payload[3]]);
                    if let Ok(guard) = pty.lock() {
                        let _ = guard.resize(cols, rows);
                    }
                }
                FRAME_CLOSE => break,
                _ => {}
            }
        }

        if let Ok(mut guard) = pty.lock() {
            guard.close();
        }
        Ok(())
    }

    pub fn maybe_run_elevated_pty_bridge() -> Option<i32> {
        let mut args = std::env::args().skip(1);
        while let Some(arg) = args.next() {
            if arg == BRIDGE_ARG {
                let Some(bridge_id) = args.next() else {
                    return Some(2);
                };
                let Some(kind_slug) = args.next() else {
                    return Some(2);
                };
                if bridge_id.is_empty()
                    || bridge_id.len() > 64
                    || !bridge_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                {
                    return Some(2);
                }
                let Some(kind) = parse_shell_kind_slug(&kind_slug) else {
                    return Some(2);
                };
                unsafe {
                    let _ = FreeConsole();
                }
                return Some(match run_pty_bridge_worker(&bridge_id, kind) {
                    Ok(()) => 0,
                    Err(_) => 1,
                });
            }
        }
        None
    }

    #[cfg(test)]
    pub fn test_bridge_round_trip() -> String {
        let bridge_id = Uuid::new_v4().simple().to_string();
        let (out_name, in_name) = pipe_paths(&bridge_id);
        let out_guard = create_single_pipe(&out_name, PIPE_ACCESS_INBOUND).expect("out pipe");
        let in_guard = create_single_pipe(&in_name, PIPE_ACCESS_OUTBOUND).expect("in pipe");

        let worker_id = bridge_id.clone();
        let worker = std::thread::spawn(move || {
            let _ = run_pty_bridge_worker(&worker_id, LocalShellKind::Cmd);
        });

        let out_file =
            connect_pipe_with_timeout(out_guard, &out_name, GENERIC_WRITE_ACCESS, Duration::from_secs(5))
                .expect("connect out");
        let in_file =
            connect_pipe_with_timeout(in_guard, &in_name, GENERIC_READ_ACCESS, Duration::from_secs(5))
                .expect("connect in");

        let (events, mut rx) = broadcast::channel(256);
        let session_id = "test-bridge".to_owned();
        spawn_bridge_reader(session_id.clone(), out_file, events.clone());
        let session = LocalPtySession::Bridge(BridgeSession {
            in_pipe: Mutex::new(Some(in_file)),
            closed: AtomicBool::new(false),
            events,
        });

        let _ = session.resize(100, 30);
        let _ = session.write_input(b"echo BRIDGE_OK\r\n");

        let start = Instant::now();
        let mut collected = String::new();
        while start.elapsed() < Duration::from_secs(4) {
            match rx.try_recv() {
                Ok(SessionEvent::Output { data, .. }) => {
                    let bytes = BASE64.decode(data).unwrap_or_default();
                    collected.push_str(&String::from_utf8_lossy(&bytes));
                    if collected.contains("BRIDGE_OK") {
                        break;
                    }
                }
                Ok(SessionEvent::Status {
                    status: SessionStatus::Closed,
                    ..
                }) => break,
                _ => std::thread::sleep(Duration::from_millis(30)),
            }
        }

        session.close();
        let _ = worker.join();
        collected
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub fn is_process_elevated() -> bool {
        false
    }

    pub fn relaunch_as_admin() -> Result<(), AppError> {
        Err(AppError::Validation("仅 Windows 支持以管理员权限重启".into()))
    }

    pub fn maybe_run_elevated_pty_bridge() -> Option<i32> {
        None
    }

    pub struct LocalPtySession {
        pub events: broadcast::Sender<SessionEvent>,
    }

    impl LocalPtySession {
        pub fn events(&self) -> &broadcast::Sender<SessionEvent> {
            &self.events
        }

        pub fn write_input(&self, _bytes: &[u8]) -> Result<(), AppError> {
            Err(AppError::Validation("仅 Windows 支持本地 ConPTY".into()))
        }

        pub fn resize(&self, _cols: i16, _rows: i16) -> Result<(), AppError> {
            Ok(())
        }

        pub fn close(&self) {}
    }

    pub fn spawn_conpty(
        _id: String,
        _kind: LocalShellKind,
        _events: broadcast::Sender<SessionEvent>,
    ) -> Result<LocalPtySession, AppError> {
        Err(AppError::Validation("当前平台不支持本地 ConPTY".into()))
    }

    pub fn spawn_elevated_bridge_session(
        _id: String,
        _kind: LocalShellKind,
        _events: broadcast::Sender<SessionEvent>,
    ) -> Result<LocalPtySession, AppError> {
        Err(AppError::Validation("仅 Windows 支持管理员权限内置终端".into()))
    }
}

use platform::{spawn_conpty, spawn_elevated_bridge_session, LocalPtySession};

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn cmd_conpty_captures_output_cleanly() {
        let mgr = LocalPtyManager::new();
        let (id, mut rx) = mgr.spawn(LocalShellKind::Cmd).expect("spawn cmd");
        let start = std::time::Instant::now();
        let mut out = String::new();
        while start.elapsed() < std::time::Duration::from_secs(3) {
            match rx.try_recv() {
                Ok(SessionEvent::Output { data, .. }) => {
                    let bytes = BASE64.decode(data).unwrap_or_default();
                    out.push_str(&String::from_utf8_lossy(&bytes));
                    if out.contains("Microsoft") || out.contains('>') {
                        break;
                    }
                }
                Ok(SessionEvent::Status {
                    status: SessionStatus::Closed,
                    ..
                }) => {
                    break;
                }
                Err(tokio::sync::broadcast::error::TryRecvError::Empty) => {
                    std::thread::sleep(std::time::Duration::from_millis(40));
                }
                _ => {}
            }
        }
        let _ = mgr.disconnect(&id);
        assert!(
            !out.is_empty(),
            "ConPTY should capture local shell output instead of leaking to parent stdio"
        );
    }

    #[test]
    fn shell_resolution_and_elevation_check_succeed() {
        let _ = is_process_elevated();
        let (pwsh_exe, pwsh_args) = platform::resolve_shell_spec(LocalShellKind::PowerShell);
        assert!(pwsh_exe == "pwsh.exe" || pwsh_exe == "powershell.exe");
        assert_eq!(pwsh_args, "-NoLogo");
        assert_eq!(platform::resolve_shell_spec(LocalShellKind::Cmd), ("cmd.exe", ""));
        assert_eq!(platform::resolve_shell_spec(LocalShellKind::Wsl), ("wsl.exe", ""));
    }

    #[test]
    fn pipe_bridge_round_trip_works_without_uac() {
        let out = platform::test_bridge_round_trip();
        assert!(
            out.contains("BRIDGE_OK"),
            "Named-pipe ConPTY bridge should capture echoed output, got: {out:?}"
        );
    }
}
