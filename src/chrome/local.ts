import { DEFAULT_CONFIG } from "../core/config/config";
import { createMarkdownItEngine, utf8Bytes } from "../core/markdown/markdown-it-engine";
import { currentHeadingIndex } from "../core/outline/current";
import type { Heading } from "../core/outline/types";
import { applyClean } from "../webview/clean";
import { drawDiagrams } from "../webview/diagrams";
import { ancestorIds, HeadingTracker } from "../webview/document-position";
import { handleKey } from "../webview/keyboard";
import {
  closeLookOnEscape,
  closeLookOnOutsideClick,
  createLookControl,
  type LookState,
  readStoredLook,
} from "../webview/look-popover";
import { adoptLayout, mountOutlinePane, storeLayout, toggleOutline } from "../webview/outline-pane";
import { OutlineState } from "../webview/outline-state";
import { renderOutline } from "../webview/outline-view";
import { matchPictureTheme } from "../webview/pictures";
import { renderState } from "../webview/state-view";
import { applySavedTheme } from "../webview/theme-switch";
import { createPromptMenu } from "./prompts-menu";

/**
 * Chrome MV3 content script for local `.md` / `.markdown` files (`file:///*.md`, `file:///*.markdown`).
 * Read-only, offline, zero telemetry, safe HTML rendering (`html: false`, ADR-0002).
 */

interface ChromeRuntimeLike {
  readonly runtime?: {
    getURL?(path: string): string;
  };
}

const WEB_LINK = /^(?:https?|mailto):/i;

function getMermaidUrl(): string {
  const existing = document.body.dataset.diagrams;
  if (existing) return existing;
  const g = globalThis as { chrome?: ChromeRuntimeLike };
  return g.chrome?.runtime?.getURL?.("mermaid.js") ?? "";
}

