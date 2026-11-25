import { api, friendlyError } from "../api.ts";
import { icon } from "../icons.ts";
import { getActiveSession, persistWorkbenchState, state } from "../state.ts";
import type {
  AlertRule,
  DockerContainer,
  ForwardKind,
  ForwardRuleInfo,
  MetricsPoint,
  OpsTab,
  ProcessDetail,
  Session,
  SystemdUnit,
} from "../types.ts";
import { $, escapeHtml, formatBytes, notify } from "../utils.ts";

let cachedProcesses: ProcessDetail[] = [];
let cachedServices: SystemdUnit[] = [];
let cachedDocker: DockerContainer[] = [];
let cachedForwards: ForwardRuleInfo[] = [];

function renderChartSvg(
  values: number[],
  maxVal: number,
  color: string,
  secondaryValues?: number[],
  secondaryColor?: string,
): string {
  const safeMax = Math.max(1, maxVal);
  const makePoints = (arr: number[]) =>
    arr
      .map((val, idx) => {
        const x = arr.length <= 1 ? 0 : (idx / (arr.length - 1)) * 100;
        const y = 38 - Math.min(1, Math.max(0, val / safeMax)) * 34;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

  const p1 = makePoints(values);
  const area1 = values.length ? `0,40 ${p1} 100,40` : "";
  const p2 = secondaryValues ? makePoints(secondaryValues) : "";

  return `
    <svg class="ops-trend-svg" viewBox="0 0 100 40" preserveAspectRatio="none">
      ${area1 ? `<polygon points="${area1}" fill="${color}" fill-opacity="0.16" />` : ""}
      ${p1 ? `<polyline points="${p1}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" />` : ""}
      ${p2 && secondaryColor ? `<polyline points="${p2}" fill="none" stroke="${secondaryColor}" stroke-width="1.5" vector-effect="non-scaling-stroke" />` : ""}
    </svg>
  `;
}

function renderTrendsView(session: Session): void {
  const series: MetricsPoint[] = state.metricsSeries.get(session.id) ?? [];
  const peaks = state.metricsPeaks.get(session.id) ?? {
    cpu: 0,
    memory: 0,
    disk: 0,
    rxRate: 0,
    txRate: 0,
  };
  const latest = series[series.length - 1];
  const maxNet = Math.max(1024, peaks.rxRate, peaks.txRate);

  const rulesHtml = state.workbench.settings.alert_rules
    .map(
      rule => `
        <div class="alert-rule-row" data-alert-id="${escapeHtml(rule.id)}">
          <label class="check-pill">
            <input type="checkbox" data-rule-enabled="${escapeHtml(rule.id)}" ${rule.enabled ? "checked" : ""} />
            <select data-rule-metric="${escapeHtml(rule.id)}">
              <option value="cpu" ${rule.metric === "cpu" ? "selected" : ""}>CPU</option>
              <option value="memory" ${rule.metric === "memory" ? "selected" : ""}>内存</option>
              <option value="disk" ${rule.metric === "disk" ? "selected" : ""}>磁盘</option>
              <option value="swap" ${rule.metric === "swap" ? "selected" : ""}>交换</option>
            </select>
          </label>
          <span class="rule-op">&gt;</span>
          <input type="number" min="10" max="99" value="${rule.threshold}" data-rule-threshold="${escapeHtml(rule.id)}" aria-label="告警阈值%" />
          <span>%</span>
          <span class="rule-cool-label">冷却</span>
          <input type="number" min="5" max="3600" value="${rule.cooldown_secs}" data-rule-cooldown="${escapeHtml(rule.id)}" aria-label="冷却秒数" />
          <span>秒</span>
          <button type="button" class="icon-button" data-rule-del="${escapeHtml(rule.id)}" title="删除规则">${icon("trash")}</button>
        </div>
      `,
    )
    .join("");

  const logsHtml = state.alertLogs
    .slice(0, 20)
    .map(
      log => `
        <div class="alert-log-row">
          <span class="alert-badge">${escapeHtml(log.metric.toUpperCase())}</span>
          <span>${escapeHtml(log.server_name)} 达到 <strong>${log.value.toFixed(1)}%</strong>（阈值 ${log.threshold}%）</span>
          <small>${new Date(log.timestamp * 1000).toLocaleTimeString("zh-CN", { hour12: false })}</small>
        </div>
      `,
    )
    .join("") || '<div class="empty-drawer small-pad">暂无触发的告警记录</div>';

  $("#ops-trends-panel").innerHTML = `
    <div class="ops-trends-grid">
      <div class="ops-chart-card">
        <div class="ops-chart-head">
          <span>CPU 历史趋势 (${series.length} 点)</span>
          <strong>当前 ${latest ? latest.cpu.toFixed(1) : "0.0"}% · 峰值 ${peaks.cpu.toFixed(1)}%</strong>
        </div>
        ${renderChartSvg(series.map(p => p.cpu), 100, "var(--accent)")}
      </div>
      <div class="ops-chart-card">
        <div class="ops-chart-head">
          <span>内存历史趋势</span>
          <strong>当前 ${latest ? latest.memory.toFixed(1) : "0.0"}% · 峰值 ${peaks.memory.toFixed(1)}%</strong>
        </div>
        ${renderChartSvg(series.map(p => p.memory), 100, "var(--sky)")}
      </div>
      <div class="ops-chart-card">
        <div class="ops-chart-head">
          <span>网络吞吐趋势 (↓ 接收 / ↑ 发送)</span>
          <strong>峰值 ↓${formatBytes(peaks.rxRate)}/s · ↑${formatBytes(peaks.txRate)}/s</strong>
        </div>
        ${renderChartSvg(
          series.map(p => p.rxRate),
          maxNet,
          "var(--sky)",
          series.map(p => p.txRate),
          "var(--violet)",
        )}
      </div>
      <div class="ops-chart-card">
        <div class="ops-chart-head">
          <span>根目录磁盘趋势</span>
          <strong>当前 ${latest ? latest.disk.toFixed(1) : "0.0"}% · 峰值 ${peaks.disk.toFixed(1)}%</strong>
        </div>
        ${renderChartSvg(series.map(p => p.disk), 100, "var(--warn)")}
      </div>
    </div>

    <div class="ops-alerts-grid">
      <section class="ops-subcard">
        <div class="ops-subcard-head">
          <h3>${icon("bell")} 告警规则（带冷却防抖）</h3>
          <button id="add-alert-rule-btn" type="button" class="subtle">${icon("plus")} 添加规则</button>
        </div>
        <div id="alert-rules-list">${rulesHtml}</div>
      </section>
      <section class="ops-subcard">
        <div class="ops-subcard-head">
          <h3>最近告警日志</h3>
          <button id="clear-alert-logs-btn" type="button" class="subtle">清空</button>
        </div>
        <div class="alert-logs-list">${logsHtml}</div>
      </section>
    </div>
  `;

  $("#add-alert-rule-btn").addEventListener("click", () => {
    const newRule: AlertRule = {
      id: `alert-${Date.now()}`,
      metric: "cpu",
      threshold: 85,
      cooldown_secs: 60,
      enabled: true,
    };
    state.workbench.settings.alert_rules.push(newRule);
    void persistWorkbenchState();
    renderTrendsView(session);
  });

  $("#clear-alert-logs-btn").addEventListener("click", () => {
    state.alertLogs = [];
    renderTrendsView(session);
  });

  $("#alert-rules-list").addEventListener("change", event => {
    const target = event.target as HTMLElement;
    const id =
      target.dataset.ruleEnabled ??
      target.dataset.ruleMetric ??
      target.dataset.ruleThreshold ??
      target.dataset.ruleCooldown;
    if (!id) return;
    const rule = state.workbench.settings.alert_rules.find(r => r.id === id);
    if (!rule) return;

    if (target.dataset.ruleEnabled) rule.enabled = (target as HTMLInputElement).checked;
    if (target.dataset.ruleMetric) rule.metric = (target as HTMLSelectElement).value as AlertRule["metric"];
    if (target.dataset.ruleThreshold) rule.threshold = Math.max(10, Math.min(99, Number((target as HTMLInputElement).value) || 85));
    if (target.dataset.ruleCooldown) rule.cooldown_secs = Math.max(5, Math.min(3600, Number((target as HTMLInputElement).value) || 60));
    void persistWorkbenchState();
  });

  $("#alert-rules-list").addEventListener("click", event => {
    const del = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rule-del]");
    if (!del) return;
    state.workbench.settings.alert_rules = state.workbench.settings.alert_rules.filter(
      r => r.id !== del.dataset.ruleDel,
    );
    void persistWorkbenchState();
    renderTrendsView(session);
  });
}

function renderProcessesList(): void {
  const query = $<HTMLInputElement>("#ops-proc-search").value.trim().toLowerCase();
  const sort = $<HTMLSelectElement>("#ops-proc-sort").value;

  const filtered = cachedProcesses
    .filter(p => {
      if (!query) return true;
      return `${p.pid} ${p.user} ${p.command}`.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (sort === "mem") return b.memory_bytes - a.memory_bytes;
      if (sort === "pid") return a.pid - b.pid;
      if (sort === "name") return a.command.localeCompare(b.command);
      return b.cpu_percent - a.cpu_percent;
    });

  $("#ops-proc-list").innerHTML =
    filtered
      .map(
        p => `
          <div class="ops-table-row proc-cols">
            <span class="mono">${p.pid}</span>
            <span>${escapeHtml(p.user)}</span>
            <span class="mono ${p.cpu_percent >= 50 ? "text-warn" : ""}">${p.cpu_percent.toFixed(1)}%</span>
            <span class="mono">${formatBytes(p.memory_bytes)}</span>
            <span class="mono">${escapeHtml(p.stat)}</span>
            <span class="ops-cmd-cell" title="${escapeHtml(p.command)}">${escapeHtml(p.command)}</span>
            <div class="ops-row-actions">
              <button type="button" class="subtle" data-proc-term="${p.pid}" data-cmd="${escapeHtml(p.command)}">结束</button>
              <button type="button" class="subtle danger-ghost" data-proc-kill="${p.pid}" data-cmd="${escapeHtml(p.command)}">强杀</button>
            </div>
          </div>
        `,
      )
      .join("") || '<div class="empty-drawer">没有匹配的进程</div>';
}

function renderServicesList(): void {
  const query = $<HTMLInputElement>("#ops-svc-search").value.trim().toLowerCase();
  const filter = $<HTMLSelectElement>("#ops-svc-filter").value;

  const filtered = cachedServices.filter(svc => {
    if (filter !== "all" && svc.active !== filter) return false;
    if (!query) return true;
    return `${svc.unit} ${svc.description}`.toLowerCase().includes(query);
  });

  $("#ops-svc-list").innerHTML =
    filtered
      .map(svc => {
        const running = svc.active === "active";
        return `
          <div class="ops-table-row svc-cols">
            <span class="mono" title="${escapeHtml(svc.unit)}">${escapeHtml(svc.unit)}</span>
            <span><span class="state-pill ${svc.active}">${escapeHtml(svc.active)}/${escapeHtml(svc.sub)}</span></span>
            <span class="ops-cmd-cell" title="${escapeHtml(svc.description)}">${escapeHtml(svc.description)}</span>
            <div class="ops-row-actions">
              <button type="button" class="subtle" data-svc-logs="${escapeHtml(svc.unit)}">日志</button>
              ${
                running
                  ? `<button type="button" class="subtle" data-svc-act="restart" data-unit="${escapeHtml(svc.unit)}">重启</button>
                     <button type="button" class="subtle danger-ghost" data-svc-act="stop" data-unit="${escapeHtml(svc.unit)}">停止</button>`
                  : `<button type="button" class="primary" data-svc-act="start" data-unit="${escapeHtml(svc.unit)}">启动</button>`
              }
            </div>
          </div>
        `;
      })
      .join("") || '<div class="empty-drawer">未发现匹配的 systemd 服务</div>';
}

function parseDockerStatus(statusText: string): { main: string; detail: string; health: string } {
  let text = statusText.trim();
  let health = "";
  const healthMatch = text.match(/\((healthy|unhealthy|health: starting)\)$/i);
  if (healthMatch) {
    health = healthMatch[1];
    text = text.slice(0, healthMatch.index).trim();
  }
  const exitedMatch = text.match(/^(Exited\s+\(\d+\))\s+(.+)$/i);
  if (exitedMatch) {
    return { main: exitedMatch[1], detail: exitedMatch[2], health };
  }
  return { main: text || "—", detail: "", health };
}

function renderDockerPorts(portsText: string): string {
  const raw = portsText.trim();
  if (!raw) return '<span class="docker-port-empty">未暴露端口</span>';
  const items = raw
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  return `
    <div class="docker-ports-wrap" title="${escapeHtml(raw)}">
      ${shown
        .map(p => `<span class="docker-port-chip">${escapeHtml(p.replaceAll("->", " → "))}</span>`)
        .join("")}
      ${more > 0 ? `<span class="docker-port-more">+${more}</span>` : ""}
    </div>
  `;
}

function renderDockerList(): void {
  const query = $<HTMLInputElement>("#ops-docker-search").value.trim().toLowerCase();
  const stateFilter = $<HTMLSelectElement>("#ops-docker-filter")?.value ?? "all";
  const runningTotal = cachedDocker.filter(c => c.state.toLowerCase() === "running").length;
  const summaryEl = document.querySelector<HTMLElement>("#ops-docker-summary");
  if (summaryEl) {
    summaryEl.textContent = `运行 ${runningTotal} / 共 ${cachedDocker.length}`;
  }

  const filtered = cachedDocker.filter(c => {
    const isRunning = c.state.toLowerCase() === "running";
    if (stateFilter === "running" && !isRunning) return false;
    if (stateFilter === "stopped" && isRunning) return false;
    if (!query) return true;
    return `${c.name} ${c.image} ${c.id}`.toLowerCase().includes(query);
  });

  $("#ops-docker-list").innerHTML =
    filtered
      .map(c => {
        const running = c.state.toLowerCase() === "running";
        const { main, detail, health } = parseDockerStatus(c.status);
        const healthBadge = health
          ? `<span class="docker-health-tag ${health.toLowerCase().includes("unhealthy") ? "is-bad" : ""}">${escapeHtml(health)}</span>`
          : "";
        const subText = detail ? `<small class="muted-block">${escapeHtml(detail)}</small>` : "";
        const resHtml =
          running && c.cpu_percent !== "—"
            ? `
              <div class="docker-res-cell">
                <span class="docker-cpu-pill">CPU ${escapeHtml(c.cpu_percent)}</span>
                <small class="mono muted-block">${escapeHtml(c.memory_usage)}</small>
              </div>
            `
            : '<span class="docker-port-empty">—</span>';

        return `
          <div class="ops-table-row docker-cols">
            <div class="docker-name-cell">
              <div class="docker-name-top">
                <span class="status-dot ${running ? "" : "closed"}"></span>
                <strong title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</strong>
              </div>
              <small class="mono muted-block" title="${escapeHtml(c.image)}">${escapeHtml(c.image)}</small>
            </div>
            <div class="docker-status-cell">
              <div class="docker-status-top">
                <span class="state-pill ${running ? "active" : "inactive"}">${escapeHtml(main)}</span>
                ${healthBadge}
              </div>
              ${subText}
            </div>
            ${resHtml}
            ${renderDockerPorts(c.ports)}
            <div class="ops-row-actions">
              <button type="button" class="subtle" data-docker-logs="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">日志</button>
              ${
                running
                  ? `<button type="button" class="subtle" data-docker-act="restart" data-id="${escapeHtml(c.id)}">重启</button>
                     <button type="button" class="subtle danger-ghost" data-docker-act="stop" data-id="${escapeHtml(c.id)}">停止</button>`
                  : `<button type="button" class="primary" data-docker-act="start" data-id="${escapeHtml(c.id)}">启动</button>`
              }
            </div>
          </div>
        `;
      })
      .join("") || '<div class="empty-drawer">未发现匹配的 Docker 容器</div>';
}

function renderForwardsList(): void {
  $("#ops-fwd-list").innerHTML =
    cachedForwards
      .map(rule => {
        const kindLabel =
          rule.kind === "local" ? "本地 (-L)" : rule.kind === "remote" ? "远程 (-R)" : "动态 SOCKS5 (-D)";
        const routeText =
          rule.kind === "dynamic"
            ? `${rule.bind_host}:${rule.bind_port} (SOCKS5 代理)`
            : `${rule.bind_host}:${rule.bind_port} → ${rule.target_host}:${rule.target_port}`;
        return `
          <div class="ops-table-row fwd-cols">
            <span class="state-pill ${rule.active ? "active" : "inactive"}">${kindLabel}</span>
            <span class="mono">${escapeHtml(routeText)}</span>
            <span class="mono">连接 ${rule.active_connections} · ↑${formatBytes(rule.bytes_sent)} ↓${formatBytes(rule.bytes_received)}</span>
            <div class="ops-row-actions">
              ${
                rule.active
                  ? `<button type="button" class="subtle" data-fwd-stop="${rule.id}">停止</button>`
                  : `<button type="button" class="primary" data-fwd-start="${rule.id}">启动</button>`
              }
              <button type="button" class="subtle danger-ghost" data-fwd-del="${rule.id}">删除</button>
            </div>
          </div>
        `;
      })
      .join("") || '<div class="empty-drawer">暂无端口转发规则，上方可添加本地、远程或 SOCKS5 动态转发</div>';
}

export async function refreshActiveOpsTab(): Promise<void> {
  const session = getActiveSession();
  if (!session || session.kind !== "ssh") return;

  const tab = session.opsTab;
  document.querySelectorAll<HTMLButtonElement>("[data-ops-tab]").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.opsTab === tab),
  );
  ["trends", "processes", "services", "docker", "forwards"].forEach(name =>
    $(`#ops-${name}-panel`).classList.toggle("hidden", name !== tab),
  );

  if (tab === "trends") {
    renderTrendsView(session);
    return;
  }

  try {
    if (tab === "processes") {
      cachedProcesses = await api.listProcessesDetailed(session.id);
      renderProcessesList();
    } else if (tab === "services") {
      cachedServices = await api.listSystemdServices(session.id);
      renderServicesList();
    } else if (tab === "docker") {
      cachedDocker = await api.listDockerContainers(session.id);
      renderDockerList();
    } else if (tab === "forwards") {
      cachedForwards = await api.listForwards(session.id);
      renderForwardsList();
    }
  } catch (error) {
    notify(friendlyError(error), true);
  }
}

