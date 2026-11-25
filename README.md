<div align="center">

<p>
  <strong>English</strong> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<img src="src/assets/rufeshell-icon.png" alt="RufeShell Logo" width="84" />

<h1>RufeShell</h1>

<p>
  <strong>A native Rust + Tauri 2 SSH, SFTP &amp; Windows ConPTY operations workbench.</strong>
</p>

<p>
  Built for daily remote ops: tabbed SSH &amp; local shells, dual-pane SFTP sync, host telemetry, and container management — with zero Java runtime dependency.
</p>

<p>
  <img src="https://img.shields.io/badge/Tauri-2.x-24C8D8?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Rust-1.90%2B-DEA584?style=flat-square&logo=rust&logoColor=111111" alt="Rust" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/xterm.js-6.0-111827?style=flat-square" alt="xterm.js" />
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D4?style=flat-square&logo=windows&logoColor=white" alt="Windows 10/11" />
  <img src="https://img.shields.io/badge/Version-1.2.0-10B981?style=flat-square" alt="Version 1.2.0" />
</p>

<p>
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#project-structure">Architecture</a> ·
  <a href="#security--storage">Security</a>
</p>

```powershell
npm run tauri dev
```

</div>

> [!NOTE]
> RufeShell stores SSH login passwords exclusively inside **Windows Credential Manager** (`keyring`) rather than plain-text config files, and verifies remote server SHA-256 host keys via `known_hosts`.

---

## Features

### SSH & Local ConPTY Sessions
- **Native SSH Interactive Terminal**: Multi-tabbed `russh` client with password and OpenSSH private key authentication, automatic terminal dimension sync, and keepalive.
- **Host Key Verification**: Displays the server's SHA-256 public key fingerprint on first connect (`Trust Once` or `Trust & Save`), and blocks connections if a saved key changes.
- **Auto Reconnect**: Preserves terminal scrollback on network drops and automatically retries based on configurable timeout and max-attempt settings, alongside one-click manual reconnect.
- **Unified Local Terminals**: Launch native Windows ConPTY tabs for **PowerShell** (`pwsh.exe` / `powershell.exe`), **CMD**, and **WSL** right alongside SSH tabs.
- **Administrator Launch (UAC)**: Relaunch RufeShell as Administrator via Windows UAC (so built-in local terminal tabs inherit elevated tokens), or toggle the sidebar **Admin** shield to open individual elevated local terminal windows.

### Daily Command Productivity
- **Command History**: Records command, timestamp, server, and execution outcome; supports `↑` / `↓` recall, search, deduplication, clearing, and automatic filtering of password/secret patterns.
- **Command Snippets**: Organize frequently used commands into groups with template variables (e.g. `{domain}`, `{service}`) and `Alt + 1` ~ `Alt + 9` quick triggers.
- **Terminal Tools**: Output search (`Ctrl + F`), screen clear (`Ctrl + Shift + L`), font & size controls, copy-on-select, right-click paste, and terminal log export.
- **Connection Management**: Edit, duplicate, group, tag, favorite, and sort connections, plus JSON import/export (passwords excluded).

### SFTP & Dual-Pane Sync
- **Full Context Menu**: Create file/folder, rename, two-step delete confirmation, copy path, and inspect/update Linux `chmod` permissions.
- **Safe Remote Text Editor**: View and edit UTF-8 files up to 1 MB with binary file protection and optional automatic `.bak` backup before saving.
- **Transfer Queue**: Live speed, progress, ETA, pause/resume/cancel/retry controls, large-file resume, conflict resolution prompts, and optional SHA-256 integrity verification.
- **Directory Transfers & Drag-and-Drop**: Upload or download entire folders recursively, or drag files/folders straight from Windows Explorer.
- **Dual-Pane Browser & Diff**: Side-by-side local vs. remote comparison with quick paths and on-demand sync.

