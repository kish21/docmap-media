import { buildPrompt, docFacts, type PromptId, promptsFor } from "../core/agent/prompts";

/**
 * Copy-only Ask AI prompt menu for the Chrome extension (PRODUCT.md#Scope 2026-11-17):
 * docmap never calls a model or sends document text over the network — it builds a prompt
 * from `src/core/agent/prompts.ts` and copies it to the clipboard for the user's own AI agent.
 */

const READ_ONLY_CHROME_PROMPTS: readonly PromptId[] = [
  "summary",
  "explain",
  "challenge",
  "risks",
  "tasks",
  "readable",
  "onePager",
];

export interface PromptMenuOptions {
  readonly fileName: string;
  readonly getSourceText: () => string;
  readonly classNamePrefix?: string;
}

/** Copies text to the clipboard using Clipboard API with a safe textarea fallback. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below when Clipboard API is restricted (e.g. file:// without focus)
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Builds a copy-only "Ask AI" trigger button + popover menu. */
export function createPromptMenu(options: PromptMenuOptions): {
  readonly element: HTMLElement;
  readonly close: () => void;
} {
  const prefix = options.classNamePrefix ?? "dm-ai";
  const wrap = document.createElement("div");
  wrap.className = `${prefix}-wrap`;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = `${prefix}-btn`;
  trigger.textContent = "Copy AI prompt";
  trigger.title = "Copy a prompt for your own AI agent (clipboard only — never sends data)";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = `${prefix}-menu`;
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  const status = document.createElement("span");
  status.className = `${prefix}-toast`;
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const flashStatus = (msg: string) => {
    status.textContent = msg;
    status.hidden = false;
    if (toastTimer !== undefined) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      status.hidden = true;
    }, 2600);
  };

  let populated = false;
  const populateMenu = () => {
    if (populated) return;
    populated = true;
    const sourceText = options.getSourceText();
    const facts = docFacts(options.fileName, sourceText);
    const available = promptsFor(["file", "section"], {
      file: options.fileName,
      docKind: facts.docKind,
      emptySections: facts.emptySections,
    });
    const chosen = READ_ONLY_CHROME_PROMPTS.map((id) => available.find((p) => p.id === id)).filter(
      (p): p is NonNullable<typeof p> => p !== undefined,
    );

    for (const def of chosen) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `${prefix}-item`;
      item.setAttribute("role", "menuitem");
      item.dataset.promptId = def.id;

      const label = document.createElement("span");
      label.className = `${prefix}-item-label`;
      label.textContent = def.label;
      const detail = document.createElement("span");
      detail.className = `${prefix}-item-detail`;
      detail.textContent = def.detail;
      item.append(label, detail);

      item.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = options.getSourceText();
        const prompt = buildPrompt(def.id, {
          file: options.fileName,
          section: { title: options.fileName, text },
        });
        setOpen(false);
        void copyToClipboard(prompt).then((ok) => {
          flashStatus(ok ? "Prompt copied — paste into your AI agent" : "Could not access clipboard");
        });
      });
      menu.append(item);
    }
  };

  const setOpen = (open: boolean, focusTrigger = false) => {
    if (open) populateMenu();
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (!open && focusTrigger) trigger.focus();
  };

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(Boolean(menu.hidden));
  });

  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false, true);
    }
  });

  wrap.append(trigger, menu, status);
  return {
    element: wrap,
    close: () => setOpen(false),
  };
}
