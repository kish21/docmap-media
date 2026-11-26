import type { StateCore, Token } from "markdown-it";

/**
 * Reading aids layered on markdown-it's token stream (0.0.4, "reading quality"). Each rule only re-labels or trims
 * tokens the parser already produced — no document text is ever turned into markup, and every string these rules
 * emit is fixed text or an attribute value docmap chose. Raw HTML stays off (ADR-0002).
 */

// ---------- structure hints: lines that act as headings ----------

/** When lines that merely LOOK like headings join the outline. */
export type InferHeadings = "auto" | "always" | "off";

/** "auto": only in documents with fewer real headings than this — a well-headed document is left as written. */
export const AUTO_INFER_BELOW = 3;
/** A line longer than this is a sentence, not a heading. */
const MAX_INFERRED_LENGTH = 100;
/**
 * "2.1 Title", "3.4.1 Title": 2–3 short number parts, then a word starting with a letter, and no sentence ending.
 * Keeps out lists ("1. Item"), measurements ("3.5 hours later we left."), addresses ("192.168.1.1 is …").
 */
const NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){1,2})\.?\s+\p{L}/u;
const SENTENCE_END = /[.!]\s*$/; // "?" can end a heading ("1.2 Why does it fail?")

/**
 * Turns top-level one-line paragraphs that act as headings into headings, marked `inferred`:
 * a line that is ONLY bold text (optionally ending in ":"), or a numbered section line ("2.1 Title").
 * Numbered lines take their depth from the number (2.1 → level 3); bold lines all sit one level below the last
 * REAL heading (level 2 when there is none) — bold subheads in a document are siblings, whatever came between.
 */
export function inferHeadings(tokens: Token[], mode: InferHeadings): void {
  if (mode === "off") return;
  if (mode === "auto" && tokens.filter((t) => t.type === "heading_open").length >= AUTO_INFER_BELOW) return;
  let lastLevel = 0; // level of the last real heading
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open?.type === "heading_open") {
      lastLevel = Number(open.tag.slice(1));
      continue;
    }
    const inline = tokens[i + 1];
    const close = tokens[i + 2];
    if (open?.type !== "paragraph_open" || open.level !== 0 || !inline || close?.type !== "paragraph_close")
      continue;
    const lines = open.map ? open.map[1] - open.map[0] : 0;
    if (lines !== 1 || inline.content.length > MAX_INFERRED_LENGTH) continue;
    const numbered = SENTENCE_END.test(inline.content) ? null : NUMBERED.exec(inline.content);
    let level: number;
    if (numbered) level = Math.min(6, (numbered[1] ?? "").split(".").length + 1);
    else if (isBoldOnly(inline)) level = Math.min(6, Math.max(2, lastLevel + 1));
    else continue;
    const tag = `h${level}`;
    open.type = "heading_open";
    open.tag = tag;
    open.markup = "";
    open.meta = { ...open.meta, inferred: true };
    open.attrJoin("class", "inferred-heading");
    close.type = "heading_close";
    close.tag = tag;
    close.markup = "";
  }
}

/** The paragraph is one bold span and nothing else (a trailing ":" allowed). */
function isBoldOnly(inline: Token): boolean {
  // markdown-it leaves empty text tokens around emphasis delimiters: they are not content
  const kids = (inline.children ?? []).filter((t) => !(t.type === "text" && t.content === ""));
  if (kids[0]?.type !== "strong_open") return false;
  let depth = 0;
  let closedAt = -1;
  for (let k = 0; k < kids.length; k++) {
    const t = kids[k];
    if (t?.type === "strong_open") depth++;
    else if (t?.type === "strong_close" && --depth === 0) {
      closedAt = k;
      break;
    }
  }
  if (closedAt === -1) return false;
  return kids.slice(closedAt + 1).every((t) => t.type === "text" && /^\s*:?\s*$/.test(t.content));
}

/**
 * A heading written inside a footnote is shown as a paragraph of the note (class "footnote-heading"), not as a
 * heading: the notes are moved to the end of the document, so such a heading would sit out of line order in the
 * outline and mislead "you are here", fold-to-level and skim.
 */
export function flattenFootnoteHeadings(tokens: Token[]): void {
  let inNotes = false;
  for (const t of tokens) {
    if (t.type === "footnote_block_open") inNotes = true;
    else if (t.type === "footnote_block_close") inNotes = false;
    else if (inNotes && (t.type === "heading_open" || t.type === "heading_close")) {
      t.type = t.type === "heading_open" ? "paragraph_open" : "paragraph_close";
      t.tag = "p";
      t.markup = "";
      if (t.nesting === 1) t.attrJoin("class", "footnote-heading");
    }
  }
}

// ---------- section size ----------

