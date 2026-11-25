import { api, friendlyError } from "../api.ts";
import { formatLocaleClock, onLanguageChange, t } from "../i18n/index.ts";
import { icon } from "../icons.ts";
import { getActiveSession, persistWorkbenchState, state } from "../state.ts";
import type { Session, SystemMetrics } from "../types.ts";
import { $, attachHorizontalResizer, escapeHtml, formatBytes, formatUptime, notify } from "../utils.ts";
import { refreshTrendsIfVisible } from "./ops.ts";

let sparklineUid = 0;
let onOpenCustomize: () => void = () => {};
const lastRenderCache = new WeakMap<
  Session,
  { metrics: SystemMetrics; cpuValues: number[]; rxRate: number; txRate: number }
>();

export function setMetricsCustomizeHandler(handler: () => void): void {
  onOpenCustomize = handler;
}

function toneClass(percent: number): string {
  const { metrics_warn_percent, metrics_danger_percent } = state.workbench.settings;
  if (percent >= metrics_danger_percent) return "is-danger";
  if (percent >= metrics_warn_percent) return "is-warn";
  return "";
}

function isSectionCollapsed(key: string): boolean {
  return state.workbench.settings.metrics_collapsed.includes(key);
}

function toggleSectionCollapsed(key: string): void {
  const list = state.workbench.settings.metrics_collapsed;
  const idx = list.indexOf(key);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(key);
  void persistWorkbenchState();
}

function renderCollapsibleGroup(key: string, title: string, bodyHtml: string): string {
  const collapsed = isSectionCollapsed(key);
  return `
    <section class="metrics-group ${collapsed ? "is-collapsed" : ""}" data-metrics-group="${key}">
      <button type="button" class="metrics-group-toggle" data-toggle-group="${key}">
        <span>${title}</span>
        ${icon("chevronDown")}
      </button>
      <div class="metrics-group-body">${bodyHtml}</div>
    </section>
  `;
}

function renderMetricCard(
  label: string,
  value: string,
  percent: number,
  detail: string,
  extraHtml = "",
): string {
  const clamped = Math.min(100, Math.max(0, percent));
  const tone = toneClass(clamped);
  return `
    <div class="metric-card ${tone}">
      <div class="metric-card-head"><span>${label}</span><strong>${value}</strong></div>
      <div class="metric-track"><span style="width:${clamped}%"></span></div>
      ${extraHtml}
      ${detail ? `<small>${detail}</small>` : ""}
    </div>
  `;
}

function renderSparkline(values: number[]): string {
  const gradId = `cpu-grad-${++sparklineUid}`;
  const coords = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 28 - Math.min(100, Math.max(0, value)) * 0.24;
    return [x, y] as const;
  });

  const linePoints = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const areaPoints = coords.length
    ? `0,30 ${linePoints} ${coords[coords.length - 1][0]},30`
    : "";

  return `
    <svg class="metric-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="CPU 最近趋势">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.32" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      ${areaPoints ? `<polygon points="${areaPoints}" fill="url(#${gradId})" />` : ""}
      <polyline points="${linePoints}" />
    </svg>
  `;
}

