import { icon } from "../icons.ts";
import { getActiveSession, persistWorkbenchState, state } from "../state.ts";
import type { CommandSnippet, Session } from "../types.ts";
import { $, escapeHtml, notify } from "../utils.ts";
import { applyTemplateVariables, extractTemplateVariables } from "../utils/sensitive.ts";

let editingSnippetId: string | null = null;
let pendingVarSnippet: { snippet: CommandSnippet; execute: boolean } | null = null;
let onSendSnippet: (session: Session, command: string, execute: boolean) => Promise<void> = async () => {};

export function setSnippetSendHandler(
  handler: (session: Session, command: string, execute: boolean) => Promise<void>,
): void {
  onSendSnippet = handler;
}

function getSnippetGroups(): string[] {
  const groups = new Set<string>();
  for (const snippet of state.workbench.snippets) {
    if (snippet.group.trim()) groups.add(snippet.group.trim());
  }
  return [...groups];
}

export function renderSnippets(): void {
  const groups = getSnippetGroups();
  const groupSelect = $<HTMLSelectElement>("#snippet-group-filter");
  const currentGroup = state.snippetGroupFilter;
  groupSelect.innerHTML =
    '<option value="all">全部分组</option>' +
    groups.map(group => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("");
  groupSelect.value = groups.includes(currentGroup) ? currentGroup : "all";

  const query = state.snippetSearch.trim().toLowerCase();
  const list = state.workbench.snippets.filter(snippet => {
    if (state.snippetGroupFilter !== "all" && snippet.group !== state.snippetGroupFilter) return false;
    if (!query) return true;
    return `${snippet.name} ${snippet.command} ${snippet.group} ${snippet.description ?? ""}`
      .toLowerCase()
      .includes(query);
  });

  const container = $("#snippet-list");
  if (!list.length) {
    container.innerHTML =
      '<div class="empty-drawer">暂无常用命令<br/><small>点击“新增命令”保存常用运维指令，支持 {domain} 等变量占位符</small></div>';
    return;
  }

  container.innerHTML = list
    .map(snippet => {
      const vars = extractTemplateVariables(snippet.command);
      const shortcutBadge = snippet.shortcut
        ? `<kbd class="keycap">${escapeHtml(snippet.shortcut)}</kbd>`
        : "";
      const varsBadge = vars.length
        ? `<span class="snippet-var-badge">${vars.map(v => `{${escapeHtml(v)}}`).join(" ")}</span>`
        : "";
      return `
        <article class="snippet-card" data-snippet-id="${snippet.id}">
          <div class="snippet-card-top">
            <div class="snippet-title-wrap">
              <strong>${escapeHtml(snippet.name)}</strong>
              <span class="snippet-group-pill">${escapeHtml(snippet.group || "未分组")}</span>
              ${shortcutBadge}
            </div>
            <div class="snippet-actions">
              <button type="button" class="icon-button" data-snippet-fill="${snippet.id}" title="填入命令（不立即回车）">${icon("terminal")}</button>
              <button type="button" class="icon-button accent-subtle" data-snippet-run="${snippet.id}" title="执行命令">${icon("play")}</button>
              <button type="button" class="icon-button" data-snippet-edit="${snippet.id}" title="编辑">${icon("edit")}</button>
              <button type="button" class="icon-button" data-snippet-del="${snippet.id}" title="删除">${icon("trash")}</button>
            </div>
          </div>
          <code class="snippet-code">${escapeHtml(snippet.command)}</code>
          ${snippet.description || varsBadge ? `<div class="snippet-card-foot"><span>${escapeHtml(snippet.description ?? "")}</span>${varsBadge}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

function resetSnippetForm(snippet?: CommandSnippet): void {
  editingSnippetId = snippet?.id ?? null;
  $("#snippet-form-title").textContent = snippet ? "编辑常用命令" : "新增常用命令";
  $<HTMLInputElement>("#snippet-name").value = snippet?.name ?? "";
  $<HTMLInputElement>("#snippet-group").value = snippet?.group ?? "系统维护";
  $<HTMLSelectElement>("#snippet-shortcut").value = snippet?.shortcut ?? "";
  $<HTMLInputElement>("#snippet-desc").value = snippet?.description ?? "";
  $<HTMLTextAreaElement>("#snippet-command").value = snippet?.command ?? "";
  $("#snippet-form").classList.remove("hidden");
  $<HTMLInputElement>("#snippet-name").focus();
}

export async function runSnippet(snippet: CommandSnippet, execute = true): Promise<void> {
  const session = getActiveSession();
  if (!session || session.status !== "connected") {
    await navigator.clipboard?.writeText(snippet.command).catch(() => undefined);
    notify("当前没有已连接的终端，已复制命令模板到剪贴板");
    return;
  }

  const variables = extractTemplateVariables(snippet.command);
  if (!variables.length) {
    const snippetsDialog = $<HTMLDialogElement>("#snippets-dialog");
    if (snippetsDialog.open) snippetsDialog.close();
    await onSendSnippet(session, snippet.command, execute);
    session.terminal.focus();
    return;
  }

  pendingVarSnippet = { snippet, execute };
  $("#vars-snippet-name").textContent = snippet.name;
  const fields = $("#vars-fields");
  fields.innerHTML = variables
    .map(
      name => `
        <label>
          <span>变量 {${escapeHtml(name)}}</span>
          <input data-var-name="${escapeHtml(name)}" value="${escapeHtml(state.variableMemory[name] ?? "")}" placeholder="请输入 ${escapeHtml(name)} 的值" required />
        </label>
      `,
    )
    .join("");

  const updatePreview = () => {
    const values: Record<string, string> = {};
    fields.querySelectorAll<HTMLInputElement>("[data-var-name]").forEach(input => {
      values[input.dataset.varName!] = input.value || `{${input.dataset.varName!}}`;
    });
    $("#vars-preview").textContent = applyTemplateVariables(snippet.command, values);
  };

  fields.querySelectorAll<HTMLInputElement>("input").forEach(input =>
    input.addEventListener("input", updatePreview),
  );
  updatePreview();

  $<HTMLDialogElement>("#snippet-vars-dialog").showModal();
  fields.querySelector<HTMLInputElement>("input")?.focus();
}

export function handleSnippetShortcut(event: KeyboardEvent): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (!/^[1-9]$/.test(event.key)) return false;
  const targetShortcut = `Alt+${event.key}`;
  const matched = state.workbench.snippets.find(item => item.shortcut === targetShortcut);
  if (!matched) return false;
  event.preventDefault();
  void runSnippet(matched, true);
  return true;
}

export function openSnippetsDialog(): void {
  $("#snippet-form").classList.add("hidden");
  $<HTMLInputElement>("#snippet-search").value = state.snippetSearch;
  renderSnippets();
  $<HTMLDialogElement>("#snippets-dialog").showModal();
}

export function initSnippetsUI(): void {
  $("#open-snippets").addEventListener("click", openSnippetsDialog);
  $("#new-snippet-btn").addEventListener("click", () => resetSnippetForm());
  $("#cancel-snippet-form").addEventListener("click", () => {
    $("#snippet-form").classList.add("hidden");
    editingSnippetId = null;
  });

  $<HTMLInputElement>("#snippet-search").addEventListener("input", event => {
    state.snippetSearch = (event.target as HTMLInputElement).value;
    renderSnippets();
  });

  $<HTMLSelectElement>("#snippet-group-filter").addEventListener("change", event => {
    state.snippetGroupFilter = (event.target as HTMLSelectElement).value;
    renderSnippets();
  });

  $("#snippet-form").addEventListener("submit", event => {
    event.preventDefault();
    const name = $<HTMLInputElement>("#snippet-name").value.trim();
    const group = $<HTMLInputElement>("#snippet-group").value.trim() || "系统维护";
    const shortcut = $<HTMLSelectElement>("#snippet-shortcut").value || null;
    const description = $<HTMLInputElement>("#snippet-desc").value.trim() || null;
    const command = $<HTMLTextAreaElement>("#snippet-command").value.trim();
    if (!name || !command) return;

    const now = Math.floor(Date.now() / 1000);
    if (shortcut) {
      for (const existing of state.workbench.snippets) {
        if (existing.shortcut === shortcut && existing.id !== editingSnippetId) {
          existing.shortcut = null;
        }
      }
    }

    if (editingSnippetId) {
      const existing = state.workbench.snippets.find(item => item.id === editingSnippetId);
      if (existing) {
        existing.name = name;
        existing.group = group;
        existing.shortcut = shortcut;
        existing.description = description;
        existing.command = command;
        existing.updated_at = now;
      }
    } else {
      state.workbench.snippets.unshift({
        id: `snip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        group,
        shortcut,
        description,
        command,
        updated_at: now,
      });
    }

    $("#snippet-form").classList.add("hidden");
    editingSnippetId = null;
    void persistWorkbenchState();
    renderSnippets();
    notify("常用命令已保存");
  });

  $("#snippet-list").addEventListener("click", event => {
    const target = event.target as HTMLElement;
    const runBtn = target.closest<HTMLButtonElement>("[data-snippet-run]");
    if (runBtn) {
      const snippet = state.workbench.snippets.find(item => item.id === runBtn.dataset.snippetRun);
      if (snippet) void runSnippet(snippet, true);
      return;
    }

    const fillBtn = target.closest<HTMLButtonElement>("[data-snippet-fill]");
    if (fillBtn) {
      const snippet = state.workbench.snippets.find(item => item.id === fillBtn.dataset.snippetFill);
      if (snippet) void runSnippet(snippet, false);
      return;
    }

    const editBtn = target.closest<HTMLButtonElement>("[data-snippet-edit]");
    if (editBtn) {
      const snippet = state.workbench.snippets.find(item => item.id === editBtn.dataset.snippetEdit);
      if (snippet) resetSnippetForm(snippet);
      return;
    }

    const delBtn = target.closest<HTMLButtonElement>("[data-snippet-del]");
    if (delBtn) {
      const snippet = state.workbench.snippets.find(item => item.id === delBtn.dataset.snippetDel);
      if (!snippet || !window.confirm(`删除常用命令“${snippet.name}”？`)) return;
      state.workbench.snippets = state.workbench.snippets.filter(item => item.id !== snippet.id);
      void persistWorkbenchState();
      renderSnippets();
      notify("已删除常用命令");
    }
  });

  $("#vars-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!pendingVarSnippet) return;
    const session = getActiveSession();
    const values: Record<string, string> = {};
    $("#vars-fields")
      .querySelectorAll<HTMLInputElement>("[data-var-name]")
      .forEach(input => {
        const key = input.dataset.varName!;
        values[key] = input.value;
        state.variableMemory[key] = input.value;
      });
    const resolved = applyTemplateVariables(pendingVarSnippet.snippet.command, values);
    const execute = pendingVarSnippet.execute;
    pendingVarSnippet = null;
    $<HTMLDialogElement>("#snippet-vars-dialog").close();
    const snippetsDialog = $<HTMLDialogElement>("#snippets-dialog");
    if (snippetsDialog.open) snippetsDialog.close();
    if (session && session.status === "connected") {
      await onSendSnippet(session, resolved, execute);
      session.terminal.focus();
    }
  });
}
