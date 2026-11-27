import type { Highlight, PageExtras, SectionCounts, WebviewToHost } from "../core/protocol/messages";
import { openFoldsWith } from "./clean";
import { markCodeRefs, onCodeRef, terminalButton } from "./code-actions";
import {
  closeLookOnEscape,
  closeLookOnOutsideClick,
  createLookControl,
  readStoredLook,
} from "./look-popover";
import { applyRedline, clearRedline, type RedlineCounts } from "./redline";
import { drawStanding } from "./standing-view";

/**
 * 2.0: everything the page shows beyond the document itself — reading look, key points, "changed since you read it",
 * the ⋯ section menu, review marks, highlights, copy buttons, a reading progress bar and slide mode. Drawn on top of
 * the rendered document after every render (and again when only the extras change). Document text only ever goes in
 * through textContent / text nodes, never as HTML.
 */

type Post = (message: WebviewToHost) => void;
const ADDED = "dm-x"; // every element this module adds carries it, so a redraw can remove them all

let post: Post = () => {};
let snapshot = false;
let onSnapshotTheme: (() => void) | undefined;
let current: PageExtras = {};
let pageVersion = -1;
/** Which trust chip was clicked last and which of its paragraphs it went to (the next click goes one further). */
let trustCursor = { state: "", index: -1 };

/** The document version the page shows (tick and status edits name it, so the host refuses a stale click). */
export function setPageVersion(version: number): void {
  pageVersion = version;
}

