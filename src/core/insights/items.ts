/**
 * 3.0: the actionable lines of a document — open tasks, open questions, @mentions — with their line and who they
 * name. Pure. Feeds the outline badges (per section), the Open Questions roll-up, My Items, and the docs ↔ code links
 * (which files a doc names).
 */

import { plain } from "./analyze";

export interface DocItem {
  /** 0-based source line. */
  readonly line: number;
  readonly kind: "task" | "question";
  /** Plain text, Markdown marks removed. */
  readonly text: string;
  /** People the line names: @mentions, and "Owner: X" / "(X)" style assignees. */
  readonly who: readonly string[];
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const OPEN_TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+(.*)$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?!\[[ xX]\])(.*)$/;
/** Any list item (open, done or plain): it starts a new item, never continues the one above. */
const ANY_ITEM = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)/;
const QUOTE = /^\s*>\s?/;
/** A line that cannot continue a paragraph or list item: a table row, a rule, an HTML block. */
const NOT_TEXT = /^\s*(\||<|(?:-{3,}|\*{3,}|_{3,})\s*$)/;
/** How many lines one item may run over (a sanity bound; an item is read whole up to the next blank line). */
const MAX_ITEM_LINES = 30;
const QUESTION_LABEL =
  /^\s*(?:[-*+]\s+)?(?:\*\*|__)?(?:open question|question|q|tbd)s?(?:\*\*|__)?\s*:\s*(.+)$/i;
const MENTION = /(?:^|[\s(,])@([A-Za-z][\w-]{1,38})\b/g;
const ASSIGNEE =
  /\b(?:[Oo]wner|[Aa]ssignee|[Aa]ssigned to|DRI|dri|[Ww]ho)\s*:\s*([A-Z][\w-]*(?:\s[A-Z][\w-]*)?)/g;
const CODE_PATH = /`((?:\.{1,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z0-9]{1,8})`/g;

export const MAX_ITEMS_PER_DOC = 500;

/**
 * Open tasks and real questions. Owner report 2026-11-24 (MarkVid): an item is read whole — a list item or paragraph
 * that wraps onto the next lines is joined up to the next blank line or item, so nothing is cut mid-sentence — and
 * only a real question counts: text ending in "?" (an open task, a list item, a sentence of a paragraph or quote) or a
 * line marked "Question:" / "Q:" / "TBD:". Statements under an "Open questions" heading are not questions.
 */
export function docItems(text: string): DocItem[] {
  const out: DocItem[] = [];
  const lines = text.split(/\r?\n/);
  let fence: string | undefined;
  // front matter (`title: …?`) is the doc's data, not its questions
  const fmEnd = /^---\s*$/.test(lines[0] ?? "")
    ? lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l))
    : -1;
  for (let i = fmEnd + 1; i < lines.length; i++) {
    if (out.length >= MAX_ITEMS_PER_DOC) break;
    const line = lines[i] ?? "";
    const f = FENCE.exec(line);
    if (fence !== undefined) {
      if (f && f[1]?.[0] === fence[0] && (f[1]?.length ?? 0) >= fence.length) fence = undefined;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    if (!line.trim() || HEADING.test(line) || NOT_TEXT.test(line)) continue;
    // the item's whole text: this line and the lines that continue it
    const quote = QUOTE.test(line);
    const first = quote ? line.replace(QUOTE, "") : line;
    // a list item or "Question:" line goes on only over indented lines (an unindented line after it is new text)
    const listy = ANY_ITEM.test(first) || QUESTION_LABEL.test(first);
    const rest: string[] = [];
    let j = i + 1;
    for (; j < lines.length && j - i < MAX_ITEM_LINES; j++) {
      const next = lines[j] ?? "";
      if (quote !== QUOTE.test(next)) break;
      const body = quote ? next.replace(QUOTE, "") : next;
      if (
        !body.trim() ||
        ANY_ITEM.test(body) ||
        HEADING.test(body) ||
        FENCE.test(body) ||
        NOT_TEXT.test(body)
      )
        break;
      if (listy && !/^\s/.test(body)) break;
      rest.push(body.trim());
    }
    const joined = (head: string) => [head, ...rest].join(" ");
    const whole = joined(first);
    const start = i;
    i = j - 1;
    const task = OPEN_TASK.exec(first);
    const label = QUESTION_LABEL.exec(first);
    const item = LIST_ITEM.exec(first);
    let kind: DocItem["kind"] | undefined;
    let t = "";
    if (task) {
      t = plain(joined(task[1] ?? ""));
      kind = /\?$/.test(t) ? "question" : "task";
    } else if (label) {
      kind = "question";
      t = plain(joined(label[1] ?? ""));
    } else if (item) {
      t = plain(joined(item[1] ?? ""));
      if (/\?$/.test(t)) kind = "question";
    } else if (!ANY_ITEM.test(first)) {
      // a paragraph or quote: its questions are the sentences that end in "?"
      t = questionsIn(whole);
      if (t) kind = "question";
    }
    if (!kind || !t || !/[\p{L}]/u.test(t)) continue;
    out.push({ line: lineOf(lines, start, j, t), kind, text: t, who: whoIn(whole) });
  }
  return out;
}

/**
 * The sentences of a paragraph (Markdown) that end in "?", in order ("" when none). A "?" in code (`a ? b : c`),
 * in quotes (someone's words) or in brackets (an aside, a reference) asks nothing. Read before `plain` cuts long text.
 */
