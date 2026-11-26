import type { Heading } from "../outline/types";

/** The markers a generated table of contents sits between (kept up to date by "Update Table of Contents"). */
export const TOC_START = "<!-- toc -->";
export const TOC_END = "<!-- tocstop -->";

/** A nested Markdown list linking every heading from `minLevel` to `maxLevel` (the title h1 left out by default). */
export function buildToc(headings: readonly Heading[], minLevel = 2, maxLevel = 4): string {
  const shown = headings.filter((h) => !h.inferred && h.level >= minLevel && h.level <= maxLevel);
  const top = Math.min(...shown.map((h) => h.level));
  return shown
    .map((h) => `${"  ".repeat(h.level - top)}- [${h.text.replace(/[[\]]/g, "\\$&")}](#${h.id})`)
    .join("\n");
}

/**
 * Where the table of contents goes: the existing block between the markers (replaced), else right after the first
 * heading. Returns 0-based lines [start, end) to replace and the new lines.
 */
export function tocEdit(
  lines: readonly string[],
  headings: readonly Heading[],
  toc: string,
): { start: number; end: number; lines: string[] } {
  const block = [TOC_START, "", toc, "", TOC_END];
  const start = lines.findIndex((l) => l.trim() === TOC_START);
  const end = start === -1 ? -1 : lines.findIndex((l, i) => i > start && l.trim() === TOC_END);
  if (start !== -1 && end !== -1) return { start, end: end + 1, lines: block };
  const after = headings[0] ? headings[0].line + 1 : 0;
  return { start: after, end: after, lines: ["", ...block, ""] };
}
