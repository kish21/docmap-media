import { INTERNAL_TIMINGS } from "../core/config/config";
import { BROWSER_FRAGMENT } from "../core/insights/plans-dashboard";
import { currentHeadingIndex } from "../core/outline/current";
import type { Heading } from "../core/outline/types";
import {
  isHostToWebview,
  type OutlineLayout,
  type PageExtras,
  type WebviewToHost,
} from "../core/protocol/messages";
import { applyClean, openMore } from "./clean";
import { forgetCodePeeks, initCodePeek, showCodePeek } from "./code-actions";
import { drawDiagrams } from "./diagrams";
import { ancestorIds, captureAnchor, HeadingTracker, restoreAnchor } from "./document-position";
import { applyExtras, initExtras, setPageVersion, startSlides } from "./extras";
import { handleKey } from "./keyboard";
import { adoptLayout, mountOutlinePane, storeLayout, toggleOutline } from "./outline-pane";
import { OutlineState } from "./outline-state";
import { renderOutline } from "./outline-view";
import { matchPictureTheme } from "./pictures";
import { renderState } from "./state-view";
import { applySavedTheme, themeButton } from "./theme-switch";

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHost): void };

const vscode = acquireVsCodeApi();
/** Running as the browser snapshot (a file on disk, no VS Code host): links to other files cannot be opened. */
const SNAPSHOT = document.documentElement.hasAttribute("data-snapshot");
/** 3.0: the snapshot page served live by docmap's local server — it follows the editor as it changes. */
const LIVE = SNAPSHOT && document.documentElement.hasAttribute("data-live");
/** Links the page itself may follow: web and mail. Everything else is handled here (or refused). */
const WEB_LINK = /^(?:https?|mailto):/i;
const app = document.getElementById("app");
/**
 * Browser snapshot only (0.0.13): the linked Markdown files written beside this page — a link's href → that page's
 * file: URL. Read now, before any document is drawn (a document's own `<a id>` could otherwise shadow the element).
 */
const LINKED_PAGES = SNAPSHOT ? linkedPages() : new Map<string, string>();
let hashRevealed = false;
/** The browser snapshot keeps its last drawing, to draw it again when the reader switches light / dark. */
let lastDrawn: { fileName: string; html: string; readingTools: boolean } | undefined;
if (SNAPSHOT) applySavedTheme();
const state = new OutlineState();
initExtras(
  (m) => vscode.postMessage(m),
  SNAPSHOT,
  () => {
    if (SNAPSHOT && app && lastDrawn) {
      render(app, lastDrawn.fileName, lastDrawn.html, lastDrawn.readingTools);
      applyExtras(undefined);
    }
  },
);
initCodePeek((m) => vscode.postMessage(m), SNAPSHOT);
let printed = false;
/** 3.0: the reading look of the latest render (Clean view on unless the reader turned it off). */
let look: { clean?: boolean; numbers?: boolean } | undefined;
let docVersion = -1;
let headings: readonly Heading[] = [];
const tracker = new HeadingTracker();
/** Set while the panel restores its own scroll position — that scroll is not the reader moving. */
let restoring = false;
let restoreGeneration = 0;

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  // the snapshot's only host is its own boot script: nothing from another window is a message for it
  if (SNAPSHOT && event.source !== window) return;
  const message = event.data;
  if (!app || !isHostToWebview(message)) return;
  switch (message.type) {
    case "render":
      docVersion = message.docVersion;
      setPageVersion(docVersion);
      headings = message.headings;
      adoptLayout(message.layout, SNAPSHOT);
      look = message.extras?.look ?? look;
      forgetCodePeeks(); // code review 2026-11-24: a code file may have changed since its lines were shown
      render(app, message.fileName, message.html, message.readingTools === true, message.extras);
      if (SNAPSHOT && !printed && document.documentElement.hasAttribute("data-autoprint")) {
        printed = true; // Export PDF: the print dialog ("Save as PDF") once the page is drawn
        setTimeout(() => window.print(), INTERNAL_TIMINGS.printDelayMs);
      }
      if (SNAPSHOT && !hashRevealed) {
        // a linked page opened at a heading (other.html#setup): the map is drawn by script, after the browser's
        // own jump to the #fragment — so jump now
        hashRevealed = true;
        const id = safeDecode(location.hash.slice(1));
        if (id) {
          revealHeading(id);
          revealBlockOf(targetById(id));
          goToHeading(id);
        }
      }
      break;
    case "state":
      headings = [];
      app.replaceChildren(
        renderState(message.state, message.fileName, message.detail, message.bytes, () =>
          vscode.postMessage({ type: "renderAnyway" }),
        ),
      );
      break;
    case "extras":
      if (message.docVersion === docVersion) applyExtras(message.extras);
      break;
    case "editorScrolled":
      // the editor moved: "you are here" follows it (the panel's own scroll is tracked below)
      if (message.docVersion === docVersion) setCurrent(currentHeadingIndex(headings, message.topLine));
      break;
    case "reveal": {
      // the place this map was left at, or a link's #heading: scroll there (an id this map lacks is ignored)
      const index = headings.findIndex((h) => h.id === message.headingId);
      if (message.docVersion !== docVersion || index === -1) break;
      revealHeading(message.headingId);
      restoring = true; // this scroll is the host's, not the reader's: "you are here" is set below
      const generation = ++restoreGeneration;
      headingById(message.headingId)?.scrollIntoView({ block: "start" });
      requestAnimationFrame(() => {
        if (generation === restoreGeneration) restoring = false;
      });
      setCurrent(index);
      break;
    }
    case "showSlides":
      if (message.docVersion === docVersion) startSlides();
      break;
    case "codePeek":
      showCodePeek(message.text, message.peek);
      break;
  }
});

