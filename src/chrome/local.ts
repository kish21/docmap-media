import { DEFAULT_CONFIG } from "../core/config/config";
import { analyze } from "../core/insights/analyze";
import { type DocItem, docItems } from "../core/insights/items";
import { standing } from "../core/insights/standing";
import { createMarkdownItEngine, utf8Bytes } from "../core/markdown/markdown-it-engine";
import { currentHeadingIndex } from "../core/outline/current";
import type { Heading } from "../core/outline/types";
import { applyClean, openMore } from "../webview/clean";
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
import { drawStanding } from "../webview/standing-view";
import { renderState } from "../webview/state-view";
import { applySavedTheme } from "../webview/theme-switch";
import { createPromptMenu } from "./prompts-menu";
import { createReviewController, type ReviewController } from "./review";
import { createSlidesController, type SlidesController } from "./slides";

/**
 * Chrome MV3 content script for local `.md` / `.markdown` files (`file:///*.md`, `file:///*.markdown`)
 * and raw GitHub/Gist Markdown URLs.
 * Read-only, offline on local files, zero telemetry, safe HTML rendering (`html: false`, ADR-0002).
 */

interface ChromeRuntimeLike {
  readonly runtime?: {
    getURL?(path: string): string;
  };
}

const WEB_LINK = /^(?:https?|mailto):/i;
const SAFE_IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;

/**
 * Resolves a relative local image path (e.g. `./arch.png`, `images/flow.svg`) strictly inside the
 * current document's folder on `file://` URLs. Remote URLs, traversal (`..`), and non-image files
 * are refused so local viewing stays offline and confined.
 */
