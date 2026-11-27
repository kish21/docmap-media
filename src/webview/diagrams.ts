/**
 * Mermaid diagrams (0.0.8, owner call). A ```mermaid block arrives as an ordinary code block; this draws it as a
 * diagram. The drawing library (dist/mermaid.js, ~5 MB) is loaded only when a document has such a block — a map
 * without diagrams costs nothing. The library runs with `securityLevel: "strict"` (labels sanitised, no click
 * handlers). A block that cannot be drawn stays the code it was. Setting `docmap.diagrams` off: nothing is loaded.
 *
 * #56: uncached diagrams are observed with `IntersectionObserver` so offscreen diagrams do not block initial paint;
 * cached diagrams render immediately, and print/PDF export (`data-autoprint` or `beforeprint`) flushes all diagrams.
 */

import { INTERNAL_LIMITS } from "../core/config/config";

interface Mermaid {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

interface PendingDiagram {
  readonly pre: HTMLElement;
  readonly source: string;
}

type WithMermaid = typeof globalThis & { docmapMermaid?: Mermaid };

/** The panel's own script nonce: the library's script tag needs it to pass the CSP. Read while this script runs. */
const NONCE =
  (typeof document !== "undefined"
    ? (document.currentScript as HTMLScriptElement | null)?.nonce
    : undefined) ?? "";

const drawn = new Map<string, string>(); // theme + source → svg: a re-render after an edit redraws nothing
let library: Promise<Mermaid | undefined> | undefined;
let initializedTheme = "";
let counter = 0;
let activeObserver: IntersectionObserver | undefined;
let beforePrintFlush: (() => void) | undefined;
let drawQueue: Promise<void> = Promise.resolve();

/** Draws ```mermaid blocks in `doc`: cached ones at once, uncached ones lazily as they near the viewport. */
export function drawDiagrams(doc: HTMLElement): void {
  disconnectObserver();
  const blocks = [...doc.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
  if (blocks.length === 0 || !diagramsOn()) return;
  const theme = currentTheme();
  const pending: PendingDiagram[] = [];
  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre) continue;
    const source = code.textContent ?? "";
    const svg = drawn.get(`${theme}\n${source}`);
    if (svg) show(pre, svg);
    else pending.push({ pre, source });
  }
  if (pending.length === 0) return;

  const autoPrint = document.documentElement.hasAttribute("data-autoprint");
  if (autoPrint || typeof IntersectionObserver === "undefined") {
    enqueue(pending, theme);
    return;
  }

  const waiting = new Map<Element, PendingDiagram>();
  for (const item of pending) waiting.set(item.pre, item);

  const observer = new IntersectionObserver(
    (entries, obs) => {
      const visible: PendingDiagram[] = [];
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const item = waiting.get(entry.target);
        if (!item) continue;
        waiting.delete(entry.target);
        obs.unobserve(entry.target);
        visible.push(item);
      }
      if (visible.length > 0) enqueue(visible, theme);
      if (waiting.size === 0) disconnectObserver();
    },
    { root: doc, rootMargin: `${INTERNAL_LIMITS.diagramRootMarginPx}px 0px` },
  );
  activeObserver = observer;
  for (const item of pending) observer.observe(item.pre);

  if (typeof window !== "undefined") {
    beforePrintFlush = () => {
      const remaining = [...waiting.values()];
      waiting.clear();
      disconnectObserver();
      if (remaining.length > 0) enqueue(remaining, theme);
    };
    window.addEventListener("beforeprint", beforePrintFlush);
  }
}

function disconnectObserver(): void {
  activeObserver?.disconnect();
  activeObserver = undefined;
  if (beforePrintFlush && typeof window !== "undefined") {
    window.removeEventListener("beforeprint", beforePrintFlush);
    beforePrintFlush = undefined;
  }
}

function enqueue(pending: PendingDiagram[], theme: string): void {
  drawQueue = drawQueue.then(() => drawLater(pending, theme));
}

