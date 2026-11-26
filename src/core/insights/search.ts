/**
 * 3.0 search across docs (owner call 2026-11-18): every match with the headings it sits under, so a result reads
 * "PRODUCT.md › Scope › Deferred" instead of a bare line number. Pure: text in, matches out. Case-insensitive,
 * plain text (no regular expressions from the user).
 */

export interface DocMatch {
  /** 0-based source line. */
  readonly line: number;
  /** The headings above the match, outermost first (empty before the first heading). */
  readonly trail: readonly string[];
  /** The matched line, trimmed and cut around the match. */
  readonly snippet: string;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const SNIPPET = 120;

/** The matches of `query` in one document, at most `max`. A query under 2 characters matches nothing. */
export function searchDoc(text: string, query: string, max: number): DocMatch[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2 || max <= 0) return [];
  const out: DocMatch[] = [];
  const trail: string[] = [];
  const levels: number[] = [];
  let fence: string | undefined;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const line = lines[i] ?? "";
    const f = FENCE.exec(line)?.[1];
    if (f && (!fence || f[0] === fence[0])) fence = fence ? undefined : f;
    const h = fence || f ? undefined : HEADING.exec(line);
    if (h) {
      const level = h[1]?.length ?? 1;
      while (levels.length && (levels[levels.length - 1] ?? 0) >= level) {
        levels.pop();
        trail.pop();
      }
      levels.push(level);
      trail.push(h[2] ?? "");
    }
    const at = line.toLowerCase().indexOf(q);
    if (at < 0) continue;
    out.push({ line: i, trail: h ? trail.slice(0, -1) : [...trail], snippet: cut(line, at, q.length) });
  }
  return out;
}

function cut(line: string, at: number, len: number): string {
  const start = Math.max(0, at - Math.floor((SNIPPET - len) / 2));
  const end = Math.min(line.length, start + SNIPPET);
  return `${start > 0 ? "…" : ""}${line.slice(start, end).trim()}${end < line.length ? "…" : ""}`;
}
