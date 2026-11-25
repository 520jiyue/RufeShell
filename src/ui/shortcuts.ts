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

const SHORTCUT_ITEMS = [
  { group: "连接与工作台", keys: "Ctrl + N", desc: "新建服务器连接" },
  { group: "连接与工作台", keys: "Ctrl + B", desc: "收起 / 展开左侧连接栏" },
  { group: "连接与工作台", keys: "Ctrl + ,", desc: "打开工作台与终端设置" },
  { group: "连接与工作台", keys: "F1 或 Ctrl + /", desc: "打开快捷键说明" },
  { group: "会话标签", keys: "Ctrl + W", desc: "关闭当前会话标签" },
  { group: "会话标签", keys: "Ctrl + Tab", desc: "切换到下一个会话" },
  { group: "会话标签", keys: "Ctrl + Shift + Tab", desc: "切换到上一个会话" },
  { group: "会话标签", keys: "Ctrl + 1 ~ 9", desc: "跳转到第 N 个会话标签" },
  { group: "终端与面板", keys: "Ctrl + F", desc: "搜索当前终端输出" },
  { group: "终端与面板", keys: "Ctrl + Shift + L", desc: "清空当前终端屏幕" },
  { group: "终端与面板", keys: "Ctrl + Shift + C / V", desc: "复制选中文本 / 粘贴剪贴板" },
  { group: "终端与面板", keys: "Ctrl + = / -", desc: "放大 / 缩小终端字号" },
  { group: "终端与面板", keys: "Ctrl + E", desc: "显示 / 隐藏右侧 SFTP 文件面板" },
  { group: "终端与面板", keys: "Ctrl + M", desc: "显示 / 隐藏左侧主机遥测面板" },
  { group: "指令与收藏", keys: "Ctrl + H", desc: "打开历史指令记录（支持方向键搜索）" },
  { group: "指令与收藏", keys: "Ctrl + K", desc: "打开常用命令收藏面板" },
  { group: "指令与收藏", keys: "Alt + 1 ~ 9", desc: "快速触发对应快捷键的收藏命令" },
  { group: "指令与收藏", keys: "↑ / ↓（命令栏内）", desc: "浏览历史指令并回车发送" },
];

export function openShortcutsDialog(): void {
  const groups = [...new Set(SHORTCUT_ITEMS.map(item => item.group))];
  $("#shortcuts-body").innerHTML = groups
    .map(group => {
      const rows = SHORTCUT_ITEMS.filter(item => item.group === group)
        .map(
          item => `
            <div class="shortcut-row">
              <span>${item.desc}</span>
              <kbd class="keycap">${item.keys}</kbd>
            </div>
          `,
        )
        .join("");
      return `<section class="shortcut-group"><h3>${group}</h3>${rows}</section>`;
    })
    .join("");

  $<HTMLDialogElement>("#shortcuts-dialog").showModal();
}

export function initShortcuts(handlers: ShortcutHandlers): void {
  $("#open-shortcuts").addEventListener("click", openShortcutsDialog);

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
