import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { api, friendlyError, onSessionEvent, onSessionWarning } from "../api.ts";
import { icon } from "../icons.ts";
import { getActiveSession, getConnectionMeta, state } from "../state.ts";
import { resolveTerminalTheme } from "../themes.ts";
import type { Connection, LocalShellKind, Session, SessionMode } from "../types.ts";
import { $, escapeHtml, notify, setGlobalStatus } from "../utils.ts";
import { refreshDualPane } from "./dualFiles.ts";
import { loadDirectory, toggleFilesPanel } from "./files.ts";
import { startMetrics } from "./metrics.ts";
import { refreshActiveOpsTab } from "./ops.ts";
import { adjustTerminalFontSize } from "./settings.ts";
import {
  clearTerminal,
  openTerminalSearch,
  trackTerminalInput,
  trackTerminalOutputForHistory,
} from "./terminalTools.ts";

let onSessionsChange: () => void = () => {};
const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

function updateSessionBadge(status: Session["status"]): void {
  const badge = $("#session-status-badge");
  badge.className = `session-status-badge ${status}`;
  badge.textContent =
    status === "connected"
      ? "已连接"
      : status === "closed"
        ? "已断开"
        : status === "authenticating"
          ? "认证中"
          : "连接中";
}

function updateReconnectUI(session: Session): void {
  if (state.activeId !== session.id) return;
  const banner = $("#reconnect-banner");
  const reconnectBtn = $("#reconnect-btn");
  const disconnectBtn = $("#disconnect");

  if (session.kind === "local") {
    reconnectBtn.classList.add("hidden");
    banner.classList.add("hidden");
    disconnectBtn.classList.toggle("hidden", session.status === "closed");
    return;
  }

  if (session.status === "closed") {
    disconnectBtn.classList.add("hidden");
    reconnectBtn.classList.remove("hidden");
    if (session.reconnectTimer !== undefined) {
      banner.classList.remove("hidden");
    }
  } else if (session.status === "connected") {
    disconnectBtn.classList.remove("hidden");
    reconnectBtn.classList.add("hidden");
    banner.classList.add("hidden");
  } else {
    disconnectBtn.classList.add("hidden");
    reconnectBtn.classList.add("hidden");
  }
}

export function setSessionMode(mode: SessionMode): void {
  const session = getActiveSession();
  if (!session) return;
  if (session.kind === "local") mode = "terminal";
  session.mode = mode;

  document.querySelectorAll<HTMLButtonElement>("[data-session-mode]").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.sessionMode === mode),
  );

  $("#session-workspace").classList.toggle("hidden", mode !== "terminal");
  $("#dual-files-view").classList.toggle("hidden", mode !== "dual");
  $("#ops-view").classList.toggle("hidden", mode !== "ops");

  if (mode === "terminal") {
    requestAnimationFrame(() => {
      session.fit.fit();
      session.terminal.focus();
    });
  } else if (mode === "dual") {
    void refreshDualPane();
  } else if (mode === "ops") {
    void refreshActiveOpsTab();
  }
}

export function renderTabs(): void {
  const tabbar = $("#tabbar");
  tabbar.innerHTML = [...state.sessions.values()]
    .map(
      session => `
        <div class="session-tab ${session.id === state.activeId ? "active" : ""}">
          <button type="button" data-activate="${session.id}">
            <span class="status-dot ${session.status}"></span>
            <span>${session.kind === "local" ? "本地 · " : ""}${escapeHtml(session.profile.name)}</span>
          </button>
          <button type="button" class="tab-close" data-close="${session.id}" title="关闭会话 (Ctrl+W)">${icon("x")}</button>
        </div>
      `,
    )
    .join("");
  tabbar.classList.toggle("hidden", state.sessions.size === 0);
}

export function switchView(view: "terminal" | "files"): void {
  const session = getActiveSession();
  if (!session) return;
  session.view = view;
  if (view === "files" && session.kind === "ssh") {
    $("#files-panel").classList.remove("hidden");
    $("#files-resizer").classList.remove("hidden");
    $("#toggle-files").classList.add("active");
  }
  requestAnimationFrame(() => {
    session.fit.fit();
    session.terminal.focus();
  });
}

