import { formatLocaleTime, onLanguageChange, t } from "../i18n/index.ts";
import { icon } from "../icons.ts";
import { getActiveSession, persistWorkbenchState, state } from "../state.ts";
import type { HistoryEntry, HistoryOutcome, Session } from "../types.ts";
import { $, escapeHtml, notify } from "../utils.ts";
import { isSensitiveCommand, looksLikePasswordPrompt } from "../utils/sensitive.ts";

let selectedIndex = 0;
let onSendCommand: (session: Session, command: string, execute: boolean) => Promise<void> = async () => {};

export function setHistorySendHandler(
  handler: (session: Session, command: string, execute: boolean) => Promise<void>,
): void {
  onSendCommand = handler;
}

export function recordCommandHistory(
  session: Session,
  command: string,
  outcome: HistoryOutcome,
  checkPrompt = true,
): HistoryEntry | null {
  const normalized = command.replace(/[\r\n]+$/g, "");
  if (!normalized.trim()) return null;
  if (checkPrompt && looksLikePasswordPrompt(session.recentOutputTail)) return null;
  if (isSensitiveCommand(normalized)) return null;

  const entry: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    command: normalized,
    timestamp: Math.floor(Date.now() / 1000),
    server_id: session.profile.id,
    server_name: session.profile.name,
    host: `${session.profile.username}@${session.profile.host}:${session.profile.port}`,
    outcome,
  };

  state.workbench.history.unshift(entry);
  if (state.workbench.history.length > 500) {
    state.workbench.history.length = 500;
  }
  state.historyCursor = -1;
  void persistWorkbenchState();

  const dialog = document.querySelector<HTMLDialogElement>("#history-dialog");
  if (dialog?.open) renderHistoryList();
  return entry;
}

export function updateHistoryOutcome(entryId: string, outcome: HistoryOutcome): void {
  const entry = state.workbench.history.find(item => item.id === entryId);
  if (!entry || entry.outcome === outcome) return;
  entry.outcome = outcome;
  void persistWorkbenchState();
  const dialog = document.querySelector<HTMLDialogElement>("#history-dialog");
  if (dialog?.open) renderHistoryList();
}

