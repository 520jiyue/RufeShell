import "@xterm/xterm/css/xterm.css";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/session.css";
import "./styles/dialogs.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, friendlyError } from "./api.ts";
import { onLanguageChange, t } from "./i18n/index.ts";
import { icon } from "./icons.ts";
import { getActiveSession, loadWorkbenchState, state } from "./state.ts";
import { $, notify } from "./utils.ts";
import { mountShell } from "./ui/shell.ts";
import { initDialogs, openConnectionDialog } from "./ui/dialogs.ts";
import { initMetricsPanel, setMetricsCustomizeHandler } from "./ui/metrics.ts";
import { initFilesPanel, loadDirectory, setDualPaneOpenHandler, toggleFilesPanel } from "./ui/files.ts";
import { initTransfersUI, setTransferCompleteCallback } from "./ui/transfers.ts";
import { initDualFilesUI } from "./ui/dualFiles.ts";
import { initOpsUI } from "./ui/ops.ts";
import {
  activateSessionByIndex,
  createSession,
  cycleSessionTab,
  disconnectSession,
  initSessions,
  setSessionMode,
} from "./ui/sessions.ts";
import {
  initConnections,
  loadConnections,
  renderConnections,
  syncLocalAdminToggle,
  toggleSidebar,
} from "./ui/connections.ts";
import { initHistoryUI, openHistoryDialog, setHistorySendHandler } from "./ui/history.ts";
import {
  handleSnippetShortcut,
  initSnippetsUI,
  openSnippetsDialog,
  setSnippetSendHandler,
} from "./ui/snippets.ts";
import {
  clearTerminal,
  initTerminalTools,
  openTerminalSearch,
  sendCommandToSession,
} from "./ui/terminalTools.ts";
import { initSettingsUI, openMetricsSettingsDialog, openSettingsDialog } from "./ui/settings.ts";
import { initCustomSelects } from "./ui/selects.ts";
import { initShortcuts, openShortcutsDialog } from "./ui/shortcuts.ts";

function initWindowControls(): void {
  const maxBtn = $<HTMLButtonElement>("#win-maximize");

  const syncMaxIcon = async (win: ReturnType<typeof getCurrentWindow>) => {
    try {
      const maximized = await win.isMaximized();
      maxBtn.innerHTML = icon(maximized ? "winRestore" : "winMax");
      maxBtn.title = t(maximized ? "titlebar.restore" : "titlebar.maximize");
    } catch {
      // Ignore in non-Tauri preview
    }
  };

  try {
    const win = getCurrentWindow();
    void syncMaxIcon(win);

    $("#win-minimize").addEventListener("click", () => {
      void win.minimize().catch(() => undefined);
    });
    maxBtn.addEventListener("click", () => {
      void win.toggleMaximize().then(() => syncMaxIcon(win)).catch(() => undefined);
    });
    $("#win-close").addEventListener("click", () => {
      void win.close().catch(() => undefined);
    });
    $("#titlebar-drag-spacer").addEventListener("dblclick", () => {
      void win.toggleMaximize().then(() => syncMaxIcon(win)).catch(() => undefined);
    });
  } catch {
    // Non-Tauri browser preview
  }
}

function syncAdminLaunchButton(): void {
  const btn = $<HTMLButtonElement>("#admin-launch-btn");
  const label = $<HTMLSpanElement>("#admin-launch-label");
  btn.classList.toggle("is-elevated", state.isElevated);
  label.textContent = t(state.isElevated ? "titlebar.adminActive" : "titlebar.adminLaunch");
  btn.title = t(state.isElevated ? "titlebar.adminActiveTitle" : "titlebar.adminLaunchTitle");
}

function triggerAdminRelaunch(): void {
  void api.relaunchAsAdmin().catch(error => notify(friendlyError(error), true));
}

function initAdminLaunchControls(): void {
  syncAdminLaunchButton();
  onLanguageChange(syncAdminLaunchButton);

  void api
    .isElevated()
    .then(elevated => {
      state.isElevated = elevated;
      syncAdminLaunchButton();
      syncLocalAdminToggle();
    })
    .catch(() => undefined);

  $("#admin-launch-btn").addEventListener("click", () => {
    if (state.isElevated) {
      notify(t("titlebar.adminAlreadyNotify"));
      return;
    }
    const activeCount = state.sessions.size;
    if (activeCount === 0) {
      triggerAdminRelaunch();
      return;
    }
    $("#relaunch-admin-desc").textContent = t("titlebar.adminRelaunchDesc", { count: activeCount });
    $<HTMLDialogElement>("#relaunch-admin-dialog").showModal();
  });

  $("#confirm-relaunch-admin-btn").addEventListener("click", () => {
    $<HTMLDialogElement>("#relaunch-admin-dialog").close();
    triggerAdminRelaunch();
  });
}

mountShell();
initCustomSelects();
initWindowControls();
initAdminLaunchControls();
await loadWorkbenchState();

initDialogs({
  onConnectionSaved: renderConnections,
  onSessionConnected: (sessionId, profile) => createSession(sessionId, profile),
});

setHistorySendHandler(sendCommandToSession);
setSnippetSendHandler(sendCommandToSession);
setMetricsCustomizeHandler(openMetricsSettingsDialog);
setDualPaneOpenHandler(() => setSessionMode("dual"));
setTransferCompleteCallback(sessionId => {
  const session = state.sessions.get(sessionId);
  if (session && session.kind === "ssh") {
    void loadDirectory(sessionId, session.path);
  }
});

initConnections();
initMetricsPanel();
await initFilesPanel();
await initTransfersUI();
initDualFilesUI();
initOpsUI();
await initSessions(renderConnections);
initHistoryUI();
initSnippetsUI();
initTerminalTools();
initSettingsUI();

$("#welcome-shortcuts").addEventListener("click", openShortcutsDialog);
$("#quick-history-open").addEventListener("click", openHistoryDialog);
$("#quick-snippets-open").addEventListener("click", openSnippetsDialog);

initShortcuts({
  newConnection: () => openConnectionDialog(),
  closeActiveTab: () => {
    if (state.activeId) void disconnectSession(state.activeId);
  },
  cycleTab: cycleSessionTab,
  activateTabIndex: activateSessionByIndex,
  toggleSidebar,
  toggleFiles: toggleFilesPanel,
  toggleMetrics: () => $("#toggle-metrics").click(),
  openHistory: openHistoryDialog,
  openSnippets: openSnippetsDialog,
  openSearch: openTerminalSearch,
  clearTerminal: () => {
    const session = getActiveSession();
    if (session) clearTerminal(session);
  },
  openSettings: openSettingsDialog,
  handleSnippetShortcut,
});

try {
  await loadConnections();
} catch (error) {
  notify(String(error), true);
}
