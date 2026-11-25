import { api } from "../api.ts";
import { LANGUAGE_OPTIONS, onLanguageChange, setLanguage, t } from "../i18n/index.ts";
import { getActiveSession, persistWorkbenchState, state } from "../state.ts";
import { applyAppTheme, FONT_PRESETS, getFontLabel, getThemeLabel, TERMINAL_THEMES } from "../themes.ts";
import { $, escapeHtml, notify } from "../utils.ts";
import { syncSelectUI } from "./selects.ts";
import { syncLocalAdminToggle } from "./connections.ts";
import { fetchAndRenderMetrics, restartAllMetricsTimers } from "./metrics.ts";
import { applySettingsToAllTerminals } from "./terminalTools.ts";
import { openUpdaterDialog } from "./updater.ts";

let themeBeforeOpen = "";
let languageBeforeOpen = "";

function populateSettingsSelects(): void {
  const s = state.workbench.settings;

  const langSelect = $<HTMLSelectElement>("#setting-language");
  const currentLang = langSelect.value || s.language || "zh-CN";
  langSelect.innerHTML = LANGUAGE_OPTIONS.map(
    item => `<option value="${item.id}">${escapeHtml(item.label)}</option>`,
  ).join("");
  langSelect.value = currentLang;

  const fontSelect = $<HTMLSelectElement>("#setting-font-family");
  const currentFont = fontSelect.value || s.font_family;
  fontSelect.innerHTML = FONT_PRESETS.map(
    item => `<option value='${escapeHtml(item.value)}'>${escapeHtml(getFontLabel(item))}</option>`,
  ).join("");
  fontSelect.value = FONT_PRESETS.some(item => item.value === currentFont)
    ? currentFont
    : FONT_PRESETS[0].value;

  const themeSelect = $<HTMLSelectElement>("#setting-theme");
  const currentTheme = themeSelect.value || s.theme;
  themeSelect.innerHTML = TERMINAL_THEMES.map(
    item => `<option value="${item.id}">${escapeHtml(getThemeLabel(item))}</option>`,
  ).join("");
  themeSelect.value = currentTheme;

  const closeActionSelect = $<HTMLSelectElement>("#setting-close-action");
  const currentCloseAction = closeActionSelect.value || s.close_action || "ask";
  closeActionSelect.innerHTML = [
    { value: "ask", label: t("settings.closeAsk") },
    { value: "tray", label: t("settings.closeTray") },
    { value: "exit", label: t("settings.closeExit") },
  ]
    .map(item => `<option value="${item.value}">${escapeHtml(item.label)}</option>`)
    .join("");
  closeActionSelect.value = ["ask", "tray", "exit"].includes(currentCloseAction)
    ? currentCloseAction
    : "ask";

  const localPrivilegeSelect = $<HTMLSelectElement>("#setting-local-privilege");
  if (state.isElevated) {
    localPrivilegeSelect.innerHTML = `<option value="inherited">${escapeHtml(t("settings.privInherited"))}</option>`;
    localPrivilegeSelect.value = "inherited";
    localPrivilegeSelect.disabled = true;
  } else {
    localPrivilegeSelect.disabled = false;
    const currentPrivilege = localPrivilegeSelect.value || s.local_shell_privilege || "ask";
    localPrivilegeSelect.innerHTML = [
      { value: "ask", label: t("settings.privAsk") },
      { value: "standard", label: t("settings.privStandard") },
      { value: "admin", label: t("settings.privAdmin") },
    ]
      .map(item => `<option value="${item.value}">${escapeHtml(item.label)}</option>`)
      .join("");
    localPrivilegeSelect.value = ["ask", "standard", "admin"].includes(currentPrivilege)
      ? currentPrivilege
      : "ask";
  }
  syncSelectUI(localPrivilegeSelect);
}

