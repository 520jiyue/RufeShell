import { api, friendlyError, onTransferEvent } from "../api.ts";
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
  if (seconds < 60) return `${seconds} 秒`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins} 分 ${secs} 秒`;
}

function statusLabel(task: TransferTask): string {
  switch (task.status) {
    case "queued":
      return "排队中";
    case "running":
      return task.speed_bps > 0 ? `${formatBytes(task.speed_bps)}/s` : "传输中";
    case "paused":
      return "已暂停";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
}

export function updateTransferStatusPill(): void {
  const pill = $("#transfer-status-pill");
  const list = [...state.transfers.values()];
  const active = list.filter(t => t.status === "running" || t.status === "queued");
  const paused = list.filter(t => t.status === "paused");
  const failed = list.filter(t => t.status === "failed");

  if (active.length > 0) {
    const speed = active.reduce((sum, t) => sum + t.speed_bps, 0);
    pill.textContent = `传输 ${active.length} 个任务 · ${formatBytes(speed)}/s`;
    pill.classList.add("is-active");
  } else if (paused.length > 0) {
    pill.textContent = `传输已暂停 (${paused.length})`;
    pill.classList.remove("is-active");
  } else if (failed.length > 0) {
    pill.textContent = `传输队列 (${failed.length} 个失败)`;
    pill.classList.remove("is-active");
  } else if (list.length > 0) {
    pill.textContent = `传输队列 (${list.length})`;
    pill.classList.remove("is-active");
  } else {
    pill.textContent = "传输队列";
    pill.classList.remove("is-active");
  }
}

export function renderTransferList(): void {
  const container = $("#transfer-list");
  const list = [...state.transfers.values()];
  if (!list.length) {
    container.innerHTML =
      '<div class="empty-drawer">暂无传输任务<br/><small>支持大文件断点续传、SHA-256 校验与整个文件夹递归传输</small></div>';
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
          ? '<span class="transfer-dir upload">↑ 上传</span>'
          : '<span class="transfer-dir download">↓ 下载</span>';
      const checksumHtml = task.checksum_detail
        ? `<span class="transfer-checksum ${task.checksum_verified === false ? "is-bad" : task.checksum_verified === true ? "is-ok" : ""}">${escapeHtml(task.checksum_detail)}</span>`
        : "";
      const actions: string[] = [];
      if (task.status === "running" || task.status === "queued") {
        actions.push(
          `<button type="button" class="icon-button" data-tx-pause="${task.id}" title="暂停">${icon("pause")}</button>`,
          `<button type="button" class="icon-button" data-tx-cancel="${task.id}" title="取消">${icon("x")}</button>`,
        );
      } else if (task.status === "paused" || task.status === "failed") {
        actions.push(
          `<button type="button" class="icon-button accent-subtle" data-tx-resume="${task.id}" title="${task.status === "paused" ? "继续传输" : "重试"}">${icon("play")}</button>`,
          `<button type="button" class="icon-button" data-tx-cancel="${task.id}" title="取消">${icon("x")}</button>`,
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
            <span>剩余：${formatEta(task.eta_seconds)}</span>
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
          ? `<span class="conflict-part">已有断点分片 ${formatBytes(item.part_bytes)}</span>`
          : "";
      return `
        <div class="conflict-row">
          <strong>${escapeHtml(item.file_name)}</strong>
          <div class="conflict-meta">
            <span>源文件：${formatBytes(item.source_size)}</span>
            <span>目标文件：${item.target_size > 0 ? formatBytes(item.target_size) : "仅断点分片"}</span>
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
    notify(`已加入下载队列：${task.file_name}`);
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
        ? `已将目录内 ${tasks.length} 个文件加入传输队列`
        : "目录为空，已创建目标目录结构",
    );
  } catch (error) {
    notify(friendlyError(error), true);
  }
}

export async function initTransfersUI(): Promise<void> {
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
