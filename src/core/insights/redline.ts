/**
 * 3.0 Rendered redline: what changed between two versions of a document, block by block (a paragraph, a list, a
 * table…) and, inside a changed block, word by word. Pure: the host aligns the blocks of the two sources; the page
 * marks the rendered blocks and wraps the changed words.
 */

export interface BlockAlignment {
  /** New block indexes with no counterpart in the old version. */
  readonly added: readonly number[];
  /** [new block, old block] pairs that are the same block, edited. */
  readonly changed: readonly (readonly [number, number])[];
  /** [new block it was before (or the new block count, for "at the end"), old block] — gone from the new version. */
  readonly removed: readonly (readonly [number, number])[];
}

export type WordOp = { readonly kind: "same" | "add" | "del"; readonly text: string };

/** Above this many blocks (either side) the alignment pairs blocks greedily instead of the exact LCS. */
export const MAX_LCS_BLOCKS = 3000;
/** Above this many words (either side) a changed block is shown as replaced whole, not word by word. */
export const MAX_DIFF_WORDS = 3000;
/** Two edited blocks are "the same block, changed" when at least this share of their words survive (0…1). */
export const SAME_BLOCK_SIMILARITY = 0.4;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (s: string) => norm(s).toLowerCase().split(" ").filter(Boolean);

/** Longest common subsequence of two lists, as index pairs (classic DP; callers cap the sizes). */
function lcs<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i * width + j] = eq(a[i] as T, b[j] as T)
        ? (table[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i] as T, b[j] as T)) {
      out.push([i, j]);
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) i++;
    else j++;
  }
  return out;
}

/** Share of words two texts have in common (multiset overlap over the longer one). */
export function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 && wb.length === 0) return 1;
  const count = new Map<string, number>();
  for (const w of wa) count.set(w, (count.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wb) {
    const c = count.get(w) ?? 0;
    if (c > 0) {
      common++;
      count.set(w, c - 1);
    }
  }
  return common / Math.max(wa.length, wb.length);
}

/** Aligns the blocks of an old and a new version (their source texts, in order). */
export function alignBlocks(oldBlocks: readonly string[], newBlocks: readonly string[]): BlockAlignment {
  const a = oldBlocks.map(norm);
  const b = newBlocks.map(norm);
  const anchors =
    a.length <= MAX_LCS_BLOCKS && b.length <= MAX_LCS_BLOCKS ? lcs(a, b, (x, y) => x === y) : greedy(a, b);
  const added: number[] = [];
  const changed: [number, number][] = [];
  const removed: [number, number][] = [];
  let oi = 0;
  let ni = 0;
  for (const [ao, an] of [...anchors, [a.length, b.length] as [number, number]]) {
    // the gap between two unchanged blocks: pair edited blocks in order, the rest were added / removed
    let o = oi;
    for (let n = ni; n < an; n++) {
      let match = -1;
      for (let k = o; k < ao; k++)
        if (similarity(a[k] ?? "", b[n] ?? "") >= SAME_BLOCK_SIMILARITY) {
          match = k;
          break;
        }
      if (match < 0) {
        added.push(n);
        continue;
      }
      for (let k = o; k < match; k++) removed.push([n, k]);
      changed.push([n, match]);
      o = match + 1;
    }
    for (let k = o; k < ao; k++) removed.push([an, k]);
    oi = ao + 1;
    ni = an + 1;
  }
  return { added, changed, removed };
}

/** Very large documents: blocks that appear exactly once on both sides anchor the alignment, in order. */
function greedy(a: readonly string[], b: readonly string[]): [number, number][] {
  const where = new Map<string, number>();
  for (const [i, s] of a.entries()) where.set(s, where.has(s) ? -1 : i);
  const out: [number, number][] = [];
  let last = -1;
  for (const [j, s] of b.entries()) {
    const i = where.get(s);
    if (i !== undefined && i > last) {
      out.push([i, j]);
      last = i;
    }
  }
  return out;
}

/** Word-level diff of two plain texts. Whitespace stays with the word before it, so joining the ops gives the text. */
export function wordDiff(before: string, after: string): WordOp[] {
  const a = before.match(/\S+\s*|\s+/g) ?? [];
  const b = after.match(/\S+\s*|\s+/g) ?? [];
  if (a.length > MAX_DIFF_WORDS || b.length > MAX_DIFF_WORDS)
    return [
      ...(before ? [{ kind: "del" as const, text: before }] : []),
      ...(after ? [{ kind: "add" as const, text: after }] : []),
    ];
  const pairs = lcs(a, b, (x, y) => x.trim() === y.trim());
  const ops: WordOp[] = [];
  const push = (kind: WordOp["kind"], text: string) => {
    const last = ops.at(-1);
    if (last?.kind === kind) ops[ops.length - 1] = { kind, text: last.text + text };
    else ops.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    while (i < pi) push("del", a[i++] ?? "");
    while (j < pj) push("add", b[j++] ?? "");
    if (pi < a.length && pj < b.length) push("same", b[j] ?? "");
    i = pi + 1;
    j = pj + 1;
  }
  return ops;
}