/** Draws the map, keeping the reader's place: scroll positions, focused entry, folds, filter, current section. */
function render(
  root: HTMLElement,
  fileName: string,
  html: string,
  readingTools: boolean,
  extras?: PageExtras,
): void {
  const oldDoc = root.querySelector<HTMLElement>(".document");
  const anchor = oldDoc ? captureAnchor(oldDoc) : undefined;
  const outlineScroll = root.querySelector(".outline-tree")?.scrollTop ?? 0;
  const focused = document.activeElement as HTMLElement | null;
  const focusedId = focused?.closest?.<HTMLElement>(".outline-row")?.dataset.id;
  const filterFocused = focused instanceof HTMLInputElement && focused.classList.contains("filter");
  // a narrow panel opens with the contents folded to one line, so the page gets the height (0.2.1, owner: the
  // outline took half the panel); a re-render keeps the reader's choice. Wide panels ignore the flag.
  const previous = root.querySelector(".outline");
  const folded = previous ? previous.hasAttribute("data-folded") : true;

  const map = div("map");
  const doc = document.createElement("main");
  doc.className = "document";
  doc.tabIndex = -1;
  // html is the host engine's output: document HTML printed as text, bar a short allowlist of bare tags (ADR-0002).
  doc.innerHTML = `<article class="prose">${html}</article>`;
  // 3.0 Clean view: lays AI Markdown out properly — before diagrams, skim and folds see the page
  const prose = doc.querySelector<HTMLElement>(".prose");
  if (prose && look?.clean !== false) applyClean(prose, { numbers: look?.numbers === true, fileName });
  matchPictureTheme(doc); // <picture> light/dark versions follow VS Code's theme
  const outline = renderOutline(fileName, headings, readingTools);
  map.append(outline, doc);
  root.replaceChildren(map);
  // the file name, with the pane's buttons beside it: hide the outline, and in the browser the light / dark switch
  const label = outline.querySelector(".outline-label");
  if (label) {
    const row = div("outline-label-row");
    label.replaceWith(row);
    row.append(label);
    if (SNAPSHOT) {
      lastDrawn = { fileName, html, readingTools };
      row.append(
        themeButton(() => {
          // diagrams are drawn for one theme: draw the page again for the other
          if (lastDrawn) render(root, lastDrawn.fileName, lastDrawn.html, lastDrawn.readingTools);
        }),
      );
    }
  }
  mountOutlinePane(map, saveLayout);

  const filter = outline.querySelector<HTMLInputElement>("input.filter");
  if (filter) filter.value = state.query;
  if (folded) setFolded(outline, true);
  state.apply(root, headings);
  applyExtras(extras); // draw toolbar, front matter and marks BEFORE restoring scroll so prepended chrome never shifts place
  drawDiagrams(doc); // ```mermaid blocks: cached drawn at once, uncached lazily near the viewport (#56)
  if (SNAPSHOT) {
    // links to other files: shown, but inert — and saying so, instead of silently doing nothing
    for (const a of root.querySelectorAll<HTMLAnchorElement>(".prose a[href]")) {
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("#") || WEB_LINK.test(href)) continue;
      // the Plans dashboard's 🌐 "open this plan in the browser": already in the browser, it could do nothing here
      if (href.endsWith(`#${BROWSER_FRAGMENT}`)) {
        a.remove();
        continue;
      }
      const page = LINKED_PAGES.get(href);
      if (page) {
        // a linked Markdown file written beside this page: a real link to it
        a.setAttribute("href", page);
        a.dataset.page = "";
        continue;
      }
      // not a link any more (no href): no click, middle-click, context menu or drag can open it from here
      a.removeAttribute("href");
      a.dataset.href = href;
      a.title = "Links to other files open in VS Code, not here";
    }
  }
  // "you are here" pauses while the panel restores its own scroll; only the LATEST restore may end the pause
  if (scrollFrame) {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }
  restoring = true;
  const generation = ++restoreGeneration;
  restoreAnchor(
    doc,
    anchor,
    () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (generation === restoreGeneration) restoring = false; // after the restore's last scroll event
        }),
      ),
    () => generation !== restoreGeneration, // a reveal after this render takes over the scroll
  );
  tracker.refresh(headings, headingById);
  const tree = outline.querySelector(".outline-tree");
  if (tree) tree.scrollTop = outlineScroll;
  if (filterFocused) filter?.focus({ preventScroll: true });
  else if (focusedId) outlineLink(focusedId)?.focus({ preventScroll: true });

  doc.addEventListener("scroll", onDocumentScroll, { passive: true });
  filter?.addEventListener("input", () => {
    state.query = filter.value;
    state.applyOutlineFilter(root, headings);
  });
}