function renderMetricsHtml(
  metrics: SystemMetrics,
  cpuValues: number[],
  rxRate: number,
  txRate: number,
): string {
  const { metrics_visible: vis, metrics_process_limit: procLimit } = state.workbench.settings;
  const cpuValue = metrics.cpu_percent === null ? t("metrics.sampling") : `${metrics.cpu_percent.toFixed(1)}%`;

  const loadChips = metrics.load_average
    .map(value => `<span class="load-chip">${value.toFixed(2)}</span>`)
    .join("");

  const hostGroup = renderCollapsibleGroup(
    "host",
    t("metrics.hostGroup"),
    `
      <div class="host-summary">
        <div class="host-summary-top">
          <strong>${escapeHtml(metrics.hostname)}</strong>
          <span class="uptime-pill">${formatUptime(metrics.uptime_seconds)}</span>
        </div>
        <small>${escapeHtml(metrics.system)}</small>
        <div class="load-summary">
          <span>${t("metrics.load")}</span>
          <div class="load-chips">${loadChips}</div>
        </div>
      </div>
    `,
  );

  const computeCards: string[] = [];
  if (vis.cpu) {
    computeCards.push(
      renderMetricCard("CPU", cpuValue, metrics.cpu_percent ?? 0, "", renderSparkline(cpuValues)),
    );
  }
  const memSwap: string[] = [];
  if (vis.memory) {
    memSwap.push(
      renderMetricCard(
        t("metrics.memory"),
        `${metrics.memory_percent.toFixed(1)}%`,
        metrics.memory_percent,
        `${formatBytes(metrics.memory_used)} / ${formatBytes(metrics.memory_total)}`,
      ),
    );
  }
  if (vis.swap) {
    memSwap.push(
      renderMetricCard(
        t("metrics.swap"),
        `${metrics.swap_percent.toFixed(1)}%`,
        metrics.swap_percent,
        `${formatBytes(metrics.swap_used)} / ${formatBytes(metrics.swap_total)}`,
      ),
    );
  }
  if (memSwap.length) {
    computeCards.push(`<div class="metric-grid">${memSwap.join("")}</div>`);
  }
  const computeGroup = computeCards.length
    ? renderCollapsibleGroup("compute", t("metrics.computeGroup"), computeCards.join(""))
    : "";

  const networkGroup = vis.network
    ? renderCollapsibleGroup(
        "network",
        t("metrics.networkGroup"),
        `
          <div class="network-summary">
            <div class="net-tile rx">
              <span>${t("metrics.rx")}</span>
              <strong>${formatBytes(rxRate)}/s</strong>
            </div>
            <div class="net-tile tx">
              <span>${t("metrics.tx")}</span>
              <strong>${formatBytes(txRate)}/s</strong>
            </div>
          </div>
        `,
      )
    : "";

  const storageItems: string[] = [];
  if (vis.disk) {
    storageItems.push(
      renderMetricCard(
        t("metrics.rootDisk"),
        `${metrics.disk_percent.toFixed(1)}%`,
        metrics.disk_percent,
        `${formatBytes(metrics.disk_used)} / ${formatBytes(metrics.disk_total)}`,
      ),
    );
  }
  if (vis.mounts && metrics.mounts.length) {
    const mountsHtml = metrics.mounts
      .map(mount => {
        const clamped = Math.min(100, Math.max(0, mount.percent));
        return `
          <div class="mount-row ${toneClass(clamped)}">
            <div>
              <span title="${escapeHtml(mount.path)}">${escapeHtml(mount.path)}</span>
              <strong>${formatBytes(mount.available)} / ${formatBytes(mount.total)}</strong>
            </div>
            <div class="mount-track"><span style="width:${clamped}%"></span></div>
          </div>
        `;
      })
      .join("");
    storageItems.push(`<div class="metrics-list-box">${mountsHtml}</div>`);
  }
  const storageGroup = storageItems.length
    ? renderCollapsibleGroup("storage", t("metrics.storageGroup"), storageItems.join(""))
    : "";

  const processesGroup =
    vis.processes && metrics.processes.length
      ? renderCollapsibleGroup(
          "processes",
          t("metrics.processesGroup", { count: Math.min(procLimit, metrics.processes.length) }),
          `<div class="metrics-list-box">${metrics.processes
            .slice(0, procLimit)
            .map(
              process => `
                <div class="process-row">
                  <span title="${escapeHtml(process.name)}">${escapeHtml(process.name)}</span>
                  <strong>${process.cpu_percent.toFixed(1)}%</strong>
                  <small>${formatBytes(process.memory_bytes)}</small>
                </div>
              `,
            )
            .join("")}</div>`,
        )
      : "";

  return `
    ${hostGroup}
    ${computeGroup}
    ${networkGroup}
    ${storageGroup}
    ${processesGroup}
    <div class="metrics-updated">${t("metrics.updatedAt", { time: formatLocaleClock() })}</div>
  `;
}