export function activateSession(id: string): void {
  const session = state.sessions.get(id);
  if (!session) return;

  state.activeId = id;
  $("#welcome").classList.add("hidden");
  $("#session-view").classList.remove("hidden");

  for (const item of state.sessions.values()) {
    item.element.classList.toggle("hidden", item.id !== id);
    item.fileElement.classList.toggle("hidden", item.id !== id);
  }

  const isLocal = session.kind === "local";
  $("#session-mode-switcher").classList.toggle("hidden", isLocal);
  $("#panel-toggles-group").classList.toggle("hidden", isLocal);
  $("#metrics-panel").classList.toggle("hidden", isLocal || !$("#toggle-metrics").classList.contains("active"));
  $("#metrics-resizer").classList.toggle("hidden", isLocal || !$("#toggle-metrics").classList.contains("active"));
  $("#files-panel").classList.toggle("hidden", isLocal || !$("#toggle-files").classList.contains("active"));
  $("#files-resizer").classList.toggle("hidden", isLocal || !$("#toggle-files").classList.contains("active"));

  $("#metrics-content").replaceWith(session.metricsElement);
  $<HTMLInputElement>("#remote-path").value = session.path;
  $("#session-title").textContent = session.profile.name;
  $("#session-address").textContent = isLocal
    ? "本地 ConPTY 终端"
    : `${session.profile.username}@${session.profile.host}:${session.profile.port}`;
  updateSessionBadge(session.status);
  updateReconnectUI(session);

  setGlobalStatus(
    session.status === "connected"
      ? "已连接"
      : session.status === "closed"
        ? "会话已关闭"
        : "正在建立连接…",
  );

  setSessionMode(session.mode);
  if (session.kind === "ssh" && session.status === "connected") {
    void loadDirectory(session.id, session.path);
    startMetrics(session);
  }
  renderTabs();
  onSessionsChange();
}

function attachTerminalInteractions(session: Session): void {
  const { terminal } = session;

  terminal.onData(data => {
    if (session.status !== "connected") return;
    trackTerminalInput(session, data);
    void api.terminalInput(session.id, data).catch(error => notify(String(error), true));
  });

  terminal.onResize(size => {
    if (session.status === "connected") {
      void api.terminalResize(session.id, size.cols, size.rows).catch(() => undefined);
    }
  });

  terminal.onSelectionChange(() => {
    if (!state.workbench.settings.copy_on_select) return;
    const text = terminal.getSelection();
    if (text) {
      void navigator.clipboard?.writeText(text).catch(() => undefined);
    }
  });

  terminal.attachCustomKeyEventHandler(event => {
    if (event.type !== "keydown") return true;
    const ctrl = event.ctrlKey || event.metaKey;
    const lower = event.key.toLowerCase();

    if (ctrl && event.shiftKey && lower === "c") {
      const selected = terminal.getSelection();
      if (selected) {
        void navigator.clipboard?.writeText(selected).catch(() => undefined);
      }
      return false;
    }

    if (ctrl && event.shiftKey && lower === "v") {
      void navigator.clipboard
        ?.readText()
        .then(text => {
          if (text && session.status === "connected") {
            void api.terminalInput(session.id, text);
          }
        })
        .catch(() => undefined);
      return false;
    }

    if (ctrl && (event.key === "=" || event.key === "+")) {
      event.preventDefault();
      adjustTerminalFontSize(1);
      return false;
    }

    if (ctrl && event.key === "-") {
      event.preventDefault();
      adjustTerminalFontSize(-1);
      return false;
    }

    if (
      event.key === "F1" ||
      (event.altKey && !ctrl && /^[1-9]$/.test(event.key)) ||
      (ctrl &&
        (event.key === "Tab" ||
          ["n", "b", "e", "m", "h", "k", "f", "w", ",", "/"].includes(lower) ||
          (event.shiftKey && lower === "l") ||
          (!event.shiftKey && /^[1-9]$/.test(event.key))))
    ) {
      return false;
    }

    return true;
  });

  session.element.addEventListener("contextmenu", event => {
    if (!state.workbench.settings.right_click_paste) return;
    event.preventDefault();
    const selected = terminal.getSelection();
    if (selected) {
      void navigator.clipboard
        ?.writeText(selected)
        .then(() => {
          terminal.clearSelection();
          notify("已复制选中内容");
        })
        .catch(() => undefined);
      return;
    }
    if (session.status !== "connected") return;
    void navigator.clipboard
      ?.readText()
      .then(text => {
        if (text) void api.terminalInput(session.id, text);
      })
      .catch(() => undefined);
  });
}

