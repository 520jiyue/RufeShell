import rufeshellIconUrl from "../assets/rufeshell-icon.png";
import { applyStaticTranslations } from "../i18n/index.ts";
import { icon } from "../icons.ts";
import { $ } from "../utils.ts";

export function mountShell(): void {
  $("#app").innerHTML = `
    <div id="app-shell" class="app-shell">
      <header class="titlebar" data-tauri-drag-region>
        <div class="titlebar-left">
          <button id="toggle-sidebar" class="icon-button active" type="button" data-i18n-title="titlebar.collapseSidebar" data-i18n-aria="titlebar.toggleSidebarAria" title="收起连接栏 (Ctrl+B)" aria-label="切换连接栏">${icon("sidebar")}</button>
        </div>
        <div id="titlebar-drag-spacer" class="titlebar-drag-spacer" data-tauri-drag-region></div>
        <div class="titlebar-right">
          <div class="titlebar-tools">
            <button id="open-history" class="tool-pill" type="button" data-i18n-title="titlebar.historyTitle" title="历史指令记录 (Ctrl+H)">${icon("history")}<span data-i18n="titlebar.history">历史指令</span></button>
            <button id="open-snippets" class="tool-pill" type="button" data-i18n-title="titlebar.snippetsTitle" title="常用命令收藏 (Ctrl+K)">${icon("bookmark")}<span data-i18n="titlebar.snippets">常用命令</span></button>
            <button id="admin-launch-btn" class="tool-pill" type="button" title="以管理员权限重新启动 RufeShell">${icon("shield")}<span id="admin-launch-label">管理员启动</span></button>
            <button id="open-settings" class="icon-button" type="button" data-i18n-title="titlebar.settingsTitle" data-i18n-aria="titlebar.settings" title="工作台与终端设置 (Ctrl+,)" aria-label="设置">${icon("settings")}</button>
            <button id="open-shortcuts" class="icon-button" type="button" data-i18n-title="titlebar.shortcutsTitle" data-i18n-aria="titlebar.shortcuts" title="快捷键说明 (F1)" aria-label="快捷键说明">${icon("keyboard")}</button>
          </div>
          <span class="titlebar-divider" aria-hidden="true"></span>
          <div class="window-controls">
            <button id="win-minimize" class="win-btn" type="button" data-i18n-title="titlebar.minimize" data-i18n-aria="titlebar.minimize" title="最小化" aria-label="最小化">${icon("winMin")}</button>
            <button id="win-maximize" class="win-btn" type="button" data-i18n-title="titlebar.maximize" data-i18n-aria="titlebar.maximize" title="最大化" aria-label="最大化">${icon("winMax")}</button>
            <button id="win-close" class="win-btn win-close" type="button" data-i18n-title="common.close" data-i18n-aria="common.close" title="关闭" aria-label="关闭">${icon("x")}</button>
          </div>
        </div>
      </header>
      <div class="workspace">
        <aside id="sidebar" class="sidebar">
          <div class="sidebar-heading">
            <span data-i18n="sidebar.servers">服务器列表</span>
            <div class="sidebar-heading-actions">
              <button id="import-connections" class="icon-button" type="button" data-i18n-title="sidebar.import" title="导入连接配置">${icon("upload")}</button>
              <button id="export-connections" class="icon-button" type="button" data-i18n-title="sidebar.export" title="导出连接配置（不含密码）">${icon("download")}</button>
              <button id="add-connection" class="icon-button accent-subtle" type="button" data-i18n-title="sidebar.newConn" title="新建连接 (Ctrl+N)">${icon("plus")}</button>
            </div>
          </div>
          <div class="sidebar-search">
            ${icon("search")}
            <input id="connection-search" type="search" data-i18n-placeholder="sidebar.searchPlaceholder" data-i18n-aria="sidebar.filterAria" placeholder="搜索名称、主机、分组或标签…" aria-label="筛选连接" spellcheck="false" />
          </div>
          <div class="sidebar-filters">
            <select id="connection-group-filter" data-i18n-aria="sidebar.groupFilterAria" aria-label="按分组筛选">
              <option value="all" data-i18n="sidebar.allGroups">全部分组</option>
              <option value="favorites" data-i18n="sidebar.onlyFavorites">★ 仅收藏</option>
            </select>
            <select id="connection-sort" data-i18n-aria="sidebar.sortAria" aria-label="排序方式">
              <option value="favorite" data-i18n="sidebar.sortFavorite">收藏优先</option>
              <option value="name" data-i18n="sidebar.sortName">按名称</option>
              <option value="group" data-i18n="sidebar.sortGroup">按分组</option>
              <option value="recent" data-i18n="sidebar.sortRecent">最近更新</option>
            </select>
          </div>
          <div id="connection-list" class="connection-list"></div>
          <div class="local-shells-strip">
            <div class="local-shells-head">
              <span class="local-shells-label" data-i18n-title="sidebar.localTitle" title="快速启动本地终端标签">${icon("terminal")}<span data-i18n="sidebar.local">本地终端</span></span>
              <button id="local-admin-toggle" class="local-admin-toggle is-ask" type="button" title="点击切换本地终端启动权限（每次询问 / 标准权限 / 管理员）">${icon("shield")}<span id="local-admin-label">选择权限</span></button>
            </div>
            <div class="local-shells-btns">
              <button type="button" class="local-shell-chip" data-local-shell="power_shell">PowerShell</button>
              <button type="button" class="local-shell-chip" data-local-shell="cmd">CMD</button>
              <button type="button" class="local-shell-chip" data-local-shell="wsl">WSL</button>
            </div>
          </div>
          <div class="sidebar-foot">
            <span class="status-dot"></span>
            <span data-i18n="sidebar.footer">Rust 原生 SSH &amp; ConPTY · 本地凭据隔离</span>
          </div>
        </aside>
        <main class="main-area">
          <div id="tabbar" class="tabbar hidden"></div>
          <div id="welcome" class="welcome">
            <div class="welcome-glow" aria-hidden="true"></div>
            <div class="welcome-hero">
              <div class="welcome-symbol"><img class="welcome-brand-img" src="${rufeshellIconUrl}" alt="RufeShell" /></div>
              <span class="welcome-kicker">RUFESHELL WORKBENCH</span>
              <h1 data-i18n="welcome.headline">远程工作，井然有序。</h1>
              <p data-i18n="welcome.sub">原生多标签 SSH 终端、SFTP 文件直传与可定制主机遥测，在一个专注的工作台中完成。</p>
              <div class="welcome-actions">
                <button id="welcome-add" class="primary" type="button">${icon("plus")} <span data-i18n="welcome.newConn">新建连接</span></button>
                <button id="welcome-shortcuts" class="subtle" type="button">${icon("keyboard")} <span data-i18n="welcome.shortcutsGuide">快捷键指南</span></button>
              </div>
              <div class="welcome-features">
                <span class="welcome-feature">${icon("terminal")}<span data-i18n="welcome.feat1">多标签与输出搜索</span></span>
                <span class="welcome-feature">${icon("history")}<span data-i18n="welcome.feat2">敏感过滤历史指令</span></span>
                <span class="welcome-feature">${icon("bookmark")}<span data-i18n="welcome.feat3">变量命令收藏</span></span>
                <span class="welcome-feature">${icon("reconnect")}<span data-i18n="welcome.feat4">断线自动重连</span></span>
              </div>
            </div>
            <div id="welcome-recents" class="welcome-recents hidden"></div>
          </div>
          <section id="session-view" class="session-view hidden">
            <div class="session-toolbar">
              <div class="session-meta">
                <span id="session-status-badge" class="session-status-badge connecting" data-i18n="common.connecting">连接中</span>
                <strong id="session-title"></strong>
                <span id="session-address" class="muted"></span>
              </div>
              <div id="session-mode-switcher" class="session-mode-switcher" role="tablist" data-i18n-aria="session.modeAria" aria-label="会话视图模式">
                <button type="button" class="mode-tab active" data-session-mode="terminal">${icon("terminal")}<span data-i18n="session.modeTerminal">终端</span></button>
                <button type="button" class="mode-tab" data-session-mode="dual">${icon("columns")}<span data-i18n="session.modeDual">双栏传输</span></button>
                <button type="button" class="mode-tab" data-session-mode="ops">${icon("activity")}<span data-i18n="session.modeOps">主机运维</span></button>
              </div>
              <div class="toolbar-actions">
                <div class="toolbar-group" data-i18n-title="session.termTools" title="终端工具">
                  <button id="terminal-search-btn" class="icon-button" type="button" data-i18n-title="session.searchOutput" title="搜索输出 (Ctrl+F)">${icon("search")}</button>
                  <button id="terminal-clear-btn" class="icon-button" type="button" data-i18n-title="session.clearScreen" title="清屏 (Ctrl+Shift+L)">${icon("clear")}</button>
                  <button id="terminal-save-log-btn" class="icon-button" type="button" data-i18n-title="session.saveLog" title="保存输出日志">${icon("save")}</button>
                </div>
                <div id="panel-toggles-group" class="toolbar-group" data-i18n-title="session.panelToggles" title="面板显示">
                  <button id="toggle-metrics" class="icon-button active" type="button" data-i18n-title="session.hideMetrics" title="隐藏资源面板 (Ctrl+M)">${icon("activity")}</button>
                  <button id="toggle-files" class="icon-button active" type="button" data-i18n-title="session.hideFiles" title="隐藏文件面板 (Ctrl+E)">${icon("folder")}</button>
                </div>
                <button id="reconnect-btn" class="subtle hidden" type="button">${icon("reconnect")}<span data-i18n="session.reconnect">重新连接</span></button>
                <button id="disconnect" class="subtle danger-ghost" type="button">${icon("x")}<span data-i18n="session.closeSession">关闭会话</span></button>
              </div>
            </div>
            <div id="session-workspace" class="session-workspace">
              <aside id="metrics-panel" class="metrics-panel">
                <div class="metrics-heading">
                  ${icon("server")}
                  <span data-i18n="metrics.title">主机遥测</span>
                  <div class="metrics-heading-right">
                    <button id="metrics-customize-btn" class="icon-button" type="button" data-i18n-title="metrics.customizeTitle" title="遥测显示与采样设置">${icon("sliders")}</button>
                    <span class="live-label">LIVE</span>
                  </div>
                </div>
                <div id="metrics-content" class="metrics-content">
                  <p class="metrics-placeholder" data-i18n="metrics.placeholder">连接后自动读取 Linux 系统资源</p>
                </div>
                <div id="metrics-foot" class="metrics-foot">2 秒采样 · 复用独立监控通道</div>
              </aside>
              <div id="metrics-resizer" class="metrics-resizer" data-i18n-title="metrics.resizeTitle" title="拖动调整资源面板宽度"></div>
              <div class="session-content">
                <div id="reconnect-banner" class="reconnect-banner hidden">
                  <div class="reconnect-banner-copy">
                    <span class="status-dot connecting"></span>
                    <span id="reconnect-status-text" data-i18n="reconnect.bannerText">网络波动导致连接断开，正在尝试自动重连…</span>
                  </div>
                  <div class="reconnect-banner-actions">
                    <button id="reconnect-now" class="primary" type="button" data-i18n="reconnect.now">立即重连</button>
                    <button id="reconnect-cancel" class="subtle" type="button" data-i18n="reconnect.stop">停止</button>
                  </div>
                </div>
                <div id="terminal-search-bar" class="terminal-search-bar hidden">
                  <input id="terminal-search-input" type="search" data-i18n-placeholder="termSearch.placeholder" placeholder="搜索终端输出…" spellcheck="false" />
                  <span id="terminal-search-count" class="search-count">0 / 0</span>
                  <label class="search-case-toggle" data-i18n-title="termSearch.caseSensitive" title="区分大小写">
                    <input id="terminal-search-case" type="checkbox" />
                    <span>Aa</span>
                  </label>
                  <button id="terminal-search-prev" class="icon-button" type="button" data-i18n-title="termSearch.prev" title="上一个 (Shift+Enter)">${icon("chevronUp")}</button>
                  <button id="terminal-search-next" class="icon-button" type="button" data-i18n-title="termSearch.next" title="下一个 (Enter)">${icon("chevronDown")}</button>
                  <button id="terminal-search-close" class="icon-button" type="button" data-i18n-title="termSearch.close" title="关闭 (Esc)">${icon("x")}</button>
                </div>
                <div id="terminal-panel" class="terminal-panel"></div>
                <div class="quick-command-bar">
                  <span class="quick-prompt">&gt;_</span>
                  <input id="quick-command-input" type="text" data-i18n-placeholder="quickCmd.placeholder" placeholder="快捷命令栏：输入指令回车发送，↑/↓ 切换历史指令…" spellcheck="false" autocomplete="off" />
                  <button id="quick-history-open" class="icon-button" type="button" data-i18n-title="quickCmd.historyTitle" title="历史指令 (Ctrl+H)">${icon("history")}</button>
                  <button id="quick-snippets-open" class="icon-button" type="button" data-i18n-title="quickCmd.snippetsTitle" title="常用命令 (Ctrl+K)">${icon("bookmark")}</button>
                  <button id="quick-command-send" class="subtle" type="button" data-i18n="common.send">发送</button>
                </div>
              </div>
              <div id="files-resizer" class="files-resizer" data-i18n-title="files.resizeTitle" title="拖动调整文件面板宽度"></div>
              <aside id="files-panel" class="files-panel">
                <div class="file-toolbar">
                  <button id="parent-directory" class="icon-button" type="button" data-i18n-title="files.parentDir" title="上一级">${icon("arrow")}</button>
                  <div class="path-input-wrap">
                    <input id="remote-path" data-i18n-aria="files.remotePathAria" aria-label="远程路径" spellcheck="false" />
                  </div>
                  <button id="upload-file" class="icon-button" type="button" data-i18n-title="files.uploadTitle" title="上传文件到当前目录">${icon("upload")}</button>
                  <button id="refresh-files" class="icon-button" type="button" data-i18n-title="common.refresh" title="刷新">${icon("refresh")}</button>
                </div>
                <div id="file-containers" class="file-containers"></div>
                <div class="files-hint" data-i18n="files.hint">支持拖放上传 · 右键文件可查看、编辑或下载</div>
              </aside>
            </div>
            <div id="dual-files-view" class="dual-files-view hidden">
              <div class="dual-toolbar">
                <div class="dual-toolbar-left">
                  <span class="eyebrow">DUAL-PANE SFTP SYNC</span>
                  <strong data-i18n="dual.title">本地与远程双栏文件管理</strong>
                </div>
                <div class="dual-toolbar-actions">
                  <button id="dual-refresh-btn" type="button" class="subtle">${icon("refresh")}<span data-i18n="dual.refreshBoth">刷新两端</span></button>
                  <button id="dual-compare-btn" type="button" class="primary">${icon("columns")}<span data-i18n="dual.compare">差异比较</span></button>
                </div>
              </div>
              <div id="dual-panes-grid" class="dual-panes-grid">
                <section class="dual-pane">
                  <div class="dual-pane-head">
                    <span class="dual-pane-badge" data-i18n="common.local">本地</span>
                    <select id="dual-local-quick" class="dual-quick-select" data-i18n-title="dual.quickPathTitle" title="快速定位本地常用目录"></select>
                    <button id="dual-local-up" type="button" class="icon-button" data-i18n-title="dual.localUpTitle" title="返回上级本地目录">${icon("chevronUp")}</button>
                    <input id="dual-local-path" type="text" data-i18n-aria="dual.localPathAria" aria-label="本地路径" />
                  </div>
                  <div class="dual-cols-head"><span data-i18n="common.name">名称</span><span data-i18n="common.size">大小</span><span data-i18n="common.action">操作</span></div>
                  <div id="dual-local-list" class="dual-list"></div>
                </section>
                <section class="dual-pane">
                  <div class="dual-pane-head">
                    <span class="dual-pane-badge is-remote" data-i18n="common.remote">远程</span>
                    <button id="dual-remote-up" type="button" class="icon-button" data-i18n-title="dual.remoteUpTitle" title="返回上级远程目录">${icon("chevronUp")}</button>
                    <input id="dual-remote-path" type="text" data-i18n-aria="dual.remotePathAria" aria-label="远程路径" />
                  </div>
                  <div class="dual-cols-head"><span data-i18n="common.name">名称</span><span data-i18n="common.size">大小</span><span data-i18n="common.action">操作</span></div>
                  <div id="dual-remote-list" class="dual-list"></div>
                </section>
              </div>
              <div id="dual-diff-view" class="dual-diff-view hidden">
                <div class="dual-diff-bar">
                  <div class="dual-diff-left">
                    <button id="dual-exit-diff-btn" type="button" class="subtle" data-i18n="dual.backToDual">返回双栏浏览</button>
                    <label class="check-pill compact-check"><input id="dual-only-diff" type="checkbox" checked /><span data-i18n="dual.onlyDiff">仅显示有差异的文件</span></label>
                  </div>
                  <div class="dual-diff-actions">
                    <button id="dual-sync-up-missing" type="button" class="subtle">${icon("upload")}<span data-i18n="dual.syncUp">批量上传本地独有/较新</span></button>
                    <button id="dual-sync-down-missing" type="button" class="subtle">${icon("download")}<span data-i18n="dual.syncDown">批量下载远端独有/较新</span></button>
                  </div>
                </div>
                <div id="dual-diff-list" class="dual-diff-list"></div>
              </div>
            </div>
            <div id="ops-view" class="ops-view hidden">
              <div class="ops-header">
                <div class="ops-tabs" role="tablist">
                  <button type="button" class="ops-tab active" data-ops-tab="trends">${icon("activity")}<span data-i18n="ops.tabTrends">资源历史与告警</span></button>
                  <button type="button" class="ops-tab" data-ops-tab="processes">${icon("terminal")}<span data-i18n="ops.tabProcesses">进程管理</span></button>
                  <button type="button" class="ops-tab" data-ops-tab="services">${icon("settings")}<span data-i18n="ops.tabServices">Systemd 服务</span></button>
                  <button type="button" class="ops-tab" data-ops-tab="docker">${icon("box")}<span data-i18n="ops.tabDocker">Docker 容器</span></button>
                  <button type="button" class="ops-tab" data-ops-tab="forwards">${icon("network")}<span data-i18n="ops.tabForwards">端口转发</span></button>
                </div>
              </div>
              <div class="ops-body">
                <div id="ops-trends-panel" class="ops-panel"></div>
                <div id="ops-processes-panel" class="ops-panel hidden">
                  <div class="ops-filterbar">
                    <input id="ops-proc-search" type="search" data-i18n-placeholder="ops.procSearch" placeholder="搜索进程名 / PID / 用户 / 命令行…" />
                    <select id="ops-proc-sort">
                      <option value="cpu" data-i18n="ops.procSortCpu">按 CPU 降序</option>
                      <option value="mem" data-i18n="ops.procSortMem">按内存降序</option>
                      <option value="pid" data-i18n="ops.procSortPid">按 PID 升序</option>
                    </select>
                    <button id="ops-proc-refresh" type="button" class="subtle">${icon("refresh")}<span data-i18n="common.refresh">刷新</span></button>
                  </div>
                  <div class="ops-table-head proc-cols">
                    <span data-i18n="ops.colPid">PID</span><span data-i18n="ops.colUser">用户</span><span data-i18n="ops.colCpu">CPU</span><span data-i18n="ops.colMem">内存</span><span data-i18n="ops.colState">状态</span><span data-i18n="ops.colCmd">命令</span><span data-i18n="common.action">操作</span>
                  </div>
                  <div id="ops-proc-list" class="ops-table-list"></div>
                </div>
                <div id="ops-services-panel" class="ops-panel hidden">
                  <div class="ops-filterbar">
                    <input id="ops-svc-search" type="search" data-i18n-placeholder="ops.svcSearch" placeholder="搜索服务名称或描述…" />
                    <select id="ops-svc-filter">
                      <option value="all" data-i18n="ops.svcAll">全部服务</option>
                      <option value="active" data-i18n="ops.svcActive">仅运行中 (active)</option>
                      <option value="failed" data-i18n="ops.svcFailed">仅异常 (failed)</option>
                      <option value="inactive" data-i18n="ops.svcInactive">仅未运行 (inactive)</option>
                    </select>
                    <button id="ops-svc-refresh" type="button" class="subtle">${icon("refresh")}<span data-i18n="common.refresh">刷新</span></button>
                  </div>
                  <div class="ops-table-head svc-cols">
                    <span data-i18n="ops.colUnit">服务单元</span><span data-i18n="common.status">状态</span><span data-i18n="ops.colDesc">描述</span><span data-i18n="common.action">操作</span>
                  </div>
                  <div id="ops-svc-list" class="ops-table-list"></div>
                </div>
                <div id="ops-docker-panel" class="ops-panel hidden">
                  <div class="ops-filterbar">
                    <input id="ops-docker-search" type="search" data-i18n-placeholder="ops.dockerSearch" placeholder="搜索容器名 / ID / 镜像…" />
                    <select id="ops-docker-filter" data-i18n-aria="ops.dockerFilterAria" aria-label="容器状态筛选">
                      <option value="all" data-i18n="ops.dockerAll">全部容器</option>
                      <option value="running" data-i18n="ops.dockerRunning">仅运行中</option>
                      <option value="stopped" data-i18n="ops.dockerStopped">已停止</option>
                    </select>
                    <span id="ops-docker-summary" class="ops-summary-pill"></span>
                    <button id="ops-docker-refresh" type="button" class="subtle">${icon("refresh")}<span data-i18n="common.refresh">刷新</span></button>
                  </div>
                  <div class="ops-table-head docker-cols">
                    <span data-i18n="ops.colContainer">容器 / 镜像</span><span data-i18n="common.status">状态</span><span data-i18n="ops.colResources">资源占用</span><span data-i18n="ops.colPorts">端口映射</span><span data-i18n="common.action">操作</span>
                  </div>
                  <div id="ops-docker-list" class="ops-table-list"></div>
                </div>
                <div id="ops-forwards-panel" class="ops-panel hidden">
                  <form id="fwd-form" class="fwd-form">
                    <select id="fwd-kind" data-i18n-title="ops.fwdKindTitle" title="转发类型">
                      <option value="local" data-i18n="ops.fwdLocal">本地转发 (-L)</option>
                      <option value="remote" data-i18n="ops.fwdRemote">远程转发 (-R)</option>
                      <option value="dynamic" data-i18n="ops.fwdDynamic">SOCKS5 动态 (-D)</option>
                    </select>
                    <input id="fwd-bind-host" type="text" value="127.0.0.1" data-i18n-placeholder="ops.fwdBindHost" placeholder="监听地址" />
                    <input id="fwd-bind-port" type="number" min="1" max="65535" data-i18n-placeholder="ops.fwdBindPort" placeholder="监听端口" required />
                    <span class="fwd-arrow">→</span>
                    <input id="fwd-target-host" type="text" value="127.0.0.1" data-i18n-placeholder="ops.fwdTargetHost" placeholder="目标主机" />
                    <input id="fwd-target-port" type="number" min="1" max="65535" data-i18n-placeholder="ops.fwdTargetPort" placeholder="目标端口" required />
                    <button type="submit" class="primary">${icon("plus")}<span data-i18n="ops.fwdAddRule">添加规则</span></button>
                  </form>
                  <div class="ops-table-head fwd-cols">
                    <span data-i18n="ops.colFwdKind">类型</span><span data-i18n="ops.colFwdRoute">转发链路</span><span data-i18n="ops.colFwdTraffic">实时流量</span><span data-i18n="common.action">操作</span>
                  </div>
                  <div id="ops-fwd-list" class="ops-table-list"></div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
      <footer class="statusbar">
        <span id="global-status" data-i18n="common.ready">就绪</span>
        <div class="statusbar-right">
          <button id="transfer-status-pill" type="button" class="transfer-status-pill" data-i18n="transfers.pillIdle">传输队列</button>
          <button id="update-status-pill" type="button" class="update-status-pill">v1.3.0</button>
          <span>RufeShell</span>
        </div>
      </footer>
    </div>

    <dialog id="connection-dialog">
      <form id="connection-form">
        <div class="dialog-heading">
          <div>
            <span id="connection-dialog-eyebrow" class="eyebrow">NEW CONNECTION</span>
            <h2 id="connection-dialog-title" data-i18n="conn.titleNew">建立新的连接</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <p class="dialog-description" data-i18n="conn.desc">填写服务器信息。连接配置保存在本地，密码仅存入系统凭据库。</p>
        <div class="form-row">
          <label class="host-field"><span data-i18n="conn.name">连接名称</span><input name="name" required data-i18n-placeholder="conn.namePlaceholder" placeholder="例如：生产服务器" maxlength="60" /></label>
          <label class="group-field"><span data-i18n="conn.group">分组</span><input name="group" data-i18n-placeholder="conn.groupPlaceholder" placeholder="生产环境" maxlength="30" /></label>
        </div>
        <div class="form-row">
          <label class="host-field"><span data-i18n="conn.host">主机地址</span><input name="host" required data-i18n-placeholder="conn.hostPlaceholder" placeholder="192.168.1.10 或 example.com" /></label>
          <label class="port-field"><span data-i18n="conn.port">端口</span><input name="port" type="number" min="1" max="65535" value="22" required /></label>
        </div>
        <div class="form-row">
          <label class="host-field"><span data-i18n="conn.username">用户名</span><input name="username" required placeholder="root" autocomplete="username" /></label>
          <label class="port-field"><span data-i18n="conn.timeout">超时(秒)</span><input name="timeout" type="number" min="3" max="120" placeholder="15" /></label>
        </div>
        <label><span data-i18n="conn.tags">标签（英文逗号分隔）</span><input name="tags" data-i18n-placeholder="conn.tagsPlaceholder" placeholder="例如：web, nginx, 华东" /></label>
        <fieldset>
          <legend data-i18n="conn.authMethod">认证方式</legend>
          <div class="auth-options">
            <label class="auth-pill"><input type="radio" name="auth" value="password" checked /><span data-i18n="conn.authPwd">密码认证</span></label>
            <label class="auth-pill"><input type="radio" name="auth" value="private_key" /><span data-i18n="conn.authKey">私钥认证</span></label>
          </div>
        </fieldset>
        <label id="password-field"><span id="password-label-text" data-i18n="conn.password">密码</span><input name="password" type="password" data-i18n-placeholder="conn.passwordPlaceholder" placeholder="连接密码" autocomplete="new-password" /></label>
        <div id="private-key-field" class="hidden">
          <label data-i18n="conn.keyPath">私钥路径</label>
          <div class="file-picker">
            <input name="private_key_path" data-i18n-placeholder="conn.keyPlaceholder" placeholder="选择 OpenSSH 私钥文件" readonly />
            <button type="button" id="choose-key" class="subtle" data-i18n="conn.chooseFile">选择文件</button>
          </div>
        </div>
        <div class="inline-checks">
          <label class="check-pill"><input name="favorite" type="checkbox" /><span data-i18n="conn.favorite">★ 设为收藏服务器</span></label>
          <label class="check-pill"><input name="auto_reconnect" type="checkbox" checked /><span data-i18n="conn.autoReconnect">断线自动重连</span></label>
        </div>
        <div id="form-error" class="form-error"></div>
        <div class="dialog-actions">
          <button type="button" class="subtle close-dialog" data-i18n="common.cancel">取消</button>
          <button id="connection-submit-btn" class="primary" type="submit" data-i18n="conn.saveBtn">保存连接</button>
        </div>
      </form>
    </dialog>

    <dialog id="connect-dialog">
      <div class="connect-dialog-inner">
        <div class="dialog-heading">
          <div>
            <span class="eyebrow">SECURE CONNECTION</span>
            <h2 id="host-dialog-title" data-i18n="host.title">核对服务器身份</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-title="common.close" title="关闭">${icon("x")}</button>
        </div>
        <div class="connect-target">${icon("server")}<span id="connect-target"></span></div>
        <div class="security-notice">${icon("shield")}<p id="host-notice" data-i18n="host.fetchingNotice">正在自动获取服务器身份，无需手动填写公钥。</p></div>
        <dl class="host-details">
          <div class="key-type"><dt data-i18n="host.keyType">密钥类型</dt><dd id="host-algorithm">获取中…</dd></div>
          <div><dt><span data-i18n="host.fingerprint">主机密钥指纹</span> <span>SHA-256</span></dt><dd id="host-fingerprint" class="fingerprint">获取中…</dd></div>
        </dl>
        <div id="password-entry" class="password-entry hidden">
          <label for="connection-password" data-i18n="host.loginPwd">登录密码</label>
          <input id="connection-password" type="password" autocomplete="current-password" data-i18n-placeholder="host.loginPwdPlaceholder" placeholder="请输入该服务器的登录密码" />
          <label class="remember-password"><input id="remember-password" type="checkbox" checked /><span data-i18n="host.rememberPwd">保存到 Windows 凭据库，下次自动登录</span></label>
        </div>
        <div id="connect-error" class="form-error"></div>
        <div class="dialog-actions">
          <button type="button" class="subtle close-dialog" data-i18n="common.cancel">取消</button>
          <button id="accept-once" class="subtle" type="button" data-i18n="host.acceptOnce">只接受本次</button>
          <button id="accept-save" class="primary" type="button" data-i18n="host.acceptSave">接受并保存</button>
        </div>
        <div class="dialog-footnote">${icon("key")} <span data-i18n="host.footnote">核对指纹可防止连接到冒充的服务器</span></div>
      </div>
    </dialog>

    <dialog id="history-dialog" class="wide-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">COMMAND HISTORY</span>
            <h2 data-i18n="history.title">历史指令记录</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <div class="modal-toolbar">
          <div class="modal-search-wrap">
            ${icon("search")}
            <input id="history-search" type="search" data-i18n-placeholder="history.searchPlaceholder" placeholder="搜索命令、服务器名称或地址…（↑/↓ 选择，Enter 执行，Shift+Enter 填入）" spellcheck="false" />
          </div>
          <label class="check-pill compact-check"><input id="history-dedupe" type="checkbox" /><span data-i18n="history.dedupe">去重显示</span></label>
          <button id="history-clear" type="button" class="subtle danger-ghost" data-i18n="history.clear">清空历史</button>
        </div>
        <div id="history-list" class="modal-scroll-list"></div>
        <div class="modal-foot" data-i18n="history.privacyNote">已开启隐私过滤：含密码、口令、Token 或以空格开头的命令不会保存。</div>
      </div>
    </dialog>

    <dialog id="snippets-dialog" class="wide-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">COMMAND SNIPPETS</span>
            <h2 data-i18n="snippets.title">常用命令收藏</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <div class="modal-toolbar">
          <div class="modal-search-wrap">
            ${icon("search")}
            <input id="snippet-search" type="search" data-i18n-placeholder="snippets.searchPlaceholder" placeholder="搜索命令名称、内容或说明…" spellcheck="false" />
          </div>
          <select id="snippet-group-filter" data-i18n-aria="snippets.groupAria" aria-label="命令分组"></select>
          <button id="new-snippet-btn" type="button" class="primary">${icon("plus")} <span data-i18n="snippets.newBtn">新增命令</span></button>
        </div>
        <form id="snippet-form" class="snippet-editor-card hidden">
          <div class="snippet-editor-head">
            <strong id="snippet-form-title" data-i18n="snippets.formTitleNew">新增常用命令</strong>
            <button id="cancel-snippet-form" type="button" class="subtle" data-i18n="snippets.collapse">收起</button>
          </div>
          <div class="form-row">
            <label class="host-field"><span data-i18n="common.name">名称</span><input id="snippet-name" required data-i18n-placeholder="snippets.namePlaceholder" placeholder="例如：查看 Nginx 错误日志" /></label>
            <label class="group-field"><span data-i18n="snippets.group">分组</span><input id="snippet-group" data-i18n-placeholder="snippets.groupPlaceholder" placeholder="日志排查" /></label>
            <label class="port-field"><span data-i18n="snippets.shortcut">快捷键</span>
              <select id="snippet-shortcut">
                <option value="" data-i18n="common.none">无</option>
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
          <label><span data-i18n="snippets.templateLabel">命令模板（可用 {domain}、{service} 等变量）</span><textarea id="snippet-command" rows="2" required data-i18n-placeholder="snippets.templatePlaceholder" placeholder="例如：tail -n 100 /var/log/nginx/{domain}.error.log"></textarea></label>
          <div class="form-row align-end">
            <label class="host-field"><span data-i18n="snippets.desc">备注说明</span><input id="snippet-desc" data-i18n-placeholder="snippets.descPlaceholder" placeholder="可选：命令用途说明" /></label>
            <button type="submit" class="primary" data-i18n="snippets.saveBtn">保存命令</button>
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
            <h2 id="vars-snippet-name" data-i18n="vars.title">填写命令变量</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <p class="dialog-description" data-i18n="vars.desc">替换变量占位符后发送到当前终端。</p>
        <div id="vars-fields"></div>
        <div class="vars-preview-box">
          <span data-i18n="vars.preview">命令预览</span>
          <code id="vars-preview"></code>
        </div>
        <div class="dialog-actions">
          <button type="button" class="subtle close-dialog" data-i18n="common.cancel">取消</button>
          <button type="submit" class="primary" data-i18n="vars.execute">执行命令</button>
        </div>
      </form>
    </dialog>

    <dialog id="settings-dialog">
      <form id="settings-form">
        <div class="dialog-heading">
          <div>
            <span class="eyebrow">WORKBENCH SETTINGS</span>
            <h2 data-i18n="settings.title">工作台与终端设置</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <p class="dialog-description" data-i18n="settings.desc">管理界面语言、外观主题、终端字体行为、自动重连及文件传输安全策略；主机遥测参数请点击遥测栏右上角设置按钮。</p>
        <div class="form-row">
          <label class="host-field"><span data-i18n="settings.language">界面语言</span><select id="setting-language"></select></label>
          <label class="host-field"><span data-i18n="settings.theme">应用与终端主题</span><select id="setting-theme"></select></label>
        </div>
        <div class="form-row">
          <label class="host-field"><span data-i18n="settings.fontFamily">终端字体</span><select id="setting-font-family"></select></label>
          <label class="port-field"><span data-i18n="settings.fontSize">字号(px)</span><input id="setting-font-size" type="number" min="11" max="24" /></label>
        </div>
        <div class="form-row">
          <label class="host-field"><span data-i18n="settings.connectTimeout">默认连接超时（秒）</span><input id="setting-connect-timeout" type="number" min="3" max="120" /></label>
          <label class="host-field"><span data-i18n="settings.reconnectMax">自动重连最大次数</span><input id="setting-reconnect-max" type="number" min="1" max="10" /></label>
        </div>
        <div class="form-row">
          <label class="host-field"><span data-i18n="settings.closeAction">点击关闭窗口时</span><select id="setting-close-action"></select></label>
          <label class="host-field"><span data-i18n="settings.localPrivilege">本地终端权限</span><select id="setting-local-privilege"></select></label>
        </div>
        <div class="settings-toggles">
          <label class="check-pill"><input id="setting-auto-reconnect" type="checkbox" /><span data-i18n="settings.autoReconnect">网络波动断开时自动重连（保留终端输出）</span></label>
          <label class="check-pill"><input id="setting-copy-on-select" type="checkbox" /><span data-i18n="settings.copyOnSelect">选中终端文本自动复制到剪贴板</span></label>
          <label class="check-pill"><input id="setting-right-click-paste" type="checkbox" /><span data-i18n="settings.rightClickPaste">在终端中右键直接粘贴剪贴板内容</span></label>
          <label class="check-pill"><input id="setting-edit-backup" type="checkbox" /><span data-i18n="settings.editBackup">在线编辑远程文件前自动生成 .bak 备份</span></label>
          <label class="check-pill"><input id="setting-transfer-checksum" type="checkbox" /><span data-i18n="settings.transferChecksum">大文件与同步传输完成后自动执行 SHA-256 校验</span></label>
          <label class="check-pill"><input id="setting-auto-updates" type="checkbox" /><span data-i18n="settings.autoCheckUpdates">启动时自动检查 RufeShell 新版本更新</span></label>
        </div>

        <div class="dialog-actions dialog-actions-split">
          <button id="settings-check-update-btn" type="button" class="subtle">${icon("refresh")}<span data-i18n="settings.checkUpdatesBtn">检查更新</span></button>
          <div class="dialog-actions-right">
            <button type="button" class="subtle close-dialog" data-i18n="common.cancel">取消</button>
            <button type="submit" class="primary" data-i18n="settings.saveApply">应用并保存</button>
          </div>
        </div>
      </form>
    </dialog>

    <dialog id="metrics-settings-dialog">
      <form id="metrics-settings-form">
        <div class="dialog-heading">
          <div>
            <span class="eyebrow">TELEMETRY DISPLAY</span>
            <h2 data-i18n="metricsSet.title">主机遥测显示设置</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <p class="dialog-description" data-i18n="metricsSet.desc">仅控制“主机遥测”侧边栏的采样周期、显示模块与负载警告着色阈值。</p>
        <div class="form-row">
          <label class="host-field"><span data-i18n="metricsSet.interval">采样周期</span>
            <select id="setting-metrics-interval">
              <option value="1" data-i18n="metricsSet.interval1">1 秒（高频）</option>
              <option value="2" data-i18n="metricsSet.interval2">2 秒（默认）</option>
              <option value="5" data-i18n="metricsSet.interval5">5 秒（省流）</option>
              <option value="10" data-i18n="metricsSet.interval10">10 秒（低开销）</option>
            </select>
          </label>
          <label class="port-field"><span data-i18n="metricsSet.procLimit">进程数</span>
            <select id="setting-metrics-processes">
              <option value="3">3</option>
              <option value="6">6</option>
              <option value="10">10</option>
              <option value="12">12</option>
            </select>
          </label>
          <label class="port-field"><span data-i18n="metricsSet.warnPct">警告%</span><input id="setting-metrics-warn" type="number" min="40" max="95" /></label>
          <label class="port-field"><span data-i18n="metricsSet.dangerPct">危险%</span><input id="setting-metrics-danger" type="number" min="50" max="99" /></label>
        </div>
        <div class="settings-section-title" data-i18n="metricsSet.modules">遥测面板显示模块</div>
        <div class="visibility-grid">
          <label class="check-pill"><input id="setting-vis-cpu" type="checkbox" /><span data-i18n="metricsSet.visCpu">CPU 趋势</span></label>
          <label class="check-pill"><input id="setting-vis-memory" type="checkbox" /><span data-i18n="metricsSet.visMem">内存</span></label>
          <label class="check-pill"><input id="setting-vis-swap" type="checkbox" /><span data-i18n="metricsSet.visSwap">交换分区</span></label>
          <label class="check-pill"><input id="setting-vis-network" type="checkbox" /><span data-i18n="metricsSet.visNet">网络速率</span></label>
          <label class="check-pill"><input id="setting-vis-disk" type="checkbox" /><span data-i18n="metricsSet.visDisk">根目录磁盘</span></label>
          <label class="check-pill"><input id="setting-vis-processes" type="checkbox" /><span data-i18n="metricsSet.visProc">进程列表</span></label>
          <label class="check-pill"><input id="setting-vis-mounts" type="checkbox" /><span data-i18n="metricsSet.visMounts">挂载点</span></label>
        </div>

        <div class="dialog-actions dialog-actions-split">
          <button id="metrics-expand-all-btn" type="button" class="subtle" data-i18n="metricsSet.expandAll">展开全部折叠分组</button>
          <div class="dialog-actions-right">
            <button type="button" class="subtle close-dialog" data-i18n="common.cancel">取消</button>
            <button type="submit" class="primary" data-i18n="metricsSet.saveBtn">保存遥测设置</button>
          </div>
        </div>
      </form>
    </dialog>

    <dialog id="shortcuts-dialog" class="wide-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">KEYBOARD SHORTCUTS</span>
            <h2 data-i18n="titlebar.shortcuts">快捷键说明</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <div id="shortcuts-body" class="modal-scroll-list shortcuts-grid"></div>
      </div>
    </dialog>

    <div id="file-context-menu" class="context-menu hidden"></div>
    <div id="file-drop-hint" class="file-drop-hint hidden">
      ${icon("upload")}
      <strong data-i18n="files.dropTitle">释放以上传文件</strong>
      <span id="file-drop-target"></span>
    </div>

    <dialog id="editor-dialog">
      <div class="editor-heading">
        <div>
          <span class="eyebrow">REMOTE TEXT EDITOR</span>
          <h2 id="editor-title" data-i18n="editor.quickViewTitle">快速查看</h2>
          <p id="editor-path"></p>
        </div>
        <button type="button" class="icon-button close-editor" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
      </div>
      <textarea id="file-editor" spellcheck="false"></textarea>
      <div id="editor-error" class="form-error"></div>
      <div class="editor-footer">
        <span data-i18n="editor.footer">仅支持 1 MB 以内的 UTF-8 文本 · Ctrl+S 保存</span>
        <div class="dialog-actions">
          <button type="button" class="subtle close-editor" data-i18n="common.cancel">取消</button>
          <button id="save-remote-file" class="primary" type="button" data-i18n="editor.saveBtn">保存修改</button>
        </div>
      </div>
    </dialog>

    <dialog id="transfer-dialog" class="wide-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">TRANSFER QUEUE</span>
            <h2 data-i18n="transfers.title">文件传输任务列表</h2>
          </div>
          <div class="modal-head-actions">
            <button id="transfer-clear-btn" type="button" class="subtle" data-i18n="transfers.clearFinished">清理已完成</button>
            <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
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
            <h2 data-i18n="conflict.title">发现同名文件或断点分片</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <p class="dialog-description" data-i18n="conflict.desc">目标位置已存在同名文件或未完成分片，请对比大小与时间后选择处理策略：</p>
        <div id="conflict-list" class="conflict-list"></div>
        <div class="dialog-actions conflict-actions">
          <button id="conflict-resume-btn" type="button" class="primary hidden" data-conflict-choice="resume" data-i18n="conflict.resume">断点续传</button>
          <button type="button" class="subtle danger-ghost" data-conflict-choice="overwrite" data-i18n="conflict.overwrite">覆盖目标</button>
          <button type="button" class="subtle" data-conflict-choice="rename" data-i18n="conflict.rename">自动重命名</button>
          <button type="button" class="subtle" data-conflict-choice="skip" data-i18n="conflict.skip">跳过冲突</button>
          <button type="button" class="subtle" data-conflict-choice="cancel" data-i18n="common.cancel">取消</button>
        </div>
      </div>
    </dialog>

    <dialog id="chmod-dialog">
      <form id="chmod-form" method="dialog">
        <div class="modal-head">
          <div>
            <span class="eyebrow">POSIX PERMISSIONS</span>
            <h2 data-i18n="chmod.title">修改权限 (chmod)</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <p id="chmod-target-path" class="dialog-description mono"></p>
        <div class="chmod-grid">
          <div class="chmod-head"><span></span><span data-i18n="chmod.read">读 (r)</span><span data-i18n="chmod.write">写 (w)</span><span data-i18n="chmod.exec">执行 (x)</span></div>
          <div class="chmod-row"><span data-i18n="chmod.owner">所有者</span><input type="checkbox" data-chmod-bit="0400" /><input type="checkbox" data-chmod-bit="0200" /><input type="checkbox" data-chmod-bit="0100" /></div>
          <div class="chmod-row"><span data-i18n="chmod.group">所属组</span><input type="checkbox" data-chmod-bit="0040" /><input type="checkbox" data-chmod-bit="0020" /><input type="checkbox" data-chmod-bit="0010" /></div>
          <div class="chmod-row"><span data-i18n="chmod.other">其他人</span><input type="checkbox" data-chmod-bit="0004" /><input type="checkbox" data-chmod-bit="0002" /><input type="checkbox" data-chmod-bit="0001" /></div>
        </div>
        <label><span data-i18n="chmod.octal">八进制权限值</span><input id="chmod-octal" type="text" maxlength="4" pattern="[0-7]{3,4}" placeholder="755" required /></label>
        <div class="dialog-actions">
          <button type="button" class="subtle close-dialog" data-i18n="common.cancel">取消</button>
          <button type="submit" class="primary" data-i18n="chmod.apply">应用权限</button>
        </div>
      </form>
    </dialog>

    <dialog id="confirm-delete-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">DANGER CONFIRMATION</span>
            <h2 data-i18n="delete.title">确认删除远程目标</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <p id="delete-target-desc" class="dialog-description"></p>
        <pre id="delete-target-path" class="delete-path-box"></pre>
        <div class="dialog-actions">
          <button type="button" class="subtle close-dialog" data-i18n="common.cancel">取消</button>
          <button id="confirm-delete-btn" type="button" class="primary danger-btn" data-i18n="delete.confirmBtn">确认永久删除</button>
        </div>
      </div>
    </dialog>

    <dialog id="ops-log-dialog" class="wide-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">RUNTIME LOGS</span>
            <h2 id="ops-log-title" data-i18n="opsLog.title">日志详情</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <pre id="ops-log-content" class="ops-log-content"></pre>
      </div>
    </dialog>

    <dialog id="relaunch-admin-dialog" class="prompt-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow">UAC ELEVATION</span>
            <h2 data-i18n="titlebar.adminRelaunchTitle">以管理员身份重启 RufeShell</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <div class="prompt-dialog-body">
          <p id="relaunch-admin-desc" class="dialog-description"></p>
          <div class="dialog-actions">
            <button type="button" class="subtle close-dialog" data-i18n="common.cancel">取消</button>
            <button id="confirm-relaunch-admin-btn" type="button" class="primary" data-i18n="titlebar.adminRelaunchBtn">以管理员启动</button>
          </div>
        </div>
      </div>
    </dialog>

    <dialog id="close-confirm-dialog" class="prompt-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow" data-i18n="closeDialog.eyebrow">CLOSE WINDOW</span>
            <h2 data-i18n="closeDialog.title">关闭 RufeShell</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <div class="prompt-dialog-body">
          <p class="dialog-description" data-i18n="closeDialog.desc">点击关闭按钮时希望执行什么操作？最小化到系统托盘可保持当前会话后台运行，点击右下角托盘图标可随时恢复窗口。</p>
          <label class="check-pill prompt-remember"><input id="close-confirm-remember" type="checkbox" /><span data-i18n="closeDialog.remember">不再询问（可在“设置”中随时更改）</span></label>
          <div class="dialog-actions">
            <button type="button" class="subtle close-dialog" data-i18n="common.cancel">取消</button>
            <button id="close-action-tray" type="button" class="subtle" data-i18n="closeDialog.minimizeTray">最小化到托盘</button>
            <button id="close-action-exit" type="button" class="primary danger-btn" data-i18n="closeDialog.exitApp">直接关闭</button>
          </div>
        </div>
      </div>
    </dialog>

    <dialog id="local-shell-privilege-dialog" class="prompt-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow" data-i18n="localPriv.eyebrow">TERMINAL PRIVILEGE</span>
            <h2 id="local-priv-title">选择启动权限</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <div class="prompt-dialog-body">
          <p id="local-priv-desc" class="dialog-description"></p>
          <div class="priv-choice-grid">
            <button id="local-priv-standard" type="button" class="priv-choice-card">
              <span class="priv-choice-icon">${icon("terminal")}</span>
              <span class="priv-choice-copy">
                <strong data-i18n="localPriv.standardBtn">标准权限</strong>
                <small id="local-priv-standard-hint" data-i18n="localPriv.standardHint">在工作台内置标签页中直接打开</small>
              </span>
            </button>
            <button id="local-priv-admin" type="button" class="priv-choice-card is-admin">
              <span class="priv-choice-icon">${icon("shield")}</span>
              <span class="priv-choice-copy">
                <strong data-i18n="localPriv.adminBtn">管理员权限</strong>
                <small id="local-priv-admin-hint" data-i18n="localPriv.adminHint">通过 Windows UAC 提权在新窗口中运行</small>
              </span>
            </button>
          </div>
          <label class="check-pill prompt-remember"><input id="local-priv-remember" type="checkbox" /><span data-i18n="localPriv.remember">记住此选择，不再询问（可在“设置”中修改）</span></label>
          <div class="dialog-actions">
            <button type="button" class="subtle close-dialog" data-i18n="common.cancel">取消</button>
          </div>
        </div>
      </div>
    </dialog>

    <dialog id="update-dialog" class="prompt-dialog">
      <div class="modal-shell">
        <div class="modal-head">
          <div>
            <span class="eyebrow" data-i18n="updater.eyebrow">SOFTWARE UPDATE</span>
            <h2 data-i18n="updater.title">应用更新</h2>
          </div>
          <button type="button" class="icon-button close-dialog" data-i18n-aria="common.close" aria-label="关闭">${icon("x")}</button>
        </div>
        <div class="prompt-dialog-body">
          <div class="updater-version-row">
            <div class="updater-ver-chip">
              <span data-i18n="updater.currentLabel">当前版本</span>
              <strong id="updater-current-ver">v1.3.0</strong>
            </div>
            <span class="updater-ver-arrow">→</span>
            <div class="updater-ver-chip is-latest">
              <span data-i18n="updater.latestLabel">最新版本</span>
              <strong id="updater-latest-ver">v1.3.0</strong>
            </div>
          </div>
          <div id="updater-status-box" class="updater-status-box is-info"></div>
          <div id="updater-notes-wrap" class="updater-notes-wrap hidden">
            <div class="updater-notes-title" data-i18n="updater.notesTitle">更新说明</div>
            <pre id="updater-notes" class="updater-notes"></pre>
          </div>
          <div id="updater-progress-wrap" class="updater-progress-wrap hidden">
            <div class="updater-progress-track"><span id="updater-progress-bar"></span></div>
            <div id="updater-progress-text" class="updater-progress-text"></div>
          </div>
          <div id="updater-session-warn" class="updater-session-warn hidden"></div>
          <div class="dialog-actions">
            <button type="button" class="subtle close-dialog" data-i18n="common.close">关闭</button>
            <button id="updater-recheck-btn" type="button" class="subtle hidden" data-i18n="updater.recheckBtn">重新检查</button>
            <button id="updater-download-btn" type="button" class="primary hidden" data-i18n="updater.downloadBtn">下载更新</button>
            <button id="updater-install-btn" type="button" class="primary hidden" data-i18n="updater.installRestartBtn">安装并重启</button>
          </div>
        </div>
      </div>
    </dialog>

    <div id="toast" class="toast" role="status"></div>
  `;
  applyStaticTranslations();
}