// ---------- find (Ctrl+F): bring the match into view ----------

// VS Code's find bar selects each match; in VS Code for the web it does not scroll to it, because the map scrolls
// inside its own panes, not the page. When a selection lands outside its pane's view, scroll it there (a selection
// made by hand is always in view, so this never moves the reader).
document.addEventListener("selectionchange", () => {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  const start = range.startContainer;
  const element = start instanceof Element ? start : start.parentElement;
  const pane = element?.closest<HTMLElement>(".document, .outline-tree");
  if (!element || !pane) return;
  const box = range.getBoundingClientRect();
  const view = pane.getBoundingClientRect();
  if (box.bottom > view.top && box.top < view.bottom) return;
  element.scrollIntoView({ block: "center" });
});

// ---------- you are here: from the panel's own scroll ----------

let scrollFrame = 0;
/**
 * A heading the reader just went to (a click in the outline, a #link, a page opened at a heading). It stays "you are
 * here" while it is on screen — a heading near the end of a document cannot scroll to the top, so the scroll position
 * alone would name the section above it — and lets go once the reader scrolls it out of view.
 */
let pinnedId: string | undefined;
function onDocumentScroll(): void {
  if (scrollFrame || restoring) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const doc = document.querySelector<HTMLElement>(".document");
    if (!doc || restoring) return;
    const box = doc.getBoundingClientRect();
    if (pinnedId !== undefined) {
      const top = targetById(pinnedId)?.getBoundingClientRect().top;
      if (top !== undefined && top >= box.top - 2 && top < box.bottom) return; // still on screen: stays current
      pinnedId = undefined;
    }
    setCurrent(tracker.currentAt(box.top + 24));
  });
}

