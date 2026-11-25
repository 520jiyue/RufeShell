import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { api, hasTauriRuntime } from "../api.ts";
import { onLanguageChange, t } from "../i18n/index.ts";
import { flushWorkbenchState, state } from "../state.ts";
import { $, escapeHtml, formatBytes, notify } from "../utils.ts";

type UpdaterPhase =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

let phase: UpdaterPhase = "idle";
let currentVersion = "1.3.2";
let pendingUpdate: Update | null = null;
let totalBytes: number | null = null;
let downloadedBytes = 0;
let lastError = "";

async function releasePendingUpdate(): Promise<void> {
  const prev = pendingUpdate;
  pendingUpdate = null;
  if (prev) {
    await prev.close().catch(() => undefined);
  }
}

export function getAppVersion(): string {
  return currentVersion;
}

export function syncUpdateStatusPill(): void {
  const pill = $<HTMLButtonElement>("#update-status-pill");
  const versionText = currentVersion;

  if (phase === "downloaded" && pendingUpdate) {
    pill.textContent = t("updater.pillReady", { version: pendingUpdate.version });
    pill.classList.add("has-update");
    return;
  }
  if ((phase === "available" || phase === "downloading") && pendingUpdate) {
    pill.textContent = t("updater.pillAvailable", { version: pendingUpdate.version });
    pill.classList.add("has-update");
    return;
  }

  pill.textContent = t("updater.pillIdle", { version: versionText });
  pill.classList.remove("has-update");
}

function renderUpdaterDialog(): void {
  const statusEl = $("#updater-status-box");
  const notesWrap = $("#updater-notes-wrap");
  const notesEl = $("#updater-notes");
  const progressWrap = $("#updater-progress-wrap");
  const progressBar = $("#updater-progress-bar");
  const progressText = $("#updater-progress-text");
  const warnEl = $("#updater-session-warn");

  const recheckBtn = $<HTMLButtonElement>("#updater-recheck-btn");
  const downloadBtn = $<HTMLButtonElement>("#updater-download-btn");
  const installBtn = $<HTMLButtonElement>("#updater-install-btn");

  $("#updater-current-ver").textContent = `v${currentVersion}`;
  $("#updater-latest-ver").textContent = pendingUpdate ? `v${pendingUpdate.version}` : `v${currentVersion}`;

  statusEl.className = "updater-status-box";
  notesWrap.classList.add("hidden");
  progressWrap.classList.add("hidden");
  warnEl.classList.add("hidden");

  recheckBtn.classList.add("hidden");
  downloadBtn.classList.add("hidden");
  installBtn.classList.add("hidden");
  recheckBtn.disabled = false;
  downloadBtn.disabled = false;
  installBtn.disabled = false;

  if (phase === "checking" || phase === "idle") {
    statusEl.classList.add("is-info");
    statusEl.textContent = t("updater.checking");
    return;
  }

  if (phase === "up_to_date") {
    statusEl.classList.add("is-ok");
    statusEl.textContent = t("updater.upToDate", { version: currentVersion });
    recheckBtn.classList.remove("hidden");
    return;
  }

  if (phase === "error") {
    statusEl.classList.add("is-error");
    statusEl.textContent = lastError;
    recheckBtn.classList.remove("hidden");
    if (pendingUpdate) {
      downloadBtn.classList.remove("hidden");
    }
    return;
  }

  if (pendingUpdate) {
    notesWrap.classList.remove("hidden");
    notesEl.textContent = pendingUpdate.body?.trim() || t("updater.notesEmpty");
  }

  if (phase === "available" && pendingUpdate) {
    statusEl.classList.add("is-accent");
    statusEl.innerHTML = `<strong>${escapeHtml(t("updater.availableTitle", { version: pendingUpdate.version }))}</strong><span>${escapeHtml(t("updater.availableDesc"))}</span>`;
    recheckBtn.classList.remove("hidden");
    downloadBtn.classList.remove("hidden");
    return;
  }

  if (phase === "downloading") {
    statusEl.classList.add("is-accent");
    statusEl.textContent = pendingUpdate
      ? t("updater.availableTitle", { version: pendingUpdate.version })
      : t("updater.checking");
    progressWrap.classList.remove("hidden");
    const pct =
      totalBytes && totalBytes > 0
        ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
        : 0;
    progressBar.style.width = totalBytes ? `${pct}%` : "35%";
    progressBar.classList.toggle("is-indeterminate", !totalBytes);
    progressText.textContent = totalBytes
      ? t("updater.downloading", {
          downloaded: formatBytes(downloadedBytes),
          total: formatBytes(totalBytes),
          pct,
        })
      : t("updater.progressUnknown", { downloaded: formatBytes(downloadedBytes) });
    return;
  }

  if (phase === "downloaded") {
    statusEl.classList.add("is-ok");
    statusEl.innerHTML = `<strong>${escapeHtml(t("updater.readyTitle"))}</strong><span>${escapeHtml(t("updater.readyDesc"))}</span>`;
    if (state.sessions.size > 0) {
      warnEl.classList.remove("hidden");
      warnEl.textContent = t("updater.activeSessionsWarn", { count: state.sessions.size });
    }
    installBtn.classList.remove("hidden");
    return;
  }

  if (phase === "installing") {
    statusEl.classList.add("is-accent");
    statusEl.textContent = t("updater.installing");
    progressWrap.classList.remove("hidden");
    progressBar.style.width = "100%";
    progressBar.classList.remove("is-indeterminate");
    progressText.textContent = t("updater.installing");
  }
}

