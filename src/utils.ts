import { t } from "./i18n/index.ts";

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

let toastTimer: number | undefined;

export function $<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing expected element: ${selector}`);
  }
  return element;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => HTML_ENTITIES[character]);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return t("metrics.uptimeDays", { days, hours });
  return t("metrics.uptimeHours", { hours, mins: Math.floor((seconds % 3600) / 60) });
}

export function notify(message: string, isError = false): void {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("visible");
    toastTimer = undefined;
  }, isError ? 6500 : 3500);
}

export function setGlobalStatus(message: string): void {
  $("#global-status").textContent = message;
}

export interface HorizontalResizerOptions {
  resizer: HTMLElement;
  panel: HTMLElement;
  direction: 1 | -1;
  minWidth: number;
  maxWidth: number;
  getAvailableWidth: () => number;
  onFinish: () => void;
}

export function attachHorizontalResizer(options: HorizontalResizerOptions): void {
  const { resizer, panel, direction, minWidth, maxWidth, getAvailableWidth, onFinish } = options;

  resizer.addEventListener("pointerdown", event => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    const availableWidth = getAvailableWidth();

    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * direction;
      const upperBound = Math.max(minWidth, Math.min(maxWidth, availableWidth - 300));
      const width = Math.max(minWidth, Math.min(upperBound, startWidth + delta));
      panel.style.width = `${width}px`;
    };

    const onStop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onStop);
      window.removeEventListener("pointercancel", onStop);
      onFinish();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onStop);
    window.addEventListener("pointercancel", onStop);
  });
}
