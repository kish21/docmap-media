/**
 * 3.0 Plans dashboard page (Markdown, shown read-only in the preview). Owner report 2026-11-17 ("clumsy, crowded";
 * "it should be easy to see where each plan is"): plans grouped by folder, only the columns this project fills, short
 * dates, then what needs attention, what is coming up, what no longer matches the code, what changed this week, the
 * open questions and the decisions. Pure: rows come from plans.ts; the extension adds git and missing-file facts.
 */

import { attention, type PlanRow, type PlanSort, type PlanStatus, SORT_LABELS, sortPlans } from "./plans";

/** The fragment of a plan link that asks to open that plan in the browser (the panel handles it). */
export const BROWSER_FRAGMENT = "open-in-browser";

export interface DashboardOptions {
  /** Add a 🌐 link beside each plan that opens it in the browser (the VS Code page; not for agents). */
  readonly browserLinks?: boolean;
}

const NBSP = "\u00a0";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 86_400_000;
/** "Coming up" looks this many days ahead; "Recently changed" this many back. */
const AHEAD_DAYS = 30;
const RECENT_DAYS = 7;
/** At most this many entries per list section, and paths per plan. */
const MAX_LIST = 20;
const MAX_PATHS = 5;
const MAX_TEXT = 120;
const ROOT_LABEL = "Top folder";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plural = (n: number, one: string, many: string) =>
  n === 0 ? "" : `${n}${NBSP}${n === 1 ? one : many}`;
const short = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);
const href = (file: string) => encodeURI(file).replace(/\(/g, "%28").replace(/\)/g, "%29");
const link = (r: PlanRow) => `[${cell(r.title)}](${href(r.file)})`;
const folderOf = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");

/** "1 Dec", or "1 Dec 2027" when not this year (YYYY-MM-DD in). Kept on one line. */
export function shortDate(iso: string, now: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const year = y === new Date(now).getUTCFullYear() ? "" : `${NBSP}${y}`;
  return `${d}${NBSP}${MONTHS[(m ?? 1) - 1]}${year}`;
}