function fileNameFromLocation(): string {
  const path = location.pathname || "document.md";
  const last = path.split("/").filter(Boolean).pop() ?? "document.md";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function readRawMarkdown(): string | undefined {
  // Chrome renders plain text / markdown file:// URLs inside a single <body><pre>…</pre></body>
  const pre = document.body.querySelector<HTMLPreElement>(":scope > pre");
  if (pre && document.body.children.length === 1) return pre.textContent ?? "";
  if (document.contentType === "text/markdown" || document.contentType === "text/plain") {
    return document.body.textContent ?? "";
  }
  return undefined;
}

function applyLook(look: LookState): void {
  if (look.theme === "vscode") document.body.removeAttribute("data-reading-theme");
  else document.body.setAttribute("data-reading-theme", look.theme);
  document.documentElement.style.setProperty("--reading-scale", String(look.fontScale));
  document.body.toggleAttribute("data-scaled", look.fontScale !== 1);
  document.body.setAttribute("data-line-width", look.lineWidth);
}

function defaultLook(): LookState {
  const saved = readStoredLook();
  return {
    theme: saved?.theme ?? "vscode",
    fontScale: saved?.fontScale ?? 1,
    lineWidth: saved?.lineWidth ?? "normal",
    clean: true,
    numbers: false,
  };
}

export function mountLocalViewer(): void {
  if (document.documentElement.dataset.docmapMounted === "true") return;
  const raw = readRawMarkdown();
  if (raw === undefined) return;
  document.documentElement.dataset.docmapMounted = "true";

  const fileName = fileNameFromLocation();
  document.title = `${fileName} — docmap`;
  applySavedTheme();

  const mermaidUrl = getMermaidUrl();
  if (mermaidUrl) document.body.dataset.diagrams = mermaidUrl;

  let app = document.getElementById("app");
  if (!app) {
    app = document.createElement("div");
    app.id = "app";
    document.body.replaceChildren(app);
  }

  const bytes = utf8Bytes(raw);
  if (bytes > DEFAULT_CONFIG.largeFileBytes) {
    app.replaceChildren(
      renderState("too-large", fileName, undefined, bytes, () => {
        renderLocalDocument(app, fileName, raw);
      }),
    );
    return;
  }

  renderLocalDocument(app, fileName, raw);
}

function renderLocalDocument(app: HTMLElement, fileName: string, raw: string): void {
  const engine = createMarkdownItEngine();
  const parsed = engine.parse(raw, 1, { readingTools: true, inferHeadings: "auto" });

  if (!parsed.ok) {
    const err = document.createElement("main");
    err.className = "document";
    const msg = document.createElement("p");
    msg.textContent = `Could not render ${fileName}: ${parsed.reason}`;
    err.append(msg);
    app.replaceChildren(err);
    return;
  }

  const headings: readonly Heading[] = parsed.document.headings;
  const html = parsed.document.html;
  const state = new OutlineState();
  const tracker = new HeadingTracker();
  let look = defaultLook();
  let promptMenuClose: (() => void) | undefined;

  const headingById = (id: string): HTMLElement | null => {
    const el = document.getElementById(id);
    return el?.closest(".prose") ? el : null;
  };

  const setCurrent = (index: number): void => {
    const nextId = index >= 0 ? headings[index]?.id : undefined;
    if (nextId === state.currentId) return;
    state.currentId = nextId;
    if (app) state.applyCurrent(app, true);
  };

  const revealHeading = (id: string): void => {
    const idx = headings.findIndex((h) => h.id === id);
    if (idx !== -1) {
      for (const anc of ancestorIds(headings, idx)) state.toggle(anc, true);
    }
    state.skimOpen.add(id);
    if (app) state.applyCollapse(app);
  };

  const goToHeading = (id: string): void => {
    revealHeading(id);
    const target = headingById(id);
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    const idx = headings.findIndex((h) => h.id === id);
    if (idx !== -1) setCurrent(idx);
  };

  const renderPage = (): void => {
    if (!app) return;
    adoptLayout(undefined, true);
    applyLook(look);

    const map = document.createElement("div");
    map.className = "map";

    const doc = document.createElement("main");
    doc.className = "document";
    doc.tabIndex = -1;
    // Safe HTML from src/core/markdown (html: false, ADR-0002)
    doc.innerHTML = `<article class="prose">${html}</article>`;

    const prose = doc.querySelector<HTMLElement>(".prose");
    if (prose) {
      applyClean(prose, { numbers: false, fileName });
      // Top bar: read-only badge + Look popover + Copy AI prompt
      const bar = document.createElement("header");
      bar.className = "dm-chrome-bar";

      const badge = document.createElement("span");
      badge.className = "dm-chrome-badge";
      badge.textContent = "docmap · read-only";

      const actions = document.createElement("div");
      actions.className = "dm-chrome-actions";

      const lookControl = createLookControl({
        addedClass: "dm-x",
        current: look,
        snapshot: true,
        post: () => {},
        onLocalChange: (next, themeChanged) => {
          look = next;
          applyLook(look);
          if (themeChanged) drawDiagrams(doc);
        },
      });

      const promptMenu = createPromptMenu({
        fileName,
        getSourceText: () => raw,
      });
      promptMenuClose = promptMenu.close;

      actions.append(lookControl, promptMenu.element);
      bar.append(badge, actions);
      prose.prepend(bar);

      // Keep external links safe; non-web relative links stay inert in local read-only view
      for (const a of prose.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const href = a.getAttribute("href") ?? "";
        if (href.startsWith("#") || WEB_LINK.test(href)) continue;
        a.removeAttribute("href");
        a.dataset.href = href;
        a.title = "Relative file link (read-only view)";
      }
    }

    matchPictureTheme(doc);
    const outline = renderOutline(fileName, headings, true);
    map.append(outline, doc);
    app.replaceChildren(map);

    const label = outline.querySelector(".outline-label");
    if (label) {
      const row = document.createElement("div");
      row.className = "outline-label-row";
      label.replaceWith(row);
      row.append(label);
    }

    mountOutlinePane(map, storeLayout);

    const filter = outline.querySelector<HTMLInputElement>("input.filter");
    if (filter) {
      filter.value = state.query;
      filter.addEventListener("input", () => {
        state.query = filter.value;
        state.apply(app, headings);
        tracker.refresh(headings, headingById);
      });
    }

    state.apply(app, headings);
    drawDiagrams(doc);
    tracker.refresh(headings, headingById);
    if (headings.length > 0 && state.currentId === undefined) setCurrent(0);

    doc.addEventListener(
      "scroll",
      () => {
        const idx = tracker.currentAt(doc.getBoundingClientRect().top + 24);
        if (idx !== -1) setCurrent(idx);
      },
      { passive: true },
    );
  };

  renderPage();

  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    closeLookOnOutsideClick(target);
    if (!target?.closest?.(".dm-ai-wrap")) promptMenuClose?.();

    const twisty = target?.closest<HTMLButtonElement>(".twisty");
    if (twisty && app) {
      event.preventDefault();
      const id = twisty.closest<HTMLElement>(".outline-row")?.dataset.id ?? "";
      if (id) {
        state.toggle(id);
        state.applyCollapse(app);
        tracker.refresh(headings, headingById);
      }
      return;
    }

    const link = target?.closest<HTMLAnchorElement>(".outline-link");
    if (link) {
      event.preventDefault();
      const id = link.closest<HTMLElement>(".outline-row")?.dataset.id ?? "";
      if (id) goToHeading(id);
      return;
    }

    const skimBtn = target?.closest<HTMLButtonElement>(".skim-toggle");
    if (skimBtn && app) {
      event.preventDefault();
      state.skim = !state.skim;
      if (!state.skim) state.skimOpen.clear();
      state.applyCollapse(app);
      tracker.refresh(headings, headingById);
      return;
    }

    const foldBtn = target?.closest<HTMLButtonElement>(".fold-level");
    if (foldBtn && app) {
      event.preventDefault();
      const lvl = Number(foldBtn.dataset.foldLevel ?? "0");
      state.foldToLevel(lvl, headings);
      state.applyCollapse(app);
      tracker.refresh(headings, headingById);
      return;
    }

    const skimLead = target?.closest<HTMLElement>("[data-skim-lead]");
    if (skimLead && app) {
      const sec = skimLead.getAttribute("data-skim-section");
      if (sec !== null) {
        state.skimOpen.add(sec);
        state.applyCollapse(app);
        tracker.refresh(headings, headingById);
      }
      return;
    }

    const toggle = target?.closest<HTMLButtonElement>(".outline-toggle");
    if (toggle) {
      const outline = toggle.closest(".outline");
      if (outline) {
        const folded = outline.toggleAttribute("data-folded");
        toggle.setAttribute("aria-expanded", String(!folded));
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    if (closeLookOnEscape(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Escape") promptMenuClose?.();
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "b"
    ) {
      event.preventDefault();
      toggleOutline(document.querySelector<HTMLElement>(".map"), storeLayout);
      return;
    }
    if (!app) return;
    handleKey(event, {
      toggle(id, open) {
        state.toggle(id, open);
        state.applyCollapse(app);
        tracker.refresh(headings, headingById);
      },
      skim() {
        state.skim = !state.skim;
        if (!state.skim) state.skimOpen.clear();
        state.applyCollapse(app);
        tracker.refresh(headings, headingById);
      },
      foldTo(position) {
        const btns = [...document.querySelectorAll<HTMLButtonElement>(".fold-level")];
        const target = position === 0 ? btns.find((b) => b.dataset.foldLevel === "0") : btns[position - 1];
        if (!target) return;
        const lvl = Number(target.dataset.foldLevel ?? "0");
        state.foldToLevel(lvl, headings);
        state.applyCollapse(app);
        tracker.refresh(headings, headingById);
      },
      isOpen: (id) => state.isOpen(id),
      clearFilter() {
        const input = document.querySelector<HTMLInputElement>("input.filter");
        if (input) input.value = "";
        state.query = "";
        state.apply(app, headings);
        tracker.refresh(headings, headingById);
      },
      jump(direction) {
        if (headings.length === 0) return;
        const cur = state.currentId ? headings.findIndex((h) => h.id === state.currentId) : 0;
        const next = Math.min(Math.max(cur + direction, 0), headings.length - 1);
        const h = headings[next];
        if (h) goToHeading(h.id);
      },
    });
  });

  // Expose helper for hash links inside prose
  window.addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (id && headingById(id)) goToHeading(id);
  });

  // Initial scroll sync if a hash is present
  if (location.hash.length > 1) {
    const id = location.hash.slice(1);
    if (headingById(id)) goToHeading(id);
  }

  // Keep currentHeadingIndex referenced cleanly if needed for future scroll sync
  void currentHeadingIndex;
}

mountLocalViewer();