/** Words in a string: runs of non-space characters. */
export function countWords(text: string): number {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const space = c === 32 || c === 9 || c === 10 || c === 13;
    if (!space && !inWord) n++;
    inWord = !space;
  }
  return n;
}

/**
 * Words under each heading, INCLUDING its sub-sections (what you would read if you opened it), in heading order.
 * Text before the first heading counts for no heading. Code blocks count too — they are reading as well.
 */
export function sectionWords(tokens: readonly Token[], headingLevels: readonly number[]): number[] {
  const own = headingLevels.map(() => 0);
  let current = -1;
  let inHeading = false;
  let inFootnotes = false; // the notes at the end belong to the references, not to the last section
  for (const t of tokens) {
    if (t.type === "footnote_block_open") inFootnotes = true;
    else if (t.type === "footnote_block_close") inFootnotes = false;
    else if (t.type === "heading_open") {
      current++;
      inHeading = true;
    } else if (t.type === "heading_close") inHeading = false;
    else if (current >= 0 && !inHeading && !inFootnotes) {
      if (t.type === "inline") own[current] = (own[current] ?? 0) + countWords(visibleText(t));
      else if (t.type === "fence" || t.type === "code_block")
        own[current] = (own[current] ?? 0) + countWords(t.content);
    }
  }
  // add each section into every ancestor: one pass with a stack of open headings
  const total = [...own];
  const stack: number[] = [];
  for (let i = 0; i < headingLevels.length; i++) {
    const level = headingLevels[i] ?? 1;
    while (stack.length > 0 && (headingLevels[stack[stack.length - 1] ?? 0] ?? 1) >= level) stack.pop();
    for (const ancestor of stack) total[ancestor] = (total[ancestor] ?? 0) + (own[i] ?? 0);
    stack.push(i);
  }
  return total;
}

/** An inline token's text as shown: its children (so stripped markers — "[!NOTE]", "[ ]" — do not count). */
function visibleText(inline: Token): string {
  if (!inline.children) return inline.content;
  let text = "";
  for (const c of inline.children) {
    if (c.type === "text" || c.type === "code_inline") text += c.content;
    else if (c.type === "softbreak" || c.type === "hardbreak") text += " ";
  }
  return text;
}

// ---------- GitHub extras: task lists and callouts ----------

const TASK = /^\[([ xX])\][ \t]/;

/** `- [ ] todo` / `- [x] done`: the marker becomes a disabled checkbox (a fixed string, see the renderer). */
export function taskLists(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i];
    if (inline?.type !== "inline" || tokens[i - 1]?.type !== "paragraph_open") continue;
    if (tokens[i - 2]?.type !== "list_item_open") continue;
    const match = TASK.exec(inline.content);
    const first = inline.children?.[0];
    if (!match || first?.type !== "text" || !TASK.test(first.content)) continue;
    first.content = first.content.slice(match[0].length);
    const box = new state.Token("docmap_task", "", 0);
    // the item's source line: the preview can tick it (the host edits that line, after checking it is still a task)
    box.meta = { checked: match[1] !== " ", line: tokens[i - 2]?.map?.[0] };
    inline.children?.unshift(box);
    tokens[i - 2]?.attrJoin("class", "task-list-item");
  }
}

const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
const CALLOUT_TITLE: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

/** `> [!NOTE]` … (GitHub alerts): the quote becomes a titled callout; the marker line is removed. */
export function callouts(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i + 2 < tokens.length; i++) {
    const quote = tokens[i];
    const para = tokens[i + 1];
    const inline = tokens[i + 2];
    if (quote?.type !== "blockquote_open" || para?.type !== "paragraph_open" || inline?.type !== "inline")
      continue;
    const match = CALLOUT.exec(inline.content);
    if (!match) continue;
    const kind = (match[1] ?? "note").toLowerCase();
    quote.attrJoin("class", `callout callout-${kind}`);
    const title = new state.Token("docmap_callout_title", "", 0);
    title.meta = { title: CALLOUT_TITLE[kind] ?? "Note" };
    tokens.splice(i + 1, 0, title);
    // drop the marker (first text child) and the line break after it
    const kids = inline.children ?? [];
    const markerText = kids[0];
    if (markerText?.type === "text") {
      markerText.content = markerText.content.replace(/^\[![A-Za-z]+\][ \t]*/, "");
      if (markerText.content === "") kids.shift();
    }
    if (kids[0]?.type === "softbreak" || kids[0]?.type === "hardbreak") kids.shift();
    if (kids.length === 0) {
      // nothing else on the first paragraph: hide it rather than leave an empty <p>
      para.hidden = true;
      const paraClose = tokens[i + 4];
      if (paraClose?.type === "paragraph_close") paraClose.hidden = true;
    }
  }
}
