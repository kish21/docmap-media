import { copyToClipboard } from "./prompts-menu";

/**
 * Local-only Review & Highlights for Chrome `.md` viewer:
 * Select text → mark Approve (✓), Question (?), or Change (✎) with an optional note.
 * Stored strictly in localStorage per file; "Copy Review for AI" copies a structured Markdown review to clipboard.
 */

export type ReviewKind = "approve" | "question" | "change";

export interface ReviewNote {
  readonly id: string;
  readonly kind: ReviewKind;
  readonly quote: string;
  readonly note: string;
  readonly createdAt: number;
}

const MAX_NOTES = 100;
const KIND_ICON: Record<ReviewKind, string> = { approve: "✓", question: "?", change: "✎" };
const KIND_LABEL: Record<ReviewKind, string> = {
  approve: "Approve",
  question: "Question",
  change: "Change requested",
};

function storageKey(docKey: string): string {
  return `docmap-chrome-review:${docKey}`;
}

export function loadReviewNotes(docKey: string): ReviewNote[] {
  try {
    const raw = localStorage.getItem(storageKey(docKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (n): n is ReviewNote =>
          Boolean(n) &&
          typeof n === "object" &&
          typeof (n as ReviewNote).id === "string" &&
          ((n as ReviewNote).kind === "approve" ||
            (n as ReviewNote).kind === "question" ||
            (n as ReviewNote).kind === "change") &&
          typeof (n as ReviewNote).quote === "string" &&
          typeof (n as ReviewNote).note === "string",
      )
      .slice(0, MAX_NOTES);
  } catch {
    return [];
  }
}

export function saveReviewNotes(docKey: string, notes: readonly ReviewNote[]): void {
  try {
    localStorage.setItem(storageKey(docKey), JSON.stringify(notes.slice(0, MAX_NOTES)));
  } catch {
    // ignore quota / storage restrictions
  }
}

export function formatReviewForAi(fileName: string, notes: readonly ReviewNote[]): string {
  const lines = [
    `Review notes on \`${fileName}\`:`,
    "",
    ...notes.map((n, i) => {
      const head = `${i + 1}. **${KIND_LABEL[n.kind]}** (${KIND_ICON[n.kind]})`;
      const quote = `   > ${n.quote.replace(/\s+/g, " ").trim().slice(0, 220)}`;
      return n.note ? `${head}\n${quote}\n   Note: ${n.note}` : `${head}\n${quote}`;
    }),
    "",
    "Please address each question and requested change concisely, keeping approved parts intact.",
  ];
  return lines.join("\n");
}

export interface ReviewController {
  readonly button: HTMLButtonElement;
  readonly drawer: HTMLElement;
  readonly bindSelection: (prose: HTMLElement) => void;
  readonly close: () => void;
}

export function createReviewController(fileName: string, docKey: string): ReviewController {
  let notes = loadReviewNotes(docKey);
  let open = false;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dm-chrome-pill";
  button.title = "Review notes & Copy Review for AI (stored locally in this browser)";

  const drawer = document.createElement("section");
  drawer.className = "dm-chrome-drawer";
  drawer.setAttribute("aria-label", "Review notes");
  drawer.hidden = true;

  // Floating selection toolbar
  const pop = document.createElement("div");
  pop.className = "dm-review-pop";
  pop.hidden = true;
  let pendingQuote = "";

  const syncButton = () => {
    button.textContent = notes.length > 0 ? `Review (${notes.length})` : "Review";
    button.setAttribute("aria-expanded", String(open));
    button.classList.toggle("is-active", open || notes.length > 0);
  };

  const renderDrawer = () => {
    drawer.replaceChildren();
    const head = document.createElement("div");
    head.className = "dm-drawer-head";
    const title = document.createElement("strong");
    title.textContent =
      notes.length > 0
        ? `Review notes (${notes.length}) — select any text to add`
        : "Review notes — select any text in the document to mark Approve, Question, or Change";
    head.append(title);

    const actions = document.createElement("div");
    actions.className = "dm-drawer-actions";
    if (notes.length > 0) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "dm-chrome-pill";
      copyBtn.textContent = "Copy Review for AI";
      copyBtn.addEventListener("click", () => {
        void copyToClipboard(formatReviewForAi(fileName, notes)).then((ok) => {
          copyBtn.textContent = ok ? "Copied ✓" : "Copy failed";
          setTimeout(() => {
            copyBtn.textContent = "Copy Review for AI";
          }, 2000);
        });
      });

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "dm-chrome-pill";
      clearBtn.textContent = "Clear";
      clearBtn.addEventListener("click", () => {
        notes = [];
        saveReviewNotes(docKey, notes);
        syncButton();
        renderDrawer();
      });
      actions.append(copyBtn, clearBtn);
    }
    head.append(actions);
    drawer.append(head);

    if (notes.length === 0) return;

    const list = document.createElement("ul");
    list.className = "dm-drawer-list";
    for (const item of notes) {
      const li = document.createElement("li");
      li.className = `dm-review-item dm-review-${item.kind}`;

      const badge = document.createElement("span");
      badge.className = "dm-review-badge";
      badge.textContent = `${KIND_ICON[item.kind]} ${KIND_LABEL[item.kind]}`;

      const quote = document.createElement("blockquote");
      quote.className = "dm-review-quote";
      quote.textContent = item.quote;

      const del = document.createElement("button");
      del.type = "button";
      del.className = "dm-review-del";
      del.textContent = "×";
      del.title = "Remove note";
      del.addEventListener("click", () => {
        notes = notes.filter((n) => n.id !== item.id);
        saveReviewNotes(docKey, notes);
        syncButton();
        renderDrawer();
      });

      const top = document.createElement("div");
      top.className = "dm-review-top";
      top.append(badge, del);
      li.append(top, quote);

      if (item.note) {
        const noteP = document.createElement("p");
        noteP.className = "dm-review-note";
        noteP.textContent = item.note;
        li.append(noteP);
      }
      list.append(li);
    }
    drawer.append(list);
  };

  const addNote = (kind: ReviewKind) => {
    const quote = pendingQuote.trim();
    if (!quote) return;
    pop.hidden = true;
    window.getSelection()?.removeAllRanges();
    const entered = window.prompt(
      `${KIND_LABEL[kind]} on "${quote.slice(0, 80)}${quote.length > 80 ? "…" : ""}"\nOptional note (leave blank to save just the highlight):`,
      "",
    );
    if (entered === null) return;
    notes = [
      ...notes.slice(-(MAX_NOTES - 1)),
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind,
        quote: quote.slice(0, 400),
        note: entered.trim().slice(0, 600),
        createdAt: Date.now(),
      },
    ];
    saveReviewNotes(docKey, notes);
    open = true;
    drawer.hidden = false;
    syncButton();
    renderDrawer();
  };

  for (const kind of ["approve", "question", "change"] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dm-review-pop-btn";
    b.textContent = `${KIND_ICON[kind]} ${KIND_LABEL[kind]}`;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => addNote(kind));
    pop.append(b);
  }
  document.body.append(pop);

  button.addEventListener("click", () => {
    open = !open;
    drawer.hidden = !open;
    syncButton();
    if (open) renderDrawer();
  });

  syncButton();

  return {
    button,
    drawer,
    bindSelection(prose: HTMLElement) {
      prose.addEventListener("mouseup", () => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (!sel || sel.isCollapsed || text.length < 3 || sel.rangeCount === 0) {
          pop.hidden = true;
          return;
        }
        const range = sel.getRangeAt(0);
        if (!prose.contains(range.commonAncestorContainer)) {
          pop.hidden = true;
          return;
        }
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          pop.hidden = true;
          return;
        }
        pendingQuote = text;
        pop.style.top = `${Math.max(8, rect.top - 40)}px`;
        pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 260, rect.left))}px`;
        pop.hidden = false;
      });
    },
    close() {
      pop.hidden = true;
    },
  };
}
