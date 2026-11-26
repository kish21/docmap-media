/**
 * The project's home page (owner call 2026-11-24, after a sample on MarkVid): the daily questions on one page —
 * what is being worked on and what is next, which docs are hard to read, which docs name code that is gone, and
 * where the doc for a feature is. Markdown, shown read-only in the preview. Pure: the extension reads the files.
 * "What's open" (what waits on me, the open questions) replaces the separate My Items and Open Questions pages.
 */

import { type DocItem, isMine, lineLink } from "./items";

export interface HomeDoc {
  /** Workspace-relative path. */
  readonly path: string;
  readonly title: string;
  readonly modified: number;
  /** In an archive folder: kept for the record, never listed. */
  readonly archived: boolean;
  readonly feature: boolean;
  /** Code files the doc names that are gone. */
  readonly missingCode: readonly string[];
  /** When the doc reads as a plan: its task boxes, status and first open task. */
  readonly plan?: {
    readonly done: number;
    readonly total: number;
    readonly status: string;
    readonly nextTask?: string;
  };
  readonly text?: string;
  /** #55 Precomputed `hardToRead(text)` result (null = checked and fine), so Home avoids re-reading every file. */
  readonly hardToReadReason?: string | null;
  /** Its open tasks and questions (items.ts), for "What's open". */
  readonly items?: readonly DocItem[];
}

export interface HomeInput {
  readonly project: string;
  readonly docs: readonly HomeDoc[];
  /** The reader's names and @handles, for "Waiting on you" (empty: that list is left out). */
  readonly names?: readonly string[];
  /** The newest handover note (NEXT-SESSION.md and the like): its title and next steps. */
  readonly handover?: { readonly file: string; readonly now?: string; readonly next: readonly string[] };
  readonly now: number;
}

const MAX_LIST = 8;
const MAX_NEXT = 6;
const MAX_FEATURES = 200;
const MAX_TEXT = 110;
/** A Status line this long, or a paragraph this long, makes a doc hard to read (proposed, owner may tune). */
const LONG_STATUS = 60;
const LONG_PARAGRAPH = 250;
const END_OF_NEWEST = /<!--\s*End of the newest handover/i;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

const short = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);
const href = (file: string) => encodeURI(file).replace(/\(/g, "%28").replace(/\)/g, "%29");
const link = (d: { title: string; path: string }) => `[${d.title.replace(/[[\]]/g, "")}](${href(d.path)})`;
const plain = (s: string) =>
  s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .trim();

