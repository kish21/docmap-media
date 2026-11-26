/**
 * Near-duplicate Markdown files, found locally with no AI (2.0 Docs Inbox): word 5-gram shingles → a 64-value MinHash
 * signature per file → banding to find candidate pairs → the signatures' agreement estimates how alike two files are.
 * Linear in the number of files (plus the candidates), so thousands of files stay fast.
 */

export const SIGNATURE_SIZE = 64;
const BANDS = 16; // 16 bands × 4 rows: pairs above ~0.5 similar almost always meet in some band
const ROWS = SIGNATURE_SIZE / BANDS;
const SHINGLE_WORDS = 5;
/** Files with fewer words than this are never called duplicates (two short stubs look alike by accident). */
export const MIN_WORDS = 40;

export type Signature = readonly number[];

/** The file's MinHash signature, or undefined when it is too short to compare. */
export function signature(text: string): Signature | undefined {
  const words = text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (words.length < MIN_WORDS) return undefined;
  const sig = new Array<number>(SIGNATURE_SIZE).fill(0xffffffff);
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i++) {
    const h = fnv1a(words.slice(i, i + SHINGLE_WORDS).join(" "));
    for (let k = 0; k < SIGNATURE_SIZE; k++) {
      const v = mix(h ^ SEEDS[k]!);
      if (v < sig[k]!) sig[k] = v;
    }
  }
  return sig;
}

/** Estimated Jaccard similarity of the two files' shingle sets (0…1). */
export function similarity(a: Signature, b: Signature): number {
  let same = 0;
  for (let k = 0; k < SIGNATURE_SIZE; k++) if (a[k] === b[k]) same++;
  return same / SIGNATURE_SIZE;
}

export interface DuplicateGroup {
  /** The files' ids, in the order they were given. */
  readonly ids: readonly string[];
  /** The lowest pairwise similarity that joined the group (0…1). */
  readonly similarity: number;
}

/** Groups files whose similarity reaches `threshold` (connected: A~B and B~C put A, B, C together). */
export function duplicateGroups(
  files: readonly { readonly id: string; readonly signature: Signature | undefined }[],
  threshold: number,
): DuplicateGroup[] {
  const parent = files.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const weakest = new Map<number, number>();
  const seen = new Set<string>();
  for (let band = 0; band < BANDS; band++) {
    const buckets = new Map<string, number[]>();
    for (const [i, f] of files.entries()) {
      if (!f.signature) continue;
      const key = f.signature.slice(band * ROWS, band * ROWS + ROWS).join(",");
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }
    for (const bucket of buckets.values()) {
      for (let x = 0; x < bucket.length; x++)
        for (let y = x + 1; y < bucket.length; y++) {
          const a = bucket[x]!;
          const b = bucket[y]!;
          const pair = `${a},${b}`;
          if (seen.has(pair)) continue;
          seen.add(pair);
          const s = similarity(files[a]!.signature!, files[b]!.signature!);
          if (s < threshold) continue;
          const ra = find(a);
          const rb = find(b);
          const w = Math.min(s, weakest.get(ra) ?? 1, weakest.get(rb) ?? 1);
          parent[rb] = ra;
          weakest.set(ra, w);
        }
    }
  }
  const groups = new Map<number, number[]>();
  for (const i of files.keys()) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => ({ ids: members.map((i) => files[i]!.id), similarity: weakest.get(root) ?? 1 }))
    .sort((a, b) => b.similarity - a.similarity);
}

/** FNV-1a, 32-bit. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A 32-bit integer finaliser (murmur3 fmix32): spreads the seeded hashes. */
function mix(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const SEEDS: readonly number[] = Array.from({ length: SIGNATURE_SIZE }, (_, k) =>
  mix(0x9e3779b9 + k * 0x7f4a7c15),
);