export function openSettingsDialog(): void {
  const s = state.workbench.settings;
  themeBeforeOpen = s.theme;
  languageBeforeOpen = s.language;

  $<HTMLSelectElement>("#setting-language").value = "";
  $<HTMLSelectElement>("#setting-font-family").value = "";
  $<HTMLSelectElement>("#setting-theme").value = "";
  $<HTMLSelectElement>("#setting-close-action").value = "";
  $<HTMLSelectElement>("#setting-local-privilege").value = "";
  populateSettingsSelects();

  $<HTMLInputElement>("#setting-font-size").value = String(s.font_size);
  $<HTMLInputElement>("#setting-copy-on-select").checked = s.copy_on_select;
  $<HTMLInputElement>("#setting-right-click-paste").checked = s.right_click_paste;
  $<HTMLInputElement>("#setting-auto-reconnect").checked = s.auto_reconnect;
  $<HTMLInputElement>("#setting-reconnect-max").value = String(s.reconnect_max_attempts);
  $<HTMLInputElement>("#setting-connect-timeout").value = String(s.connect_timeout_secs);
  $<HTMLInputElement>("#setting-edit-backup").checked = s.create_backup_on_edit;
  $<HTMLInputElement>("#setting-transfer-checksum").checked = s.verify_transfer_checksum;
  $<HTMLInputElement>("#setting-auto-updates").checked = s.auto_check_updates ?? true;

  $<HTMLDialogElement>("#settings-dialog").showModal();
}

export function openMetricsSettingsDialog(): void {
  const s = state.workbench.settings;
  $<HTMLSelectElement>("#setting-metrics-interval").value = String(s.metrics_interval_secs);
  $<HTMLSelectElement>("#setting-metrics-processes").value = String(s.metrics_process_limit);
  $<HTMLInputElement>("#setting-metrics-warn").value = String(s.metrics_warn_percent);
  $<HTMLInputElement>("#setting-metrics-danger").value = String(s.metrics_danger_percent);

  $<HTMLInputElement>("#setting-vis-cpu").checked = s.metrics_visible.cpu;
  $<HTMLInputElement>("#setting-vis-memory").checked = s.metrics_visible.memory;
  $<HTMLInputElement>("#setting-vis-swap").checked = s.metrics_visible.swap;
  $<HTMLInputElement>("#setting-vis-network").checked = s.metrics_visible.network;
  $<HTMLInputElement>("#setting-vis-disk").checked = s.metrics_visible.disk;
  $<HTMLInputElement>("#setting-vis-processes").checked = s.metrics_visible.processes;
  $<HTMLInputElement>("#setting-vis-mounts").checked = s.metrics_visible.mounts;

  $<HTMLDialogElement>("#metrics-settings-dialog").showModal();
}

export function adjustTerminalFontSize(delta: number): void {
  const next = Math.max(11, Math.min(24, state.workbench.settings.font_size + delta));
  if (next === state.workbench.settings.font_size) return;
  state.workbench.settings.font_size = next;
  applySettingsToAllTerminals();
  void persistWorkbenchState();
  notify(t("term.fontSizeToast", { size: next }));
}