function updateMetricsFooter(): void {
  const sec = state.workbench.settings.metrics_interval_secs;
  $("#metrics-foot").textContent = t("metrics.foot", { sec });
}

export async function fetchAndRenderMetrics(session: Session): Promise<void> {
  if (session.refreshingMetrics || session.status !== "connected") return;
  session.refreshingMetrics = true;

  try {
    const metrics = await api.systemMetrics(session.id);
    const history = state.cpuHistory.get(session.id) ?? [];
    if (metrics.cpu_percent !== null) history.push(metrics.cpu_percent);
    const trimmedCpu = history.slice(-40);
    state.cpuHistory.set(session.id, trimmedCpu);

    const now = Date.now();
    const previousNetwork = state.networkHistory.get(session.id);
    state.networkHistory.set(session.id, {
      received: metrics.network_receive_bytes,
      sent: metrics.network_transmit_bytes,
      time: now,
    });

    const elapsed = previousNetwork ? Math.max(0.1, (now - previousNetwork.time) / 1000) : 1;
    const received = previousNetwork
      ? Math.max(0, metrics.network_receive_bytes - previousNetwork.received) / elapsed
      : 0;
    const sent = previousNetwork
      ? Math.max(0, metrics.network_transmit_bytes - previousNetwork.sent) / elapsed
      : 0;

    const scrollTop = session.metricsElement.scrollTop;
    lastRenderCache.set(session, { metrics, cpuValues: trimmedCpu, rxRate: received, txRate: sent });
    session.metricsElement.innerHTML = renderMetricsHtml(metrics, trimmedCpu, received, sent);
    session.metricsElement.scrollTop = scrollTop;
    updateMetricsFooter();

    // Record long-term history & peak stats
    const series = state.metricsSeries.get(session.id) ?? [];
    const cpuVal = metrics.cpu_percent ?? 0;
    series.push({
      time: now,
      cpu: cpuVal,
      memory: metrics.memory_percent,
      disk: metrics.disk_percent,
      rxRate: received,
      txRate: sent,
    });
    if (series.length > 180) series.splice(0, series.length - 180);
    state.metricsSeries.set(session.id, series);

    const prevPeaks = state.metricsPeaks.get(session.id) ?? {
      cpu: 0,
      memory: 0,
      disk: 0,
      rxRate: 0,
      txRate: 0,
    };
    state.metricsPeaks.set(session.id, {
      cpu: Math.max(prevPeaks.cpu, cpuVal),
      memory: Math.max(prevPeaks.memory, metrics.memory_percent),
      disk: Math.max(prevPeaks.disk, metrics.disk_percent),
      rxRate: Math.max(prevPeaks.rxRate, received),
      txRate: Math.max(prevPeaks.txRate, sent),
    });

    evaluateAlertRules(session, metrics);
    refreshTrendsIfVisible(session.id);
  } catch (error) {
    const message = friendlyError(error);
    if (session.metricsElement.querySelector(".metric-card")) {
      const existing = session.metricsElement.querySelector(".metrics-refresh-error");
      const notice = existing ?? document.createElement("p");
      notice.className = "metrics-refresh-error";
      notice.textContent = t("metrics.refreshError", { msg: message });
      if (!existing) session.metricsElement.prepend(notice);
    } else {
      session.metricsElement.innerHTML = `
        <p class="metrics-placeholder">${escapeHtml(message)}</p>
        <button class="subtle retry-metrics" type="button">${escapeHtml(t("common.retry"))}</button>
      `;
      session.metricsElement
        .querySelector(".retry-metrics")
        ?.addEventListener("click", () => void fetchAndRenderMetrics(session));
    }
  } finally {
    session.refreshingMetrics = false;
  }
}

