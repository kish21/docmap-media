/**
 * What a Markdown document holds, at a glance — pure, no AI (2.0: Docs Inbox, key points, plan tracker, decision log,
 * docs-vs-code drift). One pass over the lines; fenced code is skipped, so examples inside code never count.
 */

export interface Decision {
  /** 0-based source line. */
  readonly line: number;
  /** The decision as plain text (Markdown marks removed), at most `MAX_SNIPPET` characters. */
  readonly text: string;
}

export interface DocFacts {
  /** The first heading's text, if any. */
  readonly title?: string;
  /** A one-paragraph summary: the doc's own TL;DR / Summary section, else its first paragraph. Plain text. */
  readonly tldr?: string;
  readonly words: number;
  readonly tasksOpen: number;
  readonly tasksDone: number;
  readonly decisions: readonly Decision[];
  /** Warning / caution / important note boxes and "**Warning**"-style lines. */
  readonly warnings: number;
  /** Repository paths named in `code` spans (e.g. `src/app/main.ts`) — checked against the disk for drift. */
  readonly codePaths: readonly string[];
  /** Relative links to other Markdown files (no #fragment, no web links). */
  readonly mdLinks: readonly string[];
}

export const MAX_SNIPPET = 280;
const MAX_ITEMS = 100;

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const TASK = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+/;
const DECISION =
  /^\s*(?:[-*+>]\s+)*(?:\*\*|__)?(?:decision|decided|we decided|we chose|we will use|chosen)\b\s*(?:\*\*|__)?\s*[:—–-]?\s*(.*)$/i;
const WARNING =
  /^\s*>\s*\[!(?:warning|caution|important)\]|^\s*(?:[-*+>]\s+)*(?:\*\*|__)(?:warning|caution|important)\b/i;
const SUMMARY_HEADING =
  /^(?:tl;?\s?dr|summary|executive summary|overview|in short|key points|at a glance)\b/i;
const NOT_PROSE = /^\s*(?:[|<]|[-*+]\s|\d+[.)]\s|>|-{3,}\s*$|\*{3,}\s*$|_{3,}\s*$|\[[^\]]+\]:)/;
const CODE_PATH = /`([\w.@-]+(?:\/[\w.@-]+)+\.[A-Za-z0-9]{1,8})`/g;
const MD_LINK = /\]\(\s*<?([^)\s>#]+\.(?:md|markdown))(?:#[^)\s>]*)?>?(?:\s+"[^"]*")?\s*\)/gi;

export function analyze(text: string): DocFacts {
  // front matter (title: / status: / owner:) is metadata, not the document's first paragraph
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  const lines = (fm ? `${"\n".repeat(fm[0].split("\n").length - 1)}${text.slice(fm[0].length)}` : text).split(
    /\r?\n/,
  );
  let fence: string | undefined;
  let title: string | undefined;
  let words = 0;
  let tasksOpen = 0;
  let tasksDone = 0;
  let warnings = 0;
  const decisions: Decision[] = [];
  const codePaths = new Set<string>();
  const mdLinks = new Set<string>();
  let summary: string | undefined;
  let firstParagraph: string | undefined;
  /** Whose paragraph the lines being collected are: the summary section's, or the document's first. */
  let mode: "summary" | "first" | undefined = "first";
  let buffer: string[] = [];
  const commit = () => {
    if (buffer.length > 0 && mode !== undefined) {
      const para = plain(buffer.join(" "));
      if (mode === "summary") summary ??= para;
      else firstParagraph ??= para;
      mode = undefined;
    }
    buffer = [];
  };

  for (const [i, line] of lines.entries()) {
    const f = FENCE.exec(line);
    if (fence !== undefined) {
      if (f && f[1]?.[0] === fence[0] && (f[1]?.length ?? 0) >= fence.length) fence = undefined;
      continue;
    }
    if (f) {
      commit();
      fence = f[1];
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      commit();
      const headingText = plain(h[2] ?? "");
      title ??= headingText;
      if (summary === undefined && SUMMARY_HEADING.test(headingText)) mode = "summary";
      else if (mode !== "summary" && firstParagraph === undefined) mode = "first";
      continue;
    }
    words += line.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    const t = TASK.exec(line);
    if (t) {
      if (t[1] === " ") tasksOpen++;
      else tasksDone++;
    }
    const d = DECISION.exec(line);
    if (d && decisions.length < MAX_ITEMS) {
      const what = plain(d[1] ?? "");
      if (what.length > 0) decisions.push({ line: i, text: what });
    }
    if (WARNING.test(line)) warnings++;
    for (const m of line.matchAll(CODE_PATH)) if (codePaths.size < MAX_ITEMS && m[1]) codePaths.add(m[1]);
    for (const m of line.matchAll(MD_LINK)) {
      const href = m[1] ?? "";
      if (!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) && mdLinks.size < MAX_ITEMS) mdLinks.add(safeDecode(href));
    }
    // a paragraph is plain lines; a blank line ends it, a list / table / quote / rule / html line ends it too
    if (line.trim() === "") commit();
    else if (NOT_PROSE.test(line)) {
      if (buffer.length > 0) commit();
    } else if (mode !== undefined) buffer.push(line.trim());
  }
  commit();
  const tldr = summary ?? firstParagraph;
  return {
    ...(title !== undefined ? { title } : {}),
    ...(tldr ? { tldr } : {}),
    words,
    tasksOpen,
    tasksDone,
    decisions,
    warnings,
    codePaths: [...codePaths],
    mdLinks: [...mdLinks],
  };
}

/** Markdown inline marks out, whitespace collapsed, cut at `MAX_SNIPPET` characters. */
export function plain(markdown: string): string {
  const text = markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > MAX_SNIPPET ? `${text.slice(0, MAX_SNIPPET - 1)}…` : text;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The open checklist items of a document, as plain text (for "continue this plan"). Code blocks skipped. */
export function openTasks(text: string): string[] {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (fence !== undefined) {
      if (f && f[1]?.[0] === fence[0]) fence = undefined;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    const t = /^\s*(?:[-*+]|\d+[.)])\s+\[ \]\s+(.*)$/.exec(line);
    if (t && out.length < MAX_ITEMS) out.push(plain(t[1] ?? ""));
  }
  return out;
}

/** 3.0: the simple `key: value` lines of a file's front matter (scalars only; lists and nesting are skipped). */
export function frontMatter(text: string): { key: string; value: string }[] {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return [];
  const out: { key: string; value: string }[] = [];
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w -]{0,30}):\s*(.+?)\s*$/.exec(line);
    if (!kv || /^[[{|>]/.test(kv[2] ?? "")) continue;
    out.push({ key: kv[1] ?? "", value: (kv[2] ?? "").replace(/^["']|["']$/g, "").slice(0, 500) });
    if (out.length >= 40) break;
  }
  return out;
}
