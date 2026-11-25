import { api, dialogs, friendlyError } from "../api.ts";
import { onLanguageChange, t } from "../i18n/index.ts";
import { icon } from "../icons.ts";
import {
  getActiveSession,
  getConnectionMeta,
  loadWorkbenchState,
  persistWorkbenchState,
  setConnectionMeta,
  state,
} from "../state.ts";
import type {
  Connection,
  ConnectionSortMode,
  LocalShellKind,
  LocalShellPrivilege,
  Status,
} from "../types.ts";
import { $, escapeHtml, notify } from "../utils.ts";
import { openConnectionDialog, startConnectionWithConfirmation } from "./dialogs.ts";
import { createSession, openLocalTerminalSession } from "./sessions.ts";

function getProfileSessionStatus(profileId: string): Status | null {
  for (const session of state.sessions.values()) {
    if (session.profile.id === profileId && session.status !== "closed") {
      return session.status;
    }
  }
  return null;
}

function getAllGroups(): string[] {
  const groups = new Set<string>();
  for (const profile of state.connections.values()) {
    const group = getConnectionMeta(profile.id).group.trim();
    if (group) groups.add(group);
  }
  return [...groups].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function sortConnections(profiles: Connection[]): Connection[] {
  return [...profiles].sort((a, b) => {
    const ma = getConnectionMeta(a.id);
    const mb = getConnectionMeta(b.id);
    if (state.connectionSort === "favorite") {
      if (ma.favorite !== mb.favorite) return ma.favorite ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-CN");
    }
    if (state.connectionSort === "group") {
      const ga = ma.group || "zzz";
      const gb = mb.group || "zzz";
      const cmp = ga.localeCompare(gb, "zh-CN");
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name, "zh-CN");
    }
    if (state.connectionSort === "recent") {
      return (b.updated_at ?? 0) - (a.updated_at ?? 0);
    }
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function renderWelcomeRecents(): void {
  const container = $("#welcome-recents");
  const profiles = sortConnections([...state.connections.values()]).slice(0, 4);
  if (!profiles.length) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="welcome-recents-head">
      <span>${t("welcome.quickConnect")}</span>
      <small>${t("welcome.savedCount", { count: state.connections.size })}</small>
    </div>
    <div class="welcome-recents-grid">
      ${profiles
        .map(profile => {
          const meta = getConnectionMeta(profile.id);
          return `
            <button type="button" class="welcome-server-card" data-welcome-connect="${profile.id}">
              <span class="welcome-server-icon">${icon("server")}</span>
              <span class="welcome-server-info">
                <strong>${meta.favorite ? "★ " : ""}${escapeHtml(profile.name)}</strong>
                <small>${escapeHtml(profile.username)}@${escapeHtml(profile.host)}:${profile.port}</small>
              </span>
              <span class="auth-chip">${profile.auth === "private_key" ? t("welcome.authKey") : t("welcome.authPwd")}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderConnections(): void {
  renderWelcomeRecents();

  const groupSelect = $<HTMLSelectElement>("#connection-group-filter");
  const groups = getAllGroups();
  const prevFilter = state.connectionGroupFilter;
  groupSelect.innerHTML =
    `<option value="all">${escapeHtml(t("sidebar.allGroups"))}</option><option value="favorites">${escapeHtml(t("sidebar.onlyFavorites"))}</option>` +
    groups.map(group => `<option value="group:${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("");
  if (
    prevFilter === "all" ||
    prevFilter === "favorites" ||
    (prevFilter.startsWith("group:") && groups.includes(prevFilter.slice(6)))
  ) {
    groupSelect.value = prevFilter;
  } else {
    state.connectionGroupFilter = "all";
    groupSelect.value = "all";
  }

  const query = state.connectionFilter.trim().toLowerCase();
  const filtered = [...state.connections.values()].filter(profile => {
    const meta = getConnectionMeta(profile.id);
    if (state.connectionGroupFilter === "favorites" && !meta.favorite) return false;
    if (
      state.connectionGroupFilter.startsWith("group:") &&
      meta.group.trim() !== state.connectionGroupFilter.slice(6)
    ) {
      return false;
    }
    if (!query) return true;
    const searchable = `${profile.name} ${profile.host} ${profile.username} ${meta.group} ${meta.tags.join(" ")}`.toLowerCase();
    return searchable.includes(query);
  });

  const list = sortConnections(filtered);

  if (!state.connections.size) {
    $("#connection-list").innerHTML = `<div class="empty-connections">${t("sidebar.emptyServers")}</div>`;
    return;
  }

  if (!list.length) {
    $("#connection-list").innerHTML = `<div class="empty-connections">${t("sidebar.noMatchServers")}</div>`;
    return;
  }

  $("#connection-list").innerHTML = list
    .map(profile => {
      const meta = getConnectionMeta(profile.id);
      const liveStatus = getProfileSessionStatus(profile.id);
      const badge = liveStatus
        ? `<span class="connection-live-dot ${liveStatus}" title="${escapeHtml(t("sidebar.liveSession"))}"></span>`
        : "";
      const authTag = profile.auth === "private_key" ? "KEY" : "PWD";
      const tagsHtml = [
        meta.group ? `<span class="conn-group-badge">${escapeHtml(meta.group)}</span>` : "",
        ...meta.tags.slice(0, 2).map(tag => `<span class="conn-tag-badge">${escapeHtml(tag)}</span>`),
      ]
        .filter(Boolean)
        .join("");

      return `
        <article class="connection-card ${liveStatus ? "has-session" : ""}" data-profile="${profile.id}">
          <button type="button" class="connection-open" title="${escapeHtml(t("sidebar.connectHost", { host: profile.host }))}">
            <span class="server-icon">${icon("server")}${badge}</span>
            <span class="connection-copy">
              <span class="connection-title-row">
                <strong>${escapeHtml(profile.name)}</strong>
                <span class="connection-auth-tag">${authTag}</span>
              </span>
              <small>${escapeHtml(profile.username)}@${escapeHtml(profile.host)}:${profile.port}</small>
              ${tagsHtml ? `<span class="connection-badges">${tagsHtml}</span>` : ""}
            </span>
          </button>
          <div class="connection-card-actions">
            <button type="button" class="icon-button fav-connection ${meta.favorite ? "is-fav" : ""}" title="${escapeHtml(t(meta.favorite ? "sidebar.unfavorite" : "sidebar.favorite"))}" data-fav="${profile.id}">${icon("star")}</button>
            <button type="button" class="icon-button edit-connection" title="${escapeHtml(t("sidebar.editConn"))}" data-edit="${profile.id}">${icon("edit")}</button>
            <button type="button" class="icon-button dup-connection" title="${escapeHtml(t("sidebar.dupConn"))}" data-dup="${profile.id}">${icon("copy")}</button>
            <button type="button" class="icon-button delete-connection" title="${escapeHtml(t("sidebar.delConn"))}" data-delete="${profile.id}">${icon("trash")}</button>
          </div>
        </article>
      `;
    })
    .join("");
}

async function startConnection(profile: Connection): Promise<void> {
  if (state.connecting) return;
  state.connecting = true;
  const card = document.querySelector<HTMLElement>(`[data-profile="${profile.id}"]`);
  card?.classList.add("connecting-card");

  let fallbackError: string | null = null;
  let needsConfirmation = false;

  try {
    const timeout =
      getConnectionMeta(profile.id).connect_timeout_secs ??
      state.workbench.settings.connect_timeout_secs;
    const id = await api.connectSaved(profile.id, timeout);
    createSession(id, profile);
    notify(t("sidebar.quickConnected"));
    return;
  } catch (error) {
    const message = friendlyError(error);
    needsConfirmation = true;
    if (!message.includes("首次连接") && message.includes("密码")) {
      fallbackError = message;
    }
  } finally {
    state.connecting = false;
    card?.classList.remove("connecting-card");
  }

  if (needsConfirmation) {
    await startConnectionWithConfirmation(profile, fallbackError);
  }
}

export function toggleSidebar(): void {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  $("#app-shell").classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  const toggleBtn = $<HTMLButtonElement>("#toggle-sidebar");
  toggleBtn.classList.toggle("active", !state.sidebarCollapsed);
  toggleBtn.title = t(state.sidebarCollapsed ? "titlebar.expandSidebar" : "titlebar.collapseSidebar");

  const session = getActiveSession();
  if (session) {
    requestAnimationFrame(() => session.fit.fit());
    window.setTimeout(() => session.fit.fit(), 220);
  }
}

export async function loadConnections(): Promise<void> {
  const profiles = await api.listConnections();
  state.connections.clear();
  for (const profile of profiles) {
    state.connections.set(profile.id, profile);
  }
  renderConnections();
}

let pendingLocalShell: LocalShellKind | null = null;

function getLocalPrivilegeMode(): LocalShellPrivilege {
  const mode = state.workbench.settings.local_shell_privilege;
  if (mode === "standard" || mode === "admin") return mode;
  return "ask";
}

function getLocalShellLabel(kind: LocalShellKind): string {
  if (kind === "power_shell") return t("session.localPwsh");
  if (kind === "cmd") return t("session.localCmd");
  return t("session.localWsl");
}

function launchLocalShellWithPrivilege(kind: LocalShellKind, privilege: "standard" | "admin"): void {
  const effectiveElevated = state.isElevated || privilege === "admin";
  void openLocalTerminalSession(kind, effectiveElevated);
}

function openLocalShellPrivilegeDialog(kind: LocalShellKind): void {
  pendingLocalShell = kind;
  const label = getLocalShellLabel(kind);
  $("#local-priv-title").textContent = t("localPriv.title", { shell: label });
  $("#local-priv-desc").textContent = t("localPriv.desc");
  $("#local-priv-standard-hint").textContent = t("localPriv.standardHint");
  $("#local-priv-admin-hint").textContent = t("localPriv.adminHint");
  $<HTMLInputElement>("#local-priv-remember").checked = false;
  $<HTMLDialogElement>("#local-shell-privilege-dialog").showModal();
}

export function syncLocalAdminToggle(): void {
  const btn = $<HTMLButtonElement>("#local-admin-toggle");
  const label = $<HTMLSpanElement>("#local-admin-label");
  const mode = getLocalPrivilegeMode();
  const isAdminEffective = state.isElevated || mode === "admin";

  btn.classList.toggle("active", isAdminEffective);
  btn.classList.toggle("is-ask", !state.isElevated && mode === "ask");
  btn.classList.toggle("is-standard", !state.isElevated && mode === "standard");
  btn.classList.toggle("is-admin", isAdminEffective);

  if (state.isElevated) {
    label.textContent = t(state.canDeelevate ? "sidebar.privAppAdmin" : "sidebar.privSystemAdmin");
    btn.title = t(
      state.canDeelevate
        ? "sidebar.localAdminSwitchTitle"
        : "sidebar.localSystemAdminTitle",
    );
  } else {
    const key =
      mode === "admin"
        ? "sidebar.privAdmin"
        : mode === "standard"
          ? "sidebar.privStandard"
          : "sidebar.privAsk";
    label.textContent = t(key);
    btn.title = t("sidebar.privCycleTitle");
  }
}

export function initConnections(): void {
  syncLocalAdminToggle();
  onLanguageChange(() => {
    syncLocalAdminToggle();
    renderConnections();
    $<HTMLButtonElement>("#toggle-sidebar").title = t(
      state.sidebarCollapsed ? "titlebar.expandSidebar" : "titlebar.collapseSidebar",
    );
  });
  $("#add-connection").addEventListener("click", () => openConnectionDialog());
  $("#welcome-add").addEventListener("click", () => openConnectionDialog());
  $("#toggle-sidebar").addEventListener("click", toggleSidebar);

  $("#local-admin-toggle").addEventListener("click", () => {
    if (state.isElevated) {
      if (state.canDeelevate) {
        $<HTMLButtonElement>("#admin-launch-btn").click();
      } else {
        notify(t("titlebar.adminSystemLockedNotify"));
      }
      return;
    }
    const order: LocalShellPrivilege[] = ["ask", "standard", "admin"];
    const next = order[(order.indexOf(getLocalPrivilegeMode()) + 1) % order.length];
    state.workbench.settings.local_shell_privilege = next;
    syncLocalAdminToggle();
    void persistWorkbenchState();
  });

  const handlePrivilegeChoice = (choice: "standard" | "admin") => {
    const kind = pendingLocalShell;
    pendingLocalShell = null;
    if ($<HTMLInputElement>("#local-priv-remember").checked) {
      state.workbench.settings.local_shell_privilege = choice;
      syncLocalAdminToggle();
      void persistWorkbenchState();
    }
    $<HTMLDialogElement>("#local-shell-privilege-dialog").close();
    if (kind) {
      launchLocalShellWithPrivilege(kind, choice);
    }
  };

  $("#local-priv-standard").addEventListener("click", () => handlePrivilegeChoice("standard"));
  $("#local-priv-admin").addEventListener("click", () => handlePrivilegeChoice("admin"));

  document.querySelectorAll<HTMLButtonElement>("[data-local-shell]").forEach(btn =>
    btn.addEventListener("click", () => {
      const kind = btn.dataset.localShell as LocalShellKind;
      if (state.isElevated) {
        launchLocalShellWithPrivilege(kind, "admin");
        return;
      }
      const mode = getLocalPrivilegeMode();
      if (mode === "ask") {
        openLocalShellPrivilegeDialog(kind);
        return;
      }
      launchLocalShellWithPrivilege(kind, mode);
    }),
  );

  $<HTMLInputElement>("#connection-search").addEventListener("input", event => {
    state.connectionFilter = (event.target as HTMLInputElement).value;
    renderConnections();
  });

  $<HTMLSelectElement>("#connection-group-filter").addEventListener("change", event => {
    state.connectionGroupFilter = (event.target as HTMLSelectElement).value;
    renderConnections();
  });

  $<HTMLSelectElement>("#connection-sort").addEventListener("change", event => {
    state.connectionSort = (event.target as HTMLSelectElement).value as ConnectionSortMode;
    renderConnections();
  });

  $("#export-connections").addEventListener("click", async () => {
    const path = await dialogs.pickExportPath();
    if (!path) return;
    try {
      const count = await api.exportConnections(path);
      notify(t("sidebar.exportSuccess", { count }));
    } catch (error) {
      notify(friendlyError(error), true);
    }
  });

  $("#import-connections").addEventListener("click", async () => {
    const path = await dialogs.pickImportPath();
    if (typeof path !== "string") return;
    try {
      const count = await api.importConnections(path);
      await loadWorkbenchState();
      await loadConnections();
      notify(count > 0 ? t("sidebar.importSuccess", { count }) : t("sidebar.importEmpty"));
    } catch (error) {
      notify(friendlyError(error), true);
    }
  });

  $("#welcome-recents").addEventListener("click", event => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-welcome-connect]");
    if (!btn) return;
    const profile = state.connections.get(btn.dataset.welcomeConnect!);
    if (profile) void startConnection(profile);
  });

  $("#connection-list").addEventListener("click", async event => {
    const target = event.target as HTMLElement;

    const favBtn = target.closest<HTMLButtonElement>("[data-fav]");
    if (favBtn) {
      const id = favBtn.dataset.fav!;
      const meta = getConnectionMeta(id);
      setConnectionMeta(id, { ...meta, favorite: !meta.favorite });
      renderConnections();
      return;
    }

    const editBtn = target.closest<HTMLButtonElement>("[data-edit]");
    if (editBtn) {
      const profile = state.connections.get(editBtn.dataset.edit!);
      if (profile) openConnectionDialog(profile);
      return;
    }

    const dupBtn = target.closest<HTMLButtonElement>("[data-dup]");
    if (dupBtn) {
      try {
        const copy = await api.duplicateConnection(dupBtn.dataset.dup!);
        await loadWorkbenchState();
        state.connections.set(copy.id, copy);
        renderConnections();
        notify(t("sidebar.dupSuccess", { name: copy.name }));
      } catch (error) {
        notify(friendlyError(error), true);
      }
      return;
    }

    const deleteButton = target.closest<HTMLButtonElement>("[data-delete]");
    if (deleteButton) {
      const profile = state.connections.get(deleteButton.dataset.delete!);
      if (!profile) return;
      if (!window.confirm(t("sidebar.delConfirm", { name: profile.name }))) return;
      try {
        await api.deleteConnection(profile.id);
        state.connections.delete(profile.id);
        delete state.workbench.connection_meta[profile.id];
        renderConnections();
        notify(t("sidebar.delSuccess", { name: profile.name }));
      } catch (error) {
        notify(String(error), true);
      }
      return;
    }

    const card = target.closest<HTMLElement>("[data-profile]");
    if (card) {
      const profile = state.connections.get(card.dataset.profile!);
      if (profile) void startConnection(profile);
    }
  });
}