export function initExtras(send: Post, isSnapshot: boolean, onThemeRedraw?: () => void): void {
  post = send;
  snapshot = isSnapshot;
  onSnapshotTheme = onThemeRedraw;
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("keydown", onSlideKey, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("mouseover", onHoverBlock);
  // a status label is a button: Enter or Space opens its menu too; Enter on a code name opens it; Esc closes Look
  document.addEventListener("keydown", (e) => {
    if (closeLookOnEscape(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && (e.target as Element | null)?.closest?.(".dm-status-edit")) {
      if (onEditClick(e.target as Element)) e.preventDefault();
    }
    if (e.key === "Enter" && !snapshot && onCodeRef(e.target as Element | null, post)) e.preventDefault();
  });
}

/** Draws the extras on the page as rendered now (call after each render, and when new extras arrive). */
export function applyExtras(extras: PageExtras | undefined): void {
  if (extras) {
    current = { ...current, ...extras };
    // the host sends this whenever it applies: absent now means gone (no longer comparing)
    if (!("redline" in extras)) delete (current as { redline?: unknown }).redline;
    // full extras (a render) without it: this doc has nothing to show; a small update (a highlight) keeps it
    if ("look" in extras && !("standing" in extras)) delete (current as { standing?: unknown }).standing;
  }
  if (snapshot) {
    const saved = readStoredLook();
    if (saved) {
      current = {
        ...current,
        look: {
          theme: saved.theme ?? current.look?.theme ?? "vscode",
          fontScale: saved.fontScale ?? current.look?.fontScale ?? 1,
          lineWidth: saved.lineWidth ?? current.look?.lineWidth ?? "normal",
          ...(current.look?.clean !== undefined ? { clean: current.look.clean } : {}),
          ...(current.look?.numbers !== undefined ? { numbers: current.look.numbers } : {}),
        },
      };
    }
  }
  const prose = document.querySelector<HTMLElement>(".prose");
  if (!prose) return;
  clear(prose);
  applyLook(current.look);
  frontMatterCard(prose);
  keyPointsStrip(prose);
  if (current.look?.clean !== false) drawStanding(prose, current.standing, ADDED, !snapshot);
  for (const h of headingsIn(prose)) decorateHeading(h);
  for (const id of current.changed ?? []) outlineBadge(id, "changed", "Changed since you last read it");
  for (const r of current.reviews ?? []) outlineBadge(r.headingId, `review-${r.mark}`, MARK_LABEL[r.mark]);
  for (const b of current.badges ?? []) outlineCounts(b);
  for (const h of current.highlights ?? []) drawHighlight(prose, h);
  openFoldsWith(prose, "mark.dm-hl"); // a highlight or comment in a folded paragraph stays seen
  if (current.redline) {
    const counts = applyRedline(prose, current.redline, ADDED, {
      on: current.look?.clean !== false,
      numbers: false,
      fileName: "",
    });
    redlineBar(prose, current.redline.label, counts);
  }
  copyButtons(prose);
  markCodeRefs(prose, current.codeRefs, snapshot);
  trustMarkers(prose);
  editableTasks(prose);
  progressBar();
  if (slides.on) showSlide(slides.index);
}

const MARK_LABEL = { approve: "Approved", question: "Question", change: "Change requested" } as const;
const MARK_ICON = { approve: "✓", question: "?", change: "✎" } as const;

let detachProgress: (() => void) | undefined;

function clear(prose: HTMLElement): void {
  detachProgress?.();
  detachProgress = undefined;
  for (const el of document.querySelectorAll(`.${ADDED}`)) el.remove();
  for (const el of document.querySelectorAll("[data-changed], [data-review]")) {
    el.removeAttribute("data-changed");
    el.removeAttribute("data-review");
  }
  for (const mark of prose.querySelectorAll("mark.dm-hl")) mark.replaceWith(...mark.childNodes);
  clearRedline(prose);
  prose.normalize();
}

// ---------- look: theme, text size, line width ----------

function applyLook(look: PageExtras["look"]): void {
  const theme = look?.theme ?? "vscode";
  if (theme === "vscode") document.body.removeAttribute("data-reading-theme");
  else document.body.setAttribute("data-reading-theme", theme);
  document.documentElement.style.setProperty("--reading-scale", String(look?.fontScale ?? 1));
  document.body.toggleAttribute("data-scaled", (look?.fontScale ?? 1) !== 1);
  document.body.setAttribute("data-line-width", look?.lineWidth ?? "normal");
}

// ---------- 3.0 front matter: a header card (Clean view) ----------

function frontMatterCard(prose: HTMLElement): void {
  const fields = current.frontMatter ?? [];
  if (current.look?.clean === false || fields.length === 0) return;
  const card = el("dl", `dm-fm ${ADDED}`);
  for (const f of fields) card.append(text("dt", f.key), text("dd", f.value));
  prose.prepend(card);
}

// ---------- 3.0 redline bar ----------

function redlineBar(prose: HTMLElement, label: string, n: RedlineCounts): void {
  const bar = el("div", `dm-rl-bar ${ADDED}`);
  bar.setAttribute("role", "status");
  const parts = [
    n.added ? `${n.added} added` : "",
    n.changed ? `${n.changed} changed` : "",
    n.removed ? `${n.removed} removed` : "",
  ].filter(Boolean);
  bar.append(
    text("strong", `Changes since ${label}: `),
    document.createTextNode(parts.join(" · ") || "none"),
  );
  if (!snapshot)
    bar.append(
      // owner call 2026-11-17: every edit, old on the left and new on the right, like Notepad++'s Compare
      button("⇆ Side by side", "rl-side", "Open the older version and this file side by side in VS Code"),
      button(
        "✨ Summarise / compare with…",
        "rl-menu",
        "Ask my AI agent to summarise, or compare with another version",
      ),
      button("Stop comparing", "rl-off", "Show the page without changes marked"),
    );
  prose.prepend(bar);
}

// ---------- key points strip ----------

function keyPointsStrip(prose: HTMLElement): void {
  const kp = current.keyPoints;
  const changed = current.changed?.length ?? 0;
  const hasSlides = prose.querySelector(":scope > hr") !== null;
  if (!current.look && !kp && changed === 0 && !hasSlides && !current.signoffs?.length && !current.docKind)
    return;
  const strip = el("section", `keypoints ${ADDED}`);
  strip.setAttribute("aria-label", "Document toolbar and key points");
  // owner report 2026-11-17: "In short" repeated the paragraph right below it — shown only when it adds something
  if (kp?.tldr && !repeatsTopOfPage(prose, kp.tldr)) {
    const p = el("p", "kp-tldr");
    p.append(text("strong", "In short: "), document.createTextNode(kp.tldr));
    strip.append(p);
  }
  // 3.3.0: calm 4-control top bar (Look, Clean view, Show source, More …) + quiet status chips on the left
  const chips = el("div", "kp-chips");
  const actions = el("div", "kp-actions");
  // 3.0 named formats: what kind of doc this is (only when docmap is sure); a click lists the format's parts
  const dk = current.docKind;
  if (dk) {
    const name = dk.format ? `${dk.label} · ${dk.format}` : dk.label;
    if (snapshot) chips.append(chip(name, "kind-label"));
    else
      chips.append(
        button(
          name,
          "kp-chip kp-kind",
          dk.format
            ? `Follows the ${dk.format} format. Click to see its parts (information only)`
            : "In its own style. Click to compare with your team's format or a standard one (information only)",
        ),
      );
  }
  const total = (kp?.tasksOpen ?? 0) + (kp?.tasksDone ?? 0);
  if (kp && total > 0) chips.append(chip(`✓ ${kp.tasksDone} of ${total} tasks done`, "tasks"));
  if (kp && kp.decisions > 0)
    chips.append(chip(`${kp.decisions} decision${kp.decisions === 1 ? "" : "s"}`, "decisions"));
  if (kp && kp.warnings > 0)
    chips.append(chip(`⚠ ${kp.warnings} warning${kp.warnings === 1 ? "" : "s"}`, "warnings"));
  const trust = current.trust ?? [];
  const count = (s: string) => trust.filter((t) => t.state === s).length;
  const doubts = [
    ["mismatch", "✗", "doesn't match the code", "don't match the code"],
    ["wrong", "✗", "marked wrong", "marked wrong"],
    ["conflict", "⇄", "conflict with another doc", "conflicts with other docs"],
    ["stale", "⚠", "may be stale", "may be stale"],
  ] as const;
  for (const [state, icon, one, many] of doubts) {
    const n = count(state);
    if (n > 0 && !snapshot) {
      const b = button(
        `${icon} ${n} ${n === 1 ? one : many}`,
        `kp-chip kp-trust kp-trust-${state}`,
        n === 1 ? "Go to it" : "Go to the next one (click again for the one after)",
      );
      b.dataset.state = state;
      chips.append(b);
    }
  }
  if (count("verified") > 0) chips.append(chip(`✓ ${count("verified")} verified`, "verified"));
  for (const s of current.signoffs ?? []) {
    const c = chip(
      s.current ? `✓ Signed off by ${s.who} · ${s.date}` : `⚠ Changed since ${s.who} signed off (${s.date})`,
      s.current ? "signed" : "signed-stale",
    );
    c.title = s.current
      ? "This exact version was signed off"
      : "The file changed after this sign-off: compare with the last commit, or sign off again";
    chips.append(c);
  }
  if (changed > 0) {
    chips.append(
      chip(`● ${changed} section${changed === 1 ? "" : "s"} changed since you read it`, "changed"),
    );
    if (!snapshot) chips.append(button("Mark as read", "kp-read", "Forget these changes"));
  }
  // 3.3.0: compact quick-action bar — Look, Plans, Atlas, Compare, Browser icon, Questions icon, More (…)
  const lookState = {
    theme: current.look?.theme ?? "vscode",
    fontScale: current.look?.fontScale ?? 1,
    lineWidth: current.look?.lineWidth ?? "normal",
    ...(current.look?.clean !== undefined ? { clean: current.look.clean } : {}),
    ...(current.look?.numbers !== undefined ? { numbers: current.look.numbers } : {}),
  };
  actions.append(
    createLookControl({
      addedClass: ADDED,
      current: lookState,
      snapshot,
      post,
      onLocalChange: (next, themeChanged) => {
        current = { ...current, look: next };
        applyLook(next);
        if (snapshot && themeChanged) onSnapshotTheme?.();
      },
    }),
  );
  // #48: in VS Code, slides live in the More (…) menu; the browser page has no such menu, so it keeps the button
  if (hasSlides && snapshot)
    actions.append(
      button("▶ Slides", "kp-slides", "Show the sections between --- lines as slides ( ← → , Esc )"),
    );
  if (!snapshot) {
    // a switch that says what it is, on or off — not a button whose label flips to the other mode
    const clean = current.look?.clean !== false;
    const t = button(
      "",
      "kp-clean",
      clean
        ? "On: the page is laid out neatly. Turn off to see the file exactly as written"
        : "Off: the file as written. Turn on to lay the page out neatly (the file is not changed)",
    );
    t.setAttribute("role", "switch");
    t.setAttribute("aria-checked", String(clean));
    t.append(el("span", "kp-switch"), document.createTextNode("Clean view"));
    t.dataset.on = String(!clean);
    actions.append(t);
    if (current.inTab && !current.report)
      actions.append(
        button("✎ Source", "kp-source", "Switch this tab to the raw Markdown text (Ctrl+Alt+V)"),
      );
    if (current.inTab && !current.report)
      actions.append(
        button("✎ Source", "kp-source", "Switch this tab to the raw Markdown text (Ctrl+Alt+V)"),
      );
    actions.append(button("Plans", "kp-plans", "Open Plans Dashboard"));
    if (!current.report) actions.append(button("Atlas", "kp-atlas", "Open Doc Atlas for this doc"));
    actions.append(
      button("Compare", "kp-compare", "Show what changed since last read, last commit, a week ago, or a tag"),
    );
    const browserBtn = button("🌐", "kp-browser kp-icon-btn", "Open in Browser");
    browserBtn.setAttribute("aria-label", "Open in Browser");
    const questionsBtn = button("?", "kp-questions kp-icon-btn", "Open Questions");
    questionsBtn.setAttribute("aria-label", "Open Questions");
    actions.append(
      browserBtn,
      questionsBtn,
      button("⋯ More", "kp-menu", "Check code, Show source, Review & AI, Export HTML/PDF, Workspace views…"),
    );
  }
  if (chips.childElementCount > 0 || actions.childElementCount > 0) {
    const bar = el("div", "kp-bar");
    if (chips.childElementCount > 0) bar.append(chips);
    if (actions.childElementCount > 0) bar.append(actions);
    strip.append(bar);
  }
  if (strip.childElementCount > 0) prose.prepend(strip);
}

/**
 * Whether the "In short" text is already on screen: one of the first blocks of the page says the same (compared
 * by letters and digits only, so Clean view's note box or bold labels do not hide a repeat).
 */
function repeatsTopOfPage(prose: HTMLElement, tldr: string): boolean {
  const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const want = bare(tldr);
  if (!want) return false;
  const blocks = [...prose.children].filter(
    (b) => !b.classList.contains(ADDED) && !/^H[1-6]$/.test(b.tagName),
  );
  return blocks.slice(0, 3).some((b) => bare(b.textContent ?? "").includes(want));
}

function chip(label: string, kind: string): HTMLElement {
  const c = text("span", label);
  c.className = `kp-chip kp-${kind}`;
  return c;
}

// ---------- headings: changed badge, review badge, ⋯ menu ----------

function decorateHeading(h: HTMLElement): void {
  const id = h.id;
  if ((current.changed ?? []).includes(id)) {
    h.setAttribute("data-changed", "");
    const badge = text("span", "changed");
    badge.className = `dm-badge dm-changed ${ADDED}`;
    badge.title = "Changed since you last read it";
    h.append(badge);
  }
  const review = current.reviews?.find((r) => r.headingId === id);
  if (review) {
    h.setAttribute("data-review", review.mark);
    const badge = text("span", `${MARK_ICON[review.mark]} ${MARK_LABEL[review.mark]}`);
    badge.className = `dm-badge dm-review dm-review-${review.mark} ${ADDED}`;
    h.append(badge);
  }
  if (!snapshot) {
    const menu = button("⋯", "section-menu", "Review this section or ask your AI agent about it");
    menu.dataset.headingId = id;
    menu.setAttribute("aria-label", `Review or ask about: ${h.textContent ?? ""}`);
    h.append(menu);
  }
}

function outlineBadge(id: string, kind: string, label: string): void {
  const row = document.querySelector<HTMLElement>(`.outline-row[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const dot = el("span", `outline-badge outline-badge-${kind} ${ADDED}`);
  dot.title = label;
  dot.setAttribute("aria-label", label);
  row.querySelector(".outline-link")?.after(dot);
}

/** 3.0: "☐ 2  ? 1  ✗ 1" after a heading in the outline — open tasks, open questions, doubtful paragraphs. */
function outlineCounts(b: SectionCounts): void {
  const row = document.querySelector<HTMLElement>(`.outline-row[data-id="${CSS.escape(b.headingId)}"]`);
  if (!row) return;
  const parts: [number, string, string, string][] = [
    [b.tasks, "☐", "tasks", "open task"],
    [b.questions, "?", "questions", "open question"],
    [b.doubts, "✗", "doubts", "paragraph to check"],
  ];
  const wrap = el("span", `outline-counts ${ADDED}`);
  const said: string[] = [];
  for (const [n, icon, kind, what] of parts) {
    if (n === 0) continue;
    const c = text("span", `${icon}${n}`);
    c.className = `outline-count outline-count-${kind}`;
    wrap.append(c);
    said.push(`${n} ${what}${n === 1 ? "" : "s"}`);
  }
  if (said.length === 0) return;
  wrap.title = said.join(", ");
  wrap.setAttribute("aria-label", said.join(", "));
  row.querySelector(".outline-link")?.after(wrap);
}

// ---------- highlights ----------

const BLOCKS = "p, li, td, th, h1, h2, h3, h4, h5, h6, dd, dt, figcaption, blockquote";

/** Marks the first place after the highlight's heading where its text appears (inside one block). */
function drawHighlight(prose: HTMLElement, h: Highlight): void {
  const start = h.headingId ? prose.querySelector(`[id="${CSS.escape(h.headingId)}"]`) : null;
  for (const block of prose.querySelectorAll<HTMLElement>(BLOCKS)) {
    if (
      start &&
      block !== start &&
      !(start.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)
    )
      continue;
    if (block.querySelector(BLOCKS)) continue; // innermost blocks only
    const at = (block.textContent ?? "").indexOf(h.text);
    if (at === -1) continue;
    wrapRange(block, at, at + h.text.length, h.id, h.note);
    return;
  }
}

function wrapRange(block: HTMLElement, from: number, to: number, id: string, note?: string): void {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const pieces: { node: Text; start: number; end: number }[] = [];
  let pos = 0;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length;
    const s = Math.max(from, pos);
    const e = Math.min(to, pos + len);
    if (s < e && !n.parentElement?.closest(`.${ADDED}`))
      pieces.push({ node: n, start: s - pos, end: e - pos });
    pos += len;
    if (pos >= to) break;
  }
  for (const { node, start, end } of pieces) {
    const middle = node.splitText(start);
    middle.splitText(end - start);
    const mark = document.createElement("mark");
    mark.className = note ? "dm-hl dm-hl-note" : "dm-hl";
    mark.dataset.id = id;
    if (note) mark.title = snapshot ? `Comment: ${note}` : `Your comment: ${note}\nClick to delete it`;
    else mark.title = snapshot ? "Highlight" : "Highlight — click to remove";
    middle.replaceWith(mark);
    mark.append(middle);
  }
}

let floating: HTMLElement | undefined;
function onMouseUp(event: MouseEvent): void {
  if (floating && event.target instanceof Node && floating.contains(event.target)) return; // its own click
  floating?.remove();
  floating = undefined;
  if (snapshot) return;
  const selection = document.getSelection();
  const selected = selection?.toString().trim() ?? "";
  if (!selection || selection.isCollapsed || selected.length === 0 || selected.length > 500) return;
  const anchor =
    selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
  if (!anchor?.closest(".prose") || anchor.closest(`.${ADDED}`)) return;
  const box = selection.getRangeAt(0).getBoundingClientRect();
  const bar = el("div", `dm-hl-bar ${ADDED}`);
  bar.style.left = `${Math.max(4, box.left)}px`;
  bar.style.top = `${Math.max(4, box.top - 34)}px`;
  const send = (type: "highlight" | "comment") => {
    post({ type, headingId: sectionOf(anchor), text: selected });
    selection.removeAllRanges();
    bar.remove();
  };
  const b = button(
    "Highlight",
    "dm-hl-button",
    "Highlight this text (saved on this computer, not in the file)",
  );
  // 2026-11-22: a comment on the selected words, sent to your AI with "Send my review"
  const c = button("Comment", "dm-hl-button", "Comment on this text (sent to your AI with your review)");
  b.addEventListener("click", () => send("highlight"));
  c.addEventListener("click", () => send("comment"));
  bar.append(b, c);
  bar.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
  document.body.append(bar);
  floating = bar;
}

/** The id of the heading whose section holds this element ("" above the first heading). */
function sectionOf(node: Element): string {
  let found = "";
  for (const h of headingsIn(document.querySelector(".prose"))) {
    if (h === node || h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) found = h.id;
    else break;
  }
  return found;
}

// ---------- 3.0 trust markers ----------

const TRUST_ICON = {
  mismatch: "✗",
  wrong: "✗",
  conflict: "⇄",
  stale: "⚠",
  superseded: "↺",
  verified: "✓",
} as const;
const TRUST_LABEL = {
  mismatch: "Doesn't match the code",
  wrong: "Marked wrong",
  conflict: "Conflicts with another doc",
  stale: "May be stale",
  superseded: "A newer version exists",
  verified: "Verified",
} as const;

/** The top-level element of block `index` (the attribute may sit on an inner element, e.g. a code block's <code>). */
function blockElement(index: number): HTMLElement | null {
  const tagged = document.querySelector<HTMLElement>(`.prose [data-block="${index}"]`);
  return tagged?.closest<HTMLElement>(".prose > *") ?? null;
}

function trustMarkers(_prose: HTMLElement): void {
  for (const t of current.trust ?? []) {
    const block = blockElement(t.block);
    if (!block) continue;
    block.setAttribute("data-trust", t.state);
    const m = button(
      TRUST_ICON[t.state],
      `dm-mark dm-mark-${t.state}`,
      `${TRUST_LABEL[t.state]}\n${t.reasons.join("\n")}\n\nClick: verify, mark wrong, or ask your AI agent`,
    );
    m.dataset.block = String(t.block);
    m.setAttribute("aria-label", `${TRUST_LABEL[t.state]}. ${t.reasons.join(" ")}`);
    // inside its block, pinned to the block's left edge: it moves with the block, whatever the layout does
    block.classList.add("dm-has-mark");
    block.prepend(m);
  }
}

/** Any other paragraph: a faint dot on hover, so it can be verified or handed to the agent too. */
let ghost: HTMLButtonElement | undefined;
function onHoverBlock(event: MouseEvent): void {
  if (snapshot) return;
  const target = event.target as Element | null;
  const block = target?.closest?.<HTMLElement>(".prose > *");
  const tagged = block?.matches("[data-block]") ? block : block?.querySelector<HTMLElement>("[data-block]");
  if (!block || !tagged || block.hasAttribute("data-trust") || block.classList.contains(ADDED)) return;
  ghost ??= button(
    "+",
    "dm-mark dm-mark-ghost",
    "Verify this paragraph, mark it wrong, or ask your AI agent",
  );
  ghost.dataset.block = tagged.dataset.block ?? "";
  if (ghost.parentElement !== block) {
    block.classList.add("dm-has-mark");
    block.prepend(ghost);
  }
}

// ---------- 3.0 tick a task, change a status (the host edits the one line; the page waits for the re-render) ----------

/** Task boxes and table status labels that came from a source line (not a removed copy shown by Compare). */
function editableTasks(prose: HTMLElement): void {
  if (snapshot) return;
  for (const box of prose.querySelectorAll<HTMLInputElement>("input.task-checkbox[data-line]")) {
    if (box.closest(`.${ADDED}`)) continue;
    box.disabled = false;
    box.title = box.checked ? "Done — click to mark as not done" : "Click to mark as done";
  }
  for (const chip of prose.querySelectorAll<HTMLElement>("tr[data-line] > td > .dm-status")) {
    if (chip.closest(`.${ADDED}`)) continue;
    chip.classList.add("dm-status-edit");
    chip.title = "Click to change the status";
    chip.setAttribute("role", "button");
    chip.tabIndex = 0;
  }
}

function onEditClick(target: Element | null): boolean {
  if (snapshot || !target || target.closest(`.${ADDED}`)) return false;
  const box = target.closest<HTMLInputElement>("input.task-checkbox[data-line]");
  if (box) {
    // the click already flipped the box; the host writes the file and the re-render shows the real state
    post({ type: "setTask", docVersion: pageVersion, line: Number(box.dataset.line), checked: box.checked });
    return true;
  }
  const chip = target.closest<HTMLElement>(".dm-status-edit");
  const cell = chip?.closest("td");
  const row = cell?.closest<HTMLElement>("tr[data-line]");
  if (chip && cell && row) {
    post({
      type: "statusMenu",
      docVersion: pageVersion,
      line: Number(row.dataset.line),
      column: cell.cellIndex,
    });
    return true;
  }
  return false;
}

// ---------- copy buttons, progress bar ----------

function copyButtons(prose: HTMLElement): void {
  for (const pre of prose.querySelectorAll<HTMLElement>("pre")) {
    if (pre.querySelector(".language-mermaid") || pre.closest(".mermaid")) continue;
    const b = button("Copy", "dm-copy", "Copy this code");
    pre.append(b);
    if (!snapshot) terminalButton(pre, button);
  }
}

function progressBar(): void {
  const doc = document.querySelector<HTMLElement>(".document");
  if (!doc) return;
  const bar = el("div", `dm-progress ${ADDED}`);
  bar.setAttribute("aria-hidden", "true");
  doc.prepend(bar);
  let frame = 0;
  const update = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const max = doc.scrollHeight - doc.clientHeight;
      bar.style.setProperty("--progress", max > 0 ? String(Math.min(1, doc.scrollTop / max)) : "0");
    });
  };
  doc.addEventListener("scroll", update, { passive: true });
  detachProgress = () => {
    doc.removeEventListener("scroll", update);
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  // a fresh page starts at the top; any scroll (the reader's, or the render putting their place back) updates it.
  // Reading the page height here would lay out the whole page mid-render (1 MB guardrail).
  bar.style.setProperty("--progress", "0");
}

// ---------- slides ----------

const slides = { on: false, index: 0, count: 0 };

function slideBlocks(): HTMLElement[][] {
  const prose = document.querySelector<HTMLElement>(".prose");
  const groups: HTMLElement[][] = [[]];
  for (const child of Array.from(prose?.children ?? []) as HTMLElement[]) {
    if (child.classList.contains(ADDED)) continue;
    if (child.tagName === "HR") groups.push([]);
    else groups[groups.length - 1]!.push(child);
  }
  return groups.filter((g) => g.length > 0);
}

function showSlide(index: number): void {
  const groups = slideBlocks();
  slides.count = groups.length;
  slides.index = Math.max(0, Math.min(index, groups.length - 1));
  const prose = document.querySelector<HTMLElement>(".prose");
  for (const child of Array.from(prose?.children ?? []) as HTMLElement[])
    child.toggleAttribute("data-slide-hidden", true);
  for (const b of groups[slides.index] ?? []) b.removeAttribute("data-slide-hidden");
  document.querySelector(".slide-bar")?.remove();
  const bar = el("div", `slide-bar ${ADDED}`);
  bar.append(
    button("‹", "slide-prev", "Previous slide ( ← )"),
    text("span", `${slides.index + 1} / ${slides.count}`),
    button("›", "slide-next", "Next slide ( → )"),
    button("Exit slides", "slide-exit", "Back to the page ( Esc )"),
  );
  document.querySelector(".document")?.append(bar);
  document.querySelector(".document")?.scrollTo({ top: 0 });
}

/** #48: the host's "Show as slides" (from the file's menu) — the same as the browser page's ▶ Slides button. */
export function startSlides(): void {
  if (document.querySelector(".prose > hr")) setSlides(true);
}

function setSlides(on: boolean): void {
  slides.on = on;
  document.querySelector(".map")?.toggleAttribute("data-slides", on);
  if (on) showSlide(0);
  else {
    for (const b of document.querySelectorAll("[data-slide-hidden]")) b.removeAttribute("data-slide-hidden");
    document.querySelector(".slide-bar")?.remove();
  }
}

function onSlideKey(event: KeyboardEvent): void {
  if (!slides.on) return;
  const step = { ArrowRight: 1, PageDown: 1, " ": 1, ArrowLeft: -1, PageUp: -1 }[event.key];
  if (step !== undefined) showSlide(slides.index + step);
  else if (event.key === "Escape") setSlides(false);
  else return;
  event.preventDefault();
  event.stopPropagation();
}

// ---------- clicks on what this module drew ----------

function onClick(event: MouseEvent): void {
  const target = event.target as Element | null;
  closeLookOnOutsideClick(target);
  const hit = (cls: string) => target?.closest?.(`.${cls}`);
  const handled = () => {
    event.preventDefault();
    event.stopPropagation();
  };
  const menu = hit("section-menu") as HTMLElement | null;
  if (onEditClick(target)) handled();
  else if (!snapshot && onCodeRef(target, post)) handled();
  else if (!snapshot && hit("dm-term")) {
    handled();
    const code = target?.closest("pre")?.querySelector("code")?.textContent ?? "";
    if (code.trim()) post({ type: "runInTerminal", text: code });
  } else if (menu) {
    handled();
    post({ type: "sectionMenu", headingId: menu.dataset.headingId ?? "" });
  } else if (hit("kp-compare") || hit("rl-menu")) {
    handled();
    post({ type: "redlineMenu" });
  } else if (hit("kp-kind")) {
    handled();
    post({ type: "compareFormat" });
  } else if (hit("rl-off")) {
    handled();
    post({ type: "redlineOff" });
  } else if (hit("rl-side")) {
    handled();
    post({ type: "redlineSideBySide" });
  } else if (hit("kp-clean")) {
    handled();
    post({ type: "setClean", on: (hit("kp-clean") as HTMLElement).dataset.on === "true" });
  } else if (hit("dm-hlink")) {
    handled();
    const link = (hit("dm-hlink") as HTMLElement).dataset.link ?? "";
    if (snapshot) void navigator.clipboard?.writeText(link);
    else post({ type: "copy", text: link });
  } else if (target?.closest?.(".dm-figure img, .dm-zoom")) {
    handled();
    const open = document.querySelector(".dm-zoom");
    if (open) open.remove();
    else {
      const img = target.closest(".dm-figure img") as HTMLImageElement;
      const z = el("div", `dm-zoom ${ADDED}`);
      const big = document.createElement("img");
      big.src = img.src;
      big.alt = img.alt;
      z.append(big);
      document.body.append(z);
    }
  } else if (hit("kp-atlas")) {
    handled();
    post({ type: "openAtlas" });
  } else if (hit("kp-plans")) {
    handled();
    post({ type: "openPlans" });
  } else if (hit("kp-browser")) {
    handled();
    post({ type: "openInBrowser" });
  } else if (hit("kp-questions")) {
    handled();
    post({ type: "openQuestions" });
  } else if (hit("kp-source")) {
    handled();
    post({ type: "showSource" });
  } else if (hit("kp-menu")) {
    handled();
    const slides = document.querySelector(".prose > hr") !== null;
    post({ type: "sectionMenu", headingId: "", ...(slides ? { slides: true } : {}) });
  } else if (hit("dm-mark")) {
    handled();
    const block = (hit("dm-mark") as HTMLElement).dataset.block;
    if (block !== undefined) post({ type: "blockMenu", block: Number(block) });
  } else if (hit("kp-trust")) {
    handled();
    // owner review 2026-11-17: each click goes to the next one of that kind, then round to the first again
    const state = (hit("kp-trust") as HTMLElement).dataset.state;
    const marked = (current.trust ?? [])
      .filter((x) => x.state === state)
      .map((x) => blockElement(x.block))
      .filter((e): e is HTMLElement => !!e);
    const index = trustCursor.state === state ? (trustCursor.index + 1) % Math.max(1, marked.length) : 0;
    trustCursor = { state: state ?? "", index };
    marked[index]?.scrollIntoView({ block: "center" });
  } else if (hit("kp-read")) {
    handled();
    post({ type: "markRead" });
  } else if (hit("kp-slides")) {
    handled();
    setSlides(true);
  } else if (hit("slide-next")) {
    handled();
    showSlide(slides.index + 1);
  } else if (hit("slide-prev")) {
    handled();
    showSlide(slides.index - 1);
  } else if (hit("slide-exit")) {
    handled();
    setSlides(false);
  } else if (hit("dm-copy")) {
    handled();
    const pre = target?.closest("pre");
    const code = pre?.querySelector("code")?.textContent ?? "";
    if (snapshot) void navigator.clipboard?.writeText(code);
    else post({ type: "copy", text: code });
    const b = hit("dm-copy") as HTMLElement;
    b.textContent = "Copied";
    setTimeout(() => {
      b.textContent = "Copy";
    }, 1500);
  } else if (!snapshot && target?.closest?.("mark.dm-hl")) {
    const id = (target.closest("mark.dm-hl") as HTMLElement).dataset.id;
    if (id && document.getSelection()?.isCollapsed !== false) {
      handled();
      post({ type: "unhighlight", id });
    }
  }
}

// ---------- helpers ----------

function headingsIn(root: Element | null): HTMLElement[] {
  return Array.from(
    root?.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]") ?? [],
  );
}

function button(label: string, cls: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `${cls} ${ADDED}`;
  b.textContent = label;
  b.title = title;
  return b;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, content: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = content;
  return node;
}
