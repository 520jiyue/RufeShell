import "@xterm/xterm/css/xterm.css";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/session.css";
import "./styles/dialogs.css";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, friendlyError, onCloseRequested } from "./api.ts";
import { getLanguage, onLanguageChange, t } from "./i18n/index.ts";
import { icon } from "./icons.ts";
import { flushWorkbenchState, getActiveSession, loadWorkbenchState, state } from "./state.ts";
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
import { initUpdaterUI } from "./ui/updater.ts";

function openCloseConfirmDialog(): void {
  const dialog = $<HTMLDialogElement>("#close-confirm-dialog");
  if (dialog.open) return;
  $<HTMLInputElement>("#close-confirm-remember").checked = false;
  dialog.showModal();
}

async function executeCloseAction(
  action: "tray" | "exit",
  remember: boolean,
  win?: ReturnType<typeof getCurrentWindow>,
): Promise<void> {
  if (remember) {
    state.workbench.settings.close_action = action;
    await flushWorkbenchState();
  }
  const dialog = $<HTMLDialogElement>("#close-confirm-dialog");
  if (dialog.open) dialog.close();

  if (action === "tray") {
    try {
      await api.hideToTray();
    } catch {
      await win?.minimize().catch(() => undefined);
      notify(t("closeDialog.minimizedToast"));
    }
    return;
  }

  try {
    await api.exitApp();
  } catch {
    await win?.close().catch(() => undefined);
  }
}

function initWindowControls(): void {
  const maxBtn = $<HTMLButtonElement>("#win-maximize");
  let appWindow: ReturnType<typeof getCurrentWindow> | undefined;

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
    appWindow = win;
    void syncMaxIcon(win);

    $("#win-minimize").addEventListener("click", () => {
      void win.minimize().catch(() => undefined);
    });
    maxBtn.addEventListener("click", () => {
      void win.toggleMaximize().then(() => syncMaxIcon(win)).catch(() => undefined);
    });
    $("#titlebar-drag-spacer").addEventListener("dblclick", () => {
      void win.toggleMaximize().then(() => syncMaxIcon(win)).catch(() => undefined);
    });
    void onCloseRequested(() => openCloseConfirmDialog()).catch(() => undefined);
  } catch {
    // Non-Tauri browser preview
  }

  $("#win-close").addEventListener("click", () => {
    const mode = state.workbench.settings.close_action;
    if (mode === "tray" || mode === "exit") {
      void executeCloseAction(mode, false, appWindow);
      return;
    }
    openCloseConfirmDialog();
  });

  $("#close-action-tray").addEventListener("click", () => {
    const remember = $<HTMLInputElement>("#close-confirm-remember").checked;
    void executeCloseAction("tray", remember, appWindow);
  });

  $("#close-action-exit").addEventListener("click", () => {
    const remember = $<HTMLInputElement>("#close-confirm-remember").checked;
    void executeCloseAction("exit", remember, appWindow);
  });
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
    $("#relaunch-admin-desc").textContent =
      activeCount > 0
        ? t("titlebar.adminRelaunchDesc", { count: activeCount })
        : t("titlebar.adminRelaunchZeroDesc");
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
void api.syncTrayLanguage(getLanguage()).catch(() => undefined);
onLanguageChange(() => void api.syncTrayLanguage(getLanguage()).catch(() => undefined));

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
initUpdaterUI();

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
