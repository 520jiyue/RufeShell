import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./style.css";
import "./file-drop.css";

type AuthKind = "password" | "private_key";
type Connection = { id: string; name: string; host: string; port: number; username: string; auth: AuthKind; private_key_path: string | null };
type RemoteEntry = { name: string; path: string; is_dir: boolean; size: number; modified_at: number | null; permissions: number | null };
type ProcessMetric = { name: string; cpu_percent: number; memory_bytes: number };
type MountMetric = { path: string; available: number; total: number; percent: number };
type SystemMetrics = { hostname: string; system: string; cpu_percent: number | null; memory_percent: number; memory_used: number; memory_total: number; load_average: number[]; disk_percent: number; disk_used: number; disk_total: number; uptime_seconds: number; swap_percent: number; swap_used: number; swap_total: number; network_receive_bytes: number; network_transmit_bytes: number; processes: ProcessMetric[]; mounts: MountMetric[] };
type Status = "connecting" | "authenticating" | "connected" | "closed";
type SessionEvent = { kind: "status"; session_id: string; status: Status; message: string | null } | { kind: "output"; session_id: string; data: string };
type Session = { id: string; profile: Connection; terminal: Terminal; fit: FitAddon; element: HTMLDivElement; fileElement: HTMLDivElement; metricsElement: HTMLElement; status: Status; path: string; view: "terminal" | "files"; loadingFiles: boolean; filesLoaded: boolean; directoryRequest: number; metricsTimer?: number; refreshingMetrics: boolean };
const cpuHistory = new Map<string, number[]>();
const networkHistory = new Map<string, { received: number; sent: number; time: number }>();
type HostKey = { code: "host_key_confirmation" | "host_key_known"; algorithm: string; fingerprint: string; host_key: string; changed: boolean; previous_fingerprint: string | null };
type DiscoveredHost = { profile: Connection; key: HostKey; known: boolean };

const icons: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>', server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>', folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>', x: '<path d="m18 6-12 12M6 6l12 12"/>',
  arrow: '<path d="m15 18-6-6 6-6"/>', upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>', refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M15 8l3 3M17 6l2 2"/>', shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
const connections = new Map<string, Connection>();
const sessions = new Map<string, Session>();
const pendingOutput = new Map<string, Uint8Array[]>();
let activeId: string | null = null;
let busy = false;
let discoveredHost: DiscoveredHost | null = null;
let connecting = false;

