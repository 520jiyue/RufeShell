fn main() {
    println!("cargo:rerun-if-env-changed=FINALPOWERSHELL_E2E");
    println!("cargo:rerun-if-changed=tauri.e2e.conf.json");
    if std::env::var_os("FINALPOWERSHELL_E2E").is_some() {
        let config = std::fs::read_to_string("tauri.e2e.conf.json")
            .expect("无法读取隔离测试配置")
            .lines()
            .map(str::trim)
            .collect::<String>();
        println!("cargo:rustc-env=TAURI_CONFIG={config}");
    }
    tauri_build::build()
}
