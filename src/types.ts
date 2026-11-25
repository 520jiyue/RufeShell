import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

export type AuthKind = "password" | "private_key";

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth: AuthKind;
  private_key_path: string | null;
  updated_at?: number;
}

export interface ConnectionDraft {
  name: string;
  host: string;
  port: number;
  username: string;
  auth: AuthKind;
  private_key_path: string | null;
}

export interface ConnectionMeta {
  group: string;
  tags: string[];
  favorite: boolean;
  sort_order: number;
  connect_timeout_secs: number | null;
  auto_reconnect: boolean | null;
}

export type ConnectionSortMode = "favorite" | "name" | "group" | "recent";

export type HistoryOutcome = "sent" | "error" | "failed";

export interface HistoryEntry {
  id: string;
  command: string;
  timestamp: number;
  server_id: string;
  server_name: string;
  host: string;
  outcome: HistoryOutcome;
}

export interface CommandSnippet {
  id: string;
  name: string;
  command: string;
  group: string;
  shortcut: string | null;
  description: string | null;
  updated_at: number;
}

export type TerminalThemeId =
  | "obsidian-emerald"
  | "tokyo-night"
  | "dracula"
  | "github-dark"
  | "morning-mist"
  | "solarized-light"
  | "catppuccin-latte";

export interface MetricsVisibility {
  cpu: boolean;
  memory: boolean;
  swap: boolean;
  network: boolean;
  disk: boolean;
  processes: boolean;
  mounts: boolean;
}

export interface AlertRule {
  id: string;
  metric: "cpu" | "memory" | "disk" | "swap";
  threshold: number;
  cooldown_secs: number;
  enabled: boolean;
}

export interface AlertLogEntry {
  id: string;
  session_id: string;
  server_name: string;
  metric: string;
  value: number;
  threshold: number;
  timestamp: number;
}

export type LanguageId = "zh-CN" | "en";
export type CloseAction = "ask" | "tray" | "exit";
export type LocalShellPrivilege = "ask" | "standard" | "admin";

export interface TerminalSettings {
  language: LanguageId | string;
  close_action: CloseAction | string;
  local_shell_privilege: LocalShellPrivilege | string;
  auto_check_updates: boolean;
  font_family: string;
  font_size: number;
  theme: TerminalThemeId | string;
  copy_on_select: boolean;
  right_click_paste: boolean;
  auto_reconnect: boolean;
  reconnect_max_attempts: number;
  connect_timeout_secs: number;
  metrics_interval_secs: number;
  metrics_process_limit: number;
  metrics_warn_percent: number;
  metrics_danger_percent: number;
  metrics_visible: MetricsVisibility;
  metrics_collapsed: string[];
  create_backup_on_edit: boolean;
  verify_transfer_checksum: boolean;
  alert_rules: AlertRule[];
}

export interface WorkbenchState {
  schema_version: number;
  connection_meta: Record<string, ConnectionMeta>;
  history: HistoryEntry[];
  snippets: CommandSnippet[];
  settings: TerminalSettings;
}

export interface RemoteEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_at: number | null;
  permissions: number | null;
}

export interface LocalEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_at: number | null;
}

export type DiffStatus =
  | "same"
  | "newer_local"
  | "newer_remote"
  | "size_diff"
  | "only_local"
  | "only_remote";

export interface FileDiffEntry {
  name: string;
  is_dir: boolean;
  local_path: string | null;
  remote_path: string | null;
  local_size: number | null;
  remote_size: number | null;
  local_modified_at: number | null;
  remote_modified_at: number | null;
  status: DiffStatus;
}

export type LocalShellKind = "power_shell" | "cmd" | "wsl";

export type TransferDirection = "upload" | "download";
export type TransferStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
export type ConflictPolicy = "ask" | "overwrite" | "skip" | "rename" | "resume";