$("#app").innerHTML = `
  <div class="app-shell">
    <header class="titlebar"><div class="brand"><span class="brand-mark">F</span><span>FinalPowerShell</span><span class="edition">WORKBENCH</span></div><span class="local-badge">${icon("shield")} 本地凭据保护</span></header>
    <div class="workspace">
      <aside class="sidebar">
        <div class="sidebar-heading"><span>连接</span><button id="add-connection" class="icon-button" title="新建连接">${icon("plus")}</button></div>
        <div id="connection-list" class="connection-list"></div>
        <div class="sidebar-foot"><span class="status-dot"></span><span>Rust 原生 SSH · 不依赖 Java</span></div>
      </aside>
      <main class="main-area">
        <div id="tabbar" class="tabbar"></div>
        <div id="welcome" class="welcome"><div class="welcome-symbol">${icon("terminal")}</div><h1>远程工作，井然有序。</h1><p>安全的 SSH 终端与文件传输，在一个工作台中完成。</p><button id="welcome-add" class="primary">${icon("plus")} 新建连接</button><span class="welcome-note">连接信息保存在本机，密码存入 Windows 凭据库</span></div>
        <section id="session-view" class="session-view hidden">
          <div class="session-toolbar"><div><strong id="session-title"></strong><span id="session-address" class="muted"></span></div><div class="toolbar-actions"><button id="toggle-files" class="icon-button" title="隐藏文件面板">${icon("folder")}</button><button id="toggle-metrics" class="icon-button" title="隐藏资源面板">${icon("activity")}</button><button id="disconnect" class="subtle">断开连接</button></div></div>
          <div id="session-workspace"><aside id="metrics-panel" class="metrics-panel"><div class="metrics-heading">${icon("server")}<span>系统信息</span><span class="live-label">LIVE</span></div><div id="metrics-content" class="metrics-content"><p class="metrics-placeholder">连接后自动读取 Linux 系统资源</p></div><div class="metrics-foot">2 秒实时刷新 · 复用监控连接</div></aside><div id="metrics-resizer" class="metrics-resizer" title="拖动调整资源面板宽度"></div><div class="session-content"><div id="terminal-panel" class="terminal-panel"></div></div><div id="files-resizer" class="files-resizer" title="拖动调整文件面板宽度"></div><aside id="files-panel" class="files-panel"><div class="file-toolbar"><button id="parent-directory" class="icon-button" title="上一级">${icon("arrow")}</button><input id="remote-path" aria-label="远程路径" spellcheck="false"/><button id="refresh-files" class="icon-button" title="刷新">${icon("refresh")}</button></div><div id="file-containers"></div><div class="files-hint">右键文件或空白处操作</div></aside></div>
        </section>
      </main>
    </div>
    <footer class="statusbar"><span id="global-status">就绪</span><span>FinalPowerShell · 开发预览版</span></footer>
  </div>
  <dialog id="connection-dialog"><form id="connection-form"><div class="dialog-heading"><div><span class="eyebrow">NEW CONNECTION</span><h2>建立新的连接</h2></div><button type="button" class="icon-button close-dialog">${icon("x")}</button></div><p class="dialog-description">填写服务器信息。密码只会存入系统凭据库。</p><label>连接名称<input name="name" required placeholder="例如：生产服务器" maxlength="60"/></label><div class="form-row"><label class="host-field">主机地址<input name="host" required placeholder="192.168.1.10 或 example.com"/></label><label class="port-field">端口<input name="port" type="number" min="1" max="65535" value="22" required/></label></div><label>用户名<input name="username" required placeholder="root" autocomplete="username"/></label><fieldset><legend>认证方式</legend><div class="auth-options"><label><input type="radio" name="auth" value="password" checked/> 密码认证</label><label><input type="radio" name="auth" value="private_key"/> 私钥认证</label></div></fieldset><label id="password-field">密码<input name="password" type="password" placeholder="连接密码" autocomplete="new-password"/></label><div id="private-key-field" class="hidden"><label>私钥路径</label><div class="file-picker"><input name="private_key_path" placeholder="选择 OpenSSH 私钥文件" readonly/><button type="button" id="choose-key" class="subtle">选择文件</button></div></div><div id="form-error" class="form-error"></div><div class="dialog-actions"><button type="button" class="subtle close-dialog">取消</button><button class="primary" type="submit">保存连接</button></div></form></dialog>
  <dialog id="connect-dialog"><div class="connect-dialog-inner"><div class="dialog-heading"><div><span class="eyebrow">SECURE CONNECTION</span><h2 id="host-dialog-title">核对服务器身份</h2></div><button type="button" class="icon-button close-dialog" title="关闭">${icon("x")}</button></div><div class="connect-target">${icon("server")}<span id="connect-target"></span></div><div class="security-notice">${icon("shield")}<p id="host-notice">正在自动获取服务器身份，无需手动填写公钥。</p></div><dl class="host-details"><div class="key-type"><dt>密钥类型</dt><dd id="host-algorithm">获取中…</dd></div><div><dt>主机密钥指纹 <span>SHA-256</span></dt><dd id="host-fingerprint" class="fingerprint">获取中…</dd></div></dl><div id="password-entry" class="password-entry hidden"><label for="connection-password">登录密码</label><input id="connection-password" type="password" autocomplete="current-password" placeholder="请输入该服务器的登录密码"/><label class="remember-password"><input id="remember-password" type="checkbox" checked/><span>保存到 Windows 凭据库，下次自动登录</span></label></div><div id="connect-error" class="form-error"></div><div class="dialog-actions"><button type="button" class="subtle close-dialog">取消</button><button id="accept-once" class="subtle" type="button">只接受本次</button><button id="accept-save" class="primary" type="button">接受并保存</button></div><div class="dialog-footnote">${icon("key")} 核对指纹可防止连接到冒充的服务器</div></div></dialog>
  <div id="file-context-menu" class="context-menu hidden"></div><div id="file-drop-hint" class="file-drop-hint hidden">${icon("upload")}<strong>释放以上传文件</strong><span id="file-drop-target"></span></div>
  <dialog id="editor-dialog"><div class="editor-heading"><div><span class="eyebrow">REMOTE TEXT EDITOR</span><h2 id="editor-title">快速查看</h2><p id="editor-path"></p></div><button type="button" class="icon-button close-editor">${icon("x")}</button></div><textarea id="file-editor" spellcheck="false"></textarea><div id="editor-error" class="form-error"></div><div class="editor-footer"><span>仅支持 1 MB 以内的 UTF-8 文本</span><div class="dialog-actions"><button type="button" class="subtle close-editor">取消</button><button id="save-remote-file" class="primary">保存修改</button></div></div></dialog>
  <div id="toast" class="toast" role="status"></div>`;

function notify(message: string, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  window.setTimeout(() => toast.classList.remove("visible"), isError ? 6500 : 3500);
}

function renderConnections() {
  $("#connection-list").innerHTML = [...connections.values()].map(profile => `<article class="connection-card" data-profile="${profile.id}"><button class="connection-open" title="连接 ${escapeHtml(profile.host)}"><span class="server-icon">${icon("server")}</span><span class="connection-copy"><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(profile.username)}@${escapeHtml(profile.host)}</small></span></button><button class="icon-button delete-connection" title="删除连接" data-delete="${profile.id}">${icon("trash")}</button></article>`).join("") || '<div class="empty-connections">还没有连接<br/>点击 + 添加第一台服务器</div>';
}

function renderTabs() {
  $("#tabbar").innerHTML = [...sessions.values()].map(session => `<div class="session-tab ${session.id === activeId ? "active" : ""}"><button data-activate="${session.id}"><span class="status-dot ${session.status}"></span>${escapeHtml(session.profile.name)}</button><button class="tab-close" data-close="${session.id}" title="关闭会话">${icon("x")}</button></div>`).join("");
  $("#tabbar").classList.toggle("hidden", sessions.size === 0);
}

function activateSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  activeId = id;
  $("#welcome").classList.add("hidden");
  $("#session-view").classList.remove("hidden");
  for (const item of sessions.values()) item.element.classList.toggle("hidden", item.id !== id);
  for (const item of sessions.values()) item.fileElement.classList.toggle("hidden", item.id !== id);
  $("#metrics-content").replaceChildren(session.metricsElement);
  $<HTMLInputElement>("#remote-path").value = session.path;
  $("#session-title").textContent = session.profile.name;
  $("#session-address").textContent = `${session.profile.username}@${session.profile.host}:${session.profile.port}`;
  $("#disconnect").classList.toggle("hidden", session.status === "closed");
  switchView(session.view);
  if (session.status === "connected") {
    void loadDirectory(session.id, session.path);
    startMetrics(session);
  }
  renderTabs();
}

function switchView(view: "terminal" | "files") {
  const session = sessions.get(activeId ?? "");
  if (!session) return;
  session.view = view;
  if (view === "files") $("#files-panel").classList.remove("hidden");
  requestAnimationFrame(() => { session.fit.fit(); session.terminal.focus(); });
}

async function loadConnections() {
  const profiles = await invoke<Connection[]>("list_connections");
  connections.clear();
  for (const profile of profiles) connections.set(profile.id, profile);
  renderConnections();
}

function openConnectionDialog() {
  $<HTMLFormElement>("#connection-form").reset();
  $<HTMLInputElement>('[name="port"]').value = "22";
  $<HTMLInputElement>('[name="auth"][value="password"]').checked = true;
  $<HTMLInputElement>('[name="password"]').required = true;
  $("#private-key-field").classList.add("hidden");
  $("#password-field").classList.remove("hidden");
  $("#form-error").textContent = "";
  $<HTMLDialogElement>("#connection-dialog").showModal();
  $<HTMLInputElement>('[name="name"]').focus();
}

async function startConnection(profile: Connection) {
  if (connecting) return;
  connecting = true;
  const card = document.querySelector<HTMLElement>(`[data-profile="${profile.id}"]`);
  card?.classList.add("connecting-card");
  try {
    const id = await invoke<string>("connect_saved", { profileId: profile.id });
    createSession(id, profile);
    notify("已快速连接");
    return;
  } catch (error) {
    const message = friendlyError(error);
    connecting = false;
    card?.classList.remove("connecting-card");
    if (!message.includes("首次连接")) {
      return startConnectionWithConfirmation(profile, message.includes("密码") ? message : null);
    }
  }
  connecting = false;
  card?.classList.remove("connecting-card");
  await startConnectionWithConfirmation(profile, null);
}

async function startConnectionWithConfirmation(profile: Connection, initialError: string | null) {
  if (connecting) return;
  connecting = true;
  $<HTMLDialogElement>("#connect-dialog").dataset.profile = profile.id;
  $("#connect-target").textContent = `${profile.username}@${profile.host}:${profile.port}`;
  $("#connect-error").textContent = initialError ?? "";
  $("#host-dialog-title").textContent = "正在获取服务器身份";
  $("#host-algorithm").textContent = "获取中…";
  $("#host-fingerprint").textContent = "获取中…";
  $("#host-notice").textContent = "正在连接服务器并读取主机公钥，此步骤不会登录。";
  $("#password-entry").classList.add("hidden");
  $<HTMLInputElement>("#connection-password").value = "";
  $("#connect-dialog").classList.remove("password-needed");
  $<HTMLButtonElement>("#accept-once").disabled = true;
  $<HTMLButtonElement>("#accept-save").disabled = true;
  $<HTMLDialogElement>("#connect-dialog").showModal();
  try {
    const key = await invoke<HostKey>("discover_host_key", { profileId: profile.id });
    const known = key.code === "host_key_known";
    discoveredHost = { profile, key, known };
    $("#host-dialog-title").textContent = known ? "服务器身份已确认" : key.changed ? "警告：服务器密钥已改变" : "核对服务器身份";
    $("#host-algorithm").textContent = key.algorithm;
    $("#host-fingerprint").textContent = key.fingerprint;
    $("#host-notice").textContent = known ? "已保存的主机密钥匹配，可以直接连接。" : key.changed ? `之前保存的指纹为 ${key.previous_fingerprint}。除非你确认服务器已重新安装或管理员更换了密钥，否则不要继续。` : "服务器尚未登记。请通过管理员等可信渠道核对指纹，再选择接受方式。";
    $("#accept-once").textContent = known ? "连接" : "只接受本次";
    $<HTMLButtonElement>("#accept-once").disabled = false;
    $<HTMLButtonElement>("#accept-save").disabled = known;
    if (known && initialError === null) {
      connecting = false;
      await acceptHost(false);
    }
  } catch (error) {
    $("#host-dialog-title").textContent = "无法获取服务器身份";
    $("#host-algorithm").textContent = "—";
    $("#host-fingerprint").textContent = "—";
    $("#host-notice").textContent = "请检查地址、端口及服务器 SSH 服务。";
    $("#connect-error").textContent = friendlyError(error);
  } finally { connecting = false; }
}

function friendlyError(error: unknown) {
  const message = String(error);
  if (message.includes("No matching entry found") || message.includes("尚未保存登录密码")) return "此连接尚未保存登录密码，请输入密码后继续";
  if (message.includes("认证失败") || message.includes("Authentication")) return "用户名或密码不正确，请重新输入";
  return message;
}

