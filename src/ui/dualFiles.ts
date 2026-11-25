import { api, friendlyError } from "../api.ts";
import { onLanguageChange, t } from "../i18n/index.ts";
import { icon } from "../icons.ts";
import { getActiveSession } from "../state.ts";
import type { DiffStatus, FileDiffEntry, LocalEntry, RemoteEntry } from "../types.ts";
import { $, escapeHtml, formatBytes, notify } from "../utils.ts";
import { startFileDownload, startFileUploads } from "./transfers.ts";

let currentLocalEntries: LocalEntry[] = [];
let currentRemoteEntries: RemoteEntry[] = [];
let currentDiffs: FileDiffEntry[] | null = null;
let onlyShowDiffs = false;

function diffBadge(status: DiffStatus): string {
  switch (status) {
    case "only_local":
      return `<span class="diff-pill only-local">${escapeHtml(t("dual.diffOnlyLocal"))}</span>`;
    case "only_remote":
      return `<span class="diff-pill only-remote">${escapeHtml(t("dual.diffOnlyRemote"))}</span>`;
    case "newer_local":
      return `<span class="diff-pill diff-warn">${escapeHtml(t("dual.diffNewerLocal"))}</span>`;
    case "newer_remote":
      return `<span class="diff-pill diff-warn">${escapeHtml(t("dual.diffNewerRemote"))}</span>`;
    case "size_diff":
      return `<span class="diff-pill diff-warn">${escapeHtml(t("dual.diffSizeDiff"))}</span>`;
    case "same":
      return `<span class="diff-pill same">${escapeHtml(t("dual.diffSame"))}</span>`;
  }
}

function renderDualLists(): void {
  const session = getActiveSession();
  if (!session) return;

  if (currentDiffs) {
    const items = onlyShowDiffs
      ? currentDiffs.filter(item => item.status !== "same")
      : currentDiffs;
    const diffRows =
      items
        .map(item => {
          const uploadBtn =
            !item.is_dir && item.local_path
              ? `<button type="button" class="icon-button" data-sync-up="${escapeHtml(item.name)}" title="${escapeHtml(t("dual.uploadToRemote"))}">${icon("upload")}</button>`
              : "";
          const downloadBtn =
            !item.is_dir && item.remote_path
              ? `<button type="button" class="icon-button" data-sync-down="${escapeHtml(item.name)}" title="${escapeHtml(t("dual.downloadToLocal"))}">${icon("download")}</button>`
              : "";
          return `
            <div class="dual-diff-row">
              <div class="dual-cell">
                <span class="file-icon-badge ${item.is_dir ? "is-dir" : ""}">${icon(item.is_dir ? "folder" : "file")}</span>
                <span class="dual-name">${item.local_path ? escapeHtml(item.name) : "—"}</span>
                <small>${item.local_size !== null && !item.is_dir ? formatBytes(item.local_size) : ""}</small>
              </div>
              <div class="dual-diff-center">
                ${diffBadge(item.status)}
                <div class="dual-sync-btns">${uploadBtn}${downloadBtn}</div>
              </div>
              <div class="dual-cell">
                <span class="file-icon-badge ${item.is_dir ? "is-dir" : ""}">${icon(item.is_dir ? "folder" : "file")}</span>
                <span class="dual-name">${item.remote_path ? escapeHtml(item.name) : "—"}</span>
                <small>${item.remote_size !== null && !item.is_dir ? formatBytes(item.remote_size) : ""}</small>
              </div>
            </div>
          `;
        })
        .join("") || `<div class="empty-drawer">${escapeHtml(t("dual.diffAllSame"))}</div>`;

    $("#dual-panes-grid").classList.add("hidden");
    $("#dual-diff-view").classList.remove("hidden");
    $("#dual-diff-list").innerHTML = diffRows;
    return;
  }

  $("#dual-diff-view").classList.add("hidden");
  $("#dual-panes-grid").classList.remove("hidden");

  $("#dual-local-list").innerHTML =
    currentLocalEntries
      .map(
        entry => `
          <div class="dual-row" data-local-path="${escapeHtml(entry.path)}" data-dir="${entry.is_dir}" data-name="${escapeHtml(entry.name)}">
            <button type="button" class="dual-entry-btn ${entry.is_dir ? "is-dir" : ""}">
              <span class="file-icon-badge ${entry.is_dir ? "is-dir" : ""}">${icon(entry.is_dir ? "folder" : "file")}</span>
              <span>${escapeHtml(entry.name)}</span>
            </button>
            <small>${entry.is_dir ? escapeHtml(t("common.dir")) : formatBytes(entry.size)}</small>
            ${entry.is_dir ? "" : `<button type="button" class="icon-button" data-dual-upload="${escapeHtml(entry.path)}" title="${escapeHtml(t("dual.uploadToRight"))}">${icon("upload")}</button>`}
          </div>
        `,
      )
      .join("") || `<div class="empty-drawer">${escapeHtml(t("dual.emptyLocal"))}</div>`;

  $("#dual-remote-list").innerHTML =
    currentRemoteEntries
      .map(
        entry => `
          <div class="dual-row" data-remote-path="${escapeHtml(entry.path)}" data-dir="${entry.is_dir}" data-name="${escapeHtml(entry.name)}">
            <button type="button" class="dual-entry-btn ${entry.is_dir ? "is-dir" : ""}">
              <span class="file-icon-badge ${entry.is_dir ? "is-dir" : ""}">${icon(entry.is_dir ? "folder" : "file")}</span>
              <span>${escapeHtml(entry.name)}</span>
            </button>
            <small>${entry.is_dir ? escapeHtml(t("common.dir")) : formatBytes(entry.size)}</small>
            ${entry.is_dir ? "" : `<button type="button" class="icon-button" data-dual-download="${escapeHtml(entry.path)}" data-name="${escapeHtml(entry.name)}" title="${escapeHtml(t("dual.downloadToLeft"))}">${icon("download")}</button>`}
          </div>
        `,
      )
      .join("") || `<div class="empty-drawer">${escapeHtml(t("dual.emptyRemote"))}</div>`;
}

