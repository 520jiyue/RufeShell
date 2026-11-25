import type { LanguageId } from "../types.ts";
import { en } from "./locales/en.ts";
import { zhCN, type TranslationDict, type TranslationKey } from "./locales/zhCN.ts";
export { LANGUAGE_OPTIONS } from "./types.ts";

const DICTS: Record<LanguageId, TranslationDict> = {
  "zh-CN": zhCN,
  en,
};

let currentLanguage: LanguageId = "zh-CN";
const listeners = new Set<() => void>();

export function normalizeLanguage(lang: string | undefined | null): LanguageId {
  if (!lang) return "zh-CN";
  if (lang === "en" || lang.toLowerCase().startsWith("en")) return "en";
  return "zh-CN";
}

export function getLanguage(): LanguageId {
  return currentLanguage;
}

export function setLanguage(lang: string, emit = true): LanguageId {
  const next = normalizeLanguage(lang);
  currentLanguage = next;
  document.documentElement.lang = next;
  if (emit) {
    applyStaticTranslations();
    listeners.forEach(cb => cb());
  }
  return next;
}

export function onLanguageChange(listener: () => void): void {
  listeners.add(listener);
}

export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const template = DICTS[currentLanguage][key] ?? DICTS["zh-CN"][key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}

export function formatLocaleTime(
  unixSeconds: number,
  options: Intl.DateTimeFormatOptions = {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  },
): string {
  return new Date(unixSeconds * 1000).toLocaleString(currentLanguage, options);
}

export function formatLocaleClock(date: Date = new Date()): string {
  return date.toLocaleTimeString(currentLanguage, { hour12: false });
}

export function applyStaticTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n as TranslationKey;
    el.textContent = t(key);
  });
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-placeholder]").forEach(el => {
    const key = el.dataset.i18nPlaceholder as TranslationKey;
    el.placeholder = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach(el => {
    const key = el.dataset.i18nTitle as TranslationKey;
    el.title = t(key);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria]").forEach(el => {
    const key = el.dataset.i18nAria as TranslationKey;
    el.setAttribute("aria-label", t(key));
  });
}

export type { LanguageId, TranslationKey };
