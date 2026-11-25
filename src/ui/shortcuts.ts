import { onLanguageChange, t, type TranslationKey } from "../i18n/index.ts";
import { $ } from "../utils.ts";

export interface ShortcutHandlers {
  newConnection: () => void;
  closeActiveTab: () => void;
  cycleTab: (direction: -1 | 1) => void;
  activateTabIndex: (index: number) => void;
  toggleSidebar: () => void;
  toggleFiles: () => void;
  toggleMetrics: () => void;
  openHistory: () => void;
  openSnippets: () => void;
  openSearch: () => void;
  clearTerminal: () => void;
  openSettings: () => void;
  handleSnippetShortcut: (event: KeyboardEvent) => boolean;
}

const SHORTCUT_ITEMS: { groupKey: TranslationKey; keys: string; descKey: TranslationKey }[] = [
  { groupKey: "shortcuts.groupWorkbench", keys: "Ctrl + N", descKey: "shortcuts.newConn" },
  { groupKey: "shortcuts.groupWorkbench", keys: "Ctrl + B", descKey: "shortcuts.toggleSidebar" },
  { groupKey: "shortcuts.groupWorkbench", keys: "Ctrl + ,", descKey: "shortcuts.openSettings" },
  { groupKey: "shortcuts.groupWorkbench", keys: "F1 / Ctrl + /", descKey: "shortcuts.openShortcuts" },
  { groupKey: "shortcuts.groupTabs", keys: "Ctrl + W", descKey: "shortcuts.closeTab" },
  { groupKey: "shortcuts.groupTabs", keys: "Ctrl + Tab", descKey: "shortcuts.nextTab" },
  { groupKey: "shortcuts.groupTabs", keys: "Ctrl + Shift + Tab", descKey: "shortcuts.prevTab" },
  { groupKey: "shortcuts.groupTabs", keys: "Ctrl + 1 ~ 9", descKey: "shortcuts.jumpTab" },
  { groupKey: "shortcuts.groupTerminal", keys: "Ctrl + F", descKey: "shortcuts.searchOutput" },
  { groupKey: "shortcuts.groupTerminal", keys: "Ctrl + Shift + L", descKey: "shortcuts.clearTerm" },
  { groupKey: "shortcuts.groupTerminal", keys: "Ctrl + Shift + C / V", descKey: "shortcuts.copyPaste" },
  { groupKey: "shortcuts.groupTerminal", keys: "Ctrl + = / -", descKey: "shortcuts.fontSize" },
  { groupKey: "shortcuts.groupTerminal", keys: "Ctrl + E", descKey: "shortcuts.toggleFiles" },
  { groupKey: "shortcuts.groupTerminal", keys: "Ctrl + M", descKey: "shortcuts.toggleMetrics" },
  { groupKey: "shortcuts.groupCommands", keys: "Ctrl + H", descKey: "shortcuts.openHistory" },
  { groupKey: "shortcuts.groupCommands", keys: "Ctrl + K", descKey: "shortcuts.openSnippets" },
  { groupKey: "shortcuts.groupCommands", keys: "Alt + 1 ~ 9", descKey: "shortcuts.triggerSnippet" },
  { groupKey: "shortcuts.groupCommands", keys: "↑ / ↓", descKey: "shortcuts.quickHistory" },
];

function renderShortcutsBody(): void {
  const groups = [...new Set(SHORTCUT_ITEMS.map(item => item.groupKey))];
  $("#shortcuts-body").innerHTML = groups
    .map(groupKey => {
      const rows = SHORTCUT_ITEMS.filter(item => item.groupKey === groupKey)
        .map(
          item => `
            <div class="shortcut-row">
              <span>${t(item.descKey)}</span>
              <kbd class="keycap">${item.keys}</kbd>
            </div>
          `,
        )
        .join("");
      return `<section class="shortcut-group"><h3>${t(groupKey)}</h3>${rows}</section>`;
    })
    .join("");
}

export function openShortcutsDialog(): void {
  renderShortcutsBody();
  $<HTMLDialogElement>("#shortcuts-dialog").showModal();
}

export function initShortcuts(handlers: ShortcutHandlers): void {
  $("#open-shortcuts").addEventListener("click", openShortcutsDialog);
  onLanguageChange(() => {
    if ($<HTMLDialogElement>("#shortcuts-dialog").open) {
      renderShortcutsBody();
    }
  });

  document.addEventListener("keydown", event => {
    const anyModalOpen = Boolean(document.querySelector("dialog[open]"));
    if (event.key === "F1") {
      event.preventDefault();
      openShortcutsDialog();
      return;
    }

    if (anyModalOpen) return;

    if (handlers.handleSnippetShortcut(event)) return;

    const ctrl = event.ctrlKey || event.metaKey;
    if (!ctrl) return;

    const key = event.key.toLowerCase();
    if (key === "/") {
      event.preventDefault();
      openShortcutsDialog();
    } else if (key === "n" && !event.shiftKey) {
      event.preventDefault();
      handlers.newConnection();
    } else if (key === "b" && !event.shiftKey) {
      event.preventDefault();
      handlers.toggleSidebar();
    } else if (key === "e" && !event.shiftKey) {
      event.preventDefault();
      handlers.toggleFiles();
    } else if (key === "m" && !event.shiftKey) {
      event.preventDefault();
      handlers.toggleMetrics();
    } else if (key === "h" && !event.shiftKey) {
      event.preventDefault();
      handlers.openHistory();
    } else if (key === "k" && !event.shiftKey) {
      event.preventDefault();
      handlers.openSnippets();
    } else if (key === "f" && !event.shiftKey) {
      event.preventDefault();
      handlers.openSearch();
    } else if (key === "l" && event.shiftKey) {
      event.preventDefault();
      handlers.clearTerminal();
    } else if (key === "w" && !event.shiftKey) {
      event.preventDefault();
      handlers.closeActiveTab();
    } else if (key === ",") {
      event.preventDefault();
      handlers.openSettings();
    } else if (event.key === "Tab") {
      event.preventDefault();
      handlers.cycleTab(event.shiftKey ? -1 : 1);
    } else if (/^[1-9]$/.test(event.key) && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      handlers.activateTabIndex(Number(event.key) - 1);
    }
  });
}