export async function refreshDualPane(): Promise<void> {
  const session = getActiveSession();
  if (!session || session.kind !== "ssh") return;
  currentDiffs = null;

  try {
    const quick = await api.localQuickPaths();
    $("#dual-local-quick").innerHTML =
      `<option value="">${escapeHtml(t("dual.quickPathOpt"))}</option>` +
      quick.map(([label, path]) => `<option value="${escapeHtml(path)}">${escapeHtml(label)}</option>`).join("");

    const [resolvedLocal, localEntries] = await api.listLocalDirectory(session.localPath);
    session.localPath = resolvedLocal;
    $<HTMLInputElement>("#dual-local-path").value = resolvedLocal;
    currentLocalEntries = localEntries;

    const remoteEntries = await api.listDirectory(session.id, session.path);
    $<HTMLInputElement>("#dual-remote-path").value = session.path;
    currentRemoteEntries = remoteEntries;

    renderDualLists();
  } catch (error) {
    notify(friendlyError(error), true);
  }
}

export function initDualFilesUI(): void {
  onLanguageChange(() => {
    const firstOpt = document.querySelector<HTMLOptionElement>("#dual-local-quick option[value='']");
    if (firstOpt) firstOpt.textContent = t("dual.quickPathOpt");
    const session = getActiveSession();
    if (session && session.mode === "dual") renderDualLists();
  });
  $("#dual-local-quick").addEventListener("change", event => {
    const val = (event.target as HTMLSelectElement).value;
    const session = getActiveSession();
    if (val && session) {
      session.localPath = val;
      void refreshDualPane();
    }
  });

  $("#dual-local-up").addEventListener("click", () => {
    const session = getActiveSession();
    if (!session) return;
    const parent = session.localPath.replace(/[\\/][^\\/]+[\\/]?$/, "") || session.localPath;
    session.localPath = parent.endsWith(":") ? `${parent}\\` : parent;
    void refreshDualPane();
  });

  $("#dual-remote-up").addEventListener("click", () => {
    const session = getActiveSession();
    if (!session) return;
    session.path = session.path === "/" ? "/" : session.path.replace(/\/[^/]+\/?$/, "") || "/";
    void refreshDualPane();
  });

  $("#dual-local-path").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      const session = getActiveSession();
      if (session) {
        session.localPath = (event.target as HTMLInputElement).value;
        void refreshDualPane();
      }
    }
  });

  $("#dual-remote-path").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      const session = getActiveSession();
      if (session) {
        session.path = (event.target as HTMLInputElement).value;
        void refreshDualPane();
      }
    }
  });

  $("#dual-refresh-btn").addEventListener("click", () => void refreshDualPane());

  $("#dual-compare-btn").addEventListener("click", async () => {
    const session = getActiveSession();
    if (!session) return;
    try {
      currentDiffs = await api.compareLocalRemote(session.id, session.localPath, session.path);
      renderDualLists();
      notify(t("dual.compareDone", { count: currentDiffs.length }));
    } catch (error) {
      notify(friendlyError(error), true);
    }
  });

  $("#dual-exit-diff-btn").addEventListener("click", () => {
    currentDiffs = null;
    renderDualLists();
  });

  $("#dual-only-diff").addEventListener("change", event => {
    onlyShowDiffs = (event.target as HTMLInputElement).checked;
    if (currentDiffs) renderDualLists();
  });

  $("#dual-sync-up-missing").addEventListener("click", async () => {
    const session = getActiveSession();
    if (!session || !currentDiffs) return;
    const targets = currentDiffs
      .filter(
        d => !d.is_dir && d.local_path && (d.status === "only_local" || d.status === "newer_local" || d.status === "size_diff"),
      )
      .map(d => d.local_path!);
    if (!targets.length) {
      notify(t("dual.noUploadSync"));
      return;
    }
    if (!window.confirm(t("dual.confirmSyncUp", { count: targets.length, path: session.path }))) {
      return;
    }
    await startFileUploads(session, targets, session.path);
    await refreshDualPane();
  });

  $("#dual-sync-down-missing").addEventListener("click", async () => {
    const session = getActiveSession();
    if (!session || !currentDiffs) return;
    const targets = currentDiffs.filter(
      d => !d.is_dir && d.remote_path && (d.status === "only_remote" || d.status === "newer_remote" || d.status === "size_diff"),
    );
    if (!targets.length) {
      notify(t("dual.noDownloadSync"));
      return;
    }
    if (!window.confirm(t("dual.confirmSyncDown", { count: targets.length, path: session.localPath }))) {
      return;
    }
    const sep = session.localPath.includes("\\") ? "\\" : "/";
    const base = session.localPath.replace(/[\\/]+$/, "");
    for (const item of targets) {
      await startFileDownload(session, item.remote_path!, `${base}${sep}${item.name}`);
    }
  });

  $("#dual-local-list").addEventListener("click", async event => {
    const target = event.target as HTMLElement;
    const session = getActiveSession();
    if (!session) return;

    const up = target.closest<HTMLButtonElement>("[data-dual-upload]");
    if (up) {
      await startFileUploads(session, [up.dataset.dualUpload!], session.path);
      await refreshDualPane();
      return;
    }

    const row = target.closest<HTMLElement>(".dual-row");
    if (row && row.dataset.dir === "true") {
      session.localPath = row.dataset.localPath!;
      await refreshDualPane();
    }
  });

  $("#dual-remote-list").addEventListener("click", async event => {
    const target = event.target as HTMLElement;
    const session = getActiveSession();
    if (!session) return;

    const down = target.closest<HTMLButtonElement>("[data-dual-download]");
    if (down) {
      const sep = session.localPath.includes("\\") ? "\\" : "/";
      const base = session.localPath.replace(/[\\/]+$/, "");
      await startFileDownload(session, down.dataset.dualDownload!, `${base}${sep}${down.dataset.name!}`);
      return;
    }

    const row = target.closest<HTMLElement>(".dual-row");
    if (row && row.dataset.dir === "true") {
      session.path = row.dataset.remotePath!;
      await refreshDualPane();
    }
  });

  $("#dual-diff-list").addEventListener("click", async event => {
    const target = event.target as HTMLElement;
    const session = getActiveSession();
    if (!session || !currentDiffs) return;

    const up = target.closest<HTMLButtonElement>("[data-sync-up]");
    if (up) {
      const item = currentDiffs.find(d => d.name === up.dataset.syncUp);
      if (item?.local_path) {
        await startFileUploads(session, [item.local_path], session.path);
        currentDiffs = await api.compareLocalRemote(session.id, session.localPath, session.path);
        renderDualLists();
      }
      return;
    }

    const down = target.closest<HTMLButtonElement>("[data-sync-down]");
    if (down) {
      const item = currentDiffs.find(d => d.name === down.dataset.syncDown);
      if (item?.remote_path) {
        const sep = session.localPath.includes("\\") ? "\\" : "/";
        const base = session.localPath.replace(/[\\/]+$/, "");
        await startFileDownload(session, item.remote_path, `${base}${sep}${item.name}`);
      }
    }
  });
}
