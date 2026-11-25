import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n/index.ts";
import type {
  ConflictPolicy,
  Connection,
  ConnectionDraft,
  DockerContainer,
  FileDiffEntry,
  ForwardRuleDraft,
  ForwardRuleInfo,
  HostKey,
  LocalEntry,
  LocalShellKind,
  ProcessDetail,
  RemoteEntry,
  SessionEvent,
  Status,
  SystemMetrics,
  SystemdUnit,
  TransferConflict,
  TransferDirection,
  TransferTask,
  WorkbenchState,
} from "./types.ts";

export function friendlyError(error: unknown): string {
  const message = String(error);
  if (message.includes("No matching entry found") || message.includes("尚未保存登录密码")) {
    return "此连接尚未保存登录密码，请输入密码后继续";
  }
  if (message.includes("认证失败") || message.includes("Authentication")) {
    return "用户名或密码不正确，请重新输入";
  }
  return message;
}

export const api = {
  listConnections: () => invoke<Connection[]>("list_connections"),
  saveConnection: (draft: ConnectionDraft, password: string | null) =>
    invoke<Connection>("save_connection", { draft, password }),
  updateConnection: (id: string, draft: ConnectionDraft, password: string | null) =>
    invoke<Connection>("update_connection", { id, draft, password }),
  duplicateConnection: (id: string) =>
    invoke<Connection>("duplicate_connection", { id }),
  deleteConnection: (id: string) => invoke<void>("delete_connection", { id }),
  exportConnections: (path: string) => invoke<number>("export_connections", { path }),
  importConnections: (path: string) => invoke<number>("import_connections", { path }),
  loadWorkbenchState: () => invoke<WorkbenchState>("load_workbench_state"),
  saveWorkbenchState: (workbenchState: WorkbenchState) =>
    invoke<void>("save_workbench_state", { workbenchState }),
  saveTextLog: (path: string, content: string) =>
    invoke<number>("save_text_log", { path, content }),
  discoverHostKey: (profileId: string) =>
    invoke<HostKey>("discover_host_key", { profileId }),
  connect: (params: {
    profileId: string;
    hostKey: string;
    remember: boolean;
    password: string | null;
    savePassword: boolean;
  }) => invoke<string>("connect", params),
  connectSaved: (profileId: string, timeoutSecs?: number | null) =>
    invoke<string>("connect_saved", { profileId, timeoutSecs: timeoutSecs ?? null }),
  isElevated: () => invoke<boolean>("is_elevated"),
  relaunchAsAdmin: () => invoke<void>("relaunch_as_admin"),
  openElevatedLocalTerminal: (kind: LocalShellKind) =>
    invoke<void>("open_elevated_local_terminal", { kind }),
  hideToTray: () => invoke<void>("hide_to_tray"),
  exitApp: () => invoke<void>("exit_app"),
  syncTrayLanguage: (language: string) => invoke<void>("sync_tray_language", { language }),
  appVersion: () => invoke<string>("app_version"),
  openLocalTerminal: (kind: LocalShellKind) =>
    invoke<string>("open_local_terminal", { kind }),
  sessionStatus: (sessionId: string) => invoke<Status>("session_status", { sessionId }),
  terminalInput: (sessionId: string, data: string) =>
    invoke<void>("terminal_input", { sessionId, data }),
  terminalResize: (sessionId: string, columns: number, rows: number) =>
    invoke<void>("terminal_resize", { sessionId, columns, rows }),
  disconnect: (sessionId: string) => invoke<void>("disconnect", { sessionId }),
  listDirectory: (sessionId: string, path: string) =>
    invoke<RemoteEntry[]>("list_directory", { sessionId, path }),
  downloadFile: (sessionId: string, remotePath: string, localPath: string) =>
    invoke<number>("download_file", { sessionId, remotePath, localPath }),
  uploadFile: (sessionId: string, localPath: string, remotePath: string) =>
    invoke<number>("upload_file", { sessionId, localPath, remotePath }),
  readTextFile: (sessionId: string, remotePath: string) =>
    invoke<string>("read_text_file", { sessionId, remotePath }),
  writeTextFile: (
    sessionId: string,
    remotePath: string,
    text: string,
    createBackup?: boolean,
  ) =>
    invoke<void>("write_text_file", {
      sessionId,
      remotePath,
      text,
      createBackup: createBackup ?? null,
    }),
  createRemoteFile: (sessionId: string, path: string) =>
    invoke<void>("create_remote_file", { sessionId, path }),
  createRemoteDirectory: (sessionId: string, path: string) =>
    invoke<void>("create_remote_directory", { sessionId, path }),
  renameRemoteEntry: (sessionId: string, oldPath: string, newPath: string) =>
    invoke<void>("rename_remote_entry", { sessionId, oldPath, newPath }),
  deleteRemoteEntry: (sessionId: string, path: string, recursive: boolean) =>
    invoke<void>("delete_remote_entry", { sessionId, path, recursive }),
  getRemotePermissions: (sessionId: string, path: string) =>
    invoke<number>("get_remote_permissions", { sessionId, path }),
  setRemotePermissions: (sessionId: string, path: string, mode: number) =>
    invoke<void>("set_remote_permissions", { sessionId, path, mode }),

  // Transfer queue
  listTransfers: () => invoke<TransferTask[]>("list_transfers"),
  inspectTransferConflicts: (
    sessionId: string,
    direction: TransferDirection,
    pairs: [string, string][],
  ) =>
    invoke<TransferConflict[]>("inspect_transfer_conflicts", {
      sessionId,
      direction,
      pairs,
    }),
  enqueueTransfer: (params: {
    sessionId: string;
    direction: TransferDirection;
    localPath: string;
    remotePath: string;
    conflictPolicy: ConflictPolicy;
  }) => invoke<TransferTask>("enqueue_transfer", params),
  enqueueDirectoryTransfer: (params: {
    sessionId: string;
    direction: TransferDirection;
    localDir: string;
    remoteDir: string;
    conflictPolicy: ConflictPolicy;
  }) => invoke<TransferTask[]>("enqueue_directory_transfer", params),
  pauseTransfer: (id: string) => invoke<TransferTask>("pause_transfer", { id }),
  resumeTransfer: (id: string) => invoke<TransferTask>("resume_transfer", { id }),
  cancelTransfer: (id: string) => invoke<TransferTask>("cancel_transfer", { id }),
  clearFinishedTransfers: () => invoke<TransferTask[]>("clear_finished_transfers"),

  // Local FS & dual-pane diff
  localQuickPaths: () => invoke<[string, string][]>("local_quick_paths"),
  listLocalDirectory: (path: string) =>
    invoke<[string, LocalEntry[]]>("list_local_directory", { path }),
  compareLocalRemote: (sessionId: string, localDir: string, remoteDir: string) =>
    invoke<FileDiffEntry[]>("compare_local_remote", { sessionId, localDir, remoteDir }),

  // Port forwarding
  listForwards: (sessionId?: string | null) =>
    invoke<ForwardRuleInfo[]>("list_forwards", { sessionId: sessionId ?? null }),
  addForward: (sessionId: string, draft: ForwardRuleDraft) =>
    invoke<ForwardRuleInfo>("add_forward", { sessionId, draft }),
  startForward: (id: string) => invoke<ForwardRuleInfo>("start_forward", { id }),
  stopForward: (id: string) => invoke<ForwardRuleInfo>("stop_forward", { id }),
  removeForward: (id: string) => invoke<void>("remove_forward", { id }),

  // Host Ops
  listProcessesDetailed: (sessionId: string) =>
    invoke<ProcessDetail[]>("list_processes_detailed", { sessionId }),
  killProcess: (sessionId: string, pid: number, force: boolean) =>
    invoke<void>("kill_process", { sessionId, pid, force }),
  listSystemdServices: (sessionId: string) =>
    invoke<SystemdUnit[]>("list_systemd_services", { sessionId }),
  controlSystemdService: (sessionId: string, unit: string, action: string) =>
    invoke<void>("control_systemd_service", { sessionId, unit, action }),
  readSystemdLogs: (sessionId: string, unit: string, lines = 120) =>
    invoke<string>("read_systemd_logs", { sessionId, unit, lines }),
  listDockerContainers: (sessionId: string) =>
    invoke<DockerContainer[]>("list_docker_containers", { sessionId }),
  controlDockerContainer: (sessionId: string, containerId: string, action: string) =>
    invoke<void>("control_docker_container", { sessionId, containerId, action }),
  readDockerLogs: (sessionId: string, containerId: string, tail = 150) =>
    invoke<string>("read_docker_logs", { sessionId, containerId, tail }),

  systemMetrics: (sessionId: string) =>
    invoke<SystemMetrics>("system_metrics", { sessionId }),
};