/** Scrolls to a heading and marks it "you are here" (see pinnedId). */
function goToHeading(id: string): void {
  targetById(id)?.scrollIntoView({ block: "start" });
  const index = headings.findIndex((h) => h.id === id);
  if (index === -1) return;
  pinnedId = id;
  setCurrent(index);
}

function setCurrent(index: number): void {
  const id = headings[index]?.id;
  if (id === state.currentId || !app) return;
  state.currentId = id;
  state.applyCurrent(app, true);
  // the host remembers where the reader is, to return there when this file's map is opened again
  if (id && !SNAPSHOT) vscode.postMessage({ type: "place", headingId: id });
}

let pendingLeadClick: ReturnType<typeof setTimeout> | undefined;

// ---------- clicks: outline links jump, fold buttons fold, links in the document go where they should ----------

document.addEventListener("click", (event) => {
  const target = event.target as Element | null;
  const more = target?.closest?.<HTMLButtonElement>(".dm-more-btn");
  if (more) {
    openMore(more);
    return;
  }
  const twisty = target?.closest?.<HTMLButtonElement>(".twisty");
  if (twisty) {
    const id = twisty.closest<HTMLElement>(".outline-row")?.dataset.id;
    if (id) toggle(id, !state.isOpen(id));
    return;
  }
  const skimButton = target?.closest?.<HTMLButtonElement>(".skim-toggle");
  if (skimButton) {
    setSkim(!state.skim);
    return;
  }
  const foldButton = target?.closest?.<HTMLButtonElement>("[data-fold-level]");
  if (foldButton) {
    foldTo(Number(foldButton.dataset.foldLevel));
    return;
  }
  const lead = target?.closest?.<HTMLElement>(".prose > [data-skim-lead]");
  if (lead && !target?.closest?.("a")) {
    // a skimmed section's first block: clicking it opens the whole section (a link inside still just works) —
    // but not a click that selects text: a drag-select ends with a selection, and a double-click's first click is
    // followed by a second one within the delay
    clearTimeout(pendingLeadClick);
    if (event.detail > 1) return;
    const section = lead.dataset.skimSection ?? "";
    pendingLeadClick = setTimeout(() => {
      if (document.getSelection()?.isCollapsed !== false) openSkimSection(section);
    }, INTERNAL_TIMINGS.skimClickDelayMs);
    return;
  }
  const toggleButton = target?.closest?.<HTMLButtonElement>(".outline-toggle");
  if (toggleButton) {
    const outline = toggleButton.closest<HTMLElement>(".outline");
    if (outline) setFolded(outline, !outline.hasAttribute("data-folded"));
    return;
  }
  const link = target?.closest?.("a");
  if (!link) return;
  if (SNAPSHOT && link.hasAttribute("data-page")) return; // a linked page of the snapshot: the browser opens it
  const href = link.getAttribute("href") ?? "";
  if (link.classList.contains("outline-link")) {
    event.preventDefault();
    jumpTo(link as HTMLAnchorElement);
  } else if (href.startsWith("#")) {
    event.preventDefault();
    const id = safeDecode(href.slice(1));
    revealHeading(id);
    revealBlockOf(targetById(id)); // a footnote or other anchor inside a skimmed section
    goToHeading(id);
  } else if (!WEB_LINK.test(href)) {
    // a relative link: the HOST decides whether it may be opened (inside the workspace only). The snapshot has no
    // host, and the browser must not resolve it against the snapshot's own folder.
    event.preventDefault();
    if (!SNAPSHOT) vscode.postMessage({ type: "openLink", href });
  }
  // http(s) and mailto links are left to VS Code (or the browser), which open them outside the map
});

// middle-click / Ctrl+click never fire "click": the same rule for them — only web and mail links may open
document.addEventListener("auxclick", (event) => {
  const link = (event.target as Element | null)?.closest?.("a");
  if (!link || (SNAPSHOT && link.hasAttribute("data-page"))) return;
  if (!WEB_LINK.test(link.getAttribute("href") ?? "")) event.preventDefault();
});