function requestPassword(error: unknown) {
  const discovered = discoveredHost;
  if (!discovered || discovered.profile.auth !== "password") return false;
  const message = friendlyError(error);
  if (!message.includes("密码")) return false;
  $("#password-entry").classList.remove("hidden");
  $("#connect-dialog").classList.add("password-needed");
  $("#connect-error").textContent = message;
  $<HTMLInputElement>("#connection-password").focus();
  return true;
}

async function acceptHost(remember: boolean) {
  const discovered = discoveredHost;
  if (!discovered || connecting) return;
  connecting = true;
  const once = $<HTMLButtonElement>("#accept-once");
  const save = $<HTMLButtonElement>("#accept-save");
  once.disabled = true;
  save.disabled = true;
  $("#connect-error").textContent = "";
  once.textContent = "正在连接…";
  try {
    const password = $<HTMLInputElement>("#connection-password").value;
    const id = await invoke<string>("connect", { profileId: discovered.profile.id, hostKey: discovered.key.host_key, remember, password: password || null, savePassword: $<HTMLInputElement>("#remember-password").checked });
    $<HTMLDialogElement>("#connect-dialog").close();
    createSession(id, discovered.profile);
    notify("已建立加密连接");
  } catch (error) {
    if (!requestPassword(error)) $("#connect-error").textContent = friendlyError(error);
  }
  finally {
    connecting = false;
    once.disabled = false;
    once.textContent = discovered.known ? "连接" : "只接受本次";
    save.disabled = discovered.known;
  }
}

function createSession(id: string, profile: Connection) {
  const terminal = new Terminal({ cursorBlink: true, fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize: 14, scrollback: 10000, theme: { background: "#101315", foreground: "#d4ddd8", cursor: "#a5e4bc", selectionBackground: "#365c47" } });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  const element = document.createElement("div");
  element.className = "terminal-host";
  $("#terminal-panel").append(element);
  terminal.open(element);
  const fileElement = document.createElement("div");
  fileElement.className = "file-container hidden";
  fileElement.innerHTML = `<div class="file-labels"><span>名称</span><span>大小</span></div><div class="file-list"><div class="empty-files">正在准备文件列表…</div></div><div class="file-foot">上传不会覆盖已有文件 · 编辑前请备份</div>`;
  $("#file-containers").append(fileElement);
  const metricsElement = document.createElement("div");
  metricsElement.className = "metrics-content";
  metricsElement.innerHTML = '<p class="metrics-placeholder">正在读取服务器资源…</p>';
  $("#metrics-content").replaceChildren(metricsElement);
  const session: Session = { id, profile, terminal, fit, element, fileElement, metricsElement, status: "connecting", path: "/", view: "terminal", loadingFiles: false, filesLoaded: false, directoryRequest: 0, refreshingMetrics: false };
  terminal.onData(data => { if (session.status === "connected") void invoke("terminal_input", { sessionId: id, data }).catch(error => notify(String(error), true)); });
  terminal.onResize(size => { if (session.status === "connected") void invoke("terminal_resize", { sessionId: id, columns: size.cols, rows: size.rows }).catch(() => undefined); });
  sessions.set(id, session);
  for (const bytes of pendingOutput.get(id) ?? []) terminal.write(bytes);
  pendingOutput.delete(id);
  activateSession(id);
  requestAnimationFrame(() => { fit.fit(); terminal.focus(); });
  void invoke<Status>("session_status", { sessionId: id }).then(status => {
    if (session.status === "connected" || status !== "connected") return;
    session.status = status;
    if (activeId === id) $("#global-status").textContent = "已连接";
    void loadDirectory(id, session.path);
    startMetrics(session);
    renderTabs();
  }).catch(error => notify(friendlyError(error), true));
}

