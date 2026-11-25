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
        let id = format!("local-{}", Uuid::new_v4());
        let (events, receiver) = broadcast::channel(512);
        let session = spawn_conpty(id.clone(), kind, events.clone())?;
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
        let _ = session.events.send(SessionEvent::Status {
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

pub fn spawn_elevated_shell(kind: LocalShellKind) -> Result<(), AppError> {
    platform::spawn_elevated_shell(kind)
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{ffi::c_void, os::windows::ffi::OsStrExt, os::windows::process::CommandExt, ptr};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_CANCELLED, HANDLE, INVALID_HANDLE_VALUE},
        Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
        Storage::FileSystem::{ReadFile, WriteFile},
        System::{
            Console::{ClosePseudoConsole, CreatePseudoConsole, ResizePseudoConsole, COORD, HPCON},
            Pipes::CreatePipe,
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

    const SW_SHOWNORMAL: i32 = 1;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
                SW_SHOWNORMAL,
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
        )
    }

    pub fn resolve_shell_spec(kind: LocalShellKind) -> (&'static str, &'static str) {
        match kind {
            LocalShellKind::PowerShell => {
                if std::process::Command::new("pwsh.exe")
                    .arg("--version")
                    .creation_flags(CREATE_NO_WINDOW)
                    .output()
                    .is_ok()
                {
                    ("pwsh.exe", "-NoLogo")
                } else {
                    ("powershell.exe", "-NoLogo")
                }
            }
            LocalShellKind::Cmd => ("cmd.exe", ""),
            LocalShellKind::Wsl => ("wsl.exe", ""),
        }
    }

    pub fn spawn_elevated_shell(kind: LocalShellKind) -> Result<(), AppError> {
        let (exe, args) = resolve_shell_spec(kind);
        let cwd = std::env::var_os("USERPROFILE");
        shell_execute_runas(
            std::ffi::OsStr::new(exe),
            (!args.is_empty()).then(|| std::ffi::OsStr::new(args)),
            cwd.as_deref(),
        )
    }

    struct HandleBox(HANDLE);
    unsafe impl Send for HandleBox {}
    unsafe impl Sync for HandleBox {}

    struct ConPtyInner {
        hpc: HPCON,
        in_write: HANDLE,
        process_handle: HANDLE,
        closed: bool,
    }
    unsafe impl Send for ConPtyInner {}

    pub struct LocalPtySession {
        inner: Mutex<ConPtyInner>,
        pub events: broadcast::Sender<SessionEvent>,
    }

    impl LocalPtySession {
        pub fn write_input(&self, bytes: &[u8]) -> Result<(), AppError> {
            let guard = self.inner.lock().expect("PTY 锁不可用");
            if guard.closed {
                return Err(AppError::SessionNotFound);
            }
            let mut written = 0u32;
            let ok = unsafe {
                WriteFile(
                    guard.in_write,
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

        pub fn resize(&self, cols: i16, rows: i16) -> Result<(), AppError> {
            let guard = self.inner.lock().expect("PTY 锁不可用");
            if guard.closed {
                return Ok(());
            }
            let size = COORD {
                X: cols.max(20),
                Y: rows.max(5),
            };
            let hr = unsafe { ResizePseudoConsole(guard.hpc, size) };
            if hr != 0 {
                return Err(AppError::Io(format!("调整本地终端尺寸失败: {hr}")));
            }
            Ok(())
        }

        pub fn close(&self) {
            let mut guard = self.inner.lock().expect("PTY 锁不可用");
            if guard.closed {
                return;
            }
            guard.closed = true;
            unsafe {
                ClosePseudoConsole(guard.hpc);
                CloseHandle(guard.in_write);
                TerminateProcess(guard.process_handle, 0);
                CloseHandle(guard.process_handle);
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

    pub fn spawn_conpty(
        id: String,
        kind: LocalShellKind,
        events: broadcast::Sender<SessionEvent>,
    ) -> Result<LocalPtySession, AppError> {
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
            let working_dir = std::env::var_os("USERPROFILE")
                .map(|p| {
                    std::ffi::OsStr::new(&p)
                        .encode_wide()
                        .chain(Some(0))
                        .collect::<Vec<_>>()
                });

            let created = CreateProcessW(
                ptr::null(),
                cmdline.as_mut_ptr(),
                ptr::null(),
                ptr::null(),
                0,
                EXTENDED_STARTUPINFO_PRESENT,
                ptr::null(),
                working_dir
                    .as_ref()
                    .map_or(ptr::null(), |dir| dir.as_ptr()),
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
            let events_clone = events.clone();
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
                    let _ = events_clone.send(SessionEvent::Output {
                        session_id: id.clone(),
                        data: BASE64.encode(&buf[..read as usize]),
                    });
                }
                CloseHandle(handle.0);
                let _ = events_clone.send(SessionEvent::Status {
                    session_id: id,
                    status: SessionStatus::Closed,
                    message: Some("本地终端已退出".into()),
                });
            });

            Ok(LocalPtySession {
                inner: Mutex::new(ConPtyInner {
                    hpc,
                    in_write,
                    process_handle: proc_info.hProcess,
                    closed: false,
                }),
                events,
            })
        }
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

    pub fn spawn_elevated_shell(_kind: LocalShellKind) -> Result<(), AppError> {
        Err(AppError::Validation("仅 Windows 支持以管理员权限启动本地终端".into()))
    }

    pub struct LocalPtySession {
        pub events: broadcast::Sender<SessionEvent>,
    }

    impl LocalPtySession {
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
}

use platform::{spawn_conpty, LocalPtySession};

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
                Ok(SessionEvent::Status { status, .. })
                    if matches!(status, SessionStatus::Closed) =>
                {
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
}
