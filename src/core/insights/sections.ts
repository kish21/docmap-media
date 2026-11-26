import type { Heading } from "../outline/types";
import { fnv1a } from "./similarity";

/**
 * A fingerprint of each section's own text (heading line to the next heading), keyed by heading id — what the reader
 * saw, so the page can mark the sections that changed since (2.0, "what changed since I last read this"). Only
 * hashes are kept, never text. Text above the first heading is keyed "".
 */
export function sectionHashes(text: string, headings: readonly Heading[]): Record<string, number> {
  const lines = text.split(/\r?\n/);
  const out: Record<string, number> = {};
  const starts = headings.map((h) => h.line);
  const firstStart = starts[0] ?? lines.length;
  if (firstStart > 0) out[""] = fnv1a(lines.slice(0, firstStart).join("\n").trim());
  for (const [i, h] of headings.entries()) {
    const end = starts[i + 1] ?? lines.length;
    out[h.id] = fnv1a(lines.slice(h.line, end).join("\n").trim());
  }
  return out;
}

/** The headings whose section is new or different from `seen` (in document order). Nothing seen yet: none. */
export function changedSections(
  seen: Readonly<Record<string, number>> | undefined,
  now: Readonly<Record<string, number>>,
  headings: readonly Heading[],
): string[] {
  if (!seen) return [];
  return headings.filter((h) => seen[h.id] !== now[h.id]).map((h) => h.id);
}
