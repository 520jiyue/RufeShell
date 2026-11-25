import { api, dialogs, friendlyError } from "../api.ts";
import { getActiveSession, state } from "../state.ts";
import { applyAppTheme, resolveTerminalTheme } from "../themes.ts";
import type { Session } from "../types.ts";
import { $, formatBytes, notify } from "../utils.ts";
import { getDeduplicatedCommands, recordCommandHistory, updateHistoryOutcome } from "./history.ts";

interface SearchMatch {
  line: number;
  col: number;
  length: number;
}

let searchMatches: SearchMatch[] = [];
let searchMatchIndex = -1;

const SHELL_ERROR_PATTERN =
  /(command not found|permission denied|no such file or directory|syntax error|not permitted|未找到命令|权限不够)/i;

export async function sendCommandToSession(
  session: Session,
  command: string,
  execute = true,
): Promise<void> {
  if (session.status !== "connected") {
    notify("会话未连接，无法发送指令", true);
    return;
  }

  const payload = execute ? `${command}\r` : command;
  try {
    await api.terminalInput(session.id, payload);
    if (execute) {
      const entry = recordCommandHistory(session, command, "sent", false);
      if (entry) session.lastHistoryEntryId = entry.id;
    } else {
      session.inputBuffer = command;
    }
  } catch (error) {
    if (execute) recordCommandHistory(session, command, "failed", false);
    notify(friendlyError(error), true);
  }
}

export function trackTerminalInput(session: Session, data: string): void {
  for (const ch of data) {
    if (ch === "\r") {
      const line = session.inputBuffer;
      session.inputBuffer = "";
      if (line.trim()) {
        const entry = recordCommandHistory(session, line, "sent", true);
        if (entry) session.lastHistoryEntryId = entry.id;
      }
    } else if (ch === "\u0003" || ch === "\u0015") {
      // Ctrl+C or Ctrl+U clears current tracked line
      session.inputBuffer = "";
    } else if (ch === "\x7f" || ch === "\b") {
      session.inputBuffer = session.inputBuffer.slice(0, -1);
    } else if (ch >= " " && ch !== "\x7f") {
      session.inputBuffer += ch;
    }
  }
}

export function trackTerminalOutputForHistory(session: Session, chunkText: string): void {
  session.recentOutputTail = (session.recentOutputTail + chunkText).slice(-800);
  if (session.lastHistoryEntryId && SHELL_ERROR_PATTERN.test(chunkText)) {
    updateHistoryOutcome(session.lastHistoryEntryId, "error");
  }
}

export function clearTerminal(session: Session): void {
  session.terminal.clear();
  session.terminal.focus();
}

export function collectTerminalText(session: Session): string {
  const buffer = session.terminal.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i += 1) {
    const line = buffer.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }
  return lines.join("\n");
}