/** "today", "yesterday", "5 days ago", else the short date. */
export function ago(ms: number, now: number): string {
  const days = Math.round((Date.parse(day(now)) - Date.parse(day(ms))) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}${NBSP}days ago`;
  return shortDate(day(ms), now);
}

/** The dashboard as Markdown. Sections with nothing to say are left out. */
export function dashboardMarkdown(
  rows: readonly PlanRow[],
  now: number,
  by: PlanSort,
  opts: DashboardOptions = {},
): string {
  const out = [
    "# Plans dashboard",
    "",
    `_Built ${day(now)} · sorted by ${SORT_LABELS[by]}. Re-run "Plans Dashboard" to refresh; "Plans Dashboard: Sort, Export or Ask My Agent…" for more._`,
    "",
  ];
  if (rows.length === 0) {
    out.push(
      "No plans found. A file counts as a plan when its name or title says plan, proposal, RFC, design, spec, roadmap…, or its front matter does (for example `type: plan` or `status: proposal`).",
    );
    return `${out.join("\n")}\n`;
  }
  const sorted = sortPlans(rows, by);
  // owner report 2026-11-23: archived plans are the record, not work; they never show as late, open or out of date
  const current = sorted.filter((r) => !r.archived);
  // "no owner" only where most plans name one: on a project that rarely writes owners it flags every plan
  const ownersUsed =
    current.filter((r) => r.owners.length > 0).length * 2 >= current.length && current.length > 0;
  const why = (r: PlanRow) => attention(r, { ownersUsed });
  const where = (r: PlanRow) => folderOf(r.file) || ROOT_LABEL;
  out.push(summary(rows), "");

  // owner report 2026-11-23: lead with what is being worked on and the next step, not every plan ever written
  const working = current.filter((r) => r.status === "in progress" || r.status === "active");
  if (working.length > 0) {
    out.push("## In progress", "");
    for (const r of working.slice(0, MAX_LIST)) {
      const facts = [
        r.total ? `${r.done}/${r.total} done` : `changed ${ago(r.modified, now)}`,
        r.nextTask ? `next: ${cell(short(r.nextTask))}` : "",
      ].filter((s) => s !== "");
      out.push(`- **${link(r)}** — ${facts.join(" · ")}`);
    }
    out.push("");
  }

  const needs = sorted.filter((r) => why(r).length > 0);
  if (needs.length > 0) {
    out.push("## Needs attention", "");
    // the folder as plain text: a name like G_Implementation broke the _italics_ and showed raw underscores
    for (const r of needs.slice(0, MAX_LIST))
      out.push(`- **${link(r)}** — ${why(r).join(" · ")} · in ${cell(where(r))}`);
    out.push("");
  }

  const today = day(now);
  const until = day(now + AHEAD_DAYS * DAY);
  const coming = current
    .filter(
      (r) => r.nextDate && !r.overdue && r.status !== "done" && r.nextDate >= today && r.nextDate <= until,
    )
    .sort((a, b) => (a.nextDate ?? "").localeCompare(b.nextDate ?? ""));
  if (coming.length > 0) {
    out.push("## Coming up", "", `_Dates in the next ${AHEAD_DAYS} days._`, "");
    for (const r of coming.slice(0, MAX_LIST))
      out.push(`- **${shortDate(r.nextDate ?? "", now)}** — ${link(r)}`);
    out.push("");
  }

  out.push("## Plans by folder", "");
  const folders = [...new Set(sorted.map((r) => folderOf(r.file)))].sort((a, b) =>
    a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
  );
  const columns = pickColumns(rows);
  for (const folder of folders) {
    const inFolder = sorted.filter((r) => folderOf(r.file) === folder);
    const flagged = inFolder.filter((r) => why(r).length > 0).length;
    const open = inFolder.filter((r) => r.status !== "done" && !r.archived);
    const finished = inFolder.filter((r) => r.status === "done" && !r.archived);
    const archived = inFolder.filter((r) => r.archived);
    out.push(
      `### ${cell(folder || ROOT_LABEL)}`,
      "",
      `_${plural(inFolder.length, "plan", "plans")}${flagged ? ` · ${plural(flagged, "needs attention", "need attention")}` : ""}_`,
      "",
    );
    if (open.length > 0) {
      out.push(`| ${columns.map((c) => c.head).join(" | ")} |`, `|${columns.map(() => "---").join("|")}|`);
      for (const r of open) out.push(`| ${columns.map((c) => c.value(r, now, opts)).join(" | ")} |`);
      out.push("");
    }
    // finished and archived plans fold away: still one click to reach, never in the way
    for (const [list, word] of [
      [finished, "finished"],
      [archived, "archived"],
    ] as const)
      if (list.length > 0)
        out.push(
          "<details>",
          `<summary>${plural(list.length, word, word)}</summary>`,
          "",
          ...list.map((r) => `- ${link(r)}`),
          "",
          "</details>",
          "",
        );
  }

  const outdated = current.filter((r) => (r.missing?.length ?? 0) > 0);
  if (outdated.length > 0) {
    out.push(
      "## Out of date with the code",
      "",
      "_Files and folders these plans name that no longer exist._",
      "",
    );
    for (const r of outdated.slice(0, MAX_LIST)) {
      const paths = r.missing ?? [];
      const more = paths.length > MAX_PATHS ? ` and ${paths.length - MAX_PATHS} more` : "";
      out.push(
        `- ${link(r)}: ${paths
          .slice(0, MAX_PATHS)
          .map((p) => `\`${p.replace(/`/g, "")}\``)
          .join(", ")}${more}`,
      );
    }
    out.push("");
  }

  const recent = [...rows]
    .filter((r) => now - r.modified <= RECENT_DAYS * DAY)
    .sort((a, b) => b.modified - a.modified);
  if (recent.length > 0) {
    out.push("## Recently changed", "");
    for (const r of recent.slice(0, MAX_LIST))
      out.push(
        `- ${link(r)} — ${ago(r.modified, now)}${r.lastEditor ? `, last commit by ${cell(r.lastEditor)}` : ""}`,
      );
    out.push("");
  }

  const asking = current.filter((r) => r.status !== "done" && r.questionList.length > 0);
  if (asking.length > 0) {
    out.push("## Open questions", "");
    for (const r of asking.slice(0, MAX_LIST)) {
      const more =
        r.questions > r.questionList.length ? ` _(+${r.questions - r.questionList.length} more)_` : "";
      out.push(`- **${link(r)}**: ${r.questionList.map((q) => cell(short(q))).join(" · ")}${more}`);
    }
    out.push("");
  }

  const deciding = sorted.filter((r) => r.decisionList.length > 0);
  if (deciding.length > 0) {
    // a record, not a to-do: folded so it never pushes the open work down
    out.push("<details>", `<summary>Decisions (${plural(deciding.length, "plan", "plans")})</summary>`, "");
    for (const r of deciding.slice(0, MAX_LIST))
      out.push(`- **${link(r)}**: ${r.decisionList.map((d) => cell(short(d))).join(" · ")}`);
    out.push("", "</details>", "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

/** One line of totals; zeros left out. */
function summary(rows: readonly PlanRow[]): string {
  const count = (...s: PlanStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  const sum = (f: (r: PlanRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const parts = [
    plural(count("done"), "done", "done"),
    plural(count("in progress"), "in progress", "in progress"),
    plural(count("not started"), "not started", "not started"),
    plural(count("active"), "active", "active"),
    plural(count("quiet"), "quiet", "quiet"),
    plural(count("stale"), "stale", "stale"),
    plural(count("blocked"), "blocked", "blocked"),
    plural(
      sum((r) => r.questions),
      "open question",
      "open questions",
    ),
    plural(
      sum((r) => r.risks),
      "risk",
      "risks",
    ),
    plural(
      sum((r) => r.decisions),
      "decision",
      "decisions",
    ),
  ].filter((s) => s !== "");
  return `**${plural(rows.length, "plan", "plans")}**${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
}

