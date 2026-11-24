# Rust 技术实施规范

## 1. 技术决策

这是面向新实现的设计，不是对 FinalShell Java 架构的逐层翻译。

| 层 | 建议 | 强制边界 |
| --- | --- | --- |
| 异步运行时 | `tokio` | 所有长 I/O 可取消，禁止 GUI 线程阻塞 |
| SSH | 评估并实现 `russh` 客户端 | 必须通过 HostKeyVerifier 抽象验证身份 |
| SFTP | `russh-sftp` | 与终端通道分离，统一取消和错误映射 |
| 终端 | `alacritty_terminal` 或独立 VT 引擎 | UI 不直接解析网络字节 |
| GUI | 原生 Rust 优先评估 `egui`；复杂桌面壳可选 Tauri | 首版不得把核心逻辑写进 Web/JavaScript 层 |
| 数据 | `serde`、`sqlx`/SQLite | 配置 schema 可迁移，秘密字段独立存储 |
| 凭据 | `keyring` 加平台适配器 | 禁止硬编码主密码和明文密码数据库 |
| 系统监控 | `sysinfo` | 可选功能，不能随启动无条件采集远程数据 |
| 日志 | `tracing` | 字段默认脱敏，日志级别不绕过秘密过滤 |

## 2. 模块划分

```text
app-shell
  workspace-ui / dialogs / settings-ui
application
  connection-service / session-service / transfer-service
  command-service / settings-service / sync-service (later)
domain
  profile / session / terminal / transfer / settings / events / errors
infrastructure
  ssh-russh / sftp-russh / vt / sqlite / keyring / fs / metrics
platform
  windows / linux (credential, process, tray, integration)
tests
  fake-ssh-server / pty / fixture-settings / transfer-faults
```

依赖方向只能为 `app-shell -> application -> domain`，`infrastructure` 实现 `domain` 定义的端口。禁止 `domain` 引入 GUI、russh、SQLite、keyring 或平台 API。

## 3. 领域契约

以下类型是语义契约，字段可在编码时细化；ID 使用不可复用的 UUID/ULID。

```rust
ConnectionProfile {
    id, folder_id, display_name, host, port, username,
    auth: AuthMethod, proxy_id: Option<ProxyId>,
    terminal_settings, host_key_policy, created_at, updated_at
}

AuthMethod::Password { credential_ref: CredentialRef }
AuthMethod::PublicKey { private_key_path, passphrase_ref: Option<CredentialRef>, agent: bool }

SessionState::Disconnected | Connecting | Authenticating | VerifyingHost |
             Connected | Reconnecting | Closing | Closed | Failed(ErrorInfo)

SessionEvent::StateChanged | OutputBytes | RemoteEof | HostKeyRequired |
              Error | Latency | ChannelClosed

RemoteEntry { name, path, kind, size, modified_at, permissions, symlink_target }

TransferJob { id, session_id, direction, source, destination,
              overwrite_policy, state, total_bytes, transferred_bytes }

CommandSnippet { id, group_id, title, body, sensitive, confirmation_policy }

AppSettings { schema_version, appearance, terminal, history,
              paths, integrations, sync: Option<SyncSettings> }
```

## 4. 服务端口

### 4.1 连接服务

- `create/update/delete/list/move/profile`
- `import/export` 必须输出秘密排除报告。
- 删除连接同时决定是否删除密钥库引用；失败必须可见。

### 4.2 会话服务

- `connect(profile_id, cancellation_token) -> session_id`
- `write_input(session_id, bytes)`
- `resize(session_id, columns, rows, pixel_width, pixel_height)`
- `disconnect(session_id, reason)`
- 事件订阅使用有界通道；慢消费者收到丢帧/重新同步事件，不能阻塞网络 reader。
- 一个会话一个所有者任务，通道生命周期由所有者统一回收。

### 4.3 文件与传输服务

- `list_directory(session_id, remote_path, continuation)`
- `enqueue_transfer(request) -> job_id`
- `pause/resume/cancel(job_id)`
- 大目录分页或流式返回；UI 不一次持有无界文件清单。
- 每个任务校验路径和类型，禁止把远端名字未净化地拼入本地目标目录。

### 4.4 设置与备份

- 数据库事务写领域数据；设置文件采用“临时文件 + flush + 原子替换”。
- 迁移过程保留旧文件、旧 schema 版本和迁移报告。
- 备份包含非敏感配置与元数据，不包含密钥库秘密。

## 5. 数据分类与生命周期

