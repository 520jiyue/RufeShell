#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(exit_code) = finalpowershell_lib::maybe_run_elevated_pty_bridge() {
        std::process::exit(exit_code);
    }
    finalpowershell_lib::run()
}
