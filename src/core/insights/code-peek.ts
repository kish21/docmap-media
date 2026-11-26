/**
 * Easy reading (2026-11-24): the code shown when the reader points at a code name or a code link in a doc — the
 * lines around the line it names, or, with no line, the file's functions and classes. Pure; the host reads the file.
 */

export interface CodePeek {
  /** Workspace-relative path, "/" separated. */
  readonly path: string;
  /** 1-based line the doc names, if it names one. */
  readonly line?: number;
  /** Lines in the file. */
  readonly total: number;
  readonly kind: "at" | "outline";
  /** [1-based line number, text, is the named line]. */
  readonly rows: readonly (readonly [number, string, boolean])[];
}

/** Rows shown around a named line: two above, the rest below. */
const ABOVE = 2;
const ROWS = 12;
/** Functions and classes listed at most, without a line. */
const OUTLINE = 14;
const WIDTH = 160;
const DEFINITION =
  /^\s*(?:(?:async\s+)?def\s+\w|class\s+\w|(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\w|export\s+(?:const|let|class|interface|type|enum)\s+\w|func\s+\w|fn\s+\w|pub\s+fn\s+\w)/;

export function peekAt(source: string, path: string, line: number | undefined): CodePeek {
  const lines = source.split(/\r?\n/);
  const cut = (s: string) => (s.length > WIDTH ? `${s.slice(0, WIDTH - 1)}…` : s);
  if (line !== undefined && line > 0) {
    const at = Math.min(line, lines.length);
    const from = Math.max(1, Math.min(at - ABOVE, lines.length - ROWS + 1));
    const rows = lines
      .slice(from - 1, from - 1 + ROWS)
      .map((t, i) => [from + i, cut(t), from + i === at] as const);
    return { path, line: at, total: lines.length, kind: "at", rows };
  }
  const rows = lines
    .flatMap((t, i) => (DEFINITION.test(t) ? [[i + 1, cut(t.trim()), false] as const] : []))
    .slice(0, OUTLINE);
  return { path, total: lines.length, kind: "outline", rows };
}