function startMetrics(session: Session) {
  if (session.metricsTimer !== undefined) return;
  const refresh = async () => {
    if (session.refreshingMetrics || session.status !== "connected") return;
    session.refreshingMetrics = true;
    try {
      const metrics = await invoke<SystemMetrics>("system_metrics", { sessionId: session.id });
      const history = cpuHistory.get(session.id) ?? [];
      if (metrics.cpu_percent !== null) history.push(metrics.cpu_percent);
      cpuHistory.set(session.id, history.slice(-40));
      const now = Date.now();
      const previousNetwork = networkHistory.get(session.id);
      networkHistory.set(session.id, { received: metrics.network_receive_bytes, sent: metrics.network_transmit_bytes, time: now });
      const elapsed = previousNetwork ? Math.max(0.1, (now - previousNetwork.time) / 1000) : 1;
      const received = previousNetwork ? Math.max(0, metrics.network_receive_bytes - previousNetwork.received) / elapsed : 0;
      const sent = previousNetwork ? Math.max(0, metrics.network_transmit_bytes - previousNetwork.sent) / elapsed : 0;
      session.metricsElement.innerHTML = `<div class="host-summary"><strong>${escapeHtml(metrics.hostname)}</strong><small>${escapeHtml(metrics.system)}</small><span>已运行 ${formatUptime(metrics.uptime_seconds)}</span></div><div class="load-summary"><span>系统负载</span><strong>${metrics.load_average.map(value => value.toFixed(2)).join(" · ")}</strong></div>${metricCard("CPU", metrics.cpu_percent === null ? "采样中" : `${metrics.cpu_percent.toFixed(1)}%`, metrics.cpu_percent ?? 0, "")}${sparkline(history)}${metricCard("内存", `${metrics.memory_percent.toFixed(1)}%`, metrics.memory_percent, `${formatBytes(metrics.memory_used)} / ${formatBytes(metrics.memory_total)}`)}${metricCard("交换", `${metrics.swap_percent.toFixed(1)}%`, metrics.swap_percent, `${formatBytes(metrics.swap_used)} / ${formatBytes(metrics.swap_total)}`)}<div class="network-summary"><div><span>↓ 接收</span><strong>${formatBytes(received)}/s</strong></div><div><span>↑ 发送</span><strong>${formatBytes(sent)}/s</strong></div></div>${metricCard("根目录 /", `${metrics.disk_percent.toFixed(1)}%`, metrics.disk_percent, `${formatBytes(metrics.disk_used)} / ${formatBytes(metrics.disk_total)}`)}<section class="metrics-section"><h3>进程 <span>CPU 占用</span></h3>${metrics.processes.map(process => `<div class="process-row"><span title="${escapeHtml(process.name)}">${escapeHtml(process.name)}</span><strong>${process.cpu_percent.toFixed(1)}%</strong><small>${formatBytes(process.memory_bytes)}</small></div>`).join("")}</section><section class="metrics-section"><h3>挂载点 <span>可用 / 总量</span></h3>${metrics.mounts.map(mount => `<div class="mount-row"><div><span title="${escapeHtml(mount.path)}">${escapeHtml(mount.path)}</span><strong>${formatBytes(mount.available)} / ${formatBytes(mount.total)}</strong></div><div class="mount-track"><span style="width:${mount.percent}%"></span></div></div>`).join("")}</section><div class="metrics-updated">更新于 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}</div>`;
    } catch (error) {
      const message = friendlyError(error);
      const existing = session.metricsElement.querySelector(".metrics-refresh-error");
      if (session.metricsElement.querySelector(".metric-card")) {
        const notice = existing ?? document.createElement("p");
        notice.className = "metrics-refresh-error";
        notice.textContent = `本次刷新失败，2 秒后自动重试：${message}`;
        session.metricsElement.prepend(notice);
      } else {
        session.metricsElement.innerHTML = `<p class="metrics-placeholder">${escapeHtml(message)}</p><button class="subtle retry-metrics" type="button">重试</button>`;
        session.metricsElement.querySelector(".retry-metrics")?.addEventListener("click", () => void refresh());
      }
    } finally { session.refreshingMetrics = false; }
  };
  void refresh();
  session.metricsTimer = window.setInterval(() => void refresh(), 2000);
}