export const dialogs = {
  pickPrivateKey: () => open({ multiple: false, title: t("dialog.pickKey") }),
  pickUploadFile: () => open({ multiple: true, title: t("dialog.pickUploadFiles") }),
  pickUploadDirectory: () => open({ directory: true, multiple: false, title: t("dialog.pickUploadDir") }),
  pickDownloadDirectory: () => open({ directory: true, multiple: false, title: t("dialog.pickDownloadDir") }),
  pickSavePath: (defaultPath: string) => save({ defaultPath, title: t("dialog.pickSaveFile") }),
  pickExportPath: () =>
    save({
      defaultPath: "rufeshell-connections.json",
      title: t("dialog.pickExport"),
      filters: [{ name: t("dialog.filterJson"), extensions: ["json"] }],
    }),
  pickImportPath: () =>
    open({
      multiple: false,
      title: t("dialog.pickImport"),
      filters: [{ name: t("dialog.filterJson"), extensions: ["json"] }],
    }),
  pickLogSavePath: (defaultName: string) =>
    save({
      defaultPath: defaultName,
      title: t("dialog.pickLogSave"),
      filters: [
        { name: t("dialog.filterLogs"), extensions: ["log", "txt"] },
        { name: t("dialog.filterAll"), extensions: ["*"] },
      ],
    }),
};

const noopUnlisten: UnlistenFn = () => {};

export function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function safeListen<T>(eventName: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!hasTauriRuntime()) return Promise.resolve(noopUnlisten);
  return listen<T>(eventName, event => handler(event.payload));
}

export function onSessionEvent(handler: (event: SessionEvent) => void): Promise<UnlistenFn> {
  return safeListen<SessionEvent>("session-event", handler);
}

export function onSessionWarning(handler: (message: string) => void): Promise<UnlistenFn> {
  return safeListen<{ message: string }>("session-warning", payload => handler(payload.message));
}

export function onTransferEvent(handler: (task: TransferTask) => void): Promise<UnlistenFn> {
  return safeListen<TransferTask>("transfer-event", handler);
}

export function onCloseRequested(handler: () => void): Promise<UnlistenFn> {
  return safeListen<void>("app-close-requested", () => handler());
}

export const onDragDropEvent = (
  handler: Parameters<ReturnType<typeof getCurrentWebview>["onDragDropEvent"]>[0],
) => (hasTauriRuntime() ? getCurrentWebview().onDragDropEvent(handler) : Promise.resolve(noopUnlisten));