function linkedPages(): Map<string, string> {
  const pages = new Map<string, string>();
  try {
    const data: unknown = JSON.parse(document.getElementById("docmap-links")?.textContent ?? "{}");
    if (data && typeof data === "object")
      // local pages only: files beside the snapshot, or (live view) pages of docmap's own server, same origin
      for (const [href, url] of Object.entries(data))
        if (typeof url === "string" && (url.startsWith("file:") || (LIVE && /^\/[^/\\]/.test(url))))
          pages.set(href, url);
  } catch {
    // no map, or a broken one: every link to another file stays inert, as before
  }
  return pages;
}

/** The outline layout the reader chose: the extension remembers it for every map; the snapshot, in its own storage. */
function saveLayout(layout: OutlineLayout): void {
  if (SNAPSHOT) storeLayout(layout);
  else vscode.postMessage({ type: "layout", ...layout });
}

// Ctrl+B / Cmd+B in the browser page hides or shows the outline (inside VS Code the key belongs to VS Code's sidebar)
document.addEventListener("keydown", (event) => {
  if (!SNAPSHOT || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "b")
    return;
  event.preventDefault();
  toggleOutline(document.querySelector<HTMLElement>(".map"), saveLayout);
});

document.addEventListener("keydown", (event) =>
  handleKey(event, {
    toggle,
    skim: () => setSkim(!state.skim),
    foldTo: (n) => {
      // "1"–"3" are positions in the toolbar (the levels this document has); "0" unfolds everything
      const levels = [...document.querySelectorAll<HTMLElement>("[data-fold-level]")]
        .map((b) => Number(b.dataset.foldLevel))
        .filter((l) => l > 0);
      const level = n === 0 ? 0 : levels[n - 1];
      if (levels.length > 0 && level !== undefined) foldTo(level);
    },
    isOpen: (id) => state.isOpen(id),
    clearFilter: () => {
      const filter = document.querySelector<HTMLInputElement>("input.filter");
      if (!filter || !app) return;
      filter.value = "";
      state.query = "";
      state.apply(app, headings);
    },
    jump: (direction) => jumpHeading(direction),
  }),
);

/** "j" / "k": the next heading below the top of the page, or the last one above it (folded ones skipped). */
function jumpHeading(direction: 1 | -1): void {
  const shown = [...document.querySelectorAll<HTMLElement>(".prose :is(h1, h2, h3, h4, h5, h6)[id]")].filter(
    (h) => h.offsetParent !== null,
  );
  const first = shown[0];
  if (!first) return;
  const top = scrollerOf(first)?.getBoundingClientRect().top ?? 0;
  // where the heading sits relative to where scrollIntoView puts it (its scroll-margin below the top)
  const at = (h: HTMLElement) =>
    h.getBoundingClientRect().top - top - (Number.parseFloat(getComputedStyle(h).scrollMarginTop) || 0);
  const target = direction === 1 ? shown.find((h) => at(h) > 2) : shown.filter((h) => at(h) < -2).at(-1);
  target?.scrollIntoView({ block: "start" });
}

/** The element that scrolls the page (the panel's content pane, or the browser page itself). */
function scrollerOf(element: HTMLElement): HTMLElement | undefined {
  for (let e = element.parentElement; e; e = e.parentElement) {
    const overflow = getComputedStyle(e).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && e.scrollHeight > e.clientHeight) return e;
  }
  return undefined;
}

function toggle(id: string, open: boolean): void {
  if (!app) return;
  state.toggle(id, open);
  state.applyCollapse(app);
  tracker.refresh(headings, headingById);
}

function setSkim(on: boolean): void {
  if (!app || !app.querySelector(".skim-toggle")) return; // reading tools off: no skim
  state.skim = on;
  state.skimOpen.clear();
  state.applyCollapse(app);
  tracker.refresh(headings, headingById);
}