| 分类 | 内容 | 存储 | 默认导出 | 默认同步 |
| --- | --- | --- | --- | --- |
| Secret | 密码、私钥口令、令牌 | 平台密钥库 | 否 | 否 |
| Private | 主机、用户名、路径、历史、命令 | 本地数据库/配置 | 经确认 | 否 |
| Preference | 主题、布局、字体、快捷键 | 版本化设置 | 是 | 可选 |
| Ephemeral | 会话状态、缓冲、任务进度 | 内存，必要时本地临时文件 | 否 | 否 |
| Cache | 图片、IP 数据、可重建索引 | 缓存目录 | 否 | 否 |
| Audit | 脱敏操作和错误元数据 | 有上限日志 | 经确认 | 否 |

- 秘密以随机 `credential_ref` 关联，引用本身不是秘密。
- 剪贴板、命令历史和导出视为敏感边界；敏感片段不进入普通历史。
- 远程编辑临时文件限定权限、路径和生命周期，退出时清理。

## 6. 安全机制

### SSH

首次主机密钥显示类型和指纹；已保存密钥变化必须报错并要求人工确认。不得默认 `accept-any`，不得静默更新主机密钥。

### 命令执行

命令只发送到用户选择的会话。广播显示会话列表并要求确认；高危及多行命令额外预览。产品不负责替代远端操作系统的授权控制。

### 路径与文件

拒绝目录穿越、绝对路径替换和符号链接意外覆盖；下载到目标目录内创建受控文件名。删除与覆盖始终使用标准化后的完整路径进行确认。

### 网络功能

代理只应用于明确选择的连接。抓包需要单独授权、显示接口和过滤器、设置时间/容量上限并可立即停止；不得在启动时自动开启混杂模式。

### 同步与更新

同步默认关闭，文档具有设备 ID、修订号、内容摘要和删除墓碑；冲突不得静默覆盖。更新只接受 HTTPS、可信来源和签名验证通过的包。

## 7. 错误与可观测性

统一错误类别：认证失败、主机身份变化、超时、网络中断、权限拒绝、路径无效、空间不足、已取消、存储损坏、版本不兼容和内部错误。

每个会话/任务事件带 `session_id` 或 `job_id`、时间和脱敏原因；日志不得记录输入字节、密码、私钥、完整命令敏感参数或文件内容。

## 8. 测试与验收矩阵

| 测试 | 必须验证 |
| --- | --- |
| 设置迁移 | 旧版本、未知字段、损坏 JSON、磁盘失败、备份恢复 |
| 密钥库 | 不可用、用户拒绝、引用丢失、删除失败；不回退明文 |
| SSH | 密码/公钥、错误主机密钥、认证失败、EOF、超时、取消 |
| 终端 | ANSI、UTF-8 分片、窗口变化、高速输出背压、多会话隔离 |
| SFTP | 大目录、中文路径、权限错误、部分传输、取消和覆盖冲突 |
| 文件安全 | 路径穿越、符号链接、临时文件清理、原子保存 |
| 历史与片段 | 禁用、清除、敏感标记、多会话广播确认 |
| 并发 | 同时连接/断开/传输不会死锁或泄露任务 |
| 故障恢复 | 进程重启后配置一致，临时传输不被误判完成 |
| 可选功能 | 同步冲突、监控失败和抓包停止不影响核心终端 |

建议建立本地 Docker SSH 测试服务器与 Windows 原生集成测试两条测试通道；Linux/WSL 测试不能替代 Windows 凭据库、路径和 GUI 验收。

## 9. 首个迭代任务清单

1. 建立 Cargo workspace、领域错误和 ID 类型。
2. 实现设置 schema、连接模型、SQLite CRUD 和密钥库适配器。
3. 实现会话状态机、主机指纹确认和假 SSH 服务测试。
4. 接入 russh，完成输入、输出、resize、断开和取消。
5. 接入 VT 引擎和最小多标签 GUI。
6. 实现 SFTP 目录视图和单文件上传下载。
7. 加入传输队列、取消、覆盖确认和故障测试。
8. 实现历史、片段、设置备份与脱敏导出。

迭代完成标准：用户能安全保存连接，打开稳定的多会话终端，并完成可取消的文件传输；无需云同步、抓包或原程序数据迁移。

## 10. 待产品决策，不阻塞 M1

- 是否必须支持密码以外的交互式键盘认证和 SSH Agent。
- 远程编辑使用文件摘要、mtime+size 还是服务端版本作为冲突依据。
- 是否提供只读会话、录制审计、企业策略和团队共享。
- 是否确有云同步需求；若有，先定义独立服务端和威胁模型。
- 是否加入 Windows 本地 PowerShell 会话；建议作为独立 `LocalPtyProvider`，不要复用 SSH 协议语义。

