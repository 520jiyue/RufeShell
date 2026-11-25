<div align="center">

<p>
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<img src="src/assets/rufeshell-icon.png" alt="RufeShell Logo" width="84" />

<h1>RufeShell</h1>

<p>
  <strong>基于 Rust、Tauri 2 与 xterm.js 构建的原生 SSH、SFTP 与 Windows 本地终端运维工作台。</strong>
</p>

<p>
  专注日常远程运维与本地效率：多标签终端、双栏 SFTP 同步、主机遥测监控与服务容器管理，零 Java 运行时依赖。
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
  <a href="#快速开始">快速开始</a> ·
  <a href="#核心特性">核心特性</a> ·
  <a href="#快捷键一览">快捷键</a> ·
  <a href="#项目结构">项目结构</a> ·
  <a href="#安全与数据存储">安全说明</a>
</p>

```powershell
npm run tauri dev
```

</div>

> [!NOTE]
> RufeShell 不会在 JSON 配置文件中明文保存服务器密码，所有登录凭据统一托管至 **Windows 原生凭据管理器**（Credential Manager），并通过 `known_hosts` 校验服务器 SHA-256 指纹。

---

## 核心特性

### 1. SSH 终端与本地 ConPTY 会话
- **原生 SSH 交互**：基于 `russh` 实现多标签 SSH 会话，支持密码与 OpenSSH 私钥认证、终端尺寸同步及连接保活。
- **主机指纹校验**：首次连接展示服务器公钥 SHA-256 指纹（可选“仅本次接受”或“保存信任”），密钥变化时自动告警拦截。
- **断线自动重连**：网络波动断开时保留终端历史输出，支持按超时和次数配置自动重连，并提供一键手动重连。
- **本地终端统一管理**：基于 Windows 原生 ConPTY 在标签页内运行 **PowerShell**（自动识别 `pwsh.exe` / `powershell.exe`）、**CMD** 与 **WSL**，与 SSH 会话同栏管理。
- **管理员权限启动**：支持一键通过系统 UAC **以管理员身份重启 RufeShell**（内置本地终端标签同步继承管理员权限），也可开启侧边栏“管理员”开关在独立提权窗口中启动本地终端。

### 2. 日常运维与命令效率
- **历史指令记录**：记录命令、时间、所属服务器及状态；支持方向键回溯、搜索、去重、清空，自动过滤包含密码等敏感信息的命令。
- **常用命令收藏**：支持命令分组、模板变量填充（如 `{domain}`、`{service}`）及 `Alt + 1` ~ `Alt + 9` 快捷键触发。
- **终端体验增强**：支持输出搜索（`Ctrl + F`）、清屏（`Ctrl + Shift + L`）、字体与字号调整、选中自动复制、右键粘贴以及输出日志导出。
- **连接管理增强**：支持连接编辑、复制、分组、标签、收藏置顶与多种排序方式，支持配置 JSON 导入 / 导出（不含密码）。

### 3. SFTP 文件管理与双栏同步
- **完整右键操作**：新建文件 / 目录、重命名、删除二次确认、复制路径、权限查看与 `chmod` 修改。
- **安全在线文本编辑**：支持 1 MB 以内 UTF-8 文本快速编辑，自动拦截二进制文件，保存前可自动创建 `.bak` 远端备份。
- **传输任务队列**：实时显示传输速度、进度、预计剩余时间与错误信息；支持暂停、恢复、取消、失败重试、大文件断点续传、同名冲突策略及 SHA-256 校验。
- **目录传输与拖拽上传**：支持整个目录递归上传 / 下载，支持从 Windows 资源管理器直接拖入文件或目录上传。
- **本地与远程双栏对照**：支持双栏浏览、快捷路径跳转、差异比对与按需同步。

### 4. 主机遥测与主机运维
- **可定制主机遥测**：独立监控通道实时读取 CPU 趋势、内存、交换分区、网络速率、磁盘、进程与挂载点；支持采样周期、模块显隐、分组折叠与负载警告阈值自定义。
- **资源历史图表与告警**：提供更长时间跨度的趋势图表与峰值记录，支持配置资源阈值告警规则及冷却时间。
- **进程与服务管理**：支持进程搜索、排序、详情查看与确认结束进程；支持 Systemd 服务列表检索、状态与日志查看及启停操作。
- **Docker 容器面板**：查看容器状态、CPU / 内存占用与端口映射，支持日志查看及启动、停止、重启操作。
- **SSH 端口转发**：可视化配置与启停本地转发（Local）、远程转发（Remote）和动态 SOCKS5（Dynamic）端口转发。

### 5. 主题与多语言
- **7 套深浅色联动主题**（应用界面与终端实时同步）：
  - 深色：`Obsidian Emerald`（默认）、`Tokyo Night`、`Dracula`、`GitHub Dark`
  - 浅色：`Morning Mist`、`Solarized Light`、`Catppuccin Latte`
- **双语切换**：内置**简体中文（`zh-CN`）**与 **English（`en`）**，支持在设置中实时预览并持久化保存。