function foldTo(level: number): void {
  if (!app || !Number.isInteger(level)) return;
  state.foldToLevel(level, headings);
  state.applyCollapse(app);
  tracker.refresh(headings, headingById);
}

function openSkimSection(section: string): void {
  if (!app || !state.skim) return;
  state.skimOpen.add(section);
  state.applyCollapse(app);
  tracker.refresh(headings, headingById);
}

/** If an element sits in a block hidden by skim mode or a fold, opens that section so it can be seen. */
function revealBlockOf(element: Element | null): void {
  const block = element?.closest<HTMLElement>(".prose > *");
  const section = block?.dataset.skimSection ?? "";
  if (block?.hasAttribute("data-skim-hidden")) openSkimSection(section);
  if (block?.hasAttribute("data-collapsed-content") && section && app) {
    revealHeading(section); // its folded ancestors
    state.toggle(section, true); // and the section itself
    state.applyCollapse(app);
    tracker.refresh(headings, headingById);
  }
  openDetailsAround(element);
  element?.scrollIntoView({ block: "start" });
}

/** Opens every closed `<details>` around an element (a heading or a match inside one), so it can be seen. */
function openDetailsAround(element: Element | null): void {
  let changed = false;
  for (let d = element?.closest("details"); d; d = d.parentElement?.closest("details")) {
    if (!d.open) {
      d.open = true;
      changed = true;
    }
  }
  if (changed) tracker.refresh(headings, headingById);
}

/** Unfolds every folded section that contains a heading, so jumping or following a #link to it can land. */
function revealHeading(id: string): void {
  openDetailsAround(targetById(id)); // a heading (or #link target) inside a collapsed <details> (0.0.8)
  // reading a section on purpose: while skimming, show it in full
  if (state.skim && headings.some((h) => h.id === id)) openSkimSection(id);
  const index = headings.findIndex((h) => h.id === id);
  const folded = ancestorIds(headings, index).filter((a) => !state.isOpen(a));
  if (index === -1 || folded.length === 0 || !app) return;
  for (const a of folded) state.toggle(a, true);
  state.applyCollapse(app);
  tracker.refresh(headings, headingById);
}

function setFolded(outline: HTMLElement, folded: boolean): void {
  outline.toggleAttribute("data-folded", folded);
  outline.querySelector(".outline-toggle")?.setAttribute("aria-expanded", String(!folded));
}

function jumpTo(link: HTMLAnchorElement): void {
  // narrow panel: the contents list works like a menu — choosing a heading folds it back, so the page gets the height
  const outline = link.closest<HTMLElement>(".outline");
  const toggle = outline?.querySelector<HTMLElement>(".outline-toggle");
  if (outline && toggle && getComputedStyle(toggle).display !== "none") setFolded(outline, true);
  const line = Number(link.dataset.line);
  const headingId = link.closest<HTMLElement>(".outline-row")?.dataset.id ?? "";
  revealHeading(headingId);
  goToHeading(headingId);
  if (Number.isInteger(line)) vscode.postMessage({ type: "jump", docVersion, line, headingId });
}

/** A heading in the rendered document. Searched inside the document only: a heading id may equal a panel id. */
function headingById(id: string): HTMLElement | null {
  // headings only: a document's own <a id="usage"> must not stand in for the "Usage" heading (0.1.0 review)
  return document.querySelector<HTMLElement>(`.prose :is(h1, h2, h3, h4, h5, h6)[id="${CSS.escape(id)}"]`);
}

/** Where a #link lands: the heading with that id, else any element in the document with it (footnote, <a id>). */
function targetById(id: string): HTMLElement | null {
  return headingById(id) ?? document.querySelector<HTMLElement>(`.prose [id="${CSS.escape(id)}"]`);
}

function outlineLink(id: string): HTMLAnchorElement | null {
  return document.querySelector<HTMLAnchorElement>(`.outline-row[data-id="${CSS.escape(id)}"] .outline-link`);
}

function safeDecode(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment; // a malformed %-escape: use the fragment as written
  }
}

function div(className: string): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

vscode.postMessage({ type: "ready" });