export interface TransferTask {
  id: string;
  session_id: string;
  direction: TransferDirection;
  local_path: string;
  remote_path: string;
  file_name: string;
  total_bytes: number;
  transferred_bytes: number;
  speed_bps: number;
  eta_seconds: number | null;
  status: TransferStatus;
  error: string | null;
  checksum_verified: boolean | null;
  checksum_detail: string | null;
  conflict_policy: ConflictPolicy;
}

export interface TransferConflict {
  local_path: string;
  remote_path: string;
  file_name: string;
  source_size: number;
  target_size: number;
  source_modified_at: number | null;
  target_modified_at: number | null;
  part_bytes: number;
}

export type ForwardKind = "local" | "remote" | "dynamic";

export interface ForwardRuleDraft {
  kind: ForwardKind;
  bind_host: string;
  bind_port: number;
  target_host: string;
  target_port: number;
}

export interface ForwardRuleInfo {
  id: string;
  session_id: string;
  kind: ForwardKind;
  bind_host: string;
  bind_port: number;
  target_host: string;
  target_port: number;
  active: boolean;
  active_connections: number;
  bytes_sent: number;
  bytes_received: number;
  error: string | null;
}

export interface ProcessDetail {
  pid: number;
  user: string;
  cpu_percent: number;
  memory_bytes: number;
  stat: string;
  command: string;
}

export interface SystemdUnit {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  cpu_percent: string;
  memory_usage: string;
  ports: string;
}

export interface ProcessMetric {
  name: string;
  cpu_percent: number;
  memory_bytes: number;
}

export interface MountMetric {
  path: string;
  available: number;
  total: number;
  percent: number;
}

export interface SystemMetrics {
  hostname: string;
  system: string;
  cpu_percent: number | null;
  memory_percent: number;
  memory_used: number;
  memory_total: number;
  load_average: number[];
  disk_percent: number;
  disk_used: number;
  disk_total: number;
  uptime_seconds: number;
  swap_percent: number;
  swap_used: number;
  swap_total: number;
  network_receive_bytes: number;
  network_transmit_bytes: number;
  processes: ProcessMetric[];
  mounts: MountMetric[];
}

export interface MetricsPoint {
  time: number;
  cpu: number;
  memory: number;
  disk: number;
  rxRate: number;
  txRate: number;
}

export interface MetricsPeaks {
  cpu: number;
  memory: number;
  disk: number;
  rxRate: number;
  txRate: number;
}

export type Status = "connecting" | "authenticating" | "connected" | "closed";

export type SessionEvent =
  | { kind: "status"; session_id: string; status: Status; message: string | null }
  | { kind: "output"; session_id: string; data: string };

export type SessionMode = "terminal" | "dual" | "ops";
export type OpsTab = "trends" | "processes" | "services" | "docker" | "forwards";

export interface Session {
  id: string;
  kind: "ssh" | "local";
  localShell?: LocalShellKind;
  profile: Connection;
  terminal: Terminal;
  fit: FitAddon;
  element: HTMLDivElement;
  fileElement: HTMLDivElement;
  metricsElement: HTMLDivElement;
  status: Status;
  path: string;
  localPath: string;
  view: "terminal" | "files";
  mode: SessionMode;
  opsTab: OpsTab;
  loadingFiles: boolean;
  filesLoaded: boolean;
  directoryRequest: number;
  metricsTimer?: number;
  metricsIntervalMs?: number;
  refreshingMetrics: boolean;
  manualClose: boolean;
  reconnectAttempts: number;
  reconnectTimer?: number;
  inputBuffer: string;
  recentOutputTail: string;
  lastHistoryEntryId?: string;
}

export interface HostKey {
  code: "host_key_confirmation" | "host_key_known";
  algorithm: string;
  fingerprint: string;
  host_key: string;
  changed: boolean;
  previous_fingerprint: string | null;
}

export interface DiscoveredHost {
  profile: Connection;
  key: HostKey;
  known: boolean;
}

export interface NetworkSample {
  received: number;
  sent: number;
  time: number;
}