function questionsIn(paragraph: string): string {
  const noAsk = (m: string) => m.replace(/[?.!]/g, "");
  const prose = paragraph
    .replace(/`[^`]*`/g, noAsk)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\([^()]*\)|"[^"]*"|“[^”]*”/g, noAsk)
    .replace(/\*+/g, "");
  return (prose.match(/[^.!?]*\?+(?=[\s_]|$)/g) ?? [])
    .map((s) => plain(s))
    .filter((s) => /[\p{L}]/u.test(s))
    .join(" ");
}

/** The line where `text` starts, among the item's lines `start` up to `end` (its first line when not found). */
function lineOf(lines: readonly string[], start: number, end: number, text: string): number {
  const head = text.split(" ").slice(0, 3).join(" ");
  for (let k = start; k < end; k++) if (plain(lines[k] ?? "").includes(head)) return k;
  return start;
}

/** People a line names: @mentions and "Owner: Name". */
export function whoIn(line: string): string[] {
  const who = new Set<string>();
  for (const m of line.matchAll(MENTION)) who.add(`@${m[1]}`);
  for (const m of line.matchAll(ASSIGNEE)) who.add((m[1] ?? "").trim());
  return [...who];
}

/** Whether an item is the reader's: it names one of `names` (case-insensitive; "@kish" and "kish" both match). */
export function isMine(item: DocItem, names: readonly string[]): boolean {
  const mine = names.map((n) => n.replace(/^@/, "").toLowerCase()).filter(Boolean);
  if (mine.length === 0) return false;
  const text = item.text.toLowerCase();
  return (
    item.who.some((w) => mine.includes(w.replace(/^@/, "").toLowerCase())) ||
    mine.some((n) => new RegExp(`(^|[^\\w@])@?${escapeRe(n)}(?![\\w-])`).test(text))
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface SectionBadge {
  readonly headingId: string;
  readonly tasks: number;
  readonly questions: number;
}

/** Open tasks and questions per section (a heading up to the next heading of any level). */
export function sectionBadges(
  items: readonly DocItem[],
  headings: readonly { readonly id: string; readonly line: number }[],
): SectionBadge[] {
  const sorted = [...headings].sort((a, b) => a.line - b.line);
  const out: SectionBadge[] = [];
  for (const [k, h] of sorted.entries()) {
    const end = sorted[k + 1]?.line ?? Number.POSITIVE_INFINITY;
    const inside = items.filter((it) => it.line > h.line && it.line < end);
    const tasks = inside.filter((it) => it.kind === "task").length;
    const questions = inside.length - tasks;
    if (tasks + questions > 0) out.push({ headingId: h.id, tasks, questions });
  }
  return out;
}

/** Repository paths a doc names in `code` spans, with the line (for "mentioned in docs" in code files). */
export function pathMentions(text: string): { path: string; line: number }[] {
  const out: { path: string; line: number }[] = [];
  let fence: string | undefined;
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    const f = FENCE.exec(line);
    if (fence !== undefined) {
      if (f && f[1]?.[0] === fence[0]) fence = undefined;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    for (const m of line.matchAll(CODE_PATH))
      if (m[1] && /\//.test(m[1]) && out.length < MAX_ITEMS_PER_DOC)
        out.push({ path: m[1].replace(/^\.\//, ""), line: i });
  }
  return out;
}

export interface FileItems {
  /** Workspace-relative path. */
  readonly file: string;
  readonly title: string;
  readonly items: readonly DocItem[];
}

const link = (file: string) => encodeURI(file).replace(/\(/g, "%28").replace(/\)/g, "%29");
/** "line 11", linked so a click opens the doc at that line (`#L11`; 0-based `line` in). */
export const lineLink = (file: string, line: number) => `[line ${line + 1}](${link(file)}#L${line + 1})`;

/** The Open Questions roll-up: every open question in the workspace, by file. */
export function questionsReport(files: readonly FileItems[], built: string): string {
  const withQ = files
    .map((f) => ({ ...f, items: f.items.filter((i) => i.kind === "question") }))
    .filter((f) => f.items.length > 0);
  const total = withQ.reduce((n, f) => n + f.items.length, 0);
  const out = [
    "# Open questions",
    "",
    `_${total} question${total === 1 ? "" : "s"} in ${withQ.length} file${withQ.length === 1 ? "" : "s"} · built ${built}. Text ending in "?" and lines marked "Question:". Click a line number to open the doc at that line. Re-run to refresh._`,
    "",
  ];
  if (total === 0) out.push("No open questions found.");
  for (const f of withQ) {
    out.push(`## [${f.title}](${link(f.file)})`, "");
    for (const q of f.items)
      out.push(`- ${q.text} _(${lineLink(f.file, q.line)}${q.who.length ? ` · ${q.who.join(", ")}` : ""})_`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** My Items: the open tasks and questions that name me, by file. */
export function myItemsReport(files: readonly FileItems[], names: readonly string[], built: string): string {
  const mine = files
    .map((f) => ({ ...f, items: f.items.filter((i) => isMine(i, names)) }))
    .filter((f) => f.items.length > 0);
  const total = mine.reduce((n, f) => n + f.items.length, 0);
  const out = [
    "# My items",
    "",
    `_${total} open item${total === 1 ? "" : "s"} naming ${names.join(", ") || "you"} · built ${built}. Set your names in the setting "docmap.myNames". Re-run to refresh._`,
    "",
  ];
  if (names.length === 0)
    out.push('Tell docmap who you are: add your name and @handle to the setting "docmap.myNames".');
  else if (total === 0) out.push("Nothing open names you. 🎉");
  for (const f of mine) {
    out.push(`## [${f.title}](${link(f.file)})`, "");
    for (const it of f.items)
      out.push(`- ${it.kind === "task" ? "[ ]" : "❓"} ${it.text} _(line ${it.line + 1})_`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
