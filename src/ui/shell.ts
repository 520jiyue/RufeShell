import rufeshellIconUrl from "../assets/rufeshell-icon.png";
import { icon } from "../icons.ts";
import { $ } from "../utils.ts";

export function mountShell(): void {
  $("#app").innerHTML = `
    <div id="app-shell" class="app-shell">
      <header class="titlebar" data-tauri-drag-region>
        <div class="titlebar-left">
          <button id="toggle-sidebar" class="icon-button active" type="button" title="收起连接栏 (Ctrl+B)" aria-label="切换连接栏">${icon("sidebar")}</button>
        </div>
        <div id="titlebar-drag-spacer" class="titlebar-drag-spacer" data-tauri-drag-region></div>
        <div class="titlebar-right">
          <div class="titlebar-tools">
            <button id="open-history" class="tool-pill" type="button" title="历史指令记录 (Ctrl+H)">${icon("history")}<span>历史指令</span></button>
            <button id="open-snippets" class="tool-pill" type="button" title="常用命令收藏 (Ctrl+K)">${icon("bookmark")}<span>常用命令</span></button>
            <button id="open-settings" class="icon-button" type="button" title="工作台与终端设置 (Ctrl+,)" aria-label="工作台与终端设置">${icon("settings")}</button>
            <button id="open-shortcuts" class="icon-button" type="button" title="快捷键说明 (F1)" aria-label="快捷键说明">${icon("keyboard")}</button>
          </div>
          <span class="titlebar-divider" aria-hidden="true"></span>
          <div class="window-controls">
            <button id="win-minimize" class="win-btn" type="button" title="最小化" aria-label="最小化">${icon("winMin")}</button>
            <button id="win-maximize" class="win-btn" type="button" title="最大化" aria-label="最大化">${icon("winMax")}</button>
            <button id="win-close" class="win-btn win-close" type="button" title="关闭" aria-label="关闭">${icon("x")}</button>
          </div>
        </div>
      </header>
      <div class="workspace">
        <aside id="sidebar" class="sidebar">
          <div class="sidebar-heading">
            <span>服务器列表</span>
            <div class="sidebar-heading-actions">
              <button id="import-connections" class="icon-button" type="button" title="导入连接配置">${icon("upload")}</button>
              <button id="export-connections" class="icon-button" type="button" title="导出连接配置（不含密码）">${icon("download")}</button>
              <button id="add-connection" class="icon-button accent-subtle" type="button" title="新建连接 (Ctrl+N)">${icon("plus")}</button>
            </div>
          </div>
          <div class="sidebar-search">
            ${icon("search")}
            <input id="connection-search" type="search" placeholder="搜索名称、主机、分组或标签…" aria-label="筛选连接" spellcheck="false" />
          </div>
          <div class="sidebar-filters">
            <select id="connection-group-filter" aria-label="按分组筛选">
              <option value="all">全部分组</option>
              <option value="favorites">★ 仅收藏</option>
            </select>
            <select id="connection-sort" aria-label="排序方式">
              <option value="favorite">收藏优先</option>
              <option value="name">按名称</option>
              <option value="group">按分组</option>
              <option value="recent">最近更新</option>
            </select>
          </div>
          <div id="connection-list" class="connection-list"></div>
          <div class="local-shells-strip" title="快速启动本地终端标签">
            <span class="local-shells-label">${icon("terminal")}<span>本地</span></span>
            <div class="local-shells-btns">
              <button type="button" class="local-shell-chip" data-local-shell="power_shell">PowerShell</button>
              <button type="button" class="local-shell-chip" data-local-shell="cmd">CMD</button>
              <button type="button" class="local-shell-chip" data-local-shell="wsl">WSL</button>
            </div>
          </div>
          <div class="sidebar-foot">
            <span class="status-dot"></span>
            <span>Rust 原生 SSH &amp; ConPTY · 本地凭据隔离</span>
          </div>
        </aside>
        <main class="main-area">
          <div id="tabbar" class="tabbar hidden"></div>
          <div id="welcome" class="welcome">
            <div class="welcome-glow" aria-hidden="true"></div>
            <div class="welcome-hero">
              <div class="welcome-symbol"><img class="welcome-brand-img" src="${rufeshellIconUrl}" alt="RufeShell" /></div>
              <span class="welcome-kicker">RUFESHELL WORKBENCH</span>
              <h1>远程工作，井然有序。</h1>
              <p>原生多标签 SSH 终端、SFTP 文件直传与可定制主机遥测，在一个专注的工作台中完成。</p>
              <div class="welcome-actions">
                <button id="welcome-add" class="primary" type="button">${icon("plus")} 新建连接</button>
                <button id="welcome-shortcuts" class="subtle" type="button">${icon("keyboard")} 快捷键指南</button>
              </div>
              <div class="welcome-features">
                <span>${icon("terminal")} 多标签与输出搜索</span>
                <span>${icon("history")} 敏感过滤历史指令</span>
                <span>${icon("bookmark")} 变量命令收藏</span>
                <span>${icon("reconnect")} 断线自动重连</span>
              </div>
            </div>
            <div id="welcome-recents" class="welcome-recents hidden"></div>
          </div>
          <section id="session-view" class="session-view hidden">
            <div class="session-toolbar">
              <div class="session-meta">
                <span id="session-status-badge" class="session-status-badge connecting">连接中</span>
                <strong id="session-title"></strong>
                <span id="session-address" class="muted"></span>
              </div>
              <div id="session-mode-switcher" class="session-mode-switcher" role="tablist" aria-label="会话视图模式">
                <button type="button" class="mode-tab active" data-session-mode="terminal">${icon("terminal")}<span>终端</span></button>
                <button type="button" class="mode-tab" data-session-mode="dual">${icon("columns")}<span>双栏传输</span></button>
                <button type="button" class="mode-tab" data-session-mode="ops">${icon("activity")}<span>主机运维</span></button>
              </div>
              <div class="toolbar-actions">
                <div class="toolbar-group" title="终端工具">
                  <button id="terminal-search-btn" class="icon-button" type="button" title="搜索输出 (Ctrl+F)">${icon("search")}</button>
                  <button id="terminal-clear-btn" class="icon-button" type="button" title="清屏 (Ctrl+Shift+L)">${icon("clear")}</button>
                  <button id="terminal-save-log-btn" class="icon-button" type="button" title="保存输出日志">${icon("save")}</button>
                </div>
                <div id="panel-toggles-group" class="toolbar-group" title="面板显示">
                  <button id="toggle-metrics" class="icon-button active" type="button" title="隐藏资源面板 (Ctrl+M)">${icon("activity")}</button>
                  <button id="toggle-files" class="icon-button active" type="button" title="隐藏文件面板 (Ctrl+E)">${icon("folder")}</button>
                </div>
                <button id="reconnect-btn" class="subtle hidden" type="button">${icon("reconnect")}<span>重新连接</span></button>
                <button id="disconnect" class="subtle danger-ghost" type="button">${icon("x")}<span>关闭会话</span></button>
              </div>
            </div>
            <div id="session-workspace" class="session-workspace">
              <aside id="metrics-panel" class="metrics-panel">
                <div class="metrics-heading">
                  ${icon("server")}
                  <span>主机遥测</span>
                  <div class="metrics-heading-right">
                    <button id="metrics-customize-btn" class="icon-button" type="button" title="遥测显示与采样设置">${icon("sliders")}</button>
                    <span class="live-label">LIVE</span>
                  </div>
                </div>
                <div id="metrics-content" class="metrics-content">
                  <p class="metrics-placeholder">连接后自动读取 Linux 系统资源</p>
                </div>
                <div id="metrics-foot" class="metrics-foot">2 秒采样 · 复用独立监控通道</div>
              </aside>
              <div id="metrics-resizer" class="metrics-resizer" title="拖动调整资源面板宽度"></div>
              <div class="session-content">
                <div id="reconnect-banner" class="reconnect-banner hidden">
                  <div class="reconnect-banner-copy">
                    <span class="status-dot connecting"></span>
                    <span id="reconnect-status-text">网络波动导致连接断开，正在尝试自动重连…</span>
                  </div>
                  <div class="reconnect-banner-actions">
                    <button id="reconnect-now" class="primary" type="button">立即重连</button>
                    <button id="reconnect-cancel" class="subtle" type="button">停止</button>
                  </div>
                </div>
                <div id="terminal-search-bar" class="terminal-search-bar hidden">
                  <input id="terminal-search-input" type="search" placeholder="搜索终端输出…" spellcheck="false" />
                  <span id="terminal-search-count" class="search-count">0 / 0</span>
                  <label class="search-case-toggle" title="区分大小写">
                    <input id="terminal-search-case" type="checkbox" />
                    <span>Aa</span>
                  </label>
                  <button id="terminal-search-prev" class="icon-button" type="button" title="上一个 (Shift+Enter)">${icon("chevronUp")}</button>
                  <button id="terminal-search-next" class="icon-button" type="button" title="下一个 (Enter)">${icon("chevronDown")}</button>
                  <button id="terminal-search-close" class="icon-button" type="button" title="关闭 (Esc)">${icon("x")}</button>
                </div>
                <div id="terminal-panel" class="terminal-panel"></div>
                <div class="quick-command-bar">
                  <span class="quick-prompt">&gt;_</span>
                  <input id="quick-command-input" type="text" placeholder="快捷命令栏：输入指令回车发送，↑/↓ 切换历史指令…" spellcheck="false" autocomplete="off" />
                  <button id="quick-history-open" class="icon-button" type="button" title="历史指令 (Ctrl+H)">${icon("history")}</button>
                  <button id="quick-snippets-open" class="icon-button" type="button" title="常用命令 (Ctrl+K)">${icon("bookmark")}</button>
                  <button id="quick-command-send" class="subtle" type="button">发送</button>
                </div>
              </div>
              <div id="files-resizer" class="files-resizer" title="拖动调整文件面板宽度"></div>
              <aside id="files-panel" class="files-panel">
                <div class="file-toolbar">
                  <button id="parent-directory" class="icon-button" type="button" title="上一级">${icon("arrow")}</button>
                  <div class="path-input-wrap">
                    <input id="remote-path" aria-label="远程路径" spellcheck="false" />
                  </div>
                  <button id="upload-file" class="icon-button" type="button" title="上传文件到当前目录">${icon("upload")}</button>
                  <button id="refresh-files" class="icon-button" type="button" title="刷新">${icon("refresh")}</button>
                </div>
                <div id="file-containers" class="file-containers"></div>
                <div class="files-hint">支持拖放上传 · 右键文件可查看、编辑或下载</div>
              </aside>
            </div>
            <div id="dual-files-view" class="dual-files-view hidden">
              <div class="dual-toolbar">
                <div class="dual-toolbar-left">
                  <span class="eyebrow">DUAL-PANE SFTP SYNC</span>
                  <strong>本地与远程双栏文件管理</strong>
                </div>
                <div class="dual-toolbar-actions">
                  <button id="dual-refresh-btn" type="button" class="subtle">${icon("refresh")}<span>刷新两端</span></button>
                  <button id="dual-compare-btn" type="button" class="primary">${icon("columns")}<span>差异比较</span></button>
                </div>
              </div>
              <div id="dual-panes-grid" class="dual-panes-grid">
                <section class="dual-pane">
                  <div class="dual-pane-head">
                    <span class="dual-pane-badge">本地</span>
                    <select id="dual-local-quick" class="dual-quick-select" title="快速定位本地常用目录"></select>
                    <button id="dual-local-up" type="button" class="icon-button" title="返回上级本地目录">${icon("chevronUp")}</button>
                    <input id="dual-local-path" type="text" aria-label="本地路径" />
                  </div>
                  <div class="dual-cols-head"><span>名称</span><span>大小</span><span>操作</span></div>
                  <div id="dual-local-list" class="dual-list"></div>
                </section>
                <section class="dual-pane">
                  <div class="dual-pane-head">
                    <span class="dual-pane-badge is-remote">远程</span>
                    <button id="dual-remote-up" type="button" class="icon-button" title="返回上级远程目录">${icon("chevronUp")}</button>
                    <input id="dual-remote-path" type="text" aria-label="远程路径" />
                  </div>
                  <div class="dual-cols-head"><span>名称</span><span>大小</span><span>操作</span></div>
                  <div id="dual-remote-list" class="dual-list"></div>
                </section>
              </div>
              <div id="dual-diff-view" class="dual-diff-view hidden">
                <div class="dual-diff-bar">
                  <div class="dual-diff-left">
                    <button id="dual-exit-diff-btn" type="button" class="subtle">返回双栏浏览</button>
                    <label class="check-pill compact-check"><input id="dual-only-diff" type="checkbox" checked /><span>仅显示有差异的文件</span></label>
                  </div>
                  <div class="dual-diff-actions">
                    <button id="dual-sync-up-missing" type="button" class="subtle">${icon("upload")}<span>批量上传本地独有/较新</span></button>
                    <button id="dual-sync-down-missing" type="button" class="subtle">${icon("download")}<span>批量下载远端独有/较新</span></button>
                  </div>
                </div>
                <div id="dual-diff-list" class="dual-diff-list"></div>
              </div>
            </div>
            <div id="ops-view" class="ops-view hidden">
              <div class="ops-header">
                <div class="ops-tabs" role="tablist">
                  <button type="button" class="ops-tab active" data-ops-tab="trends">${icon("activity")}<span>资源历史与告警</span></button>
                  <button type="button" class="ops-tab" data-ops-tab="processes">${icon("terminal")}<span>进程管理</span></button>
                  <button type="button" class="ops-tab" data-ops-tab="services">${icon("settings")}<span>Systemd 服务</span></button>
                  <button type="button" class="ops-tab" data-ops-tab="docker">${icon("box")}<span>Docker 容器</span></button>
                  <button type="button" class="ops-tab" data-ops-tab="forwards">${icon("network")}<span>端口转发</span></button>
                </div>
              </div>
              <div class="ops-body">
                <div id="ops-trends-panel" class="ops-panel"></div>
                <div id="ops-processes-panel" class="ops-panel hidden">
                  <div class="ops-filterbar">
                    <input id="ops-proc-search" type="search" placeholder="搜索进程名 / PID / 用户 / 命令行…" />
                    <select id="ops-proc-sort">
                      <option value="cpu">按 CPU 降序</option>
                      <option value="mem">按内存降序</option>
                      <option value="pid">按 PID 升序</option>
                    </select>
                    <button id="ops-proc-refresh" type="button" class="subtle">${icon("refresh")}<span>刷新</span></button>
                  </div>
                  <div class="ops-table-head proc-cols">
                    <span>PID</span><span>用户</span><span>CPU</span><span>内存</span><span>状态</span><span>命令</span><span>操作</span>
                  </div>
                  <div id="ops-proc-list" class="ops-table-list"></div>
                </div>
                <div id="ops-services-panel" class="ops-panel hidden">
                  <div class="ops-filterbar">
                    <input id="ops-svc-search" type="search" placeholder="搜索服务名称或描述…" />
                    <select id="ops-svc-filter">
                      <option value="all">全部服务</option>
                      <option value="active">仅运行中 (active)</option>
                      <option value="failed">仅异常 (failed)</option>
                      <option value="inactive">仅未运行 (inactive)</option>
                    </select>
                    <button id="ops-svc-refresh" type="button" class="subtle">${icon("refresh")}<span>刷新</span></button>
                  </div>
                  <div class="ops-table-head svc-cols">
                    <span>服务单元</span><span>状态</span><span>描述</span><span>操作</span>
                  </div>
                  <div id="ops-svc-list" class="ops-table-list"></div>
                </div>
                <div id="ops-docker-panel" class="ops-panel hidden">
                  <div class="ops-filterbar">
                    <input id="ops-docker-search" type="search" placeholder="搜索容器名 / ID / 镜像…" />
                    <select id="ops-docker-filter" aria-label="容器状态筛选">
                      <option value="all">全部容器</option>
                      <option value="running">仅运行中</option>
                      <option value="stopped">已停止</option>
                    </select>
                    <span id="ops-docker-summary" class="ops-summary-pill"></span>
                    <button id="ops-docker-refresh" type="button" class="subtle">${icon("refresh")}<span>刷新</span></button>
                  </div>
                  <div class="ops-table-head docker-cols">
                    <span>容器 / 镜像</span><span>状态</span><span>资源占用</span><span>端口映射</span><span>操作</span>
                  </div>
                  <div id="ops-docker-list" class="ops-table-list"></div>
                </div>
                <div id="ops-forwards-panel" class="ops-panel hidden">
                  <form id="fwd-form" class="fwd-form">
                    <select id="fwd-kind" title="转发类型">
                      <option value="local">本地转发 (-L)</option>
                      <option value="remote">远程转发 (-R)</option>
                      <option value="dynamic">SOCKS5 动态 (-D)</option>
                    </select>
                    <input id="fwd-bind-host" type="text" value="127.0.0.1" placeholder="监听地址" />
                    <input id="fwd-bind-port" type="number" min="1" max="65535" placeholder="监听端口" required />
                    <span class="fwd-arrow">→</span>
                    <input id="fwd-target-host" type="text" value="127.0.0.1" placeholder="目标主机" />
                    <input id="fwd-target-port" type="number" min="1" max="65535" placeholder="目标端口" required />
                    <button type="submit" class="primary">${icon("plus")}<span>添加规则</span></button>
                  </form>
                  <div class="ops-table-head fwd-cols">
                    <span>类型</span><span>转发链路</span><span>实时流量</span><span>操作</span>
                  </div>
                  <div id="ops-fwd-list" class="ops-table-list"></div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
      <footer class="statusbar">
        <span id="global-status">就绪</span>
        <div class="statusbar-right">
          <button id="transfer-status-pill" type="button" class="transfer-status-pill">传输队列</button>
          <span>RufeShell</span>
        </div>
      </footer>
    </div>

    <dialog id="connection-dialog">
      <form id="connection-form">
        <div class="dialog-heading">
          <div>
            <span id="connection-dialog-eyebrow" class="eyebrow">NEW CONNECTION</span>
            <h2 id="connection-dialog-title">建立新的连接</h2>
          </div>
          <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
        </div>
        <p class="dialog-description">填写服务器信息。连接配置保存在本地，密码仅存入系统凭据库。</p>
        <div class="form-row">
          <label class="host-field">连接名称<input name="name" required placeholder="例如：生产服务器" maxlength="60" /></label>
          <label class="group-field">分组<input name="group" placeholder="生产环境" maxlength="30" /></label>
        </div>
        <div class="form-row">
          <label class="host-field">主机地址<input name="host" required placeholder="192.168.1.10 或 example.com" /></label>
          <label class="port-field">端口<input name="port" type="number" min="1" max="65535" value="22" required /></label>
        </div>
        <div class="form-row">
          <label class="host-field">用户名<input name="username" required placeholder="root" autocomplete="username" /></label>
          <label class="port-field">超时(秒)<input name="timeout" type="number" min="3" max="120" placeholder="15" /></label>
        </div>
        <label>标签（英文逗号分隔）<input name="tags" placeholder="例如：web, nginx, 华东" /></label>
        <fieldset>
          <legend>认证方式</legend>
          <div class="auth-options">
            <label class="auth-pill"><input type="radio" name="auth" value="password" checked /><span>密码认证</span></label>
            <label class="auth-pill"><input type="radio" name="auth" value="private_key" /><span>私钥认证</span></label>
          </div>
        </fieldset>
        <label id="password-field"><span id="password-label-text">密码</span><input name="password" type="password" placeholder="连接密码" autocomplete="new-password" /></label>
        <div id="private-key-field" class="hidden">
          <label>私钥路径</label>
          <div class="file-picker">
            <input name="private_key_path" placeholder="选择 OpenSSH 私钥文件" readonly />
            <button type="button" id="choose-key" class="subtle">选择文件</button>
          </div>
        </div>
        <div class="inline-checks">
          <label class="check-pill"><input name="favorite" type="checkbox" /><span>★ 设为收藏服务器</span></label>
          <label class="check-pill"><input name="auto_reconnect" type="checkbox" checked /><span>断线自动重连</span></label>
        </div>
        <div id="form-error" class="form-error"></div>
        <div class="dialog-actions">
          <button type="button" class="subtle close-dialog">取消</button>
          <button id="connection-submit-btn" class="primary" type="submit">保存连接</button>
        </div>
      </form>
    </dialog>

    <dialog id="connect-dialog">
      <div class="connect-dialog-inner">
        <div class="dialog-heading">
          <div>
            <span class="eyebrow">SECURE CONNECTION</span>
            <h2 id="host-dialog-title">核对服务器身份</h2>
          </div>
          <button type="button" class="icon-button close-dialog" title="关闭">${icon("x")}</button>
        </div>
        <div class="connect-target">${icon("server")}<span id="connect-target"></span></div>
        <div class="security-notice">${icon("shield")}<p id="host-notice">正在自动获取服务器身份，无需手动填写公钥。</p></div>
        <dl class="host-details">
          <div class="key-type"><dt>密钥类型</dt><dd id="host-algorithm">获取中…</dd></div>
          <div><dt>主机密钥指纹 <span>SHA-256</span></dt><dd id="host-fingerprint" class="fingerprint">获取中…</dd></div>
        </dl>
        <div id="password-entry" class="password-entry hidden">
          <label for="connection-password">登录密码</label>
          <input id="connection-password" type="password" autocomplete="current-password" placeholder="请输入该服务器的登录密码" />
          <label class="remember-password"><input id="remember-password" type="checkbox" checked /><span>保存到 Windows 凭据库，下次自动登录</span></label>
        </div>
        <div id="connect-error" class="form-error"></div>
        <div class="dialog-actions">
          <button type="button" class="subtle close-dialog">取消</button>
          <button id="accept-once" class="subtle" type="button">只接受本次</button>
          <button id="accept-save" class="primary" type="button">接受并保存</button>
        </div>
        <div class="dialog-footnote">${icon("key")} 核对指纹可防止连接到冒充的服务器</div>
      </div>
    </dialog>

    <dialog id="history-dialog" class="wide-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">COMMAND HISTORY</span>
            <h2>历史指令记录</h2>
          </div>
          <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
        </div>
        <div class="modal-toolbar">
          <div class="modal-search-wrap">
            ${icon("search")}
            <input id="history-search" type="search" placeholder="搜索命令、服务器名称或地址…（↑/↓ 选择，Enter 执行，Shift+Enter 填入）" spellcheck="false" />
          </div>
          <label class="check-pill compact-check"><input id="history-dedupe" type="checkbox" /><span>去重显示</span></label>
          <button id="history-clear" type="button" class="subtle danger-ghost">清空历史</button>
        </div>
        <div id="history-list" class="modal-scroll-list"></div>
        <div class="modal-foot">已开启隐私过滤：含密码、口令、Token 或以空格开头的命令不会保存。</div>
      </div>
    </dialog>

    <dialog id="snippets-dialog" class="wide-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">COMMAND SNIPPETS</span>
            <h2>常用命令收藏</h2>
          </div>
          <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
        </div>
        <div class="modal-toolbar">
          <div class="modal-search-wrap">
            ${icon("search")}
            <input id="snippet-search" type="search" placeholder="搜索命令名称、内容或说明…" spellcheck="false" />
          </div>
          <select id="snippet-group-filter" aria-label="命令分组"></select>
          <button id="new-snippet-btn" type="button" class="primary">${icon("plus")} 新增命令</button>
        </div>
        <form id="snippet-form" class="snippet-editor-card hidden">
          <div class="snippet-editor-head">
            <strong id="snippet-form-title">新增常用命令</strong>
            <button id="cancel-snippet-form" type="button" class="subtle">收起</button>
          </div>
          <div class="form-row">
            <label class="host-field">名称<input id="snippet-name" required placeholder="例如：查看 Nginx 错误日志" /></label>
            <label class="group-field">分组<input id="snippet-group" placeholder="日志排查" /></label>
            <label class="port-field">快捷键
              <select id="snippet-shortcut">
                <option value="">无</option>
                <option value="Alt+1">Alt+1</option>
                <option value="Alt+2">Alt+2</option>
                <option value="Alt+3">Alt+3</option>
                <option value="Alt+4">Alt+4</option>
                <option value="Alt+5">Alt+5</option>
                <option value="Alt+6">Alt+6</option>
                <option value="Alt+7">Alt+7</option>
                <option value="Alt+8">Alt+8</option>
                <option value="Alt+9">Alt+9</option>
              </select>
            </label>
          </div>
          <label>命令模板（可用 {domain}、{service} 等变量）<textarea id="snippet-command" rows="2" required placeholder="例如：tail -n 100 /var/log/nginx/{domain}.error.log"></textarea></label>
          <div class="form-row align-end">
            <label class="host-field">备注说明<input id="snippet-desc" placeholder="可选：命令用途说明" /></label>
            <button type="submit" class="primary">保存命令</button>
          </div>
        </form>
        <div id="snippet-list" class="modal-scroll-list"></div>
      </div>
    </dialog>

    <dialog id="snippet-vars-dialog">
      <form id="vars-form">
        <div class="dialog-heading">
          <div>
            <span class="eyebrow">TEMPLATE VARIABLES</span>
            <h2 id="vars-snippet-name">填写命令变量</h2>
          </div>
          <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
        </div>
        <p class="dialog-description">替换变量占位符后发送到当前终端。</p>
        <div id="vars-fields"></div>
        <div class="vars-preview-box">
          <span>命令预览</span>
          <code id="vars-preview"></code>
        </div>
        <div class="dialog-actions">
          <button type="button" class="subtle close-dialog">取消</button>
          <button type="submit" class="primary">执行命令</button>
        </div>
      </form>
    </dialog>

    <dialog id="settings-dialog">
      <form id="settings-form">
        <div class="dialog-heading">
          <div>
            <span class="eyebrow">WORKBENCH SETTINGS</span>
            <h2>工作台与终端设置</h2>
          </div>
          <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
        </div>
        <p class="dialog-description">管理界面主题、终端字体行为、自动重连及文件传输安全策略；主机遥测参数请点击遥测栏右上角设置按钮。</p>
        <div class="form-row">
          <label class="host-field">终端字体<select id="setting-font-family"></select></label>
          <label class="port-field">字号(px)<input id="setting-font-size" type="number" min="11" max="24" /></label>
        </div>
        <label>应用与终端主题<select id="setting-theme"></select></label>
        <div class="form-row">
          <label class="host-field">默认连接超时（秒）<input id="setting-connect-timeout" type="number" min="3" max="120" /></label>
          <label class="host-field">自动重连最大次数<input id="setting-reconnect-max" type="number" min="1" max="10" /></label>
        </div>
        <div class="settings-toggles">
          <label class="check-pill"><input id="setting-auto-reconnect" type="checkbox" /><span>网络波动断开时自动重连（保留终端输出）</span></label>
          <label class="check-pill"><input id="setting-copy-on-select" type="checkbox" /><span>选中终端文本自动复制到剪贴板</span></label>
          <label class="check-pill"><input id="setting-right-click-paste" type="checkbox" /><span>在终端中右键直接粘贴剪贴板内容</span></label>
          <label class="check-pill"><input id="setting-edit-backup" type="checkbox" /><span>在线编辑远程文件前自动生成 .bak 备份</span></label>
          <label class="check-pill"><input id="setting-transfer-checksum" type="checkbox" /><span>大文件与同步传输完成后自动执行 SHA-256 校验</span></label>
        </div>

        <div class="dialog-actions">
          <button type="button" class="subtle close-dialog">取消</button>
          <button type="submit" class="primary">应用并保存</button>
        </div>
      </form>
    </dialog>

    <dialog id="metrics-settings-dialog">
      <form id="metrics-settings-form">
        <div class="dialog-heading">
          <div>
            <span class="eyebrow">TELEMETRY DISPLAY</span>
            <h2>主机遥测显示设置</h2>
          </div>
          <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
        </div>
        <p class="dialog-description">仅控制“主机遥测”侧边栏的采样周期、显示模块与负载警告着色阈值。</p>
        <div class="form-row">
          <label class="host-field">采样周期
            <select id="setting-metrics-interval">
              <option value="1">1 秒（高频）</option>
              <option value="2">2 秒（默认）</option>
              <option value="5">5 秒（省流）</option>
              <option value="10">10 秒（低开销）</option>
            </select>
          </label>
          <label class="port-field">进程数
            <select id="setting-metrics-processes">
              <option value="3">3 条</option>
              <option value="6">6 条</option>
              <option value="10">10 条</option>
              <option value="12">12 条</option>
            </select>
          </label>
          <label class="port-field">警告%<input id="setting-metrics-warn" type="number" min="40" max="95" /></label>
          <label class="port-field">危险%<input id="setting-metrics-danger" type="number" min="50" max="99" /></label>
        </div>
        <div class="settings-section-title">遥测面板显示模块</div>
        <div class="visibility-grid">
          <label class="check-pill"><input id="setting-vis-cpu" type="checkbox" /><span>CPU 趋势</span></label>
          <label class="check-pill"><input id="setting-vis-memory" type="checkbox" /><span>内存</span></label>
          <label class="check-pill"><input id="setting-vis-swap" type="checkbox" /><span>交换分区</span></label>
          <label class="check-pill"><input id="setting-vis-network" type="checkbox" /><span>网络速率</span></label>
          <label class="check-pill"><input id="setting-vis-disk" type="checkbox" /><span>根目录磁盘</span></label>
          <label class="check-pill"><input id="setting-vis-processes" type="checkbox" /><span>进程列表</span></label>
          <label class="check-pill"><input id="setting-vis-mounts" type="checkbox" /><span>挂载点</span></label>
        </div>

        <div class="dialog-actions dialog-actions-split">
          <button id="metrics-expand-all-btn" type="button" class="subtle">展开全部折叠分组</button>
          <div class="dialog-actions-right">
            <button type="button" class="subtle close-dialog">取消</button>
            <button type="submit" class="primary">保存遥测设置</button>
          </div>
        </div>
      </form>
    </dialog>

    <dialog id="shortcuts-dialog" class="wide-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">KEYBOARD SHORTCUTS</span>
            <h2>快捷键说明</h2>
          </div>
          <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
        </div>
        <div id="shortcuts-body" class="modal-scroll-list shortcuts-grid"></div>
      </div>
    </dialog>

    <div id="file-context-menu" class="context-menu hidden"></div>
    <div id="file-drop-hint" class="file-drop-hint hidden">
      ${icon("upload")}
      <strong>释放以上传文件</strong>
      <span id="file-drop-target"></span>
    </div>

    <dialog id="editor-dialog">
      <div class="editor-heading">
        <div>
          <span class="eyebrow">REMOTE TEXT EDITOR</span>
          <h2 id="editor-title">快速查看</h2>
          <p id="editor-path"></p>
        </div>
        <button type="button" class="icon-button close-editor" aria-label="关闭">${icon("x")}</button>
      </div>
      <textarea id="file-editor" spellcheck="false"></textarea>
      <div id="editor-error" class="form-error"></div>
      <div class="editor-footer">
        <span>仅支持 1 MB 以内的 UTF-8 文本 · Ctrl+S 保存</span>
        <div class="dialog-actions">
          <button type="button" class="subtle close-editor">取消</button>
          <button id="save-remote-file" class="primary" type="button">保存修改</button>
        </div>
      </div>
    </dialog>

    <dialog id="transfer-dialog" class="wide-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">TRANSFER QUEUE</span>
            <h2>文件传输任务列表</h2>
          </div>
          <div class="modal-head-actions">
            <button id="transfer-clear-btn" type="button" class="subtle">清理已完成</button>
            <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
          </div>
        </div>
        <div id="transfer-list" class="modal-scroll-list transfer-list"></div>
      </div>
    </dialog>

    <dialog id="conflict-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">TRANSFER CONFLICT</span>
            <h2>发现同名文件或断点分片</h2>
          </div>
          <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
        </div>
        <p class="dialog-description">目标位置已存在同名文件或未完成分片，请对比大小与时间后选择处理策略：</p>
        <div id="conflict-list" class="conflict-list"></div>
        <div class="dialog-actions conflict-actions">
          <button id="conflict-resume-btn" type="button" class="primary hidden" data-conflict-choice="resume">断点续传</button>
          <button type="button" class="subtle danger-ghost" data-conflict-choice="overwrite">覆盖目标</button>
          <button type="button" class="subtle" data-conflict-choice="rename">自动重命名</button>
          <button type="button" class="subtle" data-conflict-choice="skip">跳过冲突</button>
          <button type="button" class="subtle" data-conflict-choice="cancel">取消</button>
        </div>
      </div>
    </dialog>

    <dialog id="chmod-dialog">
      <form id="chmod-form" method="dialog">
        <div class="modal-head">
          <div>
            <span class="eyebrow">POSIX PERMISSIONS</span>
            <h2>修改权限 (chmod)</h2>
          </div>
          <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
        </div>
        <p id="chmod-target-path" class="dialog-description mono"></p>
        <div class="chmod-grid">
          <div class="chmod-head"><span></span><span>读 (r)</span><span>写 (w)</span><span>执行 (x)</span></div>
          <div class="chmod-row"><span>所有者</span><input type="checkbox" data-chmod-bit="0400" /><input type="checkbox" data-chmod-bit="0200" /><input type="checkbox" data-chmod-bit="0100" /></div>
          <div class="chmod-row"><span>所属组</span><input type="checkbox" data-chmod-bit="0040" /><input type="checkbox" data-chmod-bit="0020" /><input type="checkbox" data-chmod-bit="0010" /></div>
          <div class="chmod-row"><span>其他人</span><input type="checkbox" data-chmod-bit="0004" /><input type="checkbox" data-chmod-bit="0002" /><input type="checkbox" data-chmod-bit="0001" /></div>
        </div>
        <label>八进制权限值<input id="chmod-octal" type="text" maxlength="4" pattern="[0-7]{3,4}" placeholder="755" required /></label>
        <div class="dialog-actions">
          <button type="button" class="subtle close-dialog">取消</button>
          <button type="submit" class="primary">应用权限</button>
        </div>
      </form>
    </dialog>

    <dialog id="confirm-delete-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">DANGER CONFIRMATION</span>
            <h2>确认删除远程目标</h2>
          </div>
          <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
        </div>
        <p id="delete-target-desc" class="dialog-description"></p>
        <pre id="delete-target-path" class="delete-path-box"></pre>
        <div class="dialog-actions">
          <button type="button" class="subtle close-dialog">取消</button>
          <button id="confirm-delete-btn" type="button" class="primary danger-btn">确认永久删除</button>
        </div>
      </div>
    </dialog>

    <dialog id="ops-log-dialog" class="wide-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">RUNTIME LOGS</span>
            <h2 id="ops-log-title">日志详情</h2>
          </div>
          <button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button>
        </div>
        <pre id="ops-log-content" class="ops-log-content"></pre>
      </div>
    </dialog>

    <div id="toast" class="toast" role="status"></div>
  `;
}