export function initSettingsUI(): void {
  $("#open-settings").addEventListener("click", openSettingsDialog);
  $("#settings-check-update-btn").addEventListener("click", () => openUpdaterDialog(true));

  const dialog = $<HTMLDialogElement>("#settings-dialog");
  const metricsDialog = $<HTMLDialogElement>("#metrics-settings-dialog");
  const themeSelect = $<HTMLSelectElement>("#setting-theme");
  const languageSelect = $<HTMLSelectElement>("#setting-language");

  themeSelect.addEventListener("change", () => {
    applyAppTheme(themeSelect.value);
  });

  languageSelect.addEventListener("change", () => {
    setLanguage(languageSelect.value, true);
  });

  onLanguageChange(() => {
    if (dialog.open) {
      populateSettingsSelects();
    }
  });

  dialog.addEventListener("close", () => {
    if (themeBeforeOpen && themeBeforeOpen !== state.workbench.settings.theme) {
      applyAppTheme(state.workbench.settings.theme);
    }
    if (languageBeforeOpen && languageBeforeOpen !== state.workbench.settings.language) {
      setLanguage(state.workbench.settings.language, true);
    }
  });

  $("#settings-form").addEventListener("submit", event => {
    event.preventDefault();
    const nextLang = setLanguage(languageSelect.value, false);

    const localPrivValue = state.isElevated
      ? state.workbench.settings.local_shell_privilege || "ask"
      : $<HTMLSelectElement>("#setting-local-privilege").value || "ask";

    state.workbench.settings = {
      ...state.workbench.settings,
      language: nextLang,
      close_action: $<HTMLSelectElement>("#setting-close-action").value || "ask",
      local_shell_privilege: localPrivValue,
      font_family: $<HTMLSelectElement>("#setting-font-family").value,
      font_size: Math.max(11, Math.min(24, Number($<HTMLInputElement>("#setting-font-size").value) || 14)),
      theme: themeSelect.value,
      copy_on_select: $<HTMLInputElement>("#setting-copy-on-select").checked,
      right_click_paste: $<HTMLInputElement>("#setting-right-click-paste").checked,
      auto_reconnect: $<HTMLInputElement>("#setting-auto-reconnect").checked,
      reconnect_max_attempts: Math.max(1, Math.min(10, Number($<HTMLInputElement>("#setting-reconnect-max").value) || 3)),
      connect_timeout_secs: Math.max(3, Math.min(120, Number($<HTMLInputElement>("#setting-connect-timeout").value) || 15)),
      create_backup_on_edit: $<HTMLInputElement>("#setting-edit-backup").checked,
      verify_transfer_checksum: $<HTMLInputElement>("#setting-transfer-checksum").checked,
      auto_check_updates: $<HTMLInputElement>("#setting-auto-updates").checked,
    };

    themeBeforeOpen = state.workbench.settings.theme;
    languageBeforeOpen = nextLang;
    setLanguage(nextLang, true);
    void api.syncTrayLanguage(nextLang).catch(() => undefined);
    syncLocalAdminToggle();
    applySettingsToAllTerminals();
    void persistWorkbenchState();
    dialog.close();
    notify(t("settings.saved"));
  });

  $("#metrics-settings-form").addEventListener("submit", event => {
    event.preventDefault();
    const warn = Math.max(40, Math.min(95, Number($<HTMLInputElement>("#setting-metrics-warn").value) || 75));
    const danger = Math.max(warn + 1, Math.min(99, Number($<HTMLInputElement>("#setting-metrics-danger").value) || 90));

    state.workbench.settings = {
      ...state.workbench.settings,
      metrics_interval_secs: Math.max(1, Math.min(60, Number($<HTMLSelectElement>("#setting-metrics-interval").value) || 2)),
      metrics_process_limit: Math.max(1, Math.min(12, Number($<HTMLSelectElement>("#setting-metrics-processes").value) || 6)),
      metrics_warn_percent: warn,
      metrics_danger_percent: danger,
      metrics_visible: {
        cpu: $<HTMLInputElement>("#setting-vis-cpu").checked,
        memory: $<HTMLInputElement>("#setting-vis-memory").checked,
        swap: $<HTMLInputElement>("#setting-vis-swap").checked,
        network: $<HTMLInputElement>("#setting-vis-network").checked,
        disk: $<HTMLInputElement>("#setting-vis-disk").checked,
        processes: $<HTMLInputElement>("#setting-vis-processes").checked,
        mounts: $<HTMLInputElement>("#setting-vis-mounts").checked,
      },
    };

    restartAllMetricsTimers();
    void persistWorkbenchState();
    metricsDialog.close();
    notify(t("metricsSet.saved"));
  });

  $("#metrics-expand-all-btn").addEventListener("click", () => {
    state.workbench.settings.metrics_collapsed = [];
    void persistWorkbenchState();
    const active = getActiveSession();
    if (active && active.kind === "ssh" && active.status === "connected") {
      void fetchAndRenderMetrics(active);
    }
    notify(t("metricsSet.expandedAll"));
  });
}