function evaluateAlertRules(session: Session, metrics: SystemMetrics): void {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const rule of state.workbench.settings.alert_rules) {
    if (!rule.enabled) continue;
    const value =
      rule.metric === "cpu"
        ? metrics.cpu_percent ?? 0
        : rule.metric === "memory"
          ? metrics.memory_percent
          : rule.metric === "swap"
            ? metrics.swap_percent
            : metrics.disk_percent;

    if (value < rule.threshold) continue;
    const cooldownKey = `${session.id}:${rule.id}`;
    const lastFired = state.alertCooldowns.get(cooldownKey) ?? 0;
    if (nowSec - lastFired < rule.cooldown_secs) continue;

    state.alertCooldowns.set(cooldownKey, nowSec);
    state.alertLogs.unshift({
      id: `${nowSec}-${Math.random().toString(36).slice(2, 6)}`,
      session_id: session.id,
      server_name: session.profile.name,
      metric: rule.metric,
      value,
      threshold: rule.threshold,
      timestamp: nowSec,
    });
    if (state.alertLogs.length > 100) state.alertLogs.length = 100;

    const label =
      rule.metric === "cpu"
        ? t("metrics.metricCpu")
        : rule.metric === "memory"
          ? t("metrics.metricMem")
          : rule.metric === "swap"
            ? t("metrics.metricSwap")
            : t("metrics.metricDisk");
    notify(
      t("metrics.alertNotify", {
        server: session.profile.name,
        metric: label,
        value: value.toFixed(1),
        threshold: rule.threshold,
      }),
      true,
    );
  }
}

export function startMetrics(session: Session): void {
  const intervalMs = Math.max(1000, state.workbench.settings.metrics_interval_secs * 1000);
  if (session.metricsTimer !== undefined && session.metricsIntervalMs === intervalMs) return;
  if (session.metricsTimer !== undefined) {
    window.clearInterval(session.metricsTimer);
  }
  session.metricsIntervalMs = intervalMs;
  updateMetricsFooter();
  void fetchAndRenderMetrics(session);
  session.metricsTimer = window.setInterval(() => void fetchAndRenderMetrics(session), intervalMs);
}

export function restartAllMetricsTimers(): void {
  updateMetricsFooter();
  for (const session of state.sessions.values()) {
    if (session.status === "connected") {
      if (session.metricsTimer !== undefined) {
        window.clearInterval(session.metricsTimer);
        session.metricsTimer = undefined;
      }
      startMetrics(session);
    }
  }
}

export function initMetricsPanel(): void {
  const panel = $("#metrics-panel");
  const resizer = $("#metrics-resizer");
  const toggleBtn = $<HTMLButtonElement>("#toggle-metrics");

  updateMetricsFooter();
  onLanguageChange(() => {
    updateMetricsFooter();
    toggleBtn.title = t(panel.classList.contains("hidden") ? "session.showMetrics" : "session.hideMetrics");
    for (const session of state.sessions.values()) {
      const cached = lastRenderCache.get(session);
      if (cached) {
        session.metricsElement.innerHTML = renderMetricsHtml(
          cached.metrics,
          cached.cpuValues,
          cached.rxRate,
          cached.txRate,
        );
      }
    }
  });

  $("#metrics-customize-btn").addEventListener("click", () => onOpenCustomize());

  panel.addEventListener("click", event => {
    const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-toggle-group]");
    if (!toggle) return;
    const key = toggle.dataset.toggleGroup!;
    toggleSectionCollapsed(key);
    toggle.closest(".metrics-group")?.classList.toggle("is-collapsed", isSectionCollapsed(key));
  });

  toggleBtn.addEventListener("click", () => {
    const hidden = panel.classList.toggle("hidden");
    resizer.classList.toggle("hidden", hidden);
    toggleBtn.classList.toggle("active", !hidden);
    toggleBtn.title = t(hidden ? "session.showMetrics" : "session.hideMetrics");
    const session = getActiveSession();
    if (session) requestAnimationFrame(() => session.fit.fit());
  });

  attachHorizontalResizer({
    resizer,
    panel,
    direction: 1,
    minWidth: 185,
    maxWidth: 440,
    getAvailableWidth: () =>
      $("#session-workspace").clientWidth -
      ($("#files-panel").classList.contains("hidden") ? 0 : $("#files-panel").clientWidth),
    onFinish: () => getActiveSession()?.fit.fit(),
  });
}
