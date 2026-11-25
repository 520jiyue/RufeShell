import { api, dialogs, friendlyError, onDragDropEvent } from "../api.ts";
import { onLanguageChange, t } from "../i18n/index.ts";
import { icon } from "../icons.ts";
import { getActiveSession, state } from "../state.ts";
import type { Session } from "../types.ts";
import {
  $,
  attachHorizontalResizer,
  escapeHtml,
  formatBytes,
  notify,
  setGlobalStatus,
} from "../utils.ts";
import { openRemoteFile } from "./dialogs.ts";
import {
  startDirectoryTransfer,
  startFileDownload,
  startFileUploads,
} from "./transfers.ts";

let draggedFilePaths: string[] = [];
let onOpenDualPane: () => void = () => {};

export function setDualPaneOpenHandler(handler: () => void): void {
  onOpenDualPane = handler;
}

export function hideContextMenu(): void {
  $("#file-context-menu").classList.add("hidden");
}

function joinRemote(base: string, name: string): string {
  const clean = base.replace(/\/$/, "");
  return clean ? `${clean}/${name}` : `/${name}`;
}

export async function loadDirectory(id: string, path: string): Promise<void> {
  const session = state.sessions.get(id);
  if (!session || session.status !== "connected") return;

  while (session.loadingFiles) {
    await new Promise(resolve => window.setTimeout(resolve, 30));
  }
  if (session.status !== "connected") return;

  const request = ++session.directoryRequest;
  session.loadingFiles = true;
  if (state.activeId === id) setGlobalStatus(t("files.loading"));

  const list = $<HTMLDivElement>(".file-list", session.fileElement);
  if (!session.filesLoaded) {
    list.innerHTML = `<div class="empty-files">${escapeHtml(t("files.loading"))}</div>`;
  }

  try {
    const entries = await api.listDirectory(session.id, path);
    if (request !== session.directoryRequest) return;

    session.path = path;
    session.filesLoaded = true;
    if (state.activeId === id) {
      $<HTMLInputElement>("#remote-path").value = path;
    }

    list.innerHTML =
      entries
        .map(
          entry => `
            <div class="file-row" data-path="${escapeHtml(entry.path)}" data-name="${escapeHtml(entry.name)}" data-dir="${entry.is_dir}">
              <button class="file-name ${entry.is_dir ? "directory" : ""}" type="button" data-path="${escapeHtml(entry.path)}" title="${escapeHtml(entry.name)}">
                <span class="file-icon-badge ${entry.is_dir ? "is-dir" : ""}">${icon(entry.is_dir ? "folder" : "file")}</span>
                <span class="file-label">${escapeHtml(entry.name)}</span>
              </button>
              <span class="file-size">${entry.is_dir ? escapeHtml(t("common.dir")) : formatBytes(entry.size)}</span>
            </div>
          `,
        )
        .join("") || `<div class="empty-files">${escapeHtml(t("files.empty"))}</div>`;
  } catch (error) {
    if (request !== session.directoryRequest) return;
    const message = friendlyError(error);
    list.innerHTML = `
      <div class="empty-files file-error">
        <strong>${escapeHtml(t("files.readError"))}</strong>
        <span>${escapeHtml(message)}</span>
        <button class="subtle retry-files" type="button">${escapeHtml(t("common.retry"))}</button>
      </div>
    `;
    list.querySelector(".retry-files")?.addEventListener("click", () => {
      void loadDirectory(session.id, session.path);
    });
    notify(message, true);
  } finally {
    if (request === session.directoryRequest) session.loadingFiles = false;
    if (state.activeId === id) setGlobalStatus(t("common.ready"));
  }
}

async function uploadToSession(session: Session): Promise<void> {
  if (state.busy) return;
  const picked = await dialogs.pickUploadFile();
  if (!picked) return;
  const localPaths = Array.isArray(picked) ? picked : [picked];
  await startFileUploads(session, localPaths, session.path);
  await loadDirectory(session.id, session.path);
}

async function uploadDirectoryToSession(session: Session): Promise<void> {
  const localDir = await dialogs.pickUploadDirectory();
  if (typeof localDir !== "string") return;
  await startDirectoryTransfer(session, "upload", localDir, session.path);
  await loadDirectory(session.id, session.path);
}

async function downloadFromSession(session: Session, path: string, name: string): Promise<void> {
  const localPath = await dialogs.pickSavePath(name);
  if (!localPath) return;
  await startFileDownload(session, path, localPath);
}

async function downloadDirectoryFromSession(session: Session, remoteDir: string): Promise<void> {
  const localDir = await dialogs.pickDownloadDirectory();
  if (typeof localDir !== "string") return;
  await startDirectoryTransfer(session, "download", localDir, remoteDir);
}

