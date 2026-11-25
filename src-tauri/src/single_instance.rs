use tauri::AppHandle;

#[cfg(windows)]
mod platform {
    use super::*;
    use std::{
        ffi::c_void,
        os::windows::ffi::OsStrExt,
        ptr,
        sync::{Mutex, OnceLock},
        time::{Duration, Instant},
    };
    use tauri::Manager;
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, HANDLE},
        System::Threading::CreateMutexW,
    };

    #[link(name = "user32", kind = "raw-dylib")]
    extern "system" {
        fn RegisterWindowMessageW(lp_string: *const u16) -> u32;
        fn ChangeWindowMessageFilterEx(
            hwnd: *mut c_void,
            message: u32,
            action: u32,
            p_change_filter_struct: *mut c_void,
        ) -> i32;
        fn SetPropW(hwnd: *mut c_void, lp_string: *const u16, h_data: isize) -> i32;
        fn GetPropW(hwnd: *mut c_void, lp_string: *const u16) -> isize;
        fn EnumWindows(
            lp_enum_func: unsafe extern "system" fn(*mut c_void, isize) -> i32,
            l_param: isize,
        ) -> i32;
        fn PostMessageW(hwnd: *mut c_void, msg: u32, w_param: usize, l_param: isize) -> i32;
        fn AllowSetForegroundWindow(dw_process_id: u32) -> i32;
        fn SetWindowLongPtrW(hwnd: *mut c_void, n_index: i32, dw_new_long: isize) -> isize;
        fn CallWindowProcW(
            lp_prev_wnd_func: isize,
            hwnd: *mut c_void,
            msg: u32,
            w_param: usize,
            l_param: isize,
        ) -> isize;
    }

    const MUTEX_NAME: &str = "Local\\com.rufeshell.workbench.single-instance";
    const PROP_NAME: &str = "RufeShell.PrimaryInstance";
    const WAKE_MSG_NAME: &str = "RufeShell.SingleInstance.ShowMainWindow";
    const MSGFLT_ALLOW: u32 = 1;
    const ASFW_ANY: u32 = u32::MAX;
    const GWLP_WNDPROC: i32 = -4;

    struct WakeState {
        app: AppHandle,
        prev_wndproc: isize,
        wake_msg: u32,
    }

    static WAKE_STATE: OnceLock<Mutex<Option<WakeState>>> = OnceLock::new();

    fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }

    fn wake_message_id() -> u32 {
        static MSG_ID: OnceLock<u32> = OnceLock::new();
        *MSG_ID.get_or_init(|| {
            let name = to_wide(WAKE_MSG_NAME);
            unsafe { RegisterWindowMessageW(name.as_ptr()) }
        })
    }

    pub struct SingleInstanceGuard(HANDLE);
    unsafe impl Send for SingleInstanceGuard {}
    unsafe impl Sync for SingleInstanceGuard {}

    impl Drop for SingleInstanceGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
                self.0 = ptr::null_mut();
            }
        }
    }

    pub fn acquire_named(name: &str) -> Option<SingleInstanceGuard> {
        let wide = to_wide(name);
        let handle = unsafe { CreateMutexW(ptr::null(), 1, wide.as_ptr()) };
        let err = unsafe { GetLastError() };
        if handle.is_null() {
            if err == ERROR_ACCESS_DENIED {
                return None;
            }
            return None;
        }
        if err == ERROR_ALREADY_EXISTS {
            unsafe {
                CloseHandle(handle);
            }
            return None;
        }
        Some(SingleInstanceGuard(handle))
    }

    pub fn try_acquire() -> Option<SingleInstanceGuard> {
        acquire_named(MUTEX_NAME)
    }

    unsafe extern "system" fn wake_wndproc(
        hwnd: *mut c_void,
        msg: u32,
        w_param: usize,
        l_param: isize,
    ) -> isize {
        let mut prev = 0isize;
        let mut matched = false;
        let mut app_handle: Option<AppHandle> = None;

        if let Some(lock) = WAKE_STATE.get() {
            if let Ok(guard) = lock.lock() {
                if let Some(state) = guard.as_ref() {
                    prev = state.prev_wndproc;
                    if state.wake_msg != 0 && msg == state.wake_msg {
                        matched = true;
                        app_handle = Some(state.app.clone());
                    }
                }
            }
        }

        if matched {
            if let Some(app) = app_handle {
                crate::restore_main_window(&app);
            }
            return 0;
        }

        if prev != 0 {
            CallWindowProcW(prev, hwnd, msg, w_param, l_param)
        } else {
            0
        }
    }

    pub fn register_wake_handler(app: &AppHandle) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let Ok(hwnd) = window.hwnd() else {
            return;
        };
        let wake_msg = wake_message_id();
        if wake_msg == 0 {
            return;
        }

        let prop_w = to_wide(PROP_NAME);
        let hwnd_ptr = hwnd.0;
        unsafe {
            let _ = SetPropW(hwnd_ptr, prop_w.as_ptr(), 1);
            let _ = ChangeWindowMessageFilterEx(hwnd_ptr, wake_msg, MSGFLT_ALLOW, ptr::null_mut());
            let prev_wndproc = SetWindowLongPtrW(hwnd_ptr, GWLP_WNDPROC, wake_wndproc as *const () as isize);
            let cell = WAKE_STATE.get_or_init(|| Mutex::new(None));
            if let Ok(mut guard) = cell.lock() {
                *guard = Some(WakeState {
                    app: app.clone(),
                    prev_wndproc,
                    wake_msg,
                });
            }
        }
    }

    unsafe extern "system" fn find_primary_hwnd(hwnd: *mut c_void, l_param: isize) -> i32 {
        let prop_w = to_wide(PROP_NAME);
        if GetPropW(hwnd, prop_w.as_ptr()) != 0 {
            let out = &mut *(l_param as *mut *mut c_void);
            *out = hwnd;
            return 0;
        }
        1
    }

    pub fn notify_existing_instance() {
        let wake_msg = wake_message_id();
        if wake_msg == 0 {
            return;
        }
        let deadline = Instant::now() + Duration::from_millis(400);
        loop {
            let mut found: *mut c_void = ptr::null_mut();
            unsafe {
                let _ = EnumWindows(find_primary_hwnd, (&mut found as *mut *mut c_void) as isize);
            }
            if !found.is_null() {
                unsafe {
                    let _ = AllowSetForegroundWindow(ASFW_ANY);
                    let _ = PostMessageW(found, wake_msg, 0, 0);
                }
                return;
            }
            if Instant::now() >= deadline {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;

    pub struct SingleInstanceGuard;

    pub fn try_acquire() -> Option<SingleInstanceGuard> {
        Some(SingleInstanceGuard)
    }

    pub fn register_wake_handler(_app: &AppHandle) {}

    pub fn notify_existing_instance() {}
}

pub use platform::{notify_existing_instance, register_wake_handler, try_acquire, SingleInstanceGuard};

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn single_instance_mutex_blocks_duplicate_until_dropped() {
        let unique = format!("Local\\rufeshell-test-single-{}", uuid::Uuid::new_v4());
        let first = platform::acquire_named(&unique);
        assert!(first.is_some(), "first acquisition should succeed");

        let second = platform::acquire_named(&unique);
        assert!(second.is_none(), "duplicate acquisition while held must fail");

        drop(first);

        let third = platform::acquire_named(&unique);
        assert!(third.is_some(), "acquisition after guard drop should succeed");
    }
}