function buildSessionInstance(
  id: string,
  profile: Connection,
  kind: "ssh" | "local",
  localShell?: LocalShellKind,
): Session {
  const settings = state.workbench.settings;
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: settings.font_family,
    fontSize: settings.font_size,
    lineHeight: 1.25,
    scrollback: 10000,
    theme: resolveTerminalTheme(settings.theme),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);

  const element = document.createElement("div");
  element.className = "terminal-host";
  $("#terminal-panel").append(element);
  terminal.open(element);

  const fileElement = document.createElement("div");
  fileElement.className = "file-container hidden";
  fileElement.innerHTML = `
    <div class="file-labels"><span>名称</span><span>大小</span></div>
    <div class="file-list"><div class="empty-files">正在准备文件列表…</div></div>
  `;
  $("#file-containers").append(fileElement);

  const metricsElement = document.createElement("div");
  metricsElement.id = "metrics-content";
  metricsElement.className = "metrics-content";
  metricsElement.innerHTML = '<p class="metrics-placeholder">正在读取服务器资源…</p>';

  const session: Session = {
    id,
    kind,
    localShell,
    profile,
    terminal,
    fit,
    element,
    fileElement,
    metricsElement,
    status: kind === "local" ? "connected" : "connecting",
    path: "/",
    localPath: "",
    view: "terminal",
    mode: "terminal",
    opsTab: "trends",
    loadingFiles: false,
    filesLoaded: false,
    directoryRequest: 0,
    refreshingMetrics: false,
    manualClose: false,
    reconnectAttempts: 0,
    inputBuffer: "",
    recentOutputTail: "",
  };

  attachTerminalInteractions(session);
  state.sessions.set(id, session);

  for (const bytes of state.pendingOutput.get(id) ?? []) {
    terminal.write(bytes);
  }
  state.pendingOutput.delete(id);

  return session;
}

export function createSession(id: string, profile: Connection): void {
  const session = buildSessionInstance(id, profile, "ssh");
  activateSession(id);
  requestAnimationFrame(() => {
    session.fit.fit();
    session.terminal.focus();
  });

  void api
    .sessionStatus(id)
    .then(status => {
      if (session.status === "connected" || status !== "connected") return;
      session.status = status;
      if (state.activeId === id) {
        setGlobalStatus("已连接");
        updateSessionBadge("connected");
        updateReconnectUI(session);
      }
      void loadDirectory(id, session.path);
      startMetrics(session);
      renderTabs();
      onSessionsChange();
    })
    .catch(error => notify(friendlyError(error), true));
}

export async function openLocalTerminalSession(kind: LocalShellKind): Promise<void> {
  const labelMap: Record<LocalShellKind, string> = {
    power_shell: "PowerShell",
    cmd: "CMD 命令提示符",
    wsl: "WSL Linux",
  };
  try {
    const id = await api.openLocalTerminal(kind);
    const profile: Connection = {
      id: `local-profile-${kind}`,
      name: labelMap[kind],
      host: "localhost",
      port: 0,
      username: "local",
      auth: "password",
      private_key_path: null,
    };
    const session = buildSessionInstance(id, profile, "local", kind);
    activateSession(id);
    requestAnimationFrame(() => {
      session.fit.fit();
      const { cols, rows } = session.terminal;
      void api.terminalResize(id, cols, rows).catch(() => undefined);
      session.terminal.focus();
    });
  } catch (error) {
    notify(friendlyError(error), true);
  }
}

function cancelAutoReconnect(session: Session): void {
  if (session.reconnectTimer !== undefined) {
    window.clearTimeout(session.reconnectTimer);
    session.reconnectTimer = undefined;
  }
  if (state.activeId === session.id) {
    $("#reconnect-banner").classList.add("hidden");
  }
}