export function getFilteredHistory(): HistoryEntry[] {
  const query = state.historyFilter.trim().toLowerCase();
  const seen = new Set<string>();
  const results: HistoryEntry[] = [];

  for (const item of state.workbench.history) {
    if (query) {
      const hay = `${item.command} ${item.server_name} ${item.host}`.toLowerCase();
      if (!hay.includes(query)) continue;
    }
    if (state.historyDedupe) {
      const key = item.command;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    results.push(item);
  }
  return results;
}

export function getDeduplicatedCommands(): string[] {
  const seen = new Set<string>();
  const commands: string[] = [];
  for (const item of state.workbench.history) {
    if (!seen.has(item.command)) {
      seen.add(item.command);
      commands.push(item.command);
    }
  }
  return commands;
}

function formatTime(unixSeconds: number): string {
  return formatLocaleTime(unixSeconds);
}

function outcomeBadge(outcome: HistoryOutcome): string {
  if (outcome === "failed") return `<span class="history-outcome failed">${escapeHtml(t("history.outcomeFailed"))}</span>`;
  if (outcome === "error") return `<span class="history-outcome error">${escapeHtml(t("history.outcomeError"))}</span>`;
  return `<span class="history-outcome sent">${escapeHtml(t("history.outcomeSent"))}</span>`;
}

export function renderHistoryList(): void {
  const items = getFilteredHistory();
  if (selectedIndex >= items.length) selectedIndex = Math.max(0, items.length - 1);

  const list = $("#history-list");
  if (!items.length) {
    list.innerHTML = `<div class="empty-drawer">${t("history.empty")}</div>`;
    return;
  }

  list.innerHTML = items
    .map(
      (item, index) => `
        <div class="history-row ${index === selectedIndex ? "selected" : ""}" data-history-id="${item.id}" data-index="${index}">
          <div class="history-main">
            <code class="history-command">${escapeHtml(item.command)}</code>
            <div class="history-meta">
              <span>${escapeHtml(item.server_name)} · ${escapeHtml(item.host)}</span>
              <span>${formatTime(item.timestamp)}</span>
              ${outcomeBadge(item.outcome)}
            </div>
          </div>
          <div class="history-actions">
            <button type="button" class="icon-button" data-history-fill="${item.id}" title="${escapeHtml(t("history.fillTitle"))}">${icon("edit")}</button>
            <button type="button" class="icon-button" data-history-run="${item.id}" title="${escapeHtml(t("history.runTitle"))}">${icon("play")}</button>
            <button type="button" class="icon-button" data-history-del="${item.id}" title="${escapeHtml(t("history.delTitle"))}">${icon("trash")}</button>
          </div>
        </div>
      `,
    )
    .join("");
}

export function openHistoryDialog(): void {
  selectedIndex = 0;
  $<HTMLInputElement>("#history-search").value = state.historyFilter;
  $<HTMLInputElement>("#history-dedupe").checked = state.historyDedupe;
  renderHistoryList();
  $<HTMLDialogElement>("#history-dialog").showModal();
  $<HTMLInputElement>("#history-search").focus();
}

async function runHistoryEntry(entry: HistoryEntry, execute: boolean): Promise<void> {
  const session = getActiveSession();
  if (!session || session.status !== "connected") {
    await navigator.clipboard?.writeText(entry.command).catch(() => undefined);
    notify(t("history.copiedNoTerm"));
    return;
  }
  $<HTMLDialogElement>("#history-dialog").close();
  await onSendCommand(session, entry.command, execute);
  session.terminal.focus();
}

export function initHistoryUI(): void {
  onLanguageChange(() => {
    if ($<HTMLDialogElement>("#history-dialog").open) renderHistoryList();
  });
  $("#open-history").addEventListener("click", openHistoryDialog);

  $<HTMLInputElement>("#history-search").addEventListener("input", event => {
    state.historyFilter = (event.target as HTMLInputElement).value;
    selectedIndex = 0;
    renderHistoryList();
  });

  $<HTMLInputElement>("#history-dedupe").addEventListener("change", event => {
    state.historyDedupe = (event.target as HTMLInputElement).checked;
    selectedIndex = 0;
    renderHistoryList();
  });

  $("#history-clear").addEventListener("click", () => {
    if (!state.workbench.history.length) return;
    if (!window.confirm(t("history.clearConfirm", { count: state.workbench.history.length }))) return;
    state.workbench.history = [];
    void persistWorkbenchState();
    renderHistoryList();
    notify(t("history.cleared"));
  });

  $("#history-dialog").addEventListener("keydown", event => {
    const items = getFilteredHistory();
    if (!items.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      renderHistoryList();
      $("#history-list .history-row.selected")?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      renderHistoryList();
      $("#history-list .history-row.selected")?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      const target = items[selectedIndex];
      if (!target) return;
      event.preventDefault();
      void runHistoryEntry(target, !event.shiftKey);
    }
  });

  $("#history-list").addEventListener("click", event => {
    const target = event.target as HTMLElement;
    const del = target.closest<HTMLButtonElement>("[data-history-del]");
    if (del) {
      state.workbench.history = state.workbench.history.filter(item => item.id !== del.dataset.historyDel);
      void persistWorkbenchState();
      renderHistoryList();
      return;
    }

    const run = target.closest<HTMLButtonElement>("[data-history-run]");
    if (run) {
      const entry = state.workbench.history.find(item => item.id === run.dataset.historyRun);
      if (entry) void runHistoryEntry(entry, true);
      return;
    }

    const fill = target.closest<HTMLButtonElement>("[data-history-fill]");
    if (fill) {
      const entry = state.workbench.history.find(item => item.id === fill.dataset.historyFill);
      if (entry) void runHistoryEntry(entry, false);
      return;
    }

    const row = target.closest<HTMLElement>("[data-history-id]");
    if (row) {
      selectedIndex = Number(row.dataset.index ?? 0);
      renderHistoryList();
    }
  });
}
