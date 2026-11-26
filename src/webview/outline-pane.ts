import { MAX_OUTLINE_WIDTH, type OutlineLayout } from "../core/protocol/messages";

/**
 * The outline pane (0.0.20, owner call), like VS Code's own sidebar: drag the divider to resize it, drag it (almost)
 * shut or press the hide button to hide it, the show button to bring it back; double-click the divider for the
 * normal width. The layout is remembered: by the extension for every map (a "layout" message), or in the browser's
 * own storage for the snapshot. On a narrow window the outline stacks above the text instead, with its own toggle.
 */

export const DEFAULT_OUTLINE_WIDTH = 280;
const MIN_WIDTH = 160; // narrower than this reads badly: the pane hides instead
const HIDE_BELOW = 100; // a drag this far left hides the pane
const KEY_STEP = 16;
const STORAGE_KEY = "docmap-layout";

let layout: OutlineLayout = { outlineWidth: DEFAULT_OUTLINE_WIDTH, collapsed: false };
let changedHere = false; // the reader changed it on this page: that wins over what a later render carries

/** Takes the layout a render carried (the extension's saved one), unless the reader changed it on this page. */
export function adoptLayout(fromHost: OutlineLayout | undefined, snapshot: boolean): void {
  if (changedHere) return;
  const saved = snapshot ? readStored() : undefined;
  const chosen = saved ?? fromHost;
  if (chosen) layout = { outlineWidth: clampWidth(chosen.outlineWidth), collapsed: chosen.collapsed };
}

/**
 * Adds the divider and the hide / show buttons to a freshly drawn map and applies the layout. `save` is called once
 * per change (at the end of a drag), never while dragging.
 */
export function mountOutlinePane(map: HTMLElement, save: (layout: OutlineLayout) => void): void {
  const outline = map.querySelector<HTMLElement>(".outline");
  if (!outline) return;

  const splitter = document.createElement("div");
  splitter.className = "outline-splitter";
  splitter.tabIndex = 0;
  splitter.setAttribute("role", "separator");
  splitter.setAttribute("aria-orientation", "vertical");
  splitter.setAttribute("aria-label", "Resize the outline (drag, or ← →; Enter hides it)");
  splitter.title = "Drag to resize the outline · double-click for the normal width";
  outline.after(splitter);

  const hide = button("outline-hide", "‹", "Hide the outline");
  // #42 (owner pick 2026-11-21): a small list icon in its own left margin, so it never covers the text
  const show = button("outline-show", "", "Contents");
  show.title = "Contents: show the outline";
  show.append(listIcon());
  const labelRow = outline.querySelector(".outline-label-row");
  labelRow?.append(hide);
  map.append(show);

  const apply = () => {
    map.style.setProperty("--outline-w", `${layout.outlineWidth}px`);
    map.toggleAttribute("data-outline-collapsed", layout.collapsed);
    splitter.setAttribute("aria-valuenow", String(layout.collapsed ? 0 : layout.outlineWidth));
    splitter.setAttribute("aria-valuemin", "0");
  };
  // measured only when the divider is used: measuring while a map is drawn would force a layout mid-draw, while the
  // panel restores the reader's scroll position
  splitter.addEventListener("focus", () => splitter.setAttribute("aria-valuemax", String(maxWidth(map))));
  const commit = (next: OutlineLayout) => {
    layout = next;
    changedHere = true;
    apply();
    save(layout);
  };
  apply();

  hide.addEventListener("click", () => commit({ ...layout, collapsed: true }));
  show.addEventListener("click", () => {
    commit({ ...layout, collapsed: false });
    splitter.focus();
  });
  splitter.addEventListener("dblclick", () =>
    commit({ outlineWidth: DEFAULT_OUTLINE_WIDTH, collapsed: false }),
  );
  splitter.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowLeft" ? -KEY_STEP : KEY_STEP;
      commit({ outlineWidth: clampWidth(layout.outlineWidth + step, map), collapsed: false });
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit({ ...layout, collapsed: !layout.collapsed });
    }
  });

  splitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    map.setAttribute("data-resizing", "");
    const left = map.getBoundingClientRect().left;
    let next = layout;
    const move = (e: PointerEvent) => {
      const raw = e.clientX - left;
      next =
        raw < HIDE_BELOW
          ? { outlineWidth: layout.outlineWidth, collapsed: true }
          : { outlineWidth: clampWidth(raw, map), collapsed: false };
      map.style.setProperty("--outline-w", `${next.outlineWidth}px`);
      map.toggleAttribute("data-outline-collapsed", next.collapsed);
    };
    const end = () => {
      splitter.removeEventListener("pointermove", move);
      map.removeAttribute("data-resizing");
      commit(next);
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", end, { once: true });
    splitter.addEventListener("pointercancel", end, { once: true });
  });
}

/** Ctrl+B in the browser snapshot: hide / show the outline (VS Code keeps Ctrl+B for its own sidebar). */
export function toggleOutline(map: HTMLElement | null, save: (layout: OutlineLayout) => void): void {
  if (!map) return;
  layout = { ...layout, collapsed: !layout.collapsed };
  changedHere = true;
  map.toggleAttribute("data-outline-collapsed", layout.collapsed);
  save(layout);
}

/** The snapshot's own memory of the layout (the browser's storage for these pages). */
export function storeLayout(value: OutlineLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // storage blocked: the layout lasts for the page
  }
}

function readStored(): OutlineLayout | undefined {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (v && typeof v === "object") {
      const { outlineWidth, collapsed } = v as Record<string, unknown>;
      if (typeof outlineWidth === "number" && Number.isFinite(outlineWidth) && typeof collapsed === "boolean")
        return { outlineWidth, collapsed };
    }
  } catch {
    // nothing kept, or a broken value: the default
  }
  return undefined;
}

function maxWidth(map?: HTMLElement): number {
  const total = map?.getBoundingClientRect().width ?? 0;
  // never above what the "layout" message accepts, or the extension would drop the save on a very wide panel
  return Math.min(
    MAX_OUTLINE_WIDTH,
    total > 0 ? Math.max(MIN_WIDTH, Math.round(total * 0.6)) : MAX_OUTLINE_WIDTH,
  );
}

function clampWidth(width: number, map?: HTMLElement): number {
  return Math.round(Math.min(Math.max(width, MIN_WIDTH), maxWidth(map)));
}

/** Three dots and lines: the list icon of the Contents button (drawn in the text colour). */
function listIcon(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  for (const y of [3, 7, 11])
    for (const [x, w] of [
      [2, 2],
      [6, 8],
    ]) {
      const r = document.createElementNS(ns, "rect");
      r.setAttribute("x", String(x));
      r.setAttribute("y", String(y));
      r.setAttribute("width", String(w));
      r.setAttribute("height", "2");
      svg.append(r);
    }
  return svg;
}

function button(className: string, glyph: string, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = glyph;
  b.title = label;
  b.setAttribute("aria-label", label);
  return b;
}
