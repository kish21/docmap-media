import type { Heading } from "./types";

/** Where the query matched inside one heading's text (UTF-16 offsets, end exclusive). */
export interface FilterMatch {
  readonly start: number;
  readonly end: number;
}

export interface FilterResult {
  /** Heading id → where it matched. A heading absent from the map is hidden. */
  readonly matches: ReadonlyMap<string, FilterMatch>;
  readonly total: number;
}

/**
 * Filters headings by the text the user typed (headings only — `#Scope`: not full text).
 * Case-insensitive substring match on the visible heading text; surrounding whitespace in the query is ignored.
 * An empty query matches everything, with no highlight range.
 */
export function filterHeadings(headings: readonly Heading[], query: string): FilterResult {
  const q = query.trim().toLocaleLowerCase();
  const matches = new Map<string, FilterMatch>();
  for (const heading of headings) {
    if (q === "") {
      matches.set(heading.id, { start: 0, end: 0 });
      continue;
    }
    const match = findFolded(heading.text, q);
    if (match) matches.set(heading.id, match);
  }
  return { matches, total: headings.length };
}

/**
 * Case-insensitive search that reports offsets in the ORIGINAL text. The match itself is decided on the whole
 * lower-cased string (so context-sensitive rules like the Greek final sigma behave as for the query); the offsets
 * are then mapped back through a per-character map, because lower-casing can change the length ("İ" → 2 units).
 */
function findFolded(text: string, lowerQuery: string): FilterMatch | undefined {
  const lower = text.toLocaleLowerCase();
  const at = lower.indexOf(lowerQuery);
  if (at === -1) return undefined;
  const origin: number[] = []; // origin[i] = index in `text` of the character that produced lower[i]
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
    for (let k = 0; k < ch.toLocaleLowerCase().length; k++) origin.push(i);
    i += ch.length;
  }
  if (origin.length !== lower.length) return { start: 0, end: 0 }; // unmappable: still a match, no highlight
  const start = origin[at] ?? 0;
  const last = origin[at + lowerQuery.length - 1] ?? start;
  return { start, end: last + String.fromCodePoint(text.codePointAt(last) ?? 0).length };
}
