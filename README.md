# FinalPowerShell

使用 Rust、Tauri 2 和 xterm.js 构建的本地远程运维工作台。当前开发预览版支持连接配置、SSH 交互终端、SFTP 目录浏览和单文件上传下载，不依赖 FinalShell 或 Java 运行时。

## 已实现

- 本地 JSON 连接配置，写入前保留备份，Windows 下使用原子替换。
- 密码仅存入 Windows 凭据库，连接配置不保存密码。
- 密码和 OpenSSH 私钥认证；首次连接自动获取服务器公钥并显示 SHA256 指纹，可选择仅本次接受或保存到 `known_hosts`；已信任且凭据可用的服务器点击连接卡片即可登录。
- 多标签 SSH 终端、终端尺寸同步、主动断开和连接保活。
- Linux 服务器 CPU 趋势、内存、交换分区、网络速率、进程、挂载点、负载和运行时间面板，每 2 秒刷新，单次采样 0.6 秒并复用独立监控连接；临时失败保留已有数据并自动恢复。
- 右侧 SFTP 文件面板支持隐藏和拖动调宽；右键目录打开，右键文件快速查看、编辑保存或下载，右键空白处上传和刷新。
- 支持从 Windows 资源管理器拖入一个或多个文件上传到当前目录，也可拖到指定子目录；上传不会覆盖同名文件。
- 快速编辑支持 1 MB 以内的 UTF-8 文本，拒绝直接编辑二进制文件；上传不覆盖已有文件。

## 环境

- Windows 10/11、Node.js 22+、Rust 1.90+。
- Visual Studio 2022 C++ Build Tools（MSVC x64、Windows 11 SDK）。
- 项目新增工具与缓存统一放在 `D:\coding environment`：
  - `tools\npm`：npm 启动文件。
  - `npm-cache`：npm 下载缓存。
  - `cargo-cache\finalpowershell`：Cargo 构建输出。
  - `VSBuildTools`：MSVC 编译器。
  - `portable-msvc`、`portable-sdk`：项目使用的 C++ 头文件、运行库和 Windows SDK 工具。
  - `VSShared`、`vs-cache`：Visual Studio 共享组件和安装清单。

本工作区使用内置 Node.js，所以可用下面的完整命令运行 npm。普通终端已将 Node.js 和 npm 加入 PATH 时，直接使用 `npm run dev` 和 `npm run tauri dev` 即可。

推荐通过项目脚本启动，它会设置 MSVC、Windows SDK 和 D 盘缓存：

```powershell
.\scripts\dev-env.ps1 dev
```

不要直接双击 `cargo-cache` 中的开发版 `finalpowershell.exe`：开发模式需要同时运行本地界面服务，直接启动会出现 `localhost 拒绝连接`。需要独立打开的程序时，请使用 `.\scripts\dev-env.ps1 build` 生成发行版。

其他命令：`.\scripts\dev-env.ps1 check` 运行前端构建、Rust 测试和静态检查；`.\scripts\dev-env.ps1 build` 生成发行包。

```powershell
node 'D:\coding environment\tools\npm\package\bin\npm-cli.js' install --cache 'D:\coding environment\npm-cache'
$env:CARGO_TARGET_DIR = 'D:\coding environment\cargo-cache\finalpowershell'
node 'D:\coding environment\tools\npm\package\bin\npm-cli.js' run tauri dev
```

开发预览会使用系统 WebView2。如果系统未安装，需要安装 Microsoft Edge WebView2 Runtime。

## 检查与构建

```powershell
node 'D:\coding environment\tools\npm\package\bin\npm-cli.js' run build
$env:CARGO_TARGET_DIR = 'D:\coding environment\cargo-cache\finalpowershell'
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
node 'D:\coding environment\tools\npm\package\bin\npm-cli.js' run tauri build
```

## 使用

1. 点击左侧 `+`，填写主机、端口、用户名，选择密码或私钥认证。
2. 首次点击连接卡片时，请通过管理员等可信渠道核对指纹，再点击“只接受本次”或“接受并保存”。后续点击卡片会使用已保存的主机密钥和凭据直接连接，密钥变化仍会拒绝登录。
3. 在终端中操作，左侧查看 Linux 实时资源信息；右侧文件面板会在登录后自动加载根目录。资源与文件面板均可隐藏和拖动调宽，并为终端保留最小空间。
4. 通过文件夹图标隐藏或显示文件面板，拖动其左边缘调宽。右键文件查看、编辑或下载，右键空白处上传和刷新。小窗口会自动收起文件面板以保留终端空间。

## 数据与边界

默认数据目录为 `%LOCALAPPDATA%\FinalPowerShell`。开发测试可以设置 `FINALPOWERSHELL_DATA_DIR` 到独立目录。

已保存的主机密钥会在下次连接时自动校验；如果密钥发生变化，程序会显示旧指纹并警告。当前尚未实现加密私钥口令、自动重连、目录递归传输、端口转发、代理、云同步和团队功能。不要把开发预览版视为 FinalShell 的完整替代品。

## 本次验收记录

- 前端 TypeScript 和 Vite 构建通过。
- Rust 单元测试通过，`clippy -D warnings` 通过。
- 本地 SSH/SFTP 集成测试通过：自动读取主机公钥和 SHA256 指纹、密码认证、双会话同时输入与文件读取、终端输入回传、窗口尺寸同步、资源采集、SFTP 初始化和目录列表。测试服务仅绑定 `127.0.0.1`，使用临时主机密钥和临时测试密码。
- WebView 界面自动化验收通过：已信任服务器一键连接、终端输入、文件列表、右键文本查看编辑与重新读取、两侧面板隐藏及拖动调宽、资源连续刷新与临时失败后自动恢复。运行前需启动 `FINALPOWERSHELL_E2E=1` 的隔离实例，测试脚本也会检查此环境变量。
- Windows 原生存储临时凭据写入、读回与删除测试通过，未读取真实服务器密码。
- Windows 调试版可执行文件已生成并启动，窗口进程响应正常。
- 尚未使用真实 SSH 服务器验收；首次使用前请先在测试服务器上验证。