export async function saveTerminalLog(session: Session): Promise<void> {
  const content = collectTerminalText(session);
  if (!content.trim()) {
    notify("当前终端暂无可保存的输出内容");
    return;
  }
  const safeName = session.profile.name.replace(/[\\/:*?"<>|]/g, "_");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const localPath = await dialogs.pickLogSavePath(`${safeName}-${stamp}.log`);
  if (!localPath) return;

  try {
    const bytes = await api.saveTextLog(localPath, `${content}\n`);
    notify(`日志已保存 · ${formatBytes(bytes)}`);
  } catch (error) {
    notify(friendlyError(error), true);
  }
}

export function applySettingsToAllTerminals(): void {
  const { font_family, font_size, theme } = state.workbench.settings;
  applyAppTheme(theme);
  const resolvedTheme = resolveTerminalTheme(theme);

  for (const session of state.sessions.values()) {
    session.terminal.options.fontFamily = font_family;
    session.terminal.options.fontSize = font_size;
    session.terminal.options.theme = resolvedTheme;
    session.fit.fit();
  }
}

function runTerminalSearch(session: Session, query: string, caseSensitive: boolean): void {
  searchMatches = [];
  searchMatchIndex = -1;

  if (!query) {
    $("#terminal-search-count").textContent = "0 / 0";
    session.terminal.clearSelection();
    return;
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  const buffer = session.terminal.buffer.active;
  for (let i = 0; i < buffer.length; i += 1) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const raw = line.translateToString(true);
    const haystack = caseSensitive ? raw : raw.toLowerCase();
    let offset = 0;
    while (offset <= haystack.length - needle.length) {
      const idx = haystack.indexOf(needle, offset);
      if (idx === -1) break;
      searchMatches.push({ line: i, col: idx, length: query.length });
      offset = idx + Math.max(1, needle.length);
    }
  }

  if (searchMatches.length) {
    jumpToMatch(session, searchMatches.length - 1);
  } else {
    $("#terminal-search-count").textContent = "0 / 0";
    session.terminal.clearSelection();
  }
}

function jumpToMatch(session: Session, index: number): void {
  if (!searchMatches.length) return;
  searchMatchIndex = (index + searchMatches.length) % searchMatches.length;
  const match = searchMatches[searchMatchIndex];
  session.terminal.scrollToLine(Math.max(0, match.line - 3));
  session.terminal.select(match.col, match.line, match.length);
  $("#terminal-search-count").textContent = `${searchMatchIndex + 1} / ${searchMatches.length}`;
}

export function openTerminalSearch(): void {
  const session = getActiveSession();
  if (!session) return;
  $("#terminal-search-bar").classList.remove("hidden");
  const input = $<HTMLInputElement>("#terminal-search-input");
  input.focus();
  input.select();
  if (input.value) {
    runTerminalSearch(session, input.value, $<HTMLInputElement>("#terminal-search-case").checked);
  }
}

export function closeTerminalSearch(): void {
  $("#terminal-search-bar").classList.add("hidden");
  getActiveSession()?.terminal.focus();
}

export function initTerminalTools(): void {
  const searchInput = $<HTMLInputElement>("#terminal-search-input");
  const searchCase = $<HTMLInputElement>("#terminal-search-case");

  $("#terminal-search-btn").addEventListener("click", openTerminalSearch);
  $("#terminal-search-close").addEventListener("click", closeTerminalSearch);

  $("#terminal-clear-btn").addEventListener("click", () => {
    const session = getActiveSession();
    if (session) clearTerminal(session);
  });

  $("#terminal-save-log-btn").addEventListener("click", () => {
    const session = getActiveSession();
    if (session) void saveTerminalLog(session);
  });

  const triggerSearch = () => {
    const session = getActiveSession();
    if (session) runTerminalSearch(session, searchInput.value, searchCase.checked);
  };

  searchInput.addEventListener("input", triggerSearch);
  searchCase.addEventListener("change", triggerSearch);

  searchInput.addEventListener("keydown", event => {
    const session = getActiveSession();
    if (event.key === "Escape") {
      event.preventDefault();
      closeTerminalSearch();
    } else if (event.key === "Enter" && session) {
      event.preventDefault();
      if (!searchMatches.length) {
        triggerSearch();
      } else {
        jumpToMatch(session, searchMatchIndex + (event.shiftKey ? -1 : 1));
      }
    }
  });

  $("#terminal-search-prev").addEventListener("click", () => {
    const session = getActiveSession();
    if (session) jumpToMatch(session, searchMatchIndex - 1);
  });

  $("#terminal-search-next").addEventListener("click", () => {
    const session = getActiveSession();
    if (session) jumpToMatch(session, searchMatchIndex + 1);
  });

  // Quick Command Bar (with Up/Down arrow history navigation)
  const cmdInput = $<HTMLInputElement>("#quick-command-input");
  cmdInput.addEventListener("keydown", event => {
    const commands = getDeduplicatedCommands();
    if (event.key === "ArrowUp") {
      if (!commands.length) return;
      event.preventDefault();
      state.historyCursor = Math.min(commands.length - 1, state.historyCursor + 1);
      cmdInput.value = commands[state.historyCursor];
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (state.historyCursor <= 0) {
        state.historyCursor = -1;
        cmdInput.value = "";
      } else {
        state.historyCursor -= 1;
        cmdInput.value = commands[state.historyCursor] ?? "";
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = cmdInput.value;
      const session = getActiveSession();
      if (!command.trim() || !session) return;
      cmdInput.value = "";
      state.historyCursor = -1;
      void sendCommandToSession(session, command, true);
      session.terminal.focus();
    }
  });

  $("#quick-command-send").addEventListener("click", () => {
    const command = cmdInput.value;
    const session = getActiveSession();
    if (!command.trim() || !session) return;
    cmdInput.value = "";
    state.historyCursor = -1;
    void sendCommandToSession(session, command, true);
    session.terminal.focus();
  });
}
