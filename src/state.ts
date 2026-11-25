import { api } from "./api.ts";
import { setLanguage } from "./i18n/index.ts";
import { applyAppTheme } from "./themes.ts";
import type {
  AlertLogEntry,
  AlertRule,
  CommandSnippet,
  Connection,
  ConnectionMeta,
  ConnectionSortMode,
  DiscoveredHost,
  HistoryEntry,
  MetricsPeaks,
  MetricsPoint,
  MetricsVisibility,
  NetworkSample,
  Session,
  TerminalSettings,
  TransferTask,
  WorkbenchState,
} from "./types.ts";

export function defaultConnectionMeta(): ConnectionMeta {
  return {
    group: "",
    tags: [],
    favorite: false,
    sort_order: 0,
    connect_timeout_secs: null,
    auto_reconnect: null,
  };
}

export function defaultMetricsVisibility(): MetricsVisibility {
  return {
    cpu: true,
    memory: true,
    swap: true,
    network: true,
    disk: true,
    processes: true,
    mounts: true,
  };
}

export function defaultAlertRules(): AlertRule[] {
  return [
    { id: "alert-cpu", metric: "cpu", threshold: 85, cooldown_secs: 60, enabled: true },
    { id: "alert-mem", metric: "memory", threshold: 90, cooldown_secs: 60, enabled: true },
    { id: "alert-disk", metric: "disk", threshold: 90, cooldown_secs: 120, enabled: true },
  ];
}

export function defaultSettings(): TerminalSettings {
  return {
    language: "zh-CN",
    close_action: "ask",
    local_shell_privilege: "ask",
    auto_check_updates: true,
    font_family: '"Cascadia Mono", Consolas, monospace',
    font_size: 14,
    theme: "obsidian-emerald",
    copy_on_select: false,
    right_click_paste: true,
    auto_reconnect: true,
    reconnect_max_attempts: 3,
    connect_timeout_secs: 15,
    metrics_interval_secs: 2,
    metrics_process_limit: 6,
    metrics_warn_percent: 75,
    metrics_danger_percent: 90,
    metrics_visible: defaultMetricsVisibility(),
    metrics_collapsed: [],
    create_backup_on_edit: true,
    verify_transfer_checksum: true,
    alert_rules: defaultAlertRules(),
  };
}

export function defaultSnippets(): CommandSnippet[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      id: "preset-update-apt",
      name: "更新系统软件包 (Debian/Ubuntu)",
      command: "sudo apt update && sudo apt upgrade -y",
      group: "系统维护",
      shortcut: "Alt+1",
      description: "刷新软件源并更新已安装软件包",
      updated_at: now,
    },
    {
      id: "preset-journal-tail",
      name: "查看最近系统日志",
      command: "journalctl -xe -n 100 --no-pager",
      group: "日志排查",
      shortcut: "Alt+2",
      description: "显示最近 100 条系统报错与服务日志",
      updated_at: now,
    },
    {
      id: "preset-restart-service",
      name: "重启并检查服务状态",
      command: "sudo systemctl restart {service} && sudo systemctl status {service} --no-pager",
      group: "服务管理",
      shortcut: "Alt+3",
      description: "支持变量 {service}，例如 nginx、docker",
      updated_at: now,
    },
    {
      id: "preset-domain-cert",
      name: "检查域名站点与证书",
      command: "curl -Iv https://{domain} 2>&1 | head -n 25",
      group: "网络诊断",
      shortcut: "Alt+4",
      description: "使用变量 {domain} 检查 HTTPS 响应头与证书信息",
      updated_at: now,
    },
  ];
}

