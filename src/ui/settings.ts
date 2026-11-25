import { getActiveSession, persistWorkbenchState, state } from "../state.ts";
import { applyAppTheme, FONT_PRESETS, TERMINAL_THEMES } from "../themes.ts";
import { $, escapeHtml, notify } from "../utils.ts";
import { fetchAndRenderMetrics, restartAllMetricsTimers } from "./metrics.ts";
import { applySettingsToAllTerminals } from "./terminalTools.ts";

let themeBeforeOpen = "";

export function openSettingsDialog(): void {
  const s = state.workbench.settings;
  themeBeforeOpen = s.theme;

  const fontSelect = $<HTMLSelectElement>("#setting-font-family");
  fontSelect.innerHTML = FONT_PRESETS.map(
    item => `<option value='${escapeHtml(item.value)}'>${escapeHtml(item.label)}</option>`,
  ).join("");
  fontSelect.value = FONT_PRESETS.some(item => item.value === s.font_family)
    ? s.font_family
    : FONT_PRESETS[0].value;

  const themeSelect = $<HTMLSelectElement>("#setting-theme");
  themeSelect.innerHTML = TERMINAL_THEMES.map(
    item => `<option value="${item.id}">${escapeHtml(item.label)}</option>`,
  ).join("");
  themeSelect.value = s.theme;

  $<HTMLInputElement>("#setting-font-size").value = String(s.font_size);
  $<HTMLInputElement>("#setting-copy-on-select").checked = s.copy_on_select;
  $<HTMLInputElement>("#setting-right-click-paste").checked = s.right_click_paste;
  $<HTMLInputElement>("#setting-auto-reconnect").checked = s.auto_reconnect;
  $<HTMLInputElement>("#setting-reconnect-max").value = String(s.reconnect_max_attempts);
  $<HTMLInputElement>("#setting-connect-timeout").value = String(s.connect_timeout_secs);
  $<HTMLInputElement>("#setting-edit-backup").checked = s.create_backup_on_edit;
  $<HTMLInputElement>("#setting-transfer-checksum").checked = s.verify_transfer_checksum;

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
  notify(`终端字号：${next}px`);
}

export function initSettingsUI(): void {
  $("#open-settings").addEventListener("click", openSettingsDialog);

  const dialog = $<HTMLDialogElement>("#settings-dialog");
  const metricsDialog = $<HTMLDialogElement>("#metrics-settings-dialog");
  const themeSelect = $<HTMLSelectElement>("#setting-theme");

  themeSelect.addEventListener("change", () => {
    applyAppTheme(themeSelect.value);
  });

  dialog.addEventListener("close", () => {
    if (themeBeforeOpen && themeBeforeOpen !== state.workbench.settings.theme) {
      applyAppTheme(state.workbench.settings.theme);
    }
  });

  $("#settings-form").addEventListener("submit", event => {
    event.preventDefault();

    state.workbench.settings = {
      ...state.workbench.settings,
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
    };

    themeBeforeOpen = state.workbench.settings.theme;
    applySettingsToAllTerminals();
    void persistWorkbenchState();
    dialog.close();
    notify("工作台与终端设置已保存");
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
    notify("主机遥测显示设置已保存");
  });

  $("#metrics-expand-all-btn").addEventListener("click", () => {
    state.workbench.settings.metrics_collapsed = [];
    void persistWorkbenchState();
    const active = getActiveSession();
    if (active && active.kind === "ssh" && active.status === "connected") {
      void fetchAndRenderMetrics(active);
    }
    notify("已展开全部遥测分组");
  });
}
