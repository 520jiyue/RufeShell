import type { ITheme } from "@xterm/xterm";
import { t, type TranslationKey } from "./i18n/index.ts";
import type { TerminalThemeId } from "./types.ts";

export interface TerminalThemeOption {
  id: TerminalThemeId;
  labelKey: TranslationKey;
  appearance: "dark" | "light";
  theme: ITheme;
}

export const TERMINAL_THEMES: TerminalThemeOption[] = [
  {
    id: "obsidian-emerald",
    labelKey: "theme.obsidianEmerald",
    appearance: "dark",
    theme: {
      background: "#0a0e10",
      foreground: "#dce6e0",
      cursor: "#6ee7b7",
      cursorAccent: "#0a0e10",
      selectionBackground: "#264f3d",
      black: "#182024",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#facc15",
      blue: "#60a5fa",
      magenta: "#c084fc",
      cyan: "#2dd4bf",
      white: "#dce6e0",
      brightBlack: "#64748b",
      brightGreen: "#86efac",
      brightCyan: "#5eead4",
    },
  },
  {
    id: "tokyo-night",
    labelKey: "theme.tokyoNight",
    appearance: "dark",
    theme: {
      background: "#16161e",
      foreground: "#c0caf5",
      cursor: "#7aa2f7",
      cursorAccent: "#16161e",
      selectionBackground: "#283457",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightGreen: "#9ece6a",
      brightCyan: "#7dcfff",
    },
  },
  {
    id: "dracula",
    labelKey: "theme.dracula",
    appearance: "dark",
    theme: {
      background: "#191a21",
      foreground: "#f8f8f2",
      cursor: "#ff79c6",
      cursorAccent: "#191a21",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightGreen: "#69ff94",
      brightCyan: "#a4ffff",
    },
  },
  {
    id: "github-dark",
    labelKey: "theme.githubDark",
    appearance: "dark",
    theme: {
      background: "#0d1117",
      foreground: "#c9d1d9",
      cursor: "#58a6ff",
      cursorAccent: "#0d1117",
      selectionBackground: "#1f3a5f",
      black: "#484f58",
      red: "#ff7b72",
      green: "#3fb950",
      yellow: "#d29922",
      blue: "#58a6ff",
      magenta: "#bc8cff",
      cyan: "#39c5cf",
      white: "#b1bac4",
      brightBlack: "#6e7681",
      brightGreen: "#56d364",
      brightCyan: "#56d4dd",
    },
  },
  {
    id: "morning-mist",
    labelKey: "theme.morningMist",
    appearance: "light",
    theme: {
      background: "#ffffff",
      foreground: "#1e293b",
      cursor: "#059669",
      cursorAccent: "#ffffff",
      selectionBackground: "#bbf7d0",
      black: "#1e293b",
      red: "#dc2626",
      green: "#059669",
      yellow: "#d97706",
      blue: "#2563eb",
      magenta: "#7c3aed",
      cyan: "#0891b2",
      white: "#f1f5f9",
      brightBlack: "#64748b",
      brightGreen: "#10b981",
      brightCyan: "#06b6d4",
    },
  },
  {
    id: "solarized-light",
    labelKey: "theme.solarizedLight",
    appearance: "light",
    theme: {
      background: "#fdf6e3",
      foreground: "#586e75",
      cursor: "#2aa198",
      cursorAccent: "#fdf6e3",
      selectionBackground: "#eee8d5",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#657b83",
      brightGreen: "#859900",
      brightCyan: "#2aa198",
    },
  },
  {
    id: "catppuccin-latte",
    labelKey: "theme.catppuccinLatte",
    appearance: "light",
    theme: {
      background: "#eff1f5",
      foreground: "#4c4f69",
      cursor: "#179299",
      cursorAccent: "#eff1f5",
      selectionBackground: "#ccd0da",
      black: "#5c5f77",
      red: "#d20f39",
      green: "#40a02b",
      yellow: "#df8e1d",
      blue: "#1e66f5",
      magenta: "#8839ef",
      cyan: "#179299",
      white: "#dce0e8",
      brightBlack: "#6c6f85",
      brightGreen: "#40a02b",
      brightCyan: "#04a5e5",
    },
  },
];

export const FONT_PRESETS = [
  { label: "Cascadia Mono", labelKey: null, value: '"Cascadia Mono", Consolas, monospace' },
  { label: "Consolas", labelKey: null, value: 'Consolas, "Courier New", monospace' },
  { label: "JetBrains Mono", labelKey: null, value: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace' },
  { label: "Fira Code", labelKey: null, value: '"Fira Code", "Cascadia Mono", Consolas, monospace' },
  { label: "", labelKey: "font.systemMono" as TranslationKey, value: "monospace" },
];

export function getThemeLabel(option: TerminalThemeOption): string {
  return t(option.labelKey);
}

export function getFontLabel(preset: (typeof FONT_PRESETS)[number]): string {
  return preset.labelKey ? t(preset.labelKey) : preset.label;
}

export function findThemeOption(themeId: string): TerminalThemeOption {
  return TERMINAL_THEMES.find(item => item.id === themeId) ?? TERMINAL_THEMES[0];
}

export function resolveTerminalTheme(themeId: string): ITheme {
  return findThemeOption(themeId).theme;
}

export function applyAppTheme(themeId: string): void {
  const option = findThemeOption(themeId);
  document.documentElement.dataset.theme = option.id;
  document.documentElement.dataset.appearance = option.appearance;
  document.documentElement.style.colorScheme = option.appearance;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) meta.content = option.appearance;
}
