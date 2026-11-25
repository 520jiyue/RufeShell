import { icon } from "../icons.ts";
import { onLanguageChange } from "../i18n/index.ts";
import { escapeHtml } from "../utils.ts";

let activeMenu: {
  menu: HTMLElement;
  trigger: HTMLButtonElement;
  select: HTMLSelectElement;
  cleanup: () => void;
} | null = null;

function selectedOptionLabel(select: HTMLSelectElement): string {
  const opt = select.selectedOptions[0] ?? select.options[select.selectedIndex] ?? select.options[0];
  return opt?.textContent?.trim() || "请选择";
}

export function syncSelectUI(select: HTMLSelectElement): void {
  const wrapper = select.closest(".ui-select");
  if (!wrapper) return;
  const labelEl = wrapper.querySelector<HTMLElement>(".ui-select-value");
  const trigger = wrapper.querySelector<HTMLButtonElement>(".ui-select-trigger");
  if (labelEl) labelEl.textContent = selectedOptionLabel(select);
  if (trigger) trigger.disabled = select.disabled;
}

export function closeActiveSelectMenu(): void {
  if (!activeMenu) return;
  const { menu, trigger, cleanup } = activeMenu;
  cleanup();
  trigger.setAttribute("aria-expanded", "false");
  trigger.classList.remove("is-open");
  menu.remove();
  activeMenu = null;
}

function openSelectMenu(select: HTMLSelectElement, trigger: HTMLButtonElement): void {
  const wasSame = activeMenu?.select === select;
  closeActiveSelectMenu();
  if (wasSame || select.disabled || select.options.length === 0) return;

  const menu = document.createElement("div");
  menu.className = "ui-select-menu";
  menu.setAttribute("role", "listbox");

  const options = [...select.options];
  menu.innerHTML = options
    .map(opt => {
      const isSelected = opt.value === select.value;
      return `
        <button
          type="button"
          class="ui-select-option ${isSelected ? "is-selected" : ""}"
          role="option"
          aria-selected="${isSelected ? "true" : "false"}"
          data-value="${escapeHtml(opt.value)}"
          ${opt.disabled ? "disabled" : ""}
        >
          <span class="ui-select-opt-text">${escapeHtml(opt.textContent?.trim() ?? "")}</span>
          ${isSelected ? '<span class="ui-select-check" aria-hidden="true">✓</span>' : ""}
        </button>
      `;
    })
    .join("");

  const dialogHost = trigger.closest("dialog[open]");
  (dialogHost ?? document.body).append(menu);

  const rect = trigger.getBoundingClientRect();
  const minW = Math.max(rect.width, 136);
  menu.style.minWidth = `${minW}px`;
  menu.style.maxWidth = `${Math.min(window.innerWidth - 16, Math.max(minW, 320))}px`;

  const menuHeight = Math.min(260, menu.scrollHeight + 4);
  const spaceBelow = window.innerHeight - rect.bottom - 10;
  const spaceAbove = rect.top - 10;
  const openUpward = spaceBelow < menuHeight && spaceAbove > spaceBelow;

  if (openUpward) {
    menu.style.bottom = `${window.innerHeight - rect.top + 5}px`;
    menu.style.top = "auto";
    menu.style.maxHeight = `${Math.max(120, Math.min(260, spaceAbove))}px`;
  } else {
    menu.style.top = `${rect.bottom + 5}px`;
    menu.style.bottom = "auto";
    menu.style.maxHeight = `${Math.max(120, Math.min(260, spaceBelow))}px`;
  }

  const menuWidth = menu.offsetWidth || minW;
  const clampedLeft = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));
  menu.style.left = `${clampedLeft}px`;

  trigger.setAttribute("aria-expanded", "true");
  trigger.classList.add("is-open");

  const activeOpt = menu.querySelector<HTMLElement>(".ui-select-option.is-selected");
  activeOpt?.scrollIntoView({ block: "nearest" });

  const chooseValue = (value: string) => {
    const changed = select.value !== value;
    select.value = value;
    syncSelectUI(select);
    closeActiveSelectMenu();
    trigger.focus();
    if (changed) {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  menu.addEventListener("click", event => {
    const optBtn = (event.target as HTMLElement).closest<HTMLButtonElement>(".ui-select-option");
    if (!optBtn || optBtn.disabled) return;
    chooseValue(optBtn.dataset.value ?? "");
  });

  const onDocPointerDown = (event: PointerEvent) => {
    const target = event.target as Node;
    if (menu.contains(target) || trigger.contains(target)) return;
    closeActiveSelectMenu();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const items = [...menu.querySelectorAll<HTMLButtonElement>(".ui-select-option:not(:disabled)")];
    if (!items.length) return;
    const focusedIdx = items.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeActiveSelectMenu();
      trigger.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = items[(focusedIdx + 1) % items.length];
      next?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = items[(focusedIdx - 1 + items.length) % items.length];
      prev?.focus();
    } else if (event.key === "Enter" && focusedIdx >= 0) {
      event.preventDefault();
      chooseValue(items[focusedIdx].dataset.value ?? "");
    }
  };

  const onResizeOrScroll = (event: Event) => {
    if (event.type === "scroll" && menu.contains(event.target as Node)) return;
    closeActiveSelectMenu();
  };

  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("resize", onResizeOrScroll);
  window.addEventListener("scroll", onResizeOrScroll, true);

  activeMenu = {
    menu,
    trigger,
    select,
    cleanup: () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
    },
  };
}