export async function checkForUpdates(silent = false): Promise<void> {
  if (!hasTauriRuntime()) {
    if (!silent) {
      phase = "error";
      lastError = t("updater.previewUnsupported");
      renderUpdaterDialog();
    }
    return;
  }

  if (phase === "checking" || phase === "downloading" || phase === "installing") {
    return;
  }

  await releasePendingUpdate();
  downloadedBytes = 0;
  totalBytes = null;
  lastError = "";
  phase = "checking";
  if (!silent) renderUpdaterDialog();
  syncUpdateStatusPill();

  try {
    const update = await check({ timeout: 15000 });
    if (update) {
      currentVersion = update.currentVersion || currentVersion;
      pendingUpdate = update;
      phase = "available";
      syncUpdateStatusPill();
      if (silent) {
        notify(t("updater.toastAvailable", { version: update.version }));
      } else {
        renderUpdaterDialog();
      }
      return;
    }

    phase = "up_to_date";
    syncUpdateStatusPill();
    if (!silent) renderUpdaterDialog();
  } catch (error) {
    if (silent) {
      phase = "idle";
      syncUpdateStatusPill();
      return;
    }
    phase = "error";
    lastError = t("updater.checkFailed", { error: String(error) });
    syncUpdateStatusPill();
    renderUpdaterDialog();
  }
}

async function downloadPendingUpdate(): Promise<void> {
  if (!pendingUpdate || phase === "downloading" || phase === "installing") return;

  downloadedBytes = 0;
  totalBytes = null;
  phase = "downloading";
  syncUpdateStatusPill();
  renderUpdaterDialog();

  try {
    await pendingUpdate.download(event => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength ?? null;
        downloadedBytes = 0;
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
      } else if (event.event === "Finished") {
        if (totalBytes) downloadedBytes = totalBytes;
      }
      renderUpdaterDialog();
    });

    phase = "downloaded";
    syncUpdateStatusPill();
    renderUpdaterDialog();
  } catch (error) {
    phase = "error";
    lastError = t("updater.downloadFailed", { error: String(error) });
    syncUpdateStatusPill();
    renderUpdaterDialog();
  }
}

async function installAndRestart(): Promise<void> {
  if (!pendingUpdate || phase !== "downloaded") return;

  phase = "installing";
  renderUpdaterDialog();

  try {
    await flushWorkbenchState();
    await pendingUpdate.install({ restartAfterInstall: true });
    await relaunch().catch(() => undefined);
  } catch (error) {
    phase = "error";
    lastError = t("updater.installFailed", { error: String(error) });
    syncUpdateStatusPill();
    renderUpdaterDialog();
  }
}

export function openUpdaterDialog(autoCheckIfIdle = true): void {
  const dialog = $<HTMLDialogElement>("#update-dialog");
  renderUpdaterDialog();
  if (!dialog.open) {
    dialog.showModal();
  }
  if (autoCheckIfIdle && (phase === "idle" || phase === "up_to_date" || phase === "error")) {
    void checkForUpdates(false);
  }
}

export function initUpdaterUI(): void {
  if (hasTauriRuntime()) {
    void api
      .appVersion()
      .then(ver => {
        if (ver) currentVersion = ver;
        syncUpdateStatusPill();
      })
      .catch(() => undefined);
  }

  syncUpdateStatusPill();

  onLanguageChange(() => {
    syncUpdateStatusPill();
    if ($<HTMLDialogElement>("#update-dialog").open) {
      renderUpdaterDialog();
    }
  });

  $("#update-status-pill").addEventListener("click", () => openUpdaterDialog(true));
  $("#updater-recheck-btn").addEventListener("click", () => void checkForUpdates(false));
  $("#updater-download-btn").addEventListener("click", () => void downloadPendingUpdate());
  $("#updater-install-btn").addEventListener("click", () => void installAndRestart());

  if (state.workbench.settings.auto_check_updates && hasTauriRuntime()) {
    window.setTimeout(() => {
      if (phase === "idle") {
        void checkForUpdates(true);
      }
    }, 2500);
  }
}