async function promptCreateEntry(session: Session, isDir: boolean): Promise<void> {
  const name = window.prompt(
    t(isDir ? "files.promptNewDir" : "files.promptNewFile", { path: session.path }),
  );
  if (!name || !name.trim()) return;
  const targetPath = joinRemote(session.path, name.trim());
  try {
    if (isDir) await api.createRemoteDirectory(session.id, targetPath);
    else await api.createRemoteFile(session.id, targetPath);
    notify(t(isDir ? "files.dirCreated" : "files.fileCreated"));
    await loadDirectory(session.id, session.path);
  } catch (error) {
    notify(friendlyError(error), true);
  }
}

async function promptRenameEntry(session: Session, oldPath: string, oldName: string): Promise<void> {
  const nextName = window.prompt(t("files.promptRename"), oldName);
  if (!nextName || !nextName.trim() || nextName.trim() === oldName) return;
  const parent = oldPath.replace(/\/[^/]+\/?$/, "") || "/";
  const newPath = joinRemote(parent, nextName.trim());
  try {
    await api.renameRemoteEntry(session.id, oldPath, newPath);
    notify(t("files.renamed"));
    await loadDirectory(session.id, session.path);
  } catch (error) {
    notify(friendlyError(error), true);
  }
}

function openDeleteConfirmation(session: Session, path: string, isDir: boolean): void {
  const dialog = $<HTMLDialogElement>("#confirm-delete-dialog");
  dialog.dataset.session = session.id;
  dialog.dataset.path = path;
  dialog.dataset.dir = String(isDir);
  $("#delete-target-path").textContent = path;
  $("#delete-target-desc").textContent = t(isDir ? "delete.dirDesc" : "delete.fileDesc");
  dialog.showModal();
}

async function openChmodModal(session: Session, path: string): Promise<void> {
  try {
    const mode = await api.getRemotePermissions(session.id, path);
    const dialog = $<HTMLDialogElement>("#chmod-dialog");
    dialog.dataset.session = session.id;
    dialog.dataset.path = path;
    $("#chmod-target-path").textContent = path;
    syncChmodUI(mode);
    dialog.showModal();
  } catch (error) {
    notify(friendlyError(error), true);
  }
}

function syncChmodUI(mode: number): void {
  const clean = mode & 0o777;
  $<HTMLInputElement>("#chmod-octal").value = clean.toString(8).padStart(3, "0");
  document.querySelectorAll<HTMLInputElement>("[data-chmod-bit]").forEach(box => {
    const bit = parseInt(box.dataset.chmodBit!, 8);
    box.checked = (clean & bit) !== 0;
  });
}

function readChmodCheckboxes(): number {
  let mode = 0;
  document.querySelectorAll<HTMLInputElement>("[data-chmod-bit]").forEach(box => {
    if (box.checked) mode |= parseInt(box.dataset.chmodBit!, 8);
  });
  return mode;
}

function clearFileDrop(): void {
  draggedFilePaths = [];
  $("#files-panel").classList.remove("drag-active");
  $("#file-drop-hint").classList.add("hidden");
  document.querySelectorAll(".file-row.drop-target").forEach(row => row.classList.remove("drop-target"));
}

export function toggleFilesPanel(): void {
  const hidden = $("#files-panel").classList.toggle("hidden");
  $("#files-resizer").classList.toggle("hidden", hidden);
  const toggleBtn = $<HTMLButtonElement>("#toggle-files");
  toggleBtn.classList.toggle("active", !hidden);
  toggleBtn.title = t(hidden ? "session.showFiles" : "session.hideFiles");
  const session = getActiveSession();
  if (session) requestAnimationFrame(() => session.fit.fit());
}

