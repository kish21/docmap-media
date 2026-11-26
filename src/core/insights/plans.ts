/**
 * 3.0 Plans dashboard: every plan in the workspace as one row — progress, status, owners, next date, open
 * questions, risks, decisions, last changed — plus totals and what needs attention. Pure: the extension reads the
 * files; this decides and writes the report (Markdown, shown in the preview with Clean view; or CSV).
 */

import { analyze, frontMatter, plain } from "./analyze";
import { isArchivedPath } from "./inbox";

/** With no task boxes and no status of its own, a plan's status comes from when it last changed: active / quiet / stale. */
export type PlanStatus = "done" | "in progress" | "not started" | "stale" | "blocked" | "active" | "quiet";

export interface PlanRow {
  /** Workspace-relative path (the dashboard links to it). */
  readonly file: string;
  readonly title: string;
  readonly done: number;
  readonly total: number;
  readonly status: PlanStatus;
  /** The plan's own `status:` (front matter), if it has one — shown, never overriding the derived status. */
  readonly declared?: string;
  readonly owners: readonly string[];
  /** The earliest date (YYYY-MM-DD) from today on; else, with open work, the latest past one (overdue). */
  readonly nextDate?: string;
  readonly overdue: boolean;
  readonly questions: number;
  readonly risks: number;
  readonly decisions: number;
  /** The first few open questions and decisions, as plain text (for the dashboard's lists). */
  readonly questionList: readonly string[];
  readonly decisionList: readonly string[];
  /** Last change (ms since epoch). */
  readonly modified: number;
  /** Set by the extension: paths the plan names that no longer exist, and who last committed it (git). */
  readonly missing?: readonly string[];
  readonly lastEditor?: string;
  /** The first open task box's text: what to do next (owner report 2026-11-23). */
  readonly nextTask?: string;
  /** In an `archive/`, `_archive/`, `archived/` or `old/` folder: kept for the record, never needs attention. */
  readonly archived?: boolean;
  /** True when the file's name, title, or front matter explicitly marks it as a plan/RFC/spec/design/roadmap. */
  readonly isPlan?: boolean;
}

export type PlanSort = "attention" | "changed" | "progress" | "date";

/** A title, file name or front matter value that says "plan". */
const PLAN_WORDS =
  /\b(plan|planning|proposal|rfc|design|spec|specification|roadmap|migration|rollout|launch|project|initiative|adr|prd|brief|strategy)\b/i;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const ISO_DATE = /\b(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;
const OPEN_TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+(.+)$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?!\[[ xX]\])\S/;
const QUESTIONS_HEADING = /\b(open questions?|questions?|unknowns?|unresolved|to decide|tbd)\b/i;
const RISKS_HEADING = /\b(risks?|concerns?|threats?)\b/i;
const OWNER_LINE =
  /^\s*(?:[-*+]\s+)?(?:\*\*|__)?(?:owner|driver|dri|lead|assignee)s?(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.+)$/i;