export interface AppState {
  connections: Map<string, Connection>;
  sessions: Map<string, Session>;
  pendingOutput: Map<string, Uint8Array[]>;
  cpuHistory: Map<string, number[]>;
  networkHistory: Map<string, NetworkSample>;
  metricsSeries: Map<string, MetricsPoint[]>;
  metricsPeaks: Map<string, MetricsPeaks>;
  alertCooldowns: Map<string, number>;
  alertLogs: AlertLogEntry[];
  transfers: Map<string, TransferTask>;
  activeId: string | null;
  connectionFilter: string;
  connectionGroupFilter: string;
  connectionSort: ConnectionSortMode;
  sidebarCollapsed: boolean;
  isElevated: boolean;
  busy: boolean;
  connecting: boolean;
  discoveredHost: DiscoveredHost | null;
  workbench: WorkbenchState;
  historyFilter: string;
  historyDedupe: boolean;
  historyCursor: number;
  snippetGroupFilter: string;
  snippetSearch: string;
  variableMemory: Record<string, string>;
}

export const state: AppState = {
  connections: new Map(),
  sessions: new Map(),
  pendingOutput: new Map(),
  cpuHistory: new Map(),
  networkHistory: new Map(),
  metricsSeries: new Map(),
  metricsPeaks: new Map(),
  alertCooldowns: new Map(),
  alertLogs: [],
  transfers: new Map(),
  activeId: null,
  connectionFilter: "",
  connectionGroupFilter: "all",
  connectionSort: "favorite",
  sidebarCollapsed: false,
  isElevated: false,
  busy: false,
  connecting: false,
  discoveredHost: null,
  workbench: {
    schema_version: 1,
    connection_meta: {},
    history: [],
    snippets: defaultSnippets(),
    settings: defaultSettings(),
  },
  historyFilter: "",
  historyDedupe: false,
  historyCursor: -1,
  snippetGroupFilter: "all",
  snippetSearch: "",
  variableMemory: {},
};

export function getActiveSession(): Session | undefined {
  return state.activeId ? state.sessions.get(state.activeId) : undefined;
}

export function getConnectionMeta(profileId: string): ConnectionMeta {
  return state.workbench.connection_meta[profileId] ?? defaultConnectionMeta();
}

export function setConnectionMeta(profileId: string, meta: ConnectionMeta): void {
  state.workbench.connection_meta[profileId] = meta;
  void persistWorkbenchState();
}

let persistTimer: number | undefined;

export function persistWorkbenchState(): Promise<void> {
  if (persistTimer !== undefined) {
    window.clearTimeout(persistTimer);
  }
  return new Promise(resolve => {
    persistTimer = window.setTimeout(() => {
      persistTimer = undefined;
      void api.saveWorkbenchState(state.workbench).catch(() => undefined).finally(resolve);
    }, 120);
  });
}

export async function flushWorkbenchState(): Promise<void> {
  if (persistTimer !== undefined) {
    window.clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  await api.saveWorkbenchState(state.workbench).catch(() => undefined);
}

export async function loadWorkbenchState(): Promise<void> {
  try {
    const loaded = await api.loadWorkbenchState();
    const defaults = defaultSettings();
    state.workbench = {
      schema_version: loaded.schema_version || 1,
      connection_meta: loaded.connection_meta ?? {},
      history: (loaded.history ?? []) as HistoryEntry[],
      snippets:
        loaded.snippets && loaded.snippets.length > 0
          ? loaded.snippets
          : loaded.schema_version > 0 && Object.keys(loaded.connection_meta ?? {}).length > 0
            ? loaded.snippets
            : defaultSnippets(),
      settings: {
        ...defaults,
        ...(loaded.settings ?? {}),
        metrics_visible: {
          ...defaultMetricsVisibility(),
          ...(loaded.settings?.metrics_visible ?? {}),
        },
        metrics_collapsed: loaded.settings?.metrics_collapsed ?? [],
        alert_rules:
          loaded.settings?.alert_rules && loaded.settings.alert_rules.length > 0
            ? loaded.settings.alert_rules
            : defaults.alert_rules,
      },
    };
  } catch {
    // Keep defaults
  }
  applyAppTheme(state.workbench.settings.theme);
  setLanguage(state.workbench.settings.language, true);
}