export function refreshTrendsIfVisible(sessionId: string): void {
  const session = getActiveSession();
  if (session && session.id === sessionId && session.mode === "ops" && session.opsTab === "trends") {
    renderTrendsView(session);
  }
}

function showOpsLogsModal(title: string, content: string): void {
  $("#ops-log-title").textContent = title;
  $("#ops-log-content").textContent = content || "（暂无日志输出）";
  $<HTMLDialogElement>("#ops-log-dialog").showModal();
}

export function initOpsUI(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-ops-tab]").forEach(btn =>
    btn.addEventListener("click", () => {
      const session = getActiveSession();
      if (!session) return;
      session.opsTab = btn.dataset.opsTab as OpsTab;
      void refreshActiveOpsTab();
    }),
  );

  // Processes
  $("#ops-proc-refresh").addEventListener("click", () => void refreshActiveOpsTab());
  $("#ops-proc-search").addEventListener("input", renderProcessesList);
  $("#ops-proc-sort").addEventListener("change", renderProcessesList);
  $("#ops-proc-list").addEventListener("click", async event => {
    const target = event.target as HTMLElement;
    const session = getActiveSession();
    if (!session) return;
    const termBtn = target.closest<HTMLButtonElement>("[data-proc-term]");
    const killBtn = target.closest<HTMLButtonElement>("[data-proc-kill]");
    const btn = termBtn ?? killBtn;
    if (!btn) return;
    const pid = Number(btn.dataset.procTerm ?? btn.dataset.procKill);
    const force = Boolean(killBtn);
    const cmd = btn.dataset.cmd ?? "";
    if (
      !window.confirm(
        `危险操作确认：确定要${force ? "强制杀死 (SIGKILL -9)" : "优雅结束 (SIGTERM -15)"} 进程 PID ${pid}？\n命令：${cmd}`,
      )
    ) {
      return;
    }
    try {
      await api.killProcess(session.id, pid, force);
      notify(`已向进程 ${pid} 发送${force ? "强杀" : "结束"}信号`);
      await refreshActiveOpsTab();
    } catch (error) {
      notify(friendlyError(error), true);
    }
  });

  // Systemd services
  $("#ops-svc-refresh").addEventListener("click", () => void refreshActiveOpsTab());
  $("#ops-svc-search").addEventListener("input", renderServicesList);
  $("#ops-svc-filter").addEventListener("change", renderServicesList);
  $("#ops-svc-list").addEventListener("click", async event => {
    const target = event.target as HTMLElement;
    const session = getActiveSession();
    if (!session) return;
    const logsBtn = target.closest<HTMLButtonElement>("[data-svc-logs]");
    if (logsBtn) {
      const unit = logsBtn.dataset.svcLogs!;
      try {
        const text = await api.readSystemdLogs(session.id, unit, 150);
        showOpsLogsModal(`服务日志 · ${unit}`, text);
      } catch (error) {
        notify(friendlyError(error), true);
      }
      return;
    }
    const actBtn = target.closest<HTMLButtonElement>("[data-svc-act]");
    if (actBtn) {
      const unit = actBtn.dataset.unit!;
      const action = actBtn.dataset.svcAct!;
      if (action !== "start" && !window.confirm(`确定要对服务 ${unit} 执行 ${action}？`)) {
        return;
      }
      try {
        await api.controlSystemdService(session.id, unit, action);
        notify(`服务 ${unit} 已执行 ${action}`);
        await refreshActiveOpsTab();
      } catch (error) {
        notify(friendlyError(error), true);
      }
    }
  });

  // Docker
  $("#ops-docker-refresh").addEventListener("click", () => void refreshActiveOpsTab());
  $("#ops-docker-search").addEventListener("input", renderDockerList);
  $("#ops-docker-filter").addEventListener("change", renderDockerList);
  $("#ops-docker-list").addEventListener("click", async event => {
    const target = event.target as HTMLElement;
    const session = getActiveSession();
    if (!session) return;
    const logsBtn = target.closest<HTMLButtonElement>("[data-docker-logs]");
    if (logsBtn) {
      const cid = logsBtn.dataset.dockerLogs!;
      const name = logsBtn.dataset.name!;
      try {
        const text = await api.readDockerLogs(session.id, cid, 200);
        showOpsLogsModal(`容器日志 · ${name}`, text);
      } catch (error) {
        notify(friendlyError(error), true);
      }
      return;
    }
    const actBtn = target.closest<HTMLButtonElement>("[data-docker-act]");
    if (actBtn) {
      const cid = actBtn.dataset.id!;
      const action = actBtn.dataset.dockerAct!;
      if (action !== "start" && !window.confirm(`确定要对容器 ${cid} 执行 ${action}？`)) {
        return;
      }
      try {
        await api.controlDockerContainer(session.id, cid, action);
        notify(`容器 ${cid} 已执行 ${action}`);
        await refreshActiveOpsTab();
      } catch (error) {
        notify(friendlyError(error), true);
      }
    }
  });

  // Port Forwarding
  const fwdKindSelect = $<HTMLSelectElement>("#fwd-kind");
  fwdKindSelect.addEventListener("change", () => {
    const isDyn = fwdKindSelect.value === "dynamic";
    $<HTMLInputElement>("#fwd-target-host").disabled = isDyn;
    $<HTMLInputElement>("#fwd-target-port").disabled = isDyn;
  });

  $("#fwd-form").addEventListener("submit", async event => {
    event.preventDefault();
    const session = getActiveSession();
    if (!session) return;
    const kind = fwdKindSelect.value as ForwardKind;
    try {
      await api.addForward(session.id, {
        kind,
        bind_host: $<HTMLInputElement>("#fwd-bind-host").value || "127.0.0.1",
        bind_port: Number($<HTMLInputElement>("#fwd-bind-port").value),
        target_host: $<HTMLInputElement>("#fwd-target-host").value || "127.0.0.1",
        target_port: Number($<HTMLInputElement>("#fwd-target-port").value) || 0,
      });
      notify("端口转发规则已启动");
      await refreshActiveOpsTab();
    } catch (error) {
      notify(friendlyError(error), true);
    }
  });

  $("#ops-fwd-list").addEventListener("click", async event => {
    const target = event.target as HTMLElement;
    const stopBtn = target.closest<HTMLButtonElement>("[data-fwd-stop]");
    const startBtn = target.closest<HTMLButtonElement>("[data-fwd-start]");
    const delBtn = target.closest<HTMLButtonElement>("[data-fwd-del]");
    try {
      if (stopBtn) {
        await api.stopForward(stopBtn.dataset.fwdStop!);
        notify("端口转发已停止");
        await refreshActiveOpsTab();
      } else if (startBtn) {
        await api.startForward(startBtn.dataset.fwdStart!);
        notify("端口转发已启动");
        await refreshActiveOpsTab();
      } else if (delBtn) {
        await api.removeForward(delBtn.dataset.fwdDel!);
        notify("端口转发规则已删除");
        await refreshActiveOpsTab();
      }
    } catch (error) {
      notify(friendlyError(error), true);
    }
  });
}