const OWNER_KEYS = /^(owner|owners|author|authors|driver|dri|lead|assignee)$/i;
const MENTION = /(?:^|[\s(])@([A-Za-z][\w-]{1,38})\b/g;
const BLOCKED = /^(blocked|on hold|paused)$/i;
const MAX_OWNERS = 3;
/** How many questions / decisions a row keeps for the dashboard's lists. */
const MAX_LISTED = 3;
/** Changed within this many days: "active"; after that "quiet", until `staleDays`. */
const ACTIVE_DAYS = 14;

/** One plan's row, or undefined when the file does not read as a plan. `today` is YYYY-MM-DD. */
export function planRow(
  text: string,
  file: string,
  modified: number,
  now: number,
  staleDays: number,
): PlanRow | undefined {
  const row = docRow(text, file, modified, now, staleDays);
  return row.isPlan ? row : undefined;
}

/** One Markdown doc's dashboard row (for every doc in the workspace, plan or not). */
export function docRow(
  text: string,
  file: string,
  modified: number,
  now: number,
  staleDays: number,
): PlanRow {
  const name = file.split("/").pop() ?? file;
  const facts = analyze(text);
  const total = facts.tasksOpen + facts.tasksDone;
  const fm = frontMatter(text);
  // a plan by its name, its title, or its front matter (status/type/kind says plan…)
  const isPlan =
    PLAN_WORDS.test(name.replace(/[-_.]/g, " ")) ||
    PLAN_WORDS.test(facts.title ?? "") ||
    fm.some((f) => /^(status|state|type|kind)$/i.test(f.key) && PLAN_WORDS.test(f.value));
  const declared = fm.find((f) => /^status$/i.test(f.key))?.value;
  const owners = new Set<string>();
  for (const f of fm)
    if (OWNER_KEYS.test(f.key)) for (const o of f.value.split(/[,;]/)) if (o.trim()) owners.add(o.trim());
  const today = new Date(now).toISOString().slice(0, 10);
  const dates: string[] = [];
  for (const f of fm) for (const m of f.value.matchAll(ISO_DATE)) dates.push(m[0]);
  let questions = 0;
  const questionList: string[] = [];
  let risks = 0;
  let section: "questions" | "risks" | undefined;
  let fence: string | undefined;
  let nextTask: string | undefined;
  const fmLines = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text)?.[0].split("\n").length ?? 0;
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (i < Math.max(0, fmLines - 1)) continue;
    const f = FENCE.exec(line);
    if (fence !== undefined) {
      if (f && f[1]?.[0] === fence[0] && (f[1]?.length ?? 0) >= fence.length) fence = undefined;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const words = h[2] ?? "";
      section = QUESTIONS_HEADING.test(words) ? "questions" : RISKS_HEADING.test(words) ? "risks" : undefined;
      continue;
    }
    const o = OWNER_LINE.exec(line);
    if (o) for (const who of plain(o[1] ?? "").split(/[,;]| and /)) if (who.trim()) owners.add(who.trim());
    for (const m of line.matchAll(MENTION)) owners.add(`@${m[1]}`);
    for (const m of line.matchAll(ISO_DATE)) dates.push(m[0]);
    const open = nextTask === undefined ? OPEN_TASK.exec(line) : null;
    if (open) nextTask = plain(open[1] ?? "").trim() || undefined;
    const item = LIST_ITEM.test(line);
    const isQuestion =
      (section === "questions" && item) ||
      (/\?\s*$/.test(line) && !/^\s*>/.test(line)) ||
      /^\s*(?:[-*+]\s+)?(?:\*\*|__)?(?:open question|question|tbd)s?(?:\*\*|__)?\s*:/i.test(line);
    if (isQuestion) {
      questions++;
      const q = plain(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")).trim();
      if (q && questionList.length < MAX_LISTED) questionList.push(q);
    }
    if (section === "risks" && item) risks++;
    else if (/^\s*(?:[-*+>]\s+)?(?:\*\*|__)?risks?(?:\*\*|__)?\s*:/i.test(line)) risks++;
  }
  risks += facts.warnings;
  const future = dates.filter((d) => d >= today).sort();
  const past = dates.filter((d) => d < today).sort();
  // only an open task box can be late: a past date in plain text is history (owner report 2026-11-23, MarkVid)
  const openWork = facts.tasksOpen > 0;
  const nextDate = future[0] ?? (openWork && !isDone(declared) ? past.at(-1) : undefined);
  const overdue = future.length === 0 && nextDate !== undefined;
  const ageDays = Math.floor((now - modified) / 86_400_000);
  const status: PlanStatus =
    declared && BLOCKED.test(declared.trim())
      ? "blocked"
      : (total > 0 && facts.tasksOpen === 0) || isDone(declared)
        ? "done"
        : staleDays > 0 && ageDays >= staleDays
          ? "stale"
          : facts.tasksDone > 0
            ? "in progress"
            : total > 0
              ? "not started"
              : ageDays <= ACTIVE_DAYS
                ? "active"
                : "quiet";
  return {
    file,
    title: facts.title ?? name,
    done: facts.tasksDone,
    total,
    status,
    ...(declared ? { declared } : {}),
    owners: [...owners].slice(0, MAX_OWNERS),
    ...(nextDate ? { nextDate } : {}),
    overdue,
    questions,
    risks,
    decisions: facts.decisions.length,
    questionList,
    decisionList: facts.decisions.slice(0, MAX_LISTED).map((d) => d.text),
    modified,
    ...(nextTask ? { nextTask } : {}),
    archived: isArchivedPath(file),
    isPlan,
  };
}

