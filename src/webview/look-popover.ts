import type { LineWidth, PageExtras, ReadingTheme, WebviewToHost } from "../core/protocol/messages";

/**
 * 3.3.0: 1-click in-page Reading Look popover — 8 theme swatches, Text Size, and Line Width.
 * Pure TypeScript + DOM (ADR-0003, no innerHTML). High-contrast VS Code themes always win: when active,
 * theme swatches show a quiet notice while Text Size and Line Width stay interactive.
 */

export type LookState = NonNullable<PageExtras["look"]>;
type Post = (message: WebviewToHost) => void;

const STORAGE_KEY = "docmap-look";

export interface ThemeMeta {
  readonly id: ReadingTheme;
  readonly label: string;
  readonly hint: string;
}

export const THEME_OPTIONS: readonly ThemeMeta[] = [
  { id: "vscode", label: "VS Code", hint: "Your editor's colours" },
  { id: "paper", label: "Paper", hint: "Warm book serif" },
  { id: "github", label: "GitHub", hint: "Clean light" },
  { id: "github-dark", label: "GitHub Dark", hint: "Clean dark" },
  { id: "night", label: "Night", hint: "Soft dark blue" },
  { id: "warm-dark", label: "Warm Dark", hint: "Espresso serif dark" },
  { id: "solarized-light", label: "Solarized", hint: "Warm cream light" },
  { id: "focus", label: "Focus", hint: "One calm column" },
];

export const SCALE_OPTIONS: readonly { readonly value: number; readonly label: string }[] = [
  { value: 0.9, label: "90%" },
  { value: 1, label: "100%" },
  { value: 1.15, label: "115%" },
  { value: 1.3, label: "130%" },
];

export const WIDTH_OPTIONS: readonly { readonly value: LineWidth; readonly label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "normal", label: "Normal" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
];

const VALID_THEMES = new Set<string>(THEME_OPTIONS.map((t) => t.id));
const VALID_WIDTHS = new Set<string>(WIDTH_OPTIONS.map((w) => w.value));

/** Reads saved Look from localStorage (browser snapshot only). */
export function readStoredLook(): Partial<Pick<LookState, "theme" | "fontScale" | "lineWidth">> | undefined {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return undefined;
    const r = raw as Record<string, unknown>;
    const out: { theme?: ReadingTheme; fontScale?: number; lineWidth?: LineWidth } = {};
    if (typeof r.theme === "string" && VALID_THEMES.has(r.theme)) out.theme = r.theme as ReadingTheme;
    if (
      typeof r.fontScale === "number" &&
      Number.isFinite(r.fontScale) &&
      r.fontScale >= 0.7 &&
      r.fontScale <= 2
    )
      out.fontScale = r.fontScale;
    if (typeof r.lineWidth === "string" && VALID_WIDTHS.has(r.lineWidth))
      out.lineWidth = r.lineWidth as LineWidth;
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function storeLook(look: Pick<LookState, "theme" | "fontScale" | "lineWidth">): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(look));
  } catch {
    // storage blocked: choice still applies for this page
  }
}

export function isHighContrast(): boolean {
  return (
    document.body.classList.contains("vscode-high-contrast") ||
    document.body.classList.contains("vscode-high-contrast-light")
  );
}