---

## 快捷键一览

| 分类 | 快捷键 | 功能说明 |
| --- | --- | --- |
| **工作台** | `Ctrl + N` | 新建连接 |
| | `Ctrl + B` | 展开 / 收起左侧连接栏 |
| | `Ctrl + ,` | 打开工作台与终端设置 |
| | `F1` / `Ctrl + /` | 打开快捷键说明 |
| **会话标签** | `Ctrl + W` | 关闭当前会话 |
| | `Ctrl + Tab` / `Ctrl + Shift + Tab` | 切换下一个 / 上一个标签 |
| | `Ctrl + 1` ~ `9` | 快速跳转到对应序号标签 |
| **终端与面板** | `Ctrl + F` | 搜索终端输出内容 |
| | `Ctrl + Shift + L` | 清屏 |
| | `Ctrl + Shift + C` / `V` | 复制 / 粘贴 |
| | `Ctrl + =` / `-` | 放大 / 缩小终端字号 |
| | `Ctrl + E` | 显示 / 隐藏右侧 SFTP 文件面板 |
| | `Ctrl + M` | 显示 / 隐藏主机遥测面板 |
| **命令工具** | `Ctrl + H` | 打开历史指令记录 |
| | `Ctrl + K` | 打开常用命令收藏 |
| | `Alt + 1` ~ `9` | 执行绑定对应快捷键的常用命令 |
| | `↑` / `↓` | 终端内快速回溯历史指令 |

---

## 快速开始

### 环境要求
- **操作系统**：Windows 10 / 11（64 位）
- **运行依赖**：[Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
- **构建环境**：
  - [Node.js](https://nodejs.org/) 22+
  - [Rust](https://www.rust-lang.org/) 1.90+
  - Visual Studio 2022 Build Tools（MSVC x64 + Windows 10/11 SDK）

### 启动与打包

```powershell
# 安装前端依赖
npm install

# 启动开发模式（Tauri + Vite 热更新）
npm run tauri dev

# 仅构建前端资源
npm run build

# 打包 Windows 发行版安装包
npm run tauri build
```

> 若使用便携工具链脚本环境，也可运行 `.\scripts\dev-env.ps1 dev`、`.\scripts\dev-env.ps1 check` 或 `.\scripts\dev-env.ps1 build`。

### 测试与静态检查

```powershell
# 前端类型检查与构建
npm run build

# Rust 单元测试与集成测试
cargo test --manifest-path src-tauri/Cargo.toml

# Rust Clippy 检查
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

---

## 项目结构

```text
RufeShell/
├── index.html                  # 应用入口 HTML
├── package.json                # 前端依赖与脚本
├── vite.config.ts              # Vite 构建配置
├── scripts/                    # Windows 便携工具链辅助脚本
├── src/                        # TypeScript 前端源码
│   ├── main.ts                 # 应用启动、窗口控制与提权交互
│   ├── api.ts                  # Tauri IPC 调用与系统文件对话框
│   ├── state.ts                # 工作台配置与会话状态管理
│   ├── themes.ts               # 深浅色主题与终端字体预设
│   ├── i18n/                   # 简体中文 / 英文双语引擎与词条
│   ├── styles/                 # 样式变量、布局、会话与弹窗样式
│   ├── utils/                  # 敏感命令过滤与通用工具
│   └── ui/                     # 连接管理、终端工具、SFTP、遥测与主机运维面板
└── src-tauri/                  # Rust / Tauri 2 后端源码
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/           # Tauri 2 权限配置
    ├── tests/                  # SSH / SFTP 与凭据集成测试
    └── src/
        ├── lib.rs              # Tauri 命令注册与入口
        ├── domain.rs           # 核心领域模型、设置与校验规则
        ├── store.rs            # 配置持久化（原子替换 + 备份）
        ├── credentials.rs      # Windows 凭据库封装
        ├── host_keys.rs        # known_hosts 指纹管理
        ├── sessions.rs         # SSH 会话、终端流、SFTP 与遥测采集
        ├── local_pty.rs        # Windows ConPTY 本地终端与 UAC 提权
        ├── transfers.rs        # 分块传输、断点续传与 SHA-256 校验
        ├── forwarding.rs       # 本地 / 远程 / 动态 SSH 端口转发
        └── ops.rs              # 远端进程、Systemd 与 Docker 运维执行
```

---

## 安全与数据存储

- **数据目录**：配置文件与主机指纹默认存放在 `%LOCALAPPDATA%\RufeShell`（支持从旧目录 `%LOCALAPPDATA%\FinalPowerShell` 自动迁移，也可通过环境变量 `RUFESHELL_DATA_DIR` 自定义）。
- **凭据隔离**：连接配置不存明文密码，所有密码均通过 Windows Credential Manager 安全存储。
- **安全写入**：配置写入前自动保留备份并采用 Windows 原子文件替换。
- **文件编辑安全**：自动阻止二进制文件进入文本编辑器，支持保存前生成 `.bak` 远端备份及传输后 SHA-256 校验。