/** The newest handover's title ("now") and its next steps, read from the note's own words. */
export function handoverNext(text: string): { now?: string; next: string[] } {
  const marked = text.split(END_OF_NEWEST)[0] ?? text;
  // with no end marker, the newest note ends where the next "# Handover" (any top heading) begins
  const all = marked.split(/\r?\n/);
  const first = all.findIndex((l) => /^#\s/.test(l));
  const second = all.findIndex((l, i) => i > first && /^#\s/.test(l));
  const lines = second === -1 ? all : all.slice(0, second);
  const title = lines.find((l) => /^#\s/.test(l));
  const start = lines.findIndex((l) => /^\s*(\*\*next:?\*\*:?|#{2,4}\s+(what is |what's )?next\b)/i.test(l));
  const next: string[] = [];
  if (start !== -1) {
    // "**Next:** owner picks #991 in a new chat." — the step on the same line
    const inline = /^\s*(?:\*\*|__)next:?(?:\*\*|__):?\s*(\S.*)$/i.exec(lines[start] ?? "")?.[1];
    if (inline) next.push(inline);
    for (const l of inline ? [] : lines.slice(start + 1)) {
      const item = /^\s{0,3}(?:\d+[.)]|[-*+])\s+(.+)$/.exec(l);
      if (item) {
        if (next.length >= MAX_NEXT) break;
        next.push(item[1] as string);
      } else if (next.length > 0 && /^\s*$/.test(l)) break;
      else if (next.length > 0 && /^\s{2,}\S/.test(l))
        next[next.length - 1] += ` ${l.trim()}`; // it goes on
      else if (/^(#|\*\*)/.test(l)) break;
    }
  }
  // an item's first sentence is enough on a home page
  const firstOf = (s: string) => {
    const p = plain(s).replace(/\s+/g, " ");
    return short(/^(.+?[.!?])(\s|$)/.exec(p)?.[1] ?? p);
  };
  return {
    ...(title ? { now: short(plain(title.replace(/^#\s+/, ""))) } : {}),
    next: next.map(firstOf),
  };
}

/** Why a doc is hard to read, in plain words — or undefined when it reads fine. */
export function hardToRead(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  let fence = false;
  let para = 0;
  let longest = 0;
  for (const [i, line] of lines.entries()) {
    if (FENCE.test(line)) {
      fence = !fence;
      longest = Math.max(longest, para);
      para = 0;
      continue;
    }
    if (fence) continue;
    const status = /^\s*(?:\*\*|__)?status:?(?:\*\*|__)?:?\s*(.+)$/i.exec(line);
    if (status) {
      let words = (status[1] ?? "").split(/\s+/).filter(Boolean).length;
      for (let j = i + 1; j < lines.length && (lines[j] ?? "").trim(); j++)
        words += (lines[j] ?? "").split(/\s+/).filter(Boolean).length;
      if (words > LONG_STATUS) return `its Status line is ${words} words long`;
    }
    if (!line.trim() || /^\s*(#|\||[-*+]\s|\d+[.)]\s|>)/.test(line)) {
      longest = Math.max(longest, para);
      para = 0;
    } else para += line.split(/\s+/).filter(Boolean).length;
  }
  longest = Math.max(longest, para);
  return longest > LONG_PARAGRAPH ? `one paragraph runs ${longest} words without a break` : undefined;
}

export function homeMarkdown(input: HomeInput): string {
  const live = input.docs.filter((d) => !d.archived);
  const recent = [...live].sort((a, b) => b.modified - a.modified);
  const out: string[] = [`# ${input.project}`, ""];
  out.push(
    `${live.length} docs · ${live.filter((d) => d.feature).length} features. Open any doc, then **◈ Doc Atlas** to see the docs and code around it.`,
    "",
  );

  // 1. what is being worked on, and what is next
  out.push("## What's being worked on, and what's next", "");
  const h = input.handover;
  if (h && (h.now || h.next.length)) {
    if (h.now) out.push(`**Now:** ${h.now}`, "");
    for (const [i, n] of h.next.entries()) out.push(`${i + 1}. ${n}`);
    if (h.next.length) out.push("");
    out.push(`From ${link({ title: h.file, path: h.file })}.`, "");
  } else out.push("No handover note (NEXT-SESSION.md, HANDOVER.md) says what is next.", "");
  const open = recent.filter((d) => d.plan && d.plan.total > d.plan.done).slice(0, MAX_LIST);
  out.push("### Docs with open task boxes", "");
  if (open.length === 0) out.push("None.", "");
  for (const d of open) {
    const p = d.plan as NonNullable<HomeDoc["plan"]>;
    out.push(
      `- ${link(d)} — ${p.done} of ${p.total} done${p.nextTask ? ` · next: ${short(plain(p.nextTask))}` : ""}`,
    );
  }
  if (open.length) out.push("");
  const finished = recent
    .filter((d) => d.plan && d.plan.total > 0 && d.plan.done === d.plan.total)
    .slice(0, MAX_LIST);
  if (finished.length) {
    out.push("<details>", `<summary>Finished lately (${finished.length})</summary>`, "");
    for (const d of finished) out.push(`- ${link(d)}`);
    out.push("", "</details>", "");
  }

  // what's open: what waits on me, and the questions nobody has answered (newest docs first)
  const items = recent.flatMap((d) => (d.items ?? []).map((i) => ({ i, d })));
  const names = input.names ?? [];
  const mine = names.length ? items.filter(({ i }) => isMine(i, names)) : [];
  const questions = items.filter(({ i }) => i.kind === "question");
  out.push("## What's open", "");
  if (mine.length === 0 && questions.length === 0)
    out.push("Nothing open: no task names you, no open questions.", "");
  const list = (title: string, rows: typeof items) => {
    if (rows.length === 0) return;
    out.push(`### ${title} (${rows.length})`, "");
    // owner report 2026-11-24: the whole text (never cut mid-sentence), and the line opens the doc right there
    for (const { i, d } of rows.slice(0, MAX_LIST))
      out.push(`- ${i.text} — ${link(d)} · ${lineLink(d.path, i.line)}`);
    if (rows.length > MAX_LIST) out.push(`- …and ${rows.length - MAX_LIST} more`);
    out.push("");
  };
  list("Waiting on you", mine);
  list("Questions waiting for an answer", questions);

  // 2. hard to read
  const hard = recent.flatMap((d) => {
    const why =
      d.hardToReadReason !== undefined ? (d.hardToReadReason ?? undefined) : hardToRead(d.text ?? "");
    return why ? [{ d, why }] : [];
  });
  out.push("## Docs that are hard to read", "");
  if (hard.length === 0) out.push("No docs are hard to read.", "");
  else {
    out.push(
      `${hard.length} docs have a wall of text somewhere. Open one: the page lays it out for easy reading, and **⋯ Ask my AI agent → Make this easy to read** rewrites it with your own agent.`,
      "",
    );
    for (const { d, why } of hard.slice(0, MAX_LIST)) out.push(`- ${link(d)} — ${why}`);
    out.push("");
  }

  // 3. out of date with the code
  const stale = live
    .filter((d) => d.missingCode.length > 0)
    .sort((a, b) => b.missingCode.length - a.missingCode.length || b.modified - a.modified);
  out.push("## Docs out of date with the code", "");
  if (stale.length === 0) out.push("Every code file the docs name is still there.", "");
  else {
    out.push(`${stale.length} docs name code files that no longer exist.`, "");
    for (const d of stale.slice(0, MAX_LIST)) {
      const names = d.missingCode
        .slice(0, 2)
        .map((m) => `\`${m.replace(/`/g, "")}\``)
        .join(", ");
      const more = d.missingCode.length > 2 ? ` and ${d.missingCode.length - 2} more` : "";
      out.push(`- ${link(d)} — names ${names}${more}, no longer in the code`);
    }
    out.push("");
  }

  // 4. features
  const features = live.filter((d) => d.feature).sort((a, b) => a.title.localeCompare(b.title));
  out.push("## Find the doc for a feature", "");
  if (features.length === 0)
    out.push("No feature docs found (a `features/` folder, or docs that describe one).", "");
  else {
    out.push("Type in the search box above the contents to find one; open it, then **◈ Doc Atlas**.", "");
    for (const d of features.slice(0, MAX_FEATURES)) out.push(`- ${link(d)}`);
    out.push("");
  }
  return out.join("\n");
}
