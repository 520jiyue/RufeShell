<div align="center">

<p>
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

<img src="src/assets/rufeshell-icon.png" alt="RufeShell Logo" width="84" />

<h1>RufeShell</h1>

<p>
  <strong>A native Rust + Tauri 2 SSH, SFTP &amp; Windows ConPTY operations workbench.</strong>
</p>

<p>
  Built for daily remote ops: tabbed SSH &amp; elevated local shells, dual-pane SFTP sync, live host telemetry, and container/service management — with zero Java runtime dependency.
</p>

<p>
  <img src="https://img.shields.io/badge/Tauri-2.x-24C8D8?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Rust-1.90%2B-DEA584?style=flat-square&logo=rust&logoColor=111111" alt="Rust" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/xterm.js-6.0-111827?style=flat-square" alt="xterm.js" />
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Windows 10/11" />
  <img src="https://img.shields.io/badge/Version-1.3.2-10B981?style=flat-square" alt="Version 1.3.2" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License" /></a>
</p>

<p>
  <a href="#installation">Download</a> ·
  <a href="#features">Features</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#build-from-source">Build from Source</a> ·
  <a href="#project-structure">Architecture</a> ·
  <a href="#security--storage">Security</a>
</p>

```powershell
npm run tauri dev
```

</div>

> [!NOTE]
> RufeShell never writes SSH passwords to plain-text JSON files. Credentials are stored exclusively in **Windows Credential Manager** (`keyring`), and remote servers are verified via SHA-256 host key fingerprints in `known_hosts`.

---

## Why RufeShell?

Traditional terminal tools often require juggling separate apps for SSH terminals, SFTP file transfers, and server health/Docker checks, or rely on heavy JVM/Electron runtimes. RufeShell combines them into a single lightweight Rust + Tauri 2 workbench:

- **Native & Lightweight**: Powered by `russh`, `russh-sftp`, `tokio`, and native Windows ConPTY — fast startup, low memory footprint, zero JVM dependency.
- **Built-in Elevated Local Shells**: Elevate individual PowerShell / CMD / WSL tabs via a silent Windows UAC bridge right inside the workbench tab bar, or relaunch the entire app as Administrator.
- **Full Ops Workflow**: Interactive terminal, dual-pane SFTP diff & resumable transfers, customizable telemetry charts, `systemd` / process / Docker controls, and SSH port forwarding in one window.

---

## Installation

