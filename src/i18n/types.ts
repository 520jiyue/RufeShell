import type { LanguageId } from "../types.ts";

export interface LanguageOption {
  id: LanguageId;
  label: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { id: "zh-CN", label: "简体中文" },
  { id: "en", label: "English" },
];