function enhanceSelect(select: HTMLSelectElement): void {
  if (select.dataset.uiEnhanced === "1") {
    syncSelectUI(select);
    return;
  }
  select.dataset.uiEnhanced = "1";

  const wrapper = document.createElement("div");
  wrapper.className = "ui-select";
  if (select.classList.contains("dual-quick-select")) {
    wrapper.classList.add("is-dual-quick");
  }
  if (select.closest(".alert-rule-row")) {
    wrapper.classList.add("is-compact");
  }
  if (select.closest(".fwd-form")) {
    wrapper.classList.add("is-fwd-kind");
  }

  select.parentNode?.insertBefore(wrapper, select);
  wrapper.append(select);

  select.classList.add("ui-select-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "ui-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const ariaLabel = select.getAttribute("aria-label") || select.getAttribute("title");
  if (ariaLabel) trigger.setAttribute("aria-label", ariaLabel);
  trigger.innerHTML = `<span class="ui-select-value"></span>${icon("chevronDown")}`;
  wrapper.append(trigger);

  syncSelectUI(select);

  trigger.addEventListener("click", event => {
    event.preventDefault();
    openSelectMenu(select, trigger);
  });

  trigger.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openSelectMenu(select, trigger);
    }
  });

  select.addEventListener("change", () => syncSelectUI(select));
}

export function enhanceAllSelects(root: ParentNode = document): void {
  root.querySelectorAll<HTMLSelectElement>("select").forEach(enhanceSelect);
}

let selectsInitialized = false;

export function initCustomSelects(): void {
  if (selectsInitialized) return;
  selectsInitialized = true;

  // Keep custom trigger synced whenever code sets `select.value = ...` directly
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  if (valueDesc?.set && valueDesc.get) {
    Object.defineProperty(HTMLSelectElement.prototype, "value", {
      configurable: true,
      get() {
        return valueDesc.get!.call(this);
      },
      set(next: string) {
        valueDesc.set!.call(this, next);
        if ((this as HTMLSelectElement).dataset.uiEnhanced === "1") {
          syncSelectUI(this as HTMLSelectElement);
        }
      },
    });
  }

  enhanceAllSelects(document);

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.target instanceof HTMLSelectElement) {
        syncSelectUI(m.target);
        continue;
      }
      if (m.target instanceof HTMLOptionElement && m.target.parentElement instanceof HTMLSelectElement) {
        syncSelectUI(m.target.parentElement);
        continue;
      }
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLSelectElement) {
          enhanceSelect(node);
        } else if (node.querySelector("select")) {
          enhanceAllSelects(node);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  onLanguageChange(() => {
    document.querySelectorAll<HTMLSelectElement>("select").forEach(syncSelectUI);
  });
}