$("#toggle-metrics").addEventListener("click", () => {
  const panel = $("#metrics-panel");
  const hidden = panel.classList.toggle("hidden");
  $("#metrics-resizer").classList.toggle("hidden", hidden);
  $<HTMLButtonElement>("#toggle-metrics").title = hidden ? "显示资源面板" : "隐藏资源面板";
  const session = sessions.get(activeId ?? "");
  if (session) requestAnimationFrame(() => session.fit.fit());
});
$("#metrics-resizer").addEventListener("pointerdown", event => {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = $("#metrics-panel").getBoundingClientRect().width;
  const availableWidth = $("#session-workspace").clientWidth - ($("#files-panel").classList.contains("hidden") ? 0 : $("#files-panel").clientWidth);
  const move = (moveEvent: PointerEvent) => {
    const width = Math.max(180, Math.min(440, availableWidth - 300, startWidth + moveEvent.clientX - startX));
    $("#metrics-panel").style.width = `${width}px`;
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    const session = sessions.get(activeId ?? "");
    if (session) session.fit.fit();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
});

function metricCard(label: string, value: string, percent: number, detail: string) {
  return `<div class="metric-card"><div><span>${label}</span><strong>${value}</strong></div><div class="metric-track"><span style="width:${Math.min(100, Math.max(0, percent))}%"></span></div>${detail ? `<small>${detail}</small>` : ""}</div>`;
}

function sparkline(values: number[]) {
  const points = values.map((value, index) => `${values.length <= 1 ? 0 : index / (values.length - 1) * 100},${28 - Math.min(100, value) * 0.25}`).join(" ");
  return `<svg class="metric-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="CPU 最近趋势"><polyline points="${points}"/></svg>`;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  return days > 0 ? `${days} 天 ${hours} 小时` : `${hours} 小时 ${Math.floor(seconds % 3600 / 60)} 分钟`;
}

async function disconnectSession(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  try { if (session.status !== "closed") await invoke("disconnect", { sessionId: id }); }
  catch (error) { notify(String(error), true); return; }
  if (session.metricsTimer !== undefined) window.clearInterval(session.metricsTimer);
  session.terminal.dispose();
  session.element.remove();
  session.fileElement.remove();
  sessions.delete(id);
  if (activeId === id) { activeId = sessions.keys().next().value ?? null; if (activeId) activateSession(activeId); }
  if (!sessions.size) { $("#session-view").classList.add("hidden"); $("#welcome").classList.remove("hidden"); }
  renderTabs();
}

async function loadDirectory(id: string, path: string) {
  const session = sessions.get(id);
  if (!session || session.status !== "connected") return;
  while (session.loadingFiles) await new Promise(resolve => window.setTimeout(resolve, 30));
  if (session.status !== "connected") return;
  const request = ++session.directoryRequest;
  session.loadingFiles = true;
  if (activeId === id) $("#global-status").textContent = "正在读取远程目录…";
  const list = session.fileElement.querySelector<HTMLDivElement>(".file-list")!;
  if (!session.filesLoaded) list.innerHTML = '<div class="empty-files">正在读取远程目录…</div>';
  try {
    const entries = await invoke<RemoteEntry[]>("list_directory", { sessionId: session.id, path });
    if (request !== session.directoryRequest) return;
    session.path = path;
    session.filesLoaded = true;
    if (activeId === id) $<HTMLInputElement>("#remote-path").value = path;
    list.innerHTML = entries.map(entry => `<div class="file-row" data-path="${escapeHtml(entry.path)}" data-name="${escapeHtml(entry.name)}" data-dir="${entry.is_dir}"><button class="file-name ${entry.is_dir ? "directory" : ""}" data-path="${escapeHtml(entry.path)}">${icon(entry.is_dir ? "folder" : "file")}<span>${escapeHtml(entry.name)}</span></button><span class="file-size">${entry.is_dir ? "—" : formatBytes(entry.size)}</span></div>`).join("") || '<div class="empty-files">此目录为空 · 右键上传文件</div>';
  } catch (error) {
    if (request !== session.directoryRequest) return;
    const message = friendlyError(error);
    list.innerHTML = `<div class="empty-files file-error"><strong>文件读取失败</strong><span>${escapeHtml(message)}</span><button class="subtle retry-files" type="button">重试</button></div>`;
    list.querySelector(".retry-files")?.addEventListener("click", () => void loadDirectory(session.id, session.path));
    notify(message, true);
  }
  finally { if (request === session.directoryRequest) session.loadingFiles = false; if (activeId === id) $("#global-status").textContent = "就绪"; }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

$("#add-connection").addEventListener("click", openConnectionDialog);
$("#welcome-add").addEventListener("click", openConnectionDialog);
document.querySelectorAll<HTMLButtonElement>(".close-dialog").forEach(button => button.addEventListener("click", () => button.closest("dialog")!.close()));
document.querySelectorAll<HTMLInputElement>('[name="auth"]').forEach(input => input.addEventListener("change", () => {
  const privateKey = $<HTMLInputElement>('[name="auth"]:checked').value === "private_key";
  $("#password-field").classList.toggle("hidden", privateKey);
  $("#private-key-field").classList.toggle("hidden", !privateKey);
  $<HTMLInputElement>('[name="password"]').required = !privateKey;
}));
$("#choose-key").addEventListener("click", async () => {
  const path = await open({ multiple: false, title: "选择 OpenSSH 私钥" });
  if (typeof path === "string") $<HTMLInputElement>('[name="private_key_path"]').value = path;
});
$("#connection-form").addEventListener("submit", async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  const button = $<HTMLButtonElement>('#connection-form [type="submit"]');
  button.disabled = true;
  try {
    const profile = await invoke<Connection>("save_connection", { draft: { name: data.get("name"), host: data.get("host"), port: Number(data.get("port")), username: data.get("username"), auth: data.get("auth"), private_key_path: data.get("private_key_path") || null }, password: data.get("password") || null });
    connections.set(profile.id, profile);
    renderConnections();
    $<HTMLDialogElement>("#connection-dialog").close();
    notify("连接已保存，点击卡片即可连接");
  } catch (error) { $("#form-error").textContent = String(error); }
  finally { button.disabled = false; }
});
$("#accept-once").addEventListener("click", () => void acceptHost(false));
$("#accept-save").addEventListener("click", () => void acceptHost(true));
$("#connection-list").addEventListener("click", async event => {
  const target = event.target as HTMLElement;
  const deleteButton = target.closest<HTMLButtonElement>("[data-delete]");
  if (deleteButton) {
    const profile = connections.get(deleteButton.dataset.delete!)!;
    if (!window.confirm(`删除“${profile.name}”及其已保存的密码？`)) return;
    try { await invoke("delete_connection", { id: profile.id }); connections.delete(profile.id); renderConnections(); notify("连接已删除"); }
    catch (error) { notify(String(error), true); }
    return;
  }
  const card = target.closest<HTMLElement>("[data-profile]");
  if (card) void startConnection(connections.get(card.dataset.profile!)!);
});
$("#tabbar").addEventListener("click", event => {
  const target = event.target as HTMLElement;
  const close = target.closest<HTMLButtonElement>("[data-close]");
  if (close) void disconnectSession(close.dataset.close!);
  else { const activate = target.closest<HTMLButtonElement>("[data-activate]"); if (activate) activateSession(activate.dataset.activate!); }
});
$("#disconnect").addEventListener("click", () => { if (activeId) void disconnectSession(activeId); });
$("#parent-directory").addEventListener("click", () => { const session = sessions.get(activeId ?? ""); if (session) void loadDirectory(session.id, session.path === "/" ? "/" : session.path.replace(/\/[^/]+\/?$/, "") || "/"); });
$("#refresh-files").addEventListener("click", () => { const session = sessions.get(activeId ?? ""); if (session) void loadDirectory(session.id, session.path); });
$("#remote-path").addEventListener("keydown", event => { if (event.key === "Enter") { const session = sessions.get(activeId ?? ""); if (session) void loadDirectory(session.id, (event.target as HTMLInputElement).value); } });
$("#file-containers").addEventListener("click", async event => {
  const target = event.target as HTMLElement;
  const session = sessions.get(activeId ?? "");
  const directory = target.closest<HTMLButtonElement>(".directory");
  if (directory) { if (session) await loadDirectory(session.id, directory.dataset.path!); return; }
});

function hideContextMenu() { $("#file-context-menu").classList.add("hidden"); }
document.addEventListener("click", event => { if (!(event.target as HTMLElement).closest("#file-context-menu")) hideContextMenu(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") hideContextMenu(); });

async function uploadToSession(session: Session) {
  if (busy) return;
  const localPath = await open({ multiple: false, title: "选择要上传的文件" });
  if (typeof localPath !== "string") return;
  await uploadLocalFiles(session, [localPath], session.path);
}

async function uploadLocalFiles(session: Session, localPaths: string[], remoteDirectory: string) {
  if (busy || session.status !== "connected") return;
  busy = true;
  let uploaded = 0;
  const failures: string[] = [];
  try {
    for (const localPath of localPaths) {
      const name = localPath.split(/[\\/]/).pop();
      if (!name) { failures.push(`${localPath}：无效文件名`); continue; }
      $("#global-status").textContent = `正在上传 ${uploaded + 1} / ${localPaths.length} · ${name}`;
      try {
        await invoke<number>("upload_file", { sessionId: session.id, localPath, remotePath: `${remoteDirectory.replace(/\/$/, "")}/${name}` });
        uploaded += 1;
      } catch (error) { failures.push(`${name}：${friendlyError(error)}`); }
    }
  } finally {
    busy = false;
    $("#global-status").textContent = "就绪";
  }
  if (uploaded) notify(`已上传 ${uploaded} 个文件${failures.length ? `，${failures.length} 个失败` : ""}`, failures.length > 0);
  if (failures.length) notify(failures.join("\n"), true);
  await loadDirectory(session.id, session.path);
}

let draggedFilePaths: string[] = [];

function clearFileDrop() {
  draggedFilePaths = [];
  $("#files-panel").classList.remove("drag-active");
  $("#file-drop-hint").classList.add("hidden");
  document.querySelectorAll(".file-row.drop-target").forEach(row => row.classList.remove("drop-target"));
}

await getCurrentWebview().onDragDropEvent(event => {
  const payload = event.payload;
  if (payload.type === "leave") { clearFileDrop(); return; }
  if (payload.type === "enter") draggedFilePaths = payload.paths;
  const point = payload.position.toLogical(window.devicePixelRatio);
  const panel = $("#files-panel");
  const bounds = panel.getBoundingClientRect();
  const session = sessions.get(activeId ?? "");
  const inside = point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
  if (!inside || panel.classList.contains("hidden") || !session || session.status !== "connected") { clearFileDrop(); return; }
  const target = document.elementFromPoint(point.x, point.y);
  const row = target?.closest<HTMLElement>(".file-row");
  const remoteDirectory = row?.dataset.dir === "true" ? row.dataset.path! : session.path;
  if (payload.type === "drop") {
    clearFileDrop();
    if (!busy) void uploadLocalFiles(session, payload.paths, remoteDirectory);
    return;
  }
  document.querySelectorAll(".file-row.drop-target").forEach(item => item.classList.remove("drop-target"));
  row?.classList.toggle("drop-target", row.dataset.dir === "true");
  panel.classList.add("drag-active");
  $("#file-drop-target").textContent = `${draggedFilePaths.length} 个文件 → ${remoteDirectory}`;
  $("#file-drop-hint").classList.remove("hidden");
});

async function downloadFromSession(session: Session, path: string, name: string) {
  if (busy) return;
  const localPath = await save({ defaultPath: name, title: "保存远程文件" });
  if (!localPath) return;
  busy = true;
  try {
    const bytes = await invoke<number>("download_file", { sessionId: session.id, remotePath: path, localPath });
    notify(`下载完成 · ${formatBytes(bytes)}`);
  } catch (error) { notify(friendlyError(error), true); }
  finally { busy = false; }
}

async function openRemoteFile(session: Session, path: string, name: string) {
  if (busy) return;
  busy = true;
  try {
    const text = await invoke<string>("read_text_file", { sessionId: session.id, remotePath: path });
    $("#editor-dialog").dataset.session = session.id;
    $("#editor-dialog").dataset.path = path;
    $("#editor-title").textContent = name;
    $("#editor-path").textContent = path;
    $<HTMLTextAreaElement>("#file-editor").value = text;
    $("#editor-error").textContent = "";
    $<HTMLDialogElement>("#editor-dialog").showModal();
    $<HTMLTextAreaElement>("#file-editor").focus();
  } catch (error) { notify(friendlyError(error), true); }
  finally { busy = false; }
}

document.querySelectorAll<HTMLButtonElement>(".close-editor").forEach(button => button.addEventListener("click", () => $<HTMLDialogElement>("#editor-dialog").close()));
$("#save-remote-file").addEventListener("click", async () => {
  const dialog = $<HTMLDialogElement>("#editor-dialog");
  const session = sessions.get(dialog.dataset.session ?? "");
  if (!session || busy) return;
  busy = true;
  $("#editor-error").textContent = "";
  $<HTMLButtonElement>("#save-remote-file").disabled = true;
  try {
    await invoke("write_text_file", { sessionId: session.id, remotePath: dialog.dataset.path, text: $<HTMLTextAreaElement>("#file-editor").value });
    dialog.close();
    notify("远程文件已保存");
  } catch (error) { $("#editor-error").textContent = friendlyError(error); }
  finally { busy = false; $<HTMLButtonElement>("#save-remote-file").disabled = false; }
});

$("#files-panel").addEventListener("contextmenu", event => {
  event.preventDefault();
  const session = sessions.get(activeId ?? "");
  if (!session || session.status !== "connected") return;
  const row = (event.target as HTMLElement).closest<HTMLElement>(".file-row");
  const menu = $("#file-context-menu");
  menu.innerHTML = row ? (row.dataset.dir === "true" ? `<button data-action="open">${icon("folder")}打开目录</button>` : `<button data-action="view">${icon("eye")}快速查看</button><button data-action="edit">${icon("edit")}查看并修改</button><button data-action="download">${icon("download")}下载文件</button>`) : `<button data-action="upload">${icon("upload")}上传到当前目录</button><button data-action="refresh">${icon("refresh")}刷新目录</button>`;
  menu.classList.remove("hidden");
  const width = 190;
  menu.style.left = `${Math.min(event.clientX, window.innerWidth - width - 8)}px`;
  menu.style.top = `${Math.min(event.clientY, window.innerHeight - 190)}px`;
  menu.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.addEventListener("click", () => {
    hideContextMenu();
    if (button.dataset.action === "upload") void uploadToSession(session);
    if (button.dataset.action === "refresh") void loadDirectory(session.id, session.path);
    if (button.dataset.action === "open" && row) void loadDirectory(session.id, row.dataset.path!);
    if (button.dataset.action === "download" && row) void downloadFromSession(session, row.dataset.path!, row.dataset.name!);
    if ((button.dataset.action === "view" || button.dataset.action === "edit") && row) void openRemoteFile(session, row.dataset.path!, row.dataset.name!);
  }));
});

function toggleFiles() {
  const hidden = $("#files-panel").classList.toggle("hidden");
  $("#files-resizer").classList.toggle("hidden", hidden);
  $<HTMLButtonElement>("#toggle-files").title = hidden ? "显示文件面板" : "隐藏文件面板";
  const session = sessions.get(activeId ?? "");
  if (session) requestAnimationFrame(() => session.fit.fit());
}
$("#toggle-files").addEventListener("click", toggleFiles);
$("#files-resizer").addEventListener("pointerdown", event => {
  event.preventDefault();
  const startX = event.clientX;
  const startWidth = $("#files-panel").getBoundingClientRect().width;
  const availableWidth = $("#session-workspace").clientWidth - ($("#metrics-panel").classList.contains("hidden") ? 0 : $("#metrics-panel").clientWidth);
  const move = (moveEvent: PointerEvent) => {
    const width = Math.max(250, Math.min(620, availableWidth - 300, startWidth + startX - moveEvent.clientX));
    $("#files-panel").style.width = `${width}px`;
  };
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    sessions.get(activeId ?? "")?.fit.fit();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
});

new ResizeObserver(() => { const session = sessions.get(activeId ?? ""); if (session?.view === "terminal") { session.fit.fit(); } }).observe($("#terminal-panel"));
const workspaceObserver = new ResizeObserver(entries => {
  const width = entries[0]?.contentRect.width ?? 0;
  const files = $("#files-panel");
  const previousWidth = Number($("#session-workspace").dataset.width ?? 0);
  $("#session-workspace").dataset.width = String(width);
  if (previousWidth === width) return;
  if (width < 820 && !files.classList.contains("hidden")) {
    files.dataset.autoHidden = "true";
    toggleFiles();
  } else if (width >= 980 && files.dataset.autoHidden === "true") {
    delete files.dataset.autoHidden;
    toggleFiles();
  }
});
workspaceObserver.observe($("#session-workspace"));
await listen<SessionEvent>("session-event", event => {
  const payload = event.payload;
  const session = sessions.get(payload.session_id);
  if (!session) {
    if (payload.kind === "output") {
      const binary = atob(payload.data);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      const pending = pendingOutput.get(payload.session_id) ?? [];
      if (pending.length < 512) pending.push(bytes);
      pendingOutput.set(payload.session_id, pending);
    }
    return;
  }
  if (payload.kind === "output") {
    const binary = atob(payload.data);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    session.terminal.write(bytes);
  } else {
    session.status = payload.status;
    if (payload.status === "connected") {
      void loadDirectory(session.id, session.path);
      startMetrics(session);
    }
    if (payload.status === "closed" && session.metricsTimer !== undefined) {
      window.clearInterval(session.metricsTimer);
      session.metricsTimer = undefined;
    }
    if (payload.message) notify(payload.message);
    if (activeId === session.id) $("#global-status").textContent = payload.status === "connected" ? "已连接" : payload.status === "closed" ? "会话已关闭" : "正在建立连接…";
    renderTabs();
  }
});
await listen<{ message: string }>("session-warning", event => notify(event.payload.message, true));
try { await loadConnections(); } catch (error) { notify(String(error), true); }