async function performReconnect(session: Session): Promise<void> {
  if (session.kind === "local" || session.manualClose || !state.sessions.has(session.id)) return;

  const oldId = session.id;
  const timeout =
    getConnectionMeta(session.profile.id).connect_timeout_secs ??
    state.workbench.settings.connect_timeout_secs;

  session.status = "connecting";
  updateSessionBadge("connecting");
  renderTabs();
  if (state.activeId === session.id) {
    $("#reconnect-status-text").textContent = "正在重新建立 SSH 会话…";
  }

  try {
    const newId = await api.connectSaved(session.profile.id, timeout);
    state.sessions.delete(oldId);
    const oldCpu = state.cpuHistory.get(oldId);
    if (oldCpu) {
      state.cpuHistory.set(newId, oldCpu);
      state.cpuHistory.delete(oldId);
    }
    const oldSeries = state.metricsSeries.get(oldId);
    if (oldSeries) {
      state.metricsSeries.set(newId, oldSeries);
      state.metricsSeries.delete(oldId);
    }
    const oldPeaks = state.metricsPeaks.get(oldId);
    if (oldPeaks) {
      state.metricsPeaks.set(newId, oldPeaks);
      state.metricsPeaks.delete(oldId);
    }
    state.networkHistory.delete(oldId);

    session.id = newId;
    session.status = "connected";
    session.reconnectAttempts = 0;
    cancelAutoReconnect(session);
    state.sessions.set(newId, session);
    if (state.activeId === oldId) {
      state.activeId = newId;
    }

    for (const bytes of state.pendingOutput.get(newId) ?? []) {
      session.terminal.write(bytes);
    }
    state.pendingOutput.delete(newId);

    session.terminal.write("\r\n\x1b[32m[已重新连接]\x1b[0m\r\n");
    session.fit.fit();
    const { cols, rows } = session.terminal;
    void api.terminalResize(newId, cols, rows).catch(() => undefined);

    if (state.activeId === newId) {
      updateSessionBadge("connected");
      updateReconnectUI(session);
      setGlobalStatus("已重连");
    }
    void loadDirectory(newId, session.path);
    startMetrics(session);
    renderTabs();
    onSessionsChange();
    notify(`已重新连接到 ${session.profile.name}`);
  } catch (error) {
    session.status = "closed";
    const msg = friendlyError(error);
    session.terminal.write(`\r\n\x1b[31m[重连失败] ${msg}\x1b[0m\r\n`);
    scheduleAutoReconnect(session);
  }
}

function scheduleAutoReconnect(session: Session): void {
  if (session.kind === "local") return;
  const meta = getConnectionMeta(session.profile.id);
  const autoEnabled = meta.auto_reconnect ?? state.workbench.settings.auto_reconnect;
  const maxAttempts = state.workbench.settings.reconnect_max_attempts;

  if (session.manualClose || !autoEnabled || session.reconnectAttempts >= maxAttempts) {
    cancelAutoReconnect(session);
    updateReconnectUI(session);
    if (session.reconnectAttempts >= maxAttempts && !session.manualClose) {
      if (state.activeId === session.id) {
        $("#reconnect-banner").classList.remove("hidden");
        $("#reconnect-status-text").textContent = `已达到最大重连次数 (${maxAttempts})，请手动重连`;
      }
    }
    return;
  }

  session.reconnectAttempts += 1;
  const delaySec = Math.min(16, 2 ** session.reconnectAttempts);
  if (state.activeId === session.id) {
    $("#reconnect-banner").classList.remove("hidden");
    $("#reconnect-status-text").textContent =
      `网络波动断开 · ${delaySec} 秒后自动重连（第 ${session.reconnectAttempts}/${maxAttempts} 次）…`;
  }
  session.terminal.write(
    `\r\n\x1b[33m[连接中断] ${delaySec} 秒后尝试第 ${session.reconnectAttempts}/${maxAttempts} 次自动重连…\x1b[0m\r\n`,
  );

  session.reconnectTimer = window.setTimeout(() => {
    session.reconnectTimer = undefined;
    void performReconnect(session);
  }, delaySec * 1000);
}

export async function disconnectSession(id: string): Promise<void> {
  const session = state.sessions.get(id);
  if (!session) return;

  session.manualClose = true;
  cancelAutoReconnect(session);

  try {
    if (session.status !== "closed") {
      await api.disconnect(id);
    }
  } catch (error) {
    notify(String(error), true);
    return;
  }

  if (session.metricsTimer !== undefined) {
    window.clearInterval(session.metricsTimer);
  }
  session.terminal.dispose();
  session.element.remove();
  session.fileElement.remove();
  state.sessions.delete(id);
  state.cpuHistory.delete(id);
  state.networkHistory.delete(id);
  state.metricsSeries.delete(id);
  state.metricsPeaks.delete(id);

  if (state.activeId === id) {
    state.activeId = state.sessions.keys().next().value ?? null;
    if (state.activeId) {
      activateSession(state.activeId);
    }
  }
  if (!state.sessions.size) {
    $("#session-view").classList.add("hidden");
    $("#welcome").classList.remove("hidden");
    $("#metrics-content").innerHTML = '<p class="metrics-placeholder">连接后自动读取 Linux 系统资源</p>';
    setGlobalStatus("就绪");
  }
  renderTabs();
  onSessionsChange();
}

