import type { Mismatch } from "./check";
import type { Conflict } from "./conflicts";

/**
 * One paragraph's trust state (3.0), from the evidence gathered for it. Mechanical evidence beats a stamp: a block
 * the user verified still shows ✗ if the repo now contradicts it. Order: mismatch, conflict, stale, superseded,
 * verified, none.
 */
export type TrustState = "mismatch" | "conflict" | "stale" | "superseded" | "verified" | "wrong" | "none";

export interface Stamp {
  /** "verified" or "wrong", by the user or their agent, at a time (ms). */
  readonly verdict: "verified" | "wrong";
  readonly at: number;
  readonly note?: string;
}

export interface Evidence {
  readonly mismatches?: readonly Mismatch[];
  readonly conflicts?: readonly Conflict[];
  /** When the paragraph's lines were last changed (git), and the newest change to a file it names. */
  readonly writtenAt?: number;
  readonly filesChangedAt?: { readonly path: string; readonly at: number }[];
  /** A newer document repeats this one (duplicates). */
  readonly supersededBy?: string;
  /** The user's or agent's stamp, if its text still matches the paragraph. */
  readonly stamp?: Stamp;
}

export interface Trust {
  readonly state: TrustState;
  readonly reasons: readonly string[];
}

/** Code changing this long after the paragraph was written makes it "may be stale" (a same-day edit does not). */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function trustOf(e: Evidence): Trust {
  const reasons: string[] = [];
  for (const m of e.mismatches ?? []) reasons.push(`✗ ${capital(m.reason)}.`);
  for (const c of e.conflicts ?? [])
    reasons.push(`⇄ Says ${c.fact.label} is "${c.fact.shown}"; ${c.other.file} says "${c.other.value}".`);
  const known = e.writtenAt !== undefined || e.stamp !== undefined;
  const since = Math.max(e.writtenAt ?? Number.NEGATIVE_INFINITY, e.stamp?.at ?? Number.NEGATIVE_INFINITY);
  const newer = known ? (e.filesChangedAt ?? []).filter((f) => f.at - since > STALE_AFTER_MS) : [];
  for (const f of newer.slice(0, 3))
    reasons.push(
      `⚠ ${f.path} changed ${days(f.at - since)} after this was ${e.stamp && e.stamp.at >= (e.writtenAt ?? 0) ? "verified" : "written"}.`,
    );
  if (e.supersededBy) reasons.push(`↺ A newer version of this doc exists: ${e.supersededBy}.`);
  if (e.stamp)
    reasons.push(
      `${e.stamp.verdict === "verified" ? "✓ Verified" : "✗ Marked wrong"} ${new Date(e.stamp.at).toISOString().slice(0, 10)}${e.stamp.note ? `: ${e.stamp.note}` : ""}.`,
    );
  // the reader's "verified" wins over ✗ and ⇄ (they checked it) until the code changes after they verified
  const state: TrustState =
    e.stamp?.verdict === "verified" && newer.length === 0
      ? "verified"
      : e.mismatches?.length
        ? "mismatch"
        : e.stamp?.verdict === "wrong"
          ? "wrong"
          : e.conflicts?.length
            ? "conflict"
            : newer.length
              ? "stale"
              : e.supersededBy
                ? "superseded"
                : "none";
  return { state, reasons };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function days(ms: number): string {
  const d = Math.round(ms / 86_400_000);
  return d <= 1 ? "a day" : d < 60 ? `${d} days` : `${Math.round(d / 30)} months`;
}