interface Column {
  readonly head: string;
  readonly value: (r: PlanRow, now: number, opts: DashboardOptions) => string;
}

/** Only the columns this project fills: no Progress without task boxes, no Owner without owners or git, … */
function pickColumns(rows: readonly PlanRow[]): Column[] {
  const all: { col: Column; used: boolean }[] = [
    {
      used: true,
      col: {
        head: "Plan",
        value: (r, _now, opts) =>
          opts.browserLinks
            ? `${link(r)} [🌐](${href(r.file)}#${BROWSER_FRAGMENT} "Open this plan in the browser")`
            : link(r),
      },
    },
    {
      used: rows.some((r) => r.total > 0),
      col: {
        head: "Progress",
        value: (r) =>
          r.total ? `${r.done}/${r.total}${NBSP}(${Math.round((r.done / r.total) * 100)}%)` : "—",
      },
    },
    {
      used: true,
      col: {
        head: "Status",
        value: (r) =>
          r.declared && r.declared.toLowerCase() !== r.status
            ? `${r.status} · “${cell(r.declared)}”`
            : r.status,
      },
    },
    {
      used: rows.some((r) => r.owners.length > 0 || r.lastEditor),
      col: {
        head: "Owner",
        value: (r) =>
          r.owners.length > 0
            ? cell(r.owners.join(", "))
            : r.lastEditor
              ? `${cell(r.lastEditor)} _(last commit)_`
              : "—",
      },
    },
    {
      used: rows.some((r) => r.nextDate),
      col: {
        head: "Next date",
        value: (r, now) =>
          r.nextDate
            ? r.overdue
              ? `⚠${NBSP}overdue since ${shortDate(r.nextDate, now)}`
              : shortDate(r.nextDate, now)
            : "—",
      },
    },
    {
      used: rows.some((r) => r.questions + r.risks + r.decisions > 0),
      col: {
        head: "Notes",
        value: (r) =>
          [
            plural(r.questions, "question", "questions"),
            plural(r.risks, "risk", "risks"),
            plural(r.decisions, "decision", "decisions"),
          ]
            .filter((s) => s !== "")
            .join(" · ") || "—",
      },
    },
    { used: true, col: { head: "Changed", value: (r, now) => ago(r.modified, now) } },
  ];
  return all.filter((c) => c.used).map((c) => c.col);
}