export function cycleSessionTab(direction: -1 | 1): void {
  const ids = [...state.sessions.keys()];
  if (ids.length < 2 || !state.activeId) return;
  const idx = ids.indexOf(state.activeId);
  const nextIdx = (idx + direction + ids.length) % ids.length;
  activateSession(ids[nextIdx]);
}

export function activateSessionByIndex(index: number): void {
  const ids = [...state.sessions.keys()];
  if (index >= 0 && index < ids.length) {
    activateSession(ids[index]);
  }
}

export async function initSessions(notifyConnectionsChanged: () => void): Promise<void> {
  onSessionsChange = notifyConnectionsChanged;

  document.querySelectorAll<HTMLButtonElement>("[data-session-mode]").forEach(btn =>
    btn.addEventListener("click", () => {
      setSessionMode(btn.dataset.sessionMode as SessionMode);
    }),
  );

  $("#tabbar").addEventListener("click", event => {
    const target = event.target as HTMLElement;
    const closeBtn = target.closest<HTMLButtonElement>("[data-close]");
    if (closeBtn) {
      void disconnectSession(closeBtn.dataset.close!);
      return;
    }
    const activateBtn = target.closest<HTMLButtonElement>("[data-activate]");
    if (activateBtn) {
      activateSession(activateBtn.dataset.activate!);
    }
  });

  $("#disconnect").addEventListener("click", () => {
    if (state.activeId) void disconnectSession(state.activeId);
  });

  $("#reconnect-btn").addEventListener("click", () => {
    const session = getActiveSession();
    if (!session) return;
    session.manualClose = false;
    session.reconnectAttempts = 0;
    cancelAutoReconnect(session);
    void performReconnect(session);
  });

  $("#reconnect-now").addEventListener("click", () => {
    const session = getActiveSession();
    if (!session) return;
    session.manualClose = false;
    cancelAutoReconnect(session);
    void performReconnect(session);
  });

  $("#reconnect-cancel").addEventListener("click", () => {
    const session = getActiveSession();
    if (!session) return;
    session.manualClose = true;
    cancelAutoReconnect(session);
    updateReconnectUI(session);
    notify("已停止自动重连");
  });

  new ResizeObserver(() => {
    const session = getActiveSession();
    if (session?.mode === "terminal" && session?.view === "terminal") {
      session.fit.fit();
    }
  }).observe($("#terminal-panel"));

  new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width ?? 0;
    const files = $("#files-panel");
    const workspace = $("#session-workspace");
    const session = getActiveSession();
    if (!session || session.kind === "local") return;

    const previousWidth = Number(workspace.dataset.width ?? 0);
    workspace.dataset.width = String(width);
    if (previousWidth === width) return;

    if (width < 820 && !files.classList.contains("hidden")) {
      files.dataset.autoHidden = "true";
      toggleFilesPanel();
    } else if (width >= 980 && files.dataset.autoHidden === "true") {
      delete files.dataset.autoHidden;
      toggleFilesPanel();
    }
  }).observe($("#session-workspace"));

  await onSessionEvent(payload => {
    const session = state.sessions.get(payload.session_id);
    if (!session) {
      if (payload.kind === "output") {
        const binary = atob(payload.data);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        const pending = state.pendingOutput.get(payload.session_id) ?? [];
        if (pending.length < 512) pending.push(bytes);
        state.pendingOutput.set(payload.session_id, pending);
      }
      return;
    }

    if (payload.kind === "output") {
      const binary = atob(payload.data);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      session.terminal.write(bytes);
      trackTerminalOutputForHistory(session, utf8Decoder.decode(bytes));
      return;
    }

    session.status = payload.status;
    if (payload.status === "connected" && session.kind === "ssh") {
      void loadDirectory(session.id, session.path);
      startMetrics(session);
    }
    if (payload.status === "closed") {
      if (session.metricsTimer !== undefined) {
        window.clearInterval(session.metricsTimer);
        session.metricsTimer = undefined;
      }
      if (!session.manualClose && session.kind === "ssh") {
        scheduleAutoReconnect(session);
      }
    }
    if (payload.message) notify(payload.message);
    if (state.activeId === session.id) {
      updateSessionBadge(payload.status);
      updateReconnectUI(session);
      setGlobalStatus(
        payload.status === "connected"
          ? "已连接"
          : payload.status === "closed"
            ? "会话已关闭"
            : "正在建立连接…",
      );
    }
    renderTabs();
    onSessionsChange();
  });

  await onSessionWarning(message => notify(message, true));

  void clearTerminal;
  void openTerminalSearch;
}
