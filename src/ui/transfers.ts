import { api, friendlyError, onTransferEvent } from "../api.ts";
import { onLanguageChange, t } from "../i18n/index.ts";
import { icon } from "../icons.ts";
import { state } from "../state.ts";
import type {
  ConflictPolicy,
  Session,
  TransferConflict,
  TransferDirection,
  TransferTask,
} from "../types.ts";
import { $, escapeHtml, formatBytes, notify } from "../utils.ts";

let conflictResolver: ((policy: ConflictPolicy | null) => void) | null = null;
const completionWaiters = new Map<string, () => void>();
let onAnyTransferDone: (sessionId: string) => void = () => {};

export function setTransferCompleteCallback(handler: (sessionId: string) => void): void {
  onAnyTransferDone = handler;
}

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return t("transfers.etaSec", { sec: seconds });
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return t("transfers.etaMinSec", { min: mins, sec: secs });
}

function statusLabel(task: TransferTask): string {
  switch (task.status) {
    case "queued":
      return t("transfers.queued");
    case "running":
      return task.speed_bps > 0 ? `${formatBytes(task.speed_bps)}/s` : t("transfers.running");
    case "paused":
      return t("transfers.paused");
    case "completed":
      return t("transfers.completed");
    case "failed":
      return t("transfers.failed");
    case "cancelled":
      return t("transfers.cancelled");
  }
}

export function updateTransferStatusPill(): void {
  const pill = $("#transfer-status-pill");
  const list = [...state.transfers.values()];
  const active = list.filter(t => t.status === "running" || t.status === "queued");
  const paused = list.filter(t => t.status === "paused");
  const failed = list.filter(t => t.status === "failed");

  if (active.length > 0) {
    const speed = active.reduce((sum, item) => sum + item.speed_bps, 0);
    pill.textContent = t("transfers.pillActive", { count: active.length, speed: formatBytes(speed) });
    pill.classList.add("is-active");
  } else if (paused.length > 0) {
    pill.textContent = t("transfers.pillPaused", { count: paused.length });
    pill.classList.remove("is-active");
  } else if (failed.length > 0) {
    pill.textContent = t("transfers.pillFailed", { count: failed.length });
    pill.classList.remove("is-active");
  } else if (list.length > 0) {
    pill.textContent = t("transfers.pillCount", { count: list.length });
    pill.classList.remove("is-active");
  } else {
    pill.textContent = t("transfers.pillIdle");
    pill.classList.remove("is-active");
  }
}