function resolveLocalChromeImage(src: string): string | undefined {
  if (location.protocol !== "file:") return undefined;
  const clean = src.split(/[?#]/)[0] ?? "";
  if (!clean || clean.startsWith("/") || clean.includes("\\") || clean.includes(":")) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return undefined;
  }
  if (!SAFE_IMAGE_EXT.test(decoded)) return undefined;
  const parts = decoded.split("/");
  if (parts.some((seg) => seg === ".." || hasControlChar(seg))) return undefined;
  try {
    const baseDir = new URL("./", location.href).href;
    const resolved = new URL(clean, baseDir).href;
    return resolved.startsWith(baseDir) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

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
  app.classList.add("map-root");

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
  const parsed = engine.parse(raw, 1, {
    readingTools: true,
    inferHeadings: "auto",
    resolveImage: resolveLocalChromeImage,
  });

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
  const facts = analyze(raw);
  const items: readonly DocItem[] = docItems(raw);
  const questions = items.filter((it) => it.kind === "question");
  const openTasks = items.filter((it) => it.kind === "task");
  const st = standing(raw, headings);
  const hasStanding =
    st.parts.length > 0 || st.events.length > 1 || st.disagree.length > 0 || Boolean(st.status);

  // Map each actionable item to its enclosing heading id so clicking jumps straight there
  const headingForLine = (line: number): Heading | undefined => {
    let found: Heading | undefined;
    for (const h of headings) {
      if (h.line <= line) found = h;
      else break;
    }
    return found;
  };
  const sectionCounts = new Map<string, { q: number; t: number }>();
  for (const it of items) {
    const h = headingForLine(it.line);
    if (!h) continue;
    const cur = sectionCounts.get(h.id) ?? { q: 0, t: 0 };
    if (it.kind === "question") cur.q++;
    else cur.t++;
    sectionCounts.set(h.id, cur);
  }

  const state = new OutlineState();
  const tracker = new HeadingTracker();
  let look = defaultLook();
  let cleanMode = look.clean !== false;
  let promptMenuClose: (() => void) | undefined;
  let reviewCtrl: ReviewController | undefined;
  let slidesCtrl: SlidesController | undefined;
  const docKey = location.pathname || fileName;

  const headingById = (id: string): HTMLElement | null => {
    if (!id) return null;
    try {
      return document.querySelector<HTMLElement>(`.prose [id="${CSS.escape(id)}"]`);
    } catch {
      return null;
    }
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
      if (cleanMode) {
        applyClean(prose, { numbers: false, fileName });
        if (hasStanding) drawStanding(prose, st, "dm-x");
      }

      // Top bar: status / progress + attention pills + Clean view + Slides + Review + Look + Copy AI prompt
      const bar = document.createElement("header");
      bar.className = "dm-chrome-bar";

      const left = document.createElement("div");
      left.className = "dm-chrome-status";

      const badge = document.createElement("span");
      badge.className = "dm-chrome-badge";
      badge.textContent = "docmap";
      left.append(badge);

      const totalTasks = facts.tasksDone + facts.tasksOpen;
      if (totalTasks > 0) {
        const prog = document.createElement("span");
        prog.className = "dm-chrome-stat";
        prog.textContent = `${facts.tasksDone}/${totalTasks} done`;
        prog.title = `${facts.tasksDone} completed, ${facts.tasksOpen} open tasks`;
        left.append(prog);
      }

      // Attention drawer (Questions / Open Tasks)
      const attentionDrawer = document.createElement("section");
      attentionDrawer.className = "dm-chrome-drawer";
      attentionDrawer.setAttribute("aria-label", "Questions and open tasks");
      attentionDrawer.hidden = true;
      let activeAttention: "question" | "task" | undefined;

      const renderAttentionDrawer = (kind: "question" | "task") => {
        const listItems = kind === "question" ? questions : openTasks;
        attentionDrawer.replaceChildren();
        const head = document.createElement("div");
        head.className = "dm-drawer-head";
        const title = document.createElement("strong");
        title.textContent =
          kind === "question"
            ? `Open questions (${listItems.length}) — click to jump`
            : `Open tasks (${listItems.length}) — click to jump`;
        head.append(title);
        attentionDrawer.append(head);

        const ul = document.createElement("ul");
        ul.className = "dm-drawer-list";
        for (const it of listItems) {
          const li = document.createElement("li");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "dm-attention-item";
          const sec = headingForLine(it.line);
          const textSpan = document.createElement("span");
          textSpan.textContent = it.text;
          const metaSpan = document.createElement("span");
          metaSpan.className = "dm-attention-meta";
          metaSpan.textContent = sec ? `${sec.text} · line ${it.line + 1}` : `line ${it.line + 1}`;
          btn.append(textSpan, metaSpan);
          btn.addEventListener("click", () => {
            if (sec) goToHeading(sec.id);
          });
          li.append(btn);
          ul.append(li);
        }
        attentionDrawer.append(ul);
      };

      let qBtn: HTMLButtonElement | undefined;
      let tBtn: HTMLButtonElement | undefined;
      const toggleAttention = (kind: "question" | "task") => {
        activeAttention = activeAttention === kind ? undefined : kind;
        attentionDrawer.hidden = activeAttention === undefined;
        qBtn?.classList.toggle("is-active", activeAttention === "question");
        tBtn?.classList.toggle("is-active", activeAttention === "task");
        if (activeAttention) renderAttentionDrawer(activeAttention);
      };

      if (questions.length > 0) {
        qBtn = document.createElement("button");
        qBtn.type = "button";
        qBtn.className = "dm-chrome-pill dm-pill-warn";
        qBtn.textContent = `? ${questions.length} ${questions.length === 1 ? "question" : "questions"}`;
        qBtn.title = "Show open questions in this document";
        qBtn.addEventListener("click", () => toggleAttention("question"));
        left.append(qBtn);
      }

      if (openTasks.length > 0) {
        tBtn = document.createElement("button");
        tBtn.type = "button";
        tBtn.className = "dm-chrome-pill";
        tBtn.textContent = `☐ ${openTasks.length} ${openTasks.length === 1 ? "task" : "tasks"}`;
        tBtn.title = "Show open tasks in this document";
        tBtn.addEventListener("click", () => toggleAttention("task"));
        left.append(tBtn);
      }

      const actions = document.createElement("div");
      actions.className = "dm-chrome-actions";

      const cleanBtn = document.createElement("button");
      cleanBtn.type = "button";
      cleanBtn.className = `dm-chrome-pill${cleanMode ? " is-active" : ""}`;
      cleanBtn.textContent = cleanMode ? "Clean view" : "As written";
      cleanBtn.title = "Toggle Clean view (Where this stands, folded long paragraphs, cards)";
      cleanBtn.setAttribute("aria-pressed", String(cleanMode));
      cleanBtn.addEventListener("click", () => {
        cleanMode = !cleanMode;
        look = { ...look, clean: cleanMode };
        slidesCtrl?.exit();
        renderPage();
      });
      actions.append(cleanBtn);

      slidesCtrl = createSlidesController(prose);
      if (slidesCtrl) actions.append(slidesCtrl.button);

      reviewCtrl = createReviewController(fileName, docKey);
      reviewCtrl.bindSelection(prose);
      actions.append(reviewCtrl.button);

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
      bar.append(left, actions);
      prose.prepend(bar, attentionDrawer, reviewCtrl.drawer);

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
    // Add subtle per-section attention badges (?N / ☐N) in the outline
    if (sectionCounts.size > 0) {
      for (const row of outline.querySelectorAll<HTMLElement>(".outline-row")) {
        const id = row.dataset.id ?? "";
        const c = sectionCounts.get(id);
        if (!c) continue;
        const badge = document.createElement("span");
        badge.className = "dm-outline-attn";
        const parts: string[] = [];
        if (c.q > 0) parts.push(`?${c.q}`);
        if (c.t > 0) parts.push(`☐${c.t}`);
        badge.textContent = parts.join(" ");
        badge.title = `${c.q} open questions, ${c.t} open tasks in this section`;
        row.append(badge);
      }
    }
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
        state.applyOutlineFilter(app, headings);
      });
    }

    state.apply(app, headings);
    drawDiagrams(doc);
    tracker.refresh(headings, headingById);
    if (headings.length > 0 && state.currentId === undefined) setCurrent(0);

    let scrollFrame = 0;
    doc.addEventListener(
      "scroll",
      () => {
        if (scrollFrame) return;
        scrollFrame = requestAnimationFrame(() => {
          scrollFrame = 0;
          const idx = tracker.currentAt(doc.getBoundingClientRect().top + 24);
          if (idx !== -1) setCurrent(idx);
        });
      },
      { passive: true },
    );
  };

  renderPage();

  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    closeLookOnOutsideClick(target);
    if (!target?.closest?.(".dm-ai-wrap")) promptMenuClose?.();
    if (!target?.closest?.(".dm-review-pop")) reviewCtrl?.close();

    const moreBtn = target?.closest<HTMLButtonElement>(".dm-more-btn");
    if (moreBtn) {
      event.preventDefault();
      openMore(moreBtn);
      return;
    }

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
    if (slidesCtrl?.handleKey(event)) return;
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

  const decodeHashId = (): string => {
    const rawHash = location.hash.slice(1);
    if (!rawHash) return "";
    try {
      return decodeURIComponent(rawHash);
    } catch {
      return rawHash;
    }
  };

  // Expose helper for hash links inside prose
  window.addEventListener("hashchange", () => {
    const id = decodeHashId();
    if (id && headingById(id)) goToHeading(id);
  });

  // Initial scroll sync if a hash is present
  if (location.hash.length > 1) {
    const id = decodeHashId();
    if (headingById(id)) goToHeading(id);
  }

  // Keep currentHeadingIndex referenced cleanly if needed for future scroll sync
  void currentHeadingIndex;
}

mountLocalViewer();