Pre-built packages are available on the [GitHub Releases](https://github.com/520jiyue/RufeShell/releases) page:

- **Windows (`x64` / `arm64`)**: NSIS `.exe` (recommended, supports in-app auto-updates) and `.msi` installers — full support including native ConPTY & UAC elevation.
- **macOS (`Apple Silicon` / `Intel`) & Linux (`x64 .deb`)**: Remote SSH, SFTP, host telemetry, port forwarding, and ops panels are supported *(local ConPTY & Windows UAC controls are Windows-only)*.

---

## Features

### 1. SSH & Built-in Local ConPTY Sessions
- **Native SSH Interactive Terminal**: Multi-tabbed `russh` client supporting password and OpenSSH private key authentication, automatic terminal resize sync, and keepalive.
- **Host Key Verification**: Displays the server's SHA-256 public key fingerprint on first connect (`Trust Once` or `Trust & Save`) and blocks connections if a saved key changes.
- **Auto Reconnect**: Preserves terminal scrollback on network drops and retries based on configurable timeout and max-attempt limits, plus one-click manual reconnect.
- **Unified Local Terminals**: Launch native Windows ConPTY tabs for **PowerShell** (`pwsh.exe` / `powershell.exe`), **CMD**, and **WSL** alongside SSH sessions.
- **Flexible Privilege & UAC Control**:
  - **Built-in Elevated Tabs**: Run individual local terminal tabs as Administrator inside RufeShell via a hidden UAC ConPTY bridge (`Ask` / `Standard` / `Admin` modes, synced across the sidebar toggle, prompt dialog, and Settings).
  - **App-wide Admin Mode**: Relaunch the entire RufeShell workbench as Administrator via Windows UAC so all built-in local tabs inherit elevated tokens cleanly.

### 2. Command Productivity & Desktop Experience
- **Command History**: Records command, timestamp, server, and outcome; supports `↑` / `↓` recall, search, deduplication, clearing, and automatic filtering of password/token patterns.
- **Command Snippets**: Organize frequently used commands into groups with template variables (e.g. `{domain}`, `{service}`) and `Alt + 1` ~ `Alt + 9` quick triggers.
- **Terminal Tools**: Output search (`Ctrl + F`), screen clear (`Ctrl + Shift + L`), font & size controls, copy-on-select, right-click paste, and terminal log export.
- **Connection Management**: Edit, duplicate, group, tag, favorite, and sort connections, plus JSON import/export (passwords excluded).
- **Single-Instance & System Tray**: Prevents duplicate app instances (re-launching restores and focuses the existing window, even from the tray), with configurable close behavior (*Ask every time* / *Minimize to tray* / *Exit*).
- **In-App Auto-Updater**: Signed updates via `tauri-plugin-updater` (`latest.json` from GitHub Releases) with startup checks, release notes preview, download progress, and one-click install & restart.

### 3. SFTP File Management & Dual-Pane Sync
- **Full Context Menu**: Create file/folder, rename, two-step delete confirmation, copy path, and inspect/update Linux `chmod` permissions.
- **Safe Remote Text Editor**: View and edit UTF-8 files up to 1 MB with binary file protection and optional automatic `.bak` backup before saving.
- **Transfer Queue**: Live speed, progress, ETA, pause/resume/cancel/retry controls, large-file resume, conflict resolution prompts, and optional SHA-256 integrity verification.
- **Directory Transfers & Drag-and-Drop**: Upload or download entire folders recursively, or drag files/folders straight from Windows Explorer.
- **Dual-Pane Browser & Diff**: Side-by-side local vs. remote comparison with quick paths and on-demand batch sync.

### 4. Host Telemetry & Operations
- **Customizable Telemetry Sidebar**: Dedicated polling channel displaying CPU trends, memory, swap, network throughput, disk usage, top processes, and mounts with configurable intervals, collapsible cards, visibility toggles, and warning thresholds.
- **Resource History & Alert Rules**: Extended resource trend charts, peak tracking, and threshold alerts with cooldown timers.
- **Process & Service Management**: Search, sort, inspect, and terminate remote processes with confirmation; browse, inspect logs, and control `systemd` units.
- **Docker Panel**: Inspect container status, CPU/memory usage, port mappings, container logs, and start/stop/restart actions.
- **SSH Port Forwarding**: Visual management and toggling for Local (`-L`), Remote (`-R`), and Dynamic SOCKS5 (`-D`) forwarding rules.

### 5. Themes & Internationalization
- **7 Synchronized Themes** (UI + terminal):
  - Dark: `Obsidian Emerald` (default), `Tokyo Night`, `Dracula`, `GitHub Dark`
  - Light: `Morning Mist`, `Solarized Light`, `Catppuccin Latte`
- **Bilingual UI**: Switch seamlessly between **简体中文 (`zh-CN`)** and **English (`en`)** in Settings with live preview and synced system tray labels.

---

## Keyboard Shortcuts

| Category | Shortcut | Action |
| --- | --- | --- |
| **Workbench** | `Ctrl + N` | New connection |
| | `Ctrl + B` | Toggle connection sidebar |
| | `Ctrl + ,` | Open Workbench & Terminal Settings |
| | `F1` / `Ctrl + /` | Open Keyboard Shortcuts |
| **Tabs** | `Ctrl + W` | Close active session |
| | `Ctrl + Tab` / `Ctrl + Shift + Tab` | Next / Previous tab |
| | `Ctrl + 1` ~ `9` | Jump to tab by index |
| **Terminal & Panels** | `Ctrl + F` | Search terminal output |
| | `Ctrl + Shift + L` | Clear terminal screen |
| | `Ctrl + Shift + C` / `V` | Copy / Paste |
| | `Ctrl + =` / `-` | Increase / Decrease font size |
| | `Ctrl + E` | Toggle SFTP files panel |
| | `Ctrl + M` | Toggle Host Telemetry panel |
| **Commands** | `Ctrl + H` | Open command history |
| | `Ctrl + K` | Open command snippets |
| | `Alt + 1` ~ `9` | Trigger bound snippet |
| | `↑` / `↓` | Quick recall history inside terminal |

---

## Build from Source

### Prerequisites
- **OS**: Windows 10 / 11 (64-bit)
- **Runtime**: [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
- **Toolchain**:
  - [Node.js](https://nodejs.org/) 22+
  - [Rust](https://www.rust-lang.org/) 1.90+
  - Visual Studio 2022 Build Tools (MSVC x64 + Windows 10/11 SDK)

### Run & Package

```powershell
# Install frontend dependencies
npm install

# Start development mode (Tauri + Vite HMR)
npm run tauri dev

# Build frontend production bundle only
npm run build

# Build release executables & installers
# Note: when createUpdaterArtifacts is enabled, set TAURI_SIGNING_PRIVATE_KEY before building
npm run tauri build
```

> On environments configured with portable Windows build tools, you can also use `.\scripts\dev-env.ps1 dev`, `.\scripts\dev-env.ps1 check`, and `.\scripts\dev-env.ps1 build`.

### Verification

```powershell
# TypeScript check & Vite build
npm run build

# Rust unit & integration tests
cargo test --manifest-path src-tauri/Cargo.toml

# Rust Clippy lint check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

---

## Project Structure

```text
RufeShell/
├── index.html                  # App entry HTML
├── package.json                # Frontend dependencies & scripts
├── vite.config.ts              # Vite build config
├── scripts/                    # Windows portable toolchain helper scripts
├── src/                        # TypeScript frontend
│   ├── main.ts                 # App bootstrap, window controls, close/admin prompts
│   ├── api.ts                  # Tauri IPC bindings & native file dialogs
│   ├── state.ts                # Workbench & session state store
│   ├── themes.ts               # Light/dark themes & terminal font presets
│   ├── i18n/                   # Simplified Chinese / English localization
│   ├── styles/                 # Design tokens, layout, session & dialog CSS
│   ├── utils/                  # Sensitive command filtering & helpers
│   └── ui/                     # Connections, terminal tools, SFTP, telemetry, ops & updater
└── src-tauri/                  # Rust / Tauri 2 backend
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/           # Tauri 2 permission capabilities
    ├── tests/                  # SSH/SFTP & credential integration tests
    └── src/
        ├── main.rs             # Binary entrypoint & --pty-bridge worker dispatch
        ├── lib.rs              # Tauri commands, tray, DWM framing & lifecycle setup
        ├── single_instance.rs  # Windows single-instance mutex & window wake-up
        ├── domain.rs           # Domain models, settings & validation
        ├── store.rs            # Atomic JSON config persistence with backups
        ├── credentials.rs      # Windows Credential Manager bindings
        ├── host_keys.rs        # known_hosts fingerprint store
        ├── sessions.rs         # SSH sessions, PTY stream, SFTP & metrics
        ├── local_pty.rs        # Windows ConPTY shells & hidden UAC pipe bridge
        ├── transfers.rs        # Resumable chunked transfers & SHA-256 verification
        ├── forwarding.rs       # Local / Remote / Dynamic SSH port forwarding
        └── ops.rs              # Remote process, systemd & Docker control
```

---

## Security & Storage

- **Data Directory**: Settings, profiles, and `known_hosts` are stored under `%LOCALAPPDATA%\RufeShell` (with automatic migration from legacy `%LOCALAPPDATA%\FinalPowerShell`, or override via `RUFESHELL_DATA_DIR`).
- **Secret Isolation**: Connection profiles never save plain-text passwords; secrets are kept in Windows Credential Manager.
- **Safe Persistence**: Configuration writes preserve backups and use atomic file replacement on Windows.
- **File & Update Safety**: Binary files are blocked from text editing, optional `.bak` remote backups are supported before edits, transfers support SHA-256 verification, and in-app updates verify Ed25519 signatures before installation.

---

## License

RufeShell is released under the [MIT License](LICENSE).