export function renderTransferList(): void {
  const container = $("#transfer-list");
  const list = [...state.transfers.values()];
  if (!list.length) {
    container.innerHTML = `<div class="empty-drawer">${t("transfers.empty")}</div>`;
    return;
  }

  container.innerHTML = list
    .map(task => {
      const percent =
        task.total_bytes > 0
          ? Math.min(100, Math.round((task.transferred_bytes / task.total_bytes) * 100))
          : task.status === "completed"
            ? 100
            : 0;
      const dirBadge =
        task.direction === "upload"
          ? `<span class="transfer-dir upload">${escapeHtml(t("transfers.dirUp"))}</span>`
          : `<span class="transfer-dir download">${escapeHtml(t("transfers.dirDown"))}</span>`;
      const checksumHtml = task.checksum_detail
        ? `<span class="transfer-checksum ${task.checksum_verified === false ? "is-bad" : task.checksum_verified === true ? "is-ok" : ""}">${escapeHtml(task.checksum_detail)}</span>`
        : "";
      const actions: string[] = [];
      if (task.status === "running" || task.status === "queued") {
        actions.push(
          `<button type="button" class="icon-button" data-tx-pause="${task.id}" title="${escapeHtml(t("common.pause"))}">${icon("pause")}</button>`,
          `<button type="button" class="icon-button" data-tx-cancel="${task.id}" title="${escapeHtml(t("common.cancel"))}">${icon("x")}</button>`,
        );
      } else if (task.status === "paused" || task.status === "failed") {
        actions.push(
          `<button type="button" class="icon-button accent-subtle" data-tx-resume="${task.id}" title="${escapeHtml(t(task.status === "paused" ? "common.resume" : "transfers.retryTitle"))}">${icon("play")}</button>`,
          `<button type="button" class="icon-button" data-tx-cancel="${task.id}" title="${escapeHtml(t("common.cancel"))}">${icon("x")}</button>`,
        );
      }

      return `
        <article class="transfer-row is-${task.status}">
          <div class="transfer-row-head">
            <div class="transfer-title">
              ${dirBadge}
              <strong title="${escapeHtml(task.file_name)}">${escapeHtml(task.file_name)}</strong>
              <span class="transfer-state-pill">${statusLabel(task)}</span>
            </div>
            <div class="transfer-actions">${actions.join("")}</div>
          </div>
          <div class="transfer-paths">
            <span title="${escapeHtml(task.local_path)}">${escapeHtml(task.local_path)}</span>
            <span>→</span>
            <span title="${escapeHtml(task.remote_path)}">${escapeHtml(task.remote_path)}</span>
          </div>
          <div class="transfer-progress-track"><span style="width:${percent}%"></span></div>
          <div class="transfer-meta">
            <span>${formatBytes(task.transferred_bytes)} / ${formatBytes(task.total_bytes)} (${percent}%)</span>
            <span>${escapeHtml(t("transfers.eta", { eta: formatEta(task.eta_seconds) }))}</span>
            ${checksumHtml}
          </div>
          ${task.error ? `<div class="transfer-error">${escapeHtml(task.error)}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

export function openTransferDialog(): void {
  renderTransferList();
  $<HTMLDialogElement>("#transfer-dialog").showModal();
}

function askConflictPolicy(conflicts: TransferConflict[]): Promise<ConflictPolicy | null> {
  const hasPartial = conflicts.some(item => item.part_bytes > 0);
  const body = $("#conflict-list");
  body.innerHTML = conflicts
    .map(item => {
      const partialNote =
        item.part_bytes > 0
          ? `<span class="conflict-part">${escapeHtml(t("conflict.partial", { size: formatBytes(item.part_bytes) }))}</span>`
          : "";
      return `
        <div class="conflict-row">
          <strong>${escapeHtml(item.file_name)}</strong>
          <div class="conflict-meta">
            <span>${escapeHtml(t("conflict.source", { size: formatBytes(item.source_size) }))}</span>
            <span>${escapeHtml(t("conflict.target", { size: item.target_size > 0 ? formatBytes(item.target_size) : t("conflict.onlyPart") }))}</span>
            ${partialNote}
          </div>
        </div>
      `;
    })
    .join("");

  $("#conflict-resume-btn").classList.toggle("hidden", !hasPartial);
  const dialog = $<HTMLDialogElement>("#conflict-dialog");
  dialog.showModal();

  return new Promise(resolve => {
    conflictResolver = policy => {
      conflictResolver = null;
      if (dialog.open) dialog.close();
      resolve(policy);
    };
  });
}

function waitForTaskCompletion(taskId: string): Promise<void> {
  const existing = state.transfers.get(taskId);
  if (
    existing &&
    ["completed", "failed", "cancelled"].includes(existing.status)
  ) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    completionWaiters.set(taskId, resolve);
  });
}

export async function startFileUploads(
  session: Session,
  localPaths: string[],
  remoteDirectory: string,
): Promise<void> {
  const pairs: [string, string][] = [];
  for (const localPath of localPaths) {
    const name = localPath.split(/[\\/]/).pop();
    if (!name) continue;
    const remotePath = `${remoteDirectory.replace(/\/$/, "")}/${name}`;
    pairs.push([localPath, remotePath]);
  }
  if (!pairs.length) return;

  let policy: ConflictPolicy = "overwrite";
  try {
    const conflicts = await api.inspectTransferConflicts(session.id, "upload", pairs);
    if (conflicts.length > 0) {
      const chosen = await askConflictPolicy(conflicts);
      if (!chosen) return;
      policy = chosen;
    }
  } catch (error) {
    notify(friendlyError(error), true);
    return;
  }

  const waiterIds: string[] = [];
  for (const [localPath, remotePath] of pairs) {
    try {
      const task = await api.enqueueTransfer({
        sessionId: session.id,
        direction: "upload",
        localPath,
        remotePath,
        conflictPolicy: policy,
      });
      state.transfers.set(task.id, task);
      waiterIds.push(task.id);
    } catch (error) {
      notify(friendlyError(error), true);
    }
  }
  updateTransferStatusPill();
  await Promise.all(waiterIds.map(waitForTaskCompletion));
}

export async function startFileDownload(
  session: Session,
  remotePath: string,
  localPath: string,
): Promise<void> {
  let policy: ConflictPolicy = "overwrite";
  try {
    const conflicts = await api.inspectTransferConflicts(session.id, "download", [
      [localPath, remotePath],
    ]);
    if (conflicts.length > 0) {
      const chosen = await askConflictPolicy(conflicts);
      if (!chosen) return;
      policy = chosen;
    }
  } catch (error) {
    notify(friendlyError(error), true);
    return;
  }

  try {
    const task = await api.enqueueTransfer({
      sessionId: session.id,
      direction: "download",
      localPath,
      remotePath,
      conflictPolicy: policy,
    });
    state.transfers.set(task.id, task);
    updateTransferStatusPill();
    notify(t("transfers.queuedDownload", { name: task.file_name }));
  } catch (error) {
    notify(friendlyError(error), true);
  }
}

export async function startDirectoryTransfer(
  session: Session,
  direction: TransferDirection,
  localDir: string,
  remoteDir: string,
): Promise<void> {
  try {
    const tasks = await api.enqueueDirectoryTransfer({
      sessionId: session.id,
      direction,
      localDir,
      remoteDir,
      conflictPolicy: "rename",
    });
    for (const task of tasks) {
      state.transfers.set(task.id, task);
    }
    updateTransferStatusPill();
    notify(
      tasks.length
        ? t("transfers.queuedDirFiles", { count: tasks.length })
        : t("transfers.queuedDirEmpty"),
    );
  } catch (error) {
    notify(friendlyError(error), true);
  }
}

export async function initTransfersUI(): Promise<void> {
  onLanguageChange(() => {
    updateTransferStatusPill();
    if ($<HTMLDialogElement>("#transfer-dialog").open) renderTransferList();
  });
  $("#transfer-status-pill").addEventListener("click", openTransferDialog);

  $("#transfer-clear-btn").addEventListener("click", async () => {
    const remaining = await api.clearFinishedTransfers();
    state.transfers.clear();
    for (const task of remaining) state.transfers.set(task.id, task);
    updateTransferStatusPill();
    renderTransferList();
  });

  $("#transfer-list").addEventListener("click", async event => {
    const target = event.target as HTMLElement;
    const pauseBtn = target.closest<HTMLButtonElement>("[data-tx-pause]");
    if (pauseBtn) {
      const updated = await api.pauseTransfer(pauseBtn.dataset.txPause!);
      state.transfers.set(updated.id, updated);
      updateTransferStatusPill();
      renderTransferList();
      return;
    }
    const resumeBtn = target.closest<HTMLButtonElement>("[data-tx-resume]");
    if (resumeBtn) {
      const updated = await api.resumeTransfer(resumeBtn.dataset.txResume!);
      state.transfers.set(updated.id, updated);
      updateTransferStatusPill();
      renderTransferList();
      return;
    }
    const cancelBtn = target.closest<HTMLButtonElement>("[data-tx-cancel]");
    if (cancelBtn) {
      const updated = await api.cancelTransfer(cancelBtn.dataset.txCancel!);
      state.transfers.set(updated.id, updated);
      updateTransferStatusPill();
      renderTransferList();
    }
  });

  $("#conflict-dialog").addEventListener("click", event => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-conflict-choice]");
    if (!btn || !conflictResolver) return;
    const choice = btn.dataset.conflictChoice!;
    conflictResolver(choice === "cancel" ? null : (choice as ConflictPolicy));
  });

  $("#conflict-dialog").addEventListener("close", () => {
    if (conflictResolver) conflictResolver(null);
  });

  try {
    const initial = await api.listTransfers();
    for (const task of initial) state.transfers.set(task.id, task);
    updateTransferStatusPill();
  } catch {
    // Ignore in preview mode
  }

  await onTransferEvent(task => {
    const prev = state.transfers.get(task.id);
    state.transfers.set(task.id, task);
    updateTransferStatusPill();

    const dialog = document.querySelector<HTMLDialogElement>("#transfer-dialog");
    if (dialog?.open) renderTransferList();

    if (
      ["completed", "failed", "cancelled"].includes(task.status) &&
      prev?.status !== task.status
    ) {
      const waiter = completionWaiters.get(task.id);
      if (waiter) {
        completionWaiters.delete(task.id);
        waiter();
      }
      if (task.status === "completed") {
        onAnyTransferDone(task.session_id);
      } else if (task.status === "failed" && task.error) {
        notify(`传输失败 (${task.file_name})：${task.error}`, true);
      }
    }
  });
}
