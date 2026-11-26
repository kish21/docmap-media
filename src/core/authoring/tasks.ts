/**
 * 3.0 tick and status from the preview: the one-line edits the host makes when the reader ticks a task box or picks
 * a status for a table cell on the page. Pure. Each edit returns undefined when the line is not what the page said
 * it was (the file changed since it was drawn), so a stale click never edits the wrong line.
 */

/**
 * What the status bar says after a tick or status change: "plan.md, line 12" (+ " — not saved yet" when the file
 * already had unsaved changes, so it was not saved for the reader). `line` is 0-based.
 */
export function updatedLabel(filePath: string, line: number, saved: boolean): string {
  return `${filePath.split("/").pop() ?? filePath}, line ${line + 1}${saved ? "" : " — not saved yet"}`;
}

/** A task list item: `- [ ] …`, `* [x] …`, `1. [ ] …`, also inside a quote (`> - [ ] …`). */
const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\])/;

/** The task line with its box ticked (or cleared); undefined if `line` is not a task item. */
export function setTask(line: string, checked: boolean): string | undefined {
  const m = TASK_LINE.exec(line);
  if (!m) return undefined;
  return `${m[1]}${checked ? "x" : " "}${m[3]}${line.slice(m[0].length)}`;
}

/** Status words Clean view shows as coloured labels, by kind (also used to check a cell before changing it). */
export const STATUS_WORDS: readonly (readonly [RegExp, StatusKind])[] = [
  [/^(?:✅|✔️?|done|complete|completed|passed|shipped|resolved|yes)$/i, "done"],
  [/^(?:🚧|in progress|wip|ongoing|started|doing)$/i, "progress"],
  [/^(?:⚠️?|at risk|risky|warning|partial|stale)$/i, "risk"],
  [/^(?:❌|✗|blocked|failed|failing|no|rejected|broken)$/i, "blocked"],
  [/^(?:⏳|todo|to do|planned|pending|not started|backlog|open)$/i, "todo"],
];
export type StatusKind = "done" | "progress" | "risk" | "blocked" | "todo";

/** The status kind of a cell's text ("in progress" → "progress"), or undefined if it is not a status word. */
export function statusKind(text: string): StatusKind | undefined {
  const t = text.trim().replace(/\s+/g, " ");
  return STATUS_WORDS.find(([re]) => re.test(t))?.[1];
}

/** What the reader can pick, in the words written into the file. */
export const STATUS_CHOICES: readonly { readonly kind: StatusKind; readonly word: string }[] = [
  { kind: "todo", word: "to do" },
  { kind: "progress", word: "in progress" },
  { kind: "done", word: "done" },
  { kind: "blocked", word: "blocked" },
  { kind: "risk", word: "at risk" },
];

/** [start, end) of each cell's text in a table row; outer pipes optional, `code` and \| stay inside their cell. */
export function cellSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  while (i < line.length && /\s/.test(line[i] ?? "")) i++;
  if (line[i] === "|") i++;
  let start = i;
  let code = 0;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      i++;
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (line[i + n] === "`") n++;
      code = code === n ? 0 : code === 0 ? n : code;
      i += n - 1;
      continue;
    }
    if (ch === "|" && code === 0) {
      spans.push([start, i]);
      start = i + 1;
    }
  }
  if (line.slice(start).trim() !== "") spans.push([start, line.length]);
  return spans;
}

/** The trimmed text of each cell in a table row (same cell rules as `cellSpans`). */
export function splitCells(line: string): string[] {
  return cellSpans(line).map(([s, e]) => line.slice(s, e).trim());
}

/**
 * The table row with cell `column` changed from a status word to `word`; undefined if the line is not a table row,
 * the cell is missing, or it does not hold a status word now. Keeps the cell's spacing (and width, when it fits).
 */
export function setStatusCell(line: string, column: number, word: string): string | undefined {
  if (!line.includes("|") || /[|\n]/.test(word) || statusKind(word) === undefined) return undefined;
  const span = cellSpans(line)[column];
  if (!span) return undefined;
  const raw = line.slice(span[0], span[1]);
  if (statusKind(raw) === undefined) return undefined;
  const lead = /^\s*/.exec(raw)?.[0] ?? "";
  const trail = /\s*$/.exec(raw)?.[0] ?? "";
  const width = raw.length - lead.length;
  const pad = trail.length === 0 ? "" : " ".repeat(Math.max(1, width - word.length));
  return `${line.slice(0, span[0])}${lead}${word}${pad}${line.slice(span[1])}`;
}