export async function initFilesPanel(): Promise<void> {
  const panel = $("#files-panel");
  const resizer = $("#files-resizer");

  onLanguageChange(() => {
    const toggleBtn = $<HTMLButtonElement>("#toggle-files");
    toggleBtn.title = t(panel.classList.contains("hidden") ? "session.showFiles" : "session.hideFiles");
    const active = getActiveSession();
    if (active && active.kind === "ssh" && active.status === "connected" && active.filesLoaded) {
      void loadDirectory(active.id, active.path);
    }
  });

  $("#toggle-files").addEventListener("click", toggleFilesPanel);

  $("#parent-directory").addEventListener("click", () => {
    const session = getActiveSession();
    if (!session) return;
    const parent = session.path === "/" ? "/" : session.path.replace(/\/[^/]+\/?$/, "") || "/";
    void loadDirectory(session.id, parent);
  });

  $("#refresh-files").addEventListener("click", () => {
    const session = getActiveSession();
    if (session) void loadDirectory(session.id, session.path);
  });

  $("#upload-file").addEventListener("click", () => {
    const session = getActiveSession();
    if (session && session.status === "connected") void uploadToSession(session);
  });

  $("#remote-path").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      const session = getActiveSession();
      if (session) void loadDirectory(session.id, (event.target as HTMLInputElement).value);
    }
  });

  $("#file-containers").addEventListener("click", async event => {
    const target = event.target as HTMLElement;
    const session = getActiveSession();
    const directory = target.closest<HTMLButtonElement>(".directory");
    if (directory && session) {
      await loadDirectory(session.id, directory.dataset.path!);
    }
  });

  // Confirm delete handler
  $("#confirm-delete-btn").addEventListener("click", async () => {
    const dialog = $<HTMLDialogElement>("#confirm-delete-dialog");
    const session = state.sessions.get(dialog.dataset.session ?? "");
    const path = dialog.dataset.path;
    const recursive = dialog.dataset.dir === "true";
    if (!session || !path) return;
    try {
      await api.deleteRemoteEntry(session.id, path, recursive);
      dialog.close();
      notify(t("files.deleted", { path }));
      await loadDirectory(session.id, session.path);
    } catch (error) {
      notify(friendlyError(error), true);
    }
  });

  // Chmod modal handlers
  document.querySelectorAll<HTMLInputElement>("[data-chmod-bit]").forEach(box =>
    box.addEventListener("change", () => syncChmodUI(readChmodCheckboxes())),
  );
  $<HTMLInputElement>("#chmod-octal").addEventListener("input", event => {
    const raw = (event.target as HTMLInputElement).value.trim();
    if (/^[0-7]{3,4}$/.test(raw)) {
      const parsed = parseInt(raw, 8) & 0o777;
      document.querySelectorAll<HTMLInputElement>("[data-chmod-bit]").forEach(box => {
        const bit = parseInt(box.dataset.chmodBit!, 8);
        box.checked = (parsed & bit) !== 0;
      });
    }
  });
  $("#chmod-form").addEventListener("submit", async event => {
    event.preventDefault();
    const dialog = $<HTMLDialogElement>("#chmod-dialog");
    const session = state.sessions.get(dialog.dataset.session ?? "");
    const path = dialog.dataset.path;
    const raw = $<HTMLInputElement>("#chmod-octal").value.trim();
    if (!session || !path || !/^[0-7]{3,4}$/.test(raw)) {
      notify(t("files.invalidOctal"), true);
      return;
    }
    try {
      await api.setRemotePermissions(session.id, path, parseInt(raw, 8));
      dialog.close();
      notify(t("files.chmodUpdated", { mode: raw }));
    } catch (error) {
      notify(friendlyError(error), true);
    }
  });

  panel.addEventListener("contextmenu", event => {
    event.preventDefault();
    const session = getActiveSession();
    if (!session || session.status !== "connected") return;

    const row = (event.target as HTMLElement).closest<HTMLElement>(".file-row");
    const menu = $("#file-context-menu");
    menu.innerHTML = row
      ? row.dataset.dir === "true"
        ? `
          <button type="button" data-action="open">${icon("folder")}${escapeHtml(t("files.menuOpen"))}</button>
          <button type="button" data-action="download-dir">${icon("download")}${escapeHtml(t("files.menuDownloadDir"))}</button>
          <button type="button" data-action="rename">${icon("edit")}${escapeHtml(t("files.menuRename"))}</button>
          <button type="button" data-action="chmod">${icon("sliders")}${escapeHtml(t("files.menuChmod"))}</button>
          <button type="button" data-action="copy-path">${icon("copy")}${escapeHtml(t("files.menuCopyPath"))}</button>
          <button type="button" data-action="delete" class="menu-danger">${icon("trash")}${escapeHtml(t("files.menuDeleteDir"))}</button>
        `
        : `
          <button type="button" data-action="view">${icon("eye")}${escapeHtml(t("files.menuView"))}</button>
          <button type="button" data-action="edit">${icon("edit")}${escapeHtml(t("files.menuEdit"))}</button>
          <button type="button" data-action="download">${icon("download")}${escapeHtml(t("files.menuDownload"))}</button>
          <button type="button" data-action="rename">${icon("edit")}${escapeHtml(t("files.menuRename"))}</button>
          <button type="button" data-action="chmod">${icon("sliders")}${escapeHtml(t("files.menuChmod"))}</button>
          <button type="button" data-action="copy-path">${icon("copy")}${escapeHtml(t("files.menuCopyPath"))}</button>
          <button type="button" data-action="delete" class="menu-danger">${icon("trash")}${escapeHtml(t("files.menuDeleteFile"))}</button>
        `
      : `
        <button type="button" data-action="new-file">${icon("plusFile")}${escapeHtml(t("files.menuNewFile"))}</button>
        <button type="button" data-action="new-dir">${icon("plusFolder")}${escapeHtml(t("files.menuNewDir"))}</button>
        <button type="button" data-action="upload">${icon("upload")}${escapeHtml(t("files.menuUpload"))}</button>
        <button type="button" data-action="upload-dir">${icon("folder")}${escapeHtml(t("files.menuUploadDir"))}</button>
        <button type="button" data-action="dual-pane">${icon("columns")}${escapeHtml(t("files.menuDualPane"))}</button>
        <button type="button" data-action="refresh">${icon("refresh")}${escapeHtml(t("files.menuRefresh"))}</button>
      `;

    menu.classList.remove("hidden");
    const menuWidth = 196;
    const menuHeight = 290;
    menu.style.left = `${Math.min(event.clientX, window.innerWidth - menuWidth - 8)}px`;
    menu.style.top = `${Math.min(event.clientY, window.innerHeight - menuHeight)}px`;

    menu.querySelectorAll<HTMLButtonElement>("button").forEach(button =>
      button.addEventListener("click", () => {
        hideContextMenu();
        const action = button.dataset.action;
        if (action === "upload") void uploadToSession(session);
        if (action === "upload-dir") void uploadDirectoryToSession(session);
        if (action === "new-file") void promptCreateEntry(session, false);
        if (action === "new-dir") void promptCreateEntry(session, true);
        if (action === "dual-pane") onOpenDualPane();
        if (action === "refresh") void loadDirectory(session.id, session.path);
        if (action === "open" && row) void loadDirectory(session.id, row.dataset.path!);
        if (action === "download" && row) {
          void downloadFromSession(session, row.dataset.path!, row.dataset.name!);
        }
        if (action === "download-dir" && row) {
          void downloadDirectoryFromSession(session, row.dataset.path!);
        }
        if (action === "rename" && row) {
          void promptRenameEntry(session, row.dataset.path!, row.dataset.name!);
        }
        if (action === "chmod" && row) {
          void openChmodModal(session, row.dataset.path!);
        }
        if (action === "copy-path" && row) {
          void navigator.clipboard?.writeText(row.dataset.path!);
          notify(t("files.copiedPath", { path: row.dataset.path! }));
        }
        if (action === "delete" && row) {
          openDeleteConfirmation(session, row.dataset.path!, row.dataset.dir === "true");
        }
        if ((action === "view" || action === "edit") && row) {
          void openRemoteFile(session, row.dataset.path!, row.dataset.name!, action);
        }
      }),
    );
  });

  document.addEventListener("click", event => {
    if (!(event.target as HTMLElement).closest("#file-context-menu")) {
      hideContextMenu();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") hideContextMenu();
  });

  attachHorizontalResizer({
    resizer,
    panel,
    direction: -1,
    minWidth: 250,
    maxWidth: 620,
    getAvailableWidth: () =>
      $("#session-workspace").clientWidth -
      ($("#metrics-panel").classList.contains("hidden") ? 0 : $("#metrics-panel").clientWidth),
    onFinish: () => getActiveSession()?.fit.fit(),
  });

  await onDragDropEvent(event => {
    const payload = event.payload;
    if (payload.type === "leave") {
      clearFileDrop();
      return;
    }
    if (payload.type === "enter") {
      draggedFilePaths = payload.paths;
    }

    const point = payload.position.toLogical(window.devicePixelRatio);
    const bounds = panel.getBoundingClientRect();
    const session = getActiveSession();
    const inside =
      point.x >= bounds.left &&
      point.x <= bounds.right &&
      point.y >= bounds.top &&
      point.y <= bounds.bottom;

    if (!inside || panel.classList.contains("hidden") || !session || session.status !== "connected") {
      clearFileDrop();
      return;
    }

    const target = document.elementFromPoint(point.x, point.y);
    const row = target?.closest<HTMLElement>(".file-row");
    const remoteDirectory = row?.dataset.dir === "true" ? row.dataset.path! : session.path;

    if (payload.type === "drop") {
      clearFileDrop();
      if (!state.busy) {
        void startFileUploads(session, payload.paths, remoteDirectory).then(() =>
          loadDirectory(session.id, session.path),
        );
      }
      return;
    }

    document.querySelectorAll(".file-row.drop-target").forEach(item => item.classList.remove("drop-target"));
    row?.classList.toggle("drop-target", row.dataset.dir === "true");
    panel.classList.add("drag-active");
    $("#file-drop-target").textContent = t("files.dropProgress", {
      count: draggedFilePaths.length,
      dir: remoteDirectory,
    });
    $("#file-drop-hint").classList.remove("hidden");
  });
}