/** Builds the Look trigger button + anchored popover wrapper. */
export function createLookControl(options: {
  readonly addedClass: string;
  readonly current: LookState;
  readonly snapshot: boolean;
  readonly post: Post;
  readonly onLocalChange: (next: LookState, themeChanged: boolean) => void;
}): HTMLElement {
  const { addedClass, snapshot, post, onLocalChange } = options;
  let state: LookState = { ...options.current };

  const wrap = document.createElement("div");
  wrap.className = `kp-look-wrap ${addedClass}`;

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = `kp-look ${addedClass}`;
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "dm-look-popover");
  trigger.title = "Choose reading theme, text size and line width";

  const dot = document.createElement("span");
  dot.className = "kp-look-dot";
  dot.setAttribute("aria-hidden", "true");
  dot.dataset.theme = state.theme;

  const labelSpan = document.createElement("span");
  labelSpan.className = "kp-look-label";
  const themeLabel = (id: ReadingTheme): string => THEME_OPTIONS.find((t) => t.id === id)?.label ?? "VS Code";
  const syncLabel = () => {
    labelSpan.textContent = `Look: ${themeLabel(state.theme)}`;
  };
  syncLabel();
  trigger.append(dot, labelSpan);

  const pop = document.createElement("div");
  pop.id = "dm-look-popover";
  pop.className = `dm-look-pop ${addedClass}`;
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Reading look");
  pop.hidden = true;

  const commit = (patch: Partial<Pick<LookState, "theme" | "fontScale" | "lineWidth">>) => {
    const themeChanged = patch.theme !== undefined && patch.theme !== state.theme;
    state = { ...state, ...patch };
    dot.dataset.theme = state.theme;
    syncLabel();
    syncPressed();
    if (snapshot) storeLook({ theme: state.theme, fontScale: state.fontScale, lineWidth: state.lineWidth });
    else post({ type: "setLook", ...patch });
    onLocalChange(state, themeChanged);
  };

  // --- Theme section ---
  const themeHeading = document.createElement("div");
  themeHeading.className = "dm-look-heading";
  themeHeading.textContent = "Theme";
  pop.append(themeHeading);

  if (isHighContrast()) {
    const note = document.createElement("p");
    note.className = "dm-look-hc-note";
    note.textContent = "High-contrast theme active — colours follow VS Code.";
    pop.append(note);
  }

  const swatches = document.createElement("div");
  swatches.className = "dm-swatches";
  const themeButtons = new Map<ReadingTheme, HTMLButtonElement>();
  for (const t of THEME_OPTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dm-swatch";
    b.dataset.theme = t.id;
    b.title = `${t.label} — ${t.hint}`;
    b.setAttribute("aria-pressed", String(state.theme === t.id));

    const chip = document.createElement("span");
    chip.className = "dm-swatch-chip";
    chip.setAttribute("aria-hidden", "true");
    const bar = document.createElement("span");
    bar.className = "dm-swatch-accent";
    const aa = document.createElement("span");
    aa.className = "dm-swatch-aa";
    aa.textContent = "Aa";
    chip.append(bar, aa);

    const name = document.createElement("span");
    name.className = "dm-swatch-label";
    name.textContent = t.label;

    b.append(chip, name);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      commit({ theme: t.id });
    });
    themeButtons.set(t.id, b);
    swatches.append(b);
  }
  pop.append(swatches);

  // --- Text size section ---
  const sizeHeading = document.createElement("div");
  sizeHeading.className = "dm-look-heading";
  sizeHeading.textContent = "Text size";
  pop.append(sizeHeading);

  const sizeRow = document.createElement("div");
  sizeRow.className = "dm-seg-row";
  const scaleButtons = new Map<number, HTMLButtonElement>();
  for (const s of SCALE_OPTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dm-seg-btn";
    b.textContent = s.label;
    b.dataset.scale = String(s.value);
    b.setAttribute("aria-pressed", String(Math.abs(state.fontScale - s.value) < 0.01));
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      commit({ fontScale: s.value });
    });
    scaleButtons.set(s.value, b);
    sizeRow.append(b);
  }
  pop.append(sizeRow);

  // --- Line width section ---
  const widthHeading = document.createElement("div");
  widthHeading.className = "dm-look-heading";
  widthHeading.textContent = "Line width";
  pop.append(widthHeading);

  const widthRow = document.createElement("div");
  widthRow.className = "dm-seg-row";
  const widthButtons = new Map<LineWidth, HTMLButtonElement>();
  for (const w of WIDTH_OPTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dm-seg-btn";
    b.textContent = w.label;
    b.dataset.width = w.value;
    b.setAttribute("aria-pressed", String(state.lineWidth === w.value));
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      commit({ lineWidth: w.value });
    });
    widthButtons.set(w.value, b);
    widthRow.append(b);
  }
  pop.append(widthRow);

  const syncPressed = () => {
    for (const [id, b] of themeButtons) b.setAttribute("aria-pressed", String(state.theme === id));
    for (const [v, b] of scaleButtons)
      b.setAttribute("aria-pressed", String(Math.abs(state.fontScale - v) < 0.01));
    for (const [w, b] of widthButtons) b.setAttribute("aria-pressed", String(state.lineWidth === w));
  };

  const setOpen = (open: boolean, focusTrigger = false) => {
    pop.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (!open && focusTrigger) trigger.focus();
  };

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(Boolean(pop.hidden));
  });

  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false, true);
    }
  });

  wrap.append(trigger, pop);
  return wrap;
}

/** Closes any open Look popover if the click landed outside it. */
export function closeLookOnOutsideClick(target: Element | null): void {
  const pop = document.getElementById("dm-look-popover");
  if (!pop || pop.hidden) return;
  if (target?.closest?.(".kp-look-wrap")) return;
  pop.hidden = true;
  document.querySelector(".kp-look")?.setAttribute("aria-expanded", "false");
}

/** Closes any open Look popover on Escape from anywhere in the document. */
export function closeLookOnEscape(event: KeyboardEvent): boolean {
  if (event.key !== "Escape") return false;
  const pop = document.getElementById("dm-look-popover");
  if (!pop || pop.hidden) return false;
  pop.hidden = true;
  const trigger = document.querySelector<HTMLButtonElement>(".kp-look");
  trigger?.setAttribute("aria-expanded", "false");
  trigger?.focus();
  return true;
}
