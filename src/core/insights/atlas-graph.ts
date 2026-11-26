/**
 * Doc Atlas as a graph you walk (owner call 2026-11-24, after a sample on MarkVid's real links): one doc in the middle,
 * the docs that link to it on the left, the docs it links to on the right, the code files it names below; click any
 * box to move there. This file builds the page's data and its layout numbers. Pure.
 */

/** A doc as the graph page receives it (short keys: the page holds every doc of a big project). */
export interface AtlasNode {
  /** Workspace-relative path, "/" separated. */
  readonly p: string;
  /** Title. */
  readonly t: string;
  /** One line: what it is. */
  readonly w: string;
  /** A feature doc. */
  readonly f: boolean;
  /** Docs it links to. */
  readonly l: readonly string[];
  /** Code files it names that exist. */
  readonly c: readonly string[];
  /** How many names it gives that the code no longer has. */
  readonly g: number;
}

export interface AtlasGraph {
  readonly docs: readonly AtlasNode[];
  /** The doc shown first: the first feature by title, else the first doc. */
  readonly start?: string;
  /**
   * Opened from this doc's page (owner report 2026-11-24): the feature list starts folded, so the doc's own map has
   * the room — beside the doc, at half width, the list took most of the panel and it looked like the general map.
   */
  readonly forDoc?: boolean;
}

export interface AtlasInput {
  readonly path: string;
  readonly title: string;
  readonly what?: string;
  readonly links: readonly string[];
  readonly code: readonly string[];
  readonly gone: number;
  readonly feature: boolean;
}

/** Limits that keep the page small on any project. */
const MAX_DOCS = 5000;
const MAX_LINKS = 200;
const MAX_CODE = 30;
const MAX_TEXT = 200;
/** Docs drawn a side at most; the last box says how many more. */
export const MAX_SIDE = 8;
/** Box width plus gap for code boxes. */
const CODE_STEP = 175;
const ROW_STEP = 52;

const cut = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);

export function atlasGraph(input: readonly AtlasInput[]): AtlasGraph {
  const docs = input.slice(0, MAX_DOCS);
  const known = new Set(docs.map((d) => d.path));
  const nodes: AtlasNode[] = docs.map((d) => ({
    p: d.path,
    t: cut(d.title),
    w: cut(d.what ?? ""),
    f: d.feature,
    l: [...new Set(d.links)].filter((l) => l !== d.path && known.has(l)).slice(0, MAX_LINKS),
    c: [...new Set(d.code)].slice(0, MAX_CODE),
    g: d.gone,
  }));
  const first = [...nodes].filter((n) => n.f).sort((a, b) => a.t.localeCompare(b.t))[0] ?? nodes[0];
  return { docs: nodes, ...(first ? { start: first.p } : {}) };
}

/** The boxes of one side: up to MAX_SIDE docs, the last one "N more" when they do not fit. */
export function fitNeighbours(paths: readonly string[]): ({ path: string } | { more: number })[] {
  if (paths.length <= MAX_SIDE) return paths.map((path) => ({ path }));
  return [...paths.slice(0, MAX_SIDE - 1).map((path) => ({ path })), { more: paths.length - MAX_SIDE + 1 }];
}

/** Vertical centres for `count` boxes in a column around `middle`, within `height`. */
export function columnY(count: number, middle: number, height: number): number[] {
  const gap = Math.min(54, (height - 60) / Math.max(1, count));
  return Array.from({ length: count }, (_, i) => middle + (i - (count - 1) / 2) * gap);
}

/** Centres for `count` code boxes in rows that fit `width`, centred on `middle`, the first row at `top`. */
export function codeGrid(
  count: number,
  width: number,
  middle: number,
  top: number,
): { x: number; y: number }[] {
  const perRow = Math.max(1, Math.floor((width - 40) / CODE_STEP));
  return Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, count - row * perRow);
    return { x: middle + ((i % perRow) - (inRow - 1) / 2) * CODE_STEP, y: top + row * ROW_STEP };
  });
}