### Host Telemetry & Operations
- **Customizable Telemetry Sidebar**: Dedicated polling channel displaying CPU trends, memory, swap, network throughput, disk usage, top processes, and mounts with configurable intervals, collapsible cards, visibility toggles, and warning thresholds.
- **Resource History & Alert Rules**: Extended resource trend charts, peak tracking, and threshold alerts with cooldown timers.
- **Process & Service Management**: Search, sort, inspect, and terminate remote processes with confirmation; browse, inspect logs, and control `systemd` units.
- **Docker Panel**: Inspect container status, CPU/memory usage, port mappings, container logs, and start/stop/restart actions.
- **SSH Port Forwarding**: Visual management and toggling for Local, Remote, and Dynamic (SOCKS5) port forwarding rules.

### Themes & Internationalization
- **7 Synchronized Themes** (UI + terminal):
  - Dark: `Obsidian Emerald` (default), `Tokyo Night`, `Dracula`, `GitHub Dark`
  - Light: `Morning Mist`, `Solarized Light`, `Catppuccin Latte`
- **Bilingual UI**: Switch seamlessly between **简体中文 (`zh-CN`)** and **English (`en`)** in Settings with live preview.

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

## Quick Start

### Prerequisites
- **OS**: Windows 10 / 11 (64-bit)
- **Runtime**: [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
- **Toolchain**:
  - [Node.js](https://nodejs.org/) 22+
  - [Rust](https://www.rust-lang.org/) 1.90+
  - Visual Studio 2022 Build Tools (MSVC x64 + Windows 10/11 SDK)

### Run & Build

```powershell
# Install frontend dependencies
npm install

# Start development mode (Tauri + Vite HMR)
npm run tauri dev

# Build frontend production bundle only
npm run build

# Build Windows release executables & installers (.exe / .msi)
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
│   ├── main.ts                 # App bootstrap, window controls & UAC elevation UI
│   ├── api.ts                  # Tauri IPC bindings & native file dialogs
│   ├── state.ts                # Workbench & session state store
│   ├── themes.ts               # Light/dark themes & terminal font presets
│   ├── i18n/                   # Simplified Chinese / English localization
│   ├── styles/                 # Design tokens, layout, session & dialog CSS
│   ├── utils/                  # Sensitive command filtering & helpers
│   └── ui/                     # Connections, terminal tools, SFTP, telemetry & ops panels
└── src-tauri/                  # Rust / Tauri 2 backend
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/           # Tauri 2 permission capabilities
    ├── tests/                  # SSH/SFTP & credential integration tests
    └── src/
        ├── lib.rs              # Tauri commands & app setup
        ├── domain.rs           # Domain models, settings & validation
        ├── store.rs            # Atomic JSON config persistence with backups
        ├── credentials.rs      # Windows Credential Manager bindings
        ├── host_keys.rs        # known_hosts fingerprint store
        ├── sessions.rs         # SSH sessions, PTY stream, SFTP & metrics
        ├── local_pty.rs        # Windows ConPTY shells & UAC elevation helpers
        ├── transfers.rs        # Resumable chunked transfers & SHA-256 verification
        ├── forwarding.rs       # Local / Remote / Dynamic SSH port forwarding
        └── ops.rs              # Remote process, systemd & Docker control
```

---

## Security & Storage

- **Data Directory**: Settings, profiles, and `known_hosts` are stored under `%LOCALAPPDATA%\RufeShell` (with automatic migration from legacy `%LOCALAPPDATA%\FinalPowerShell`, or override via `RUFESHELL_DATA_DIR`).
- **Secret Isolation**: Connection profiles never save plain-text passwords; secrets are kept in Windows Credential Manager.
- **Safe Persistence**: Configuration writes preserve backups and use atomic file replacement on Windows.
- **File Safety**: Binary files are blocked from text editing, optional `.bak` remote backups are supported before edits, and large/sync transfers support SHA-256 verification.