async function drawLater(pending: PendingDiagram[], theme: string): Promise<void> {
  const mermaid = await load();
  if (!mermaid) return;
  if (initializedTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme });
    initializedTheme = theme;
  }
  for (const { pre, source } of pending) {
    if (!pre.isConnected) continue;
    const cached = drawn.get(`${theme}\n${source}`);
    if (cached) {
      show(pre, cached);
      continue;
    }
    try {
      const { svg } = await mermaid.render(`docmap-diagram-${++counter}`, source);
      drawn.set(`${theme}\n${source}`, svg);
      if (pre.isConnected) show(pre, svg);
    } catch {
      pre.dataset.diagramError = "";
      pre.title = "This diagram could not be drawn — shown as code";
      // said on the page, not only on hover: a silent code block looked like "no diagram" (owner report 2026-11-23)
      if (pre.isConnected && !pre.previousElementSibling?.classList.contains("diagram-note")) {
        const note = document.createElement("p");
        note.className = "diagram-note";
        note.textContent =
          "This diagram could not be drawn (too big, or a mistake in it), so it is shown as code.";
        pre.before(note);
      }
    }
  }
}

function show(pre: HTMLElement, svg: string): void {
  pre.classList.add("mermaid-diagram");
  pre.setAttribute("role", "img");
  pre.setAttribute("aria-label", "Diagram");
  // mermaid's own output under securityLevel "strict" (its labels are sanitised); no document text is added here
  pre.innerHTML = svg;
}

/** The panel says where the library is (`data-diagrams`); the browser snapshot carries it inline instead. */
function diagramsOn(): boolean {
  return Boolean(inlineLibrary()) || Boolean(document.body.dataset.diagrams);
}

/**
 * The library the snapshot carries inline (or the one the loaded script set), checked to be the library: a document's
 * own `<a id="docmapMermaid">` also shows up as `window.docmapMermaid` (a browser "named property").
 */
function inlineLibrary(): Mermaid | undefined {
  const lib: unknown = (globalThis as WithMermaid).docmapMermaid;
  return !(lib instanceof Element) &&
    typeof (lib as Mermaid | undefined)?.render === "function" &&
    typeof (lib as Mermaid | undefined)?.initialize === "function"
    ? (lib as Mermaid)
    : undefined;
}

function load(): Promise<Mermaid | undefined> {
  library ??= new Promise((resolve) => {
    const inline = inlineLibrary();
    if (inline) {
      resolve(inline);
      return;
    }
    const url = document.body.dataset.diagrams ?? "";
    // Chrome MV3 content scripts run in an isolated world: <script> tags execute in the page's
    // main world where the content script cannot read `window.docmapMermaid`, whereas dynamic
    // `import()` loads the ESM bundle directly into the content script's isolated world.
    if (url.startsWith("chrome-extension://")) {
      import(/* @vite-ignore */ url)
        .then((mod: { default?: unknown }) => {
          const lib = mod?.default ?? inlineLibrary();
          resolve(
            lib &&
              !(lib instanceof Element) &&
              typeof (lib as Mermaid).render === "function" &&
              typeof (lib as Mermaid).initialize === "function"
              ? (lib as Mermaid)
              : undefined,
          );
        })
        .catch(() => resolve(undefined));
      return;
    }
    const script = document.createElement("script");
    script.src = url;
    script.nonce = NONCE;
    script.onload = () => resolve(inlineLibrary());
    script.onerror = () => resolve(undefined);
    document.head.append(script);
  });
  return library;
}

/** Reading themes whose surface is dark or light, overriding the host theme unless VS Code high contrast is active. */
const DARK_READING_THEMES = new Set(["github-dark", "night", "warm-dark"]);
const LIGHT_READING_THEMES = new Set(["paper", "github", "solarized-light"]);

/** VS Code marks its dark and high-contrast themes on the body; reading themes win except in high contrast (ADR-0003). */
function currentTheme(): string {
  const body = document.body.classList;
  // ADR-0003: VS Code high-contrast themes always win over reading themes
  if (body.contains("vscode-high-contrast-light")) return "default";
  if (body.contains("vscode-high-contrast")) return "dark";
  const reading = document.body.getAttribute?.("data-reading-theme") ?? "";
  if (DARK_READING_THEMES.has(reading)) return "dark";
  if (LIGHT_READING_THEMES.has(reading)) return "default";
  // the snapshot's light / dark switch (0.0.19) marks the root element
  if (document.documentElement.classList.contains("dark")) return "dark";
  if (document.documentElement.classList.contains("light")) return "default";
  if (body.contains("vscode-dark")) return "dark";
  if (body.contains("vscode-light")) return "default";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default";
}