/**
 * A status that starts with a tick or a finished word ("✅ Built 2026-07-19 · …", "Superseded by 45"): the plan is
 * over, so it is never stale or overdue (owner report 2026-11-23: on MarkVid every finished doc showed as overdue).
 */
const FINISHED =
  /^(?:[✅✔☑]|(?:done|complete|completed|shipped|closed|built|merged|released|implemented|finished|superseded|replaced|archived)\b)/iu;
const isDone = (s: string | undefined) => s !== undefined && FINISHED.test(s.trim());

/** Why a plan needs the reader now — empty when it does not. */
export function attention(row: PlanRow, opts: { readonly ownersUsed?: boolean } = {}): string[] {
  const why: string[] = [];
  // an archived plan is kept for the record: nothing in it is anyone's to-do
  if (row.status === "done" || row.archived) return why;
  if (row.overdue) why.push(`overdue since ${row.nextDate}`);
  if (row.status === "blocked") why.push("blocked");
  if (row.status === "stale") why.push("not changed in a long time");
  const gone = row.missing?.length ?? 0;
  if (gone > 0)
    why.push(`names ${gone} file${gone === 1 ? "" : "s"} that no longer exist${gone === 1 ? "s" : ""}`);
  // "no owner" only where the project writes owners at all — else every plan would say it
  if (row.owners.length === 0 && opts.ownersUsed !== false) why.push("no owner");
  if (row.questions > 0) why.push(`${row.questions} open question${row.questions === 1 ? "" : "s"}`);
  return why;
}

export function sortPlans(rows: readonly PlanRow[], by: PlanSort): PlanRow[] {
  const pct = (r: PlanRow) => (r.total === 0 ? -1 : r.done / r.total);
  const cmp: Record<PlanSort, (a: PlanRow, b: PlanRow) => number> = {
    attention: (a, b) => attention(b).length - attention(a).length || b.modified - a.modified,
    changed: (a, b) => b.modified - a.modified,
    progress: (a, b) => pct(a) - pct(b) || b.modified - a.modified,
    date: (a, b) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999") || b.modified - a.modified,
  };
  return [...rows].sort(cmp[by]);
}

export const SORT_LABELS: Record<PlanSort, string> = {
  attention: "needs attention first",
  changed: "last changed first",
  progress: "least done first",
  date: "next date first",
};

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The rows as CSV (RFC 4180 quoting), for a spreadsheet. */
export function dashboardCsv(rows: readonly PlanRow[], by: PlanSort): string {
  const q = (v: string | number) => {
    const s = String(v);
    // a leading = + - @ would run as a formula in a spreadsheet: quote it as text
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const head = [
    "file",
    "title",
    "done",
    "total",
    "status",
    "declared status",
    "owners",
    "next date",
    "overdue",
    "open questions",
    "risks",
    "decisions",
    "last changed",
  ];
  const lines = [head.join(",")];
  for (const r of sortPlans(rows, by))
    lines.push(
      [
        r.file,
        r.title,
        r.done,
        r.total,
        r.status,
        r.declared ?? "",
        r.owners.join("; "),
        r.nextDate ?? "",
        r.overdue ? "yes" : "no",
        r.questions,
        r.risks,
        r.decisions,
        day(r.modified),
      ]
        .map(q)
        .join(","),
    );
  return `${lines.join("\r\n")}\r\n`;
}
