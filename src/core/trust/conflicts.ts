/**
 * Facts stated as "key: value" or "key is value" (3.0 ⇄ conflicts): the same key with a different value in another
 * doc is a conflict. Pure. Keys are normalised (lower case, words only); values compared as normalised text.
 */
export interface KeyFact {
  readonly key: string;
  /** Normalised, for comparing. */
  readonly value: string;
  /** Plain-text label as written, for the hover. */
  readonly label: string;
  /** The value as written (emphasis marks dropped), for the hover — "2026-12-01", not "2026 12 01". */
  readonly shown: string;
}

/**
 * Fields every document has its own value for (owner report 2026-11-17: "Status: in progress" here and
 * "Status: draft" in the meeting notes are not a conflict — they describe different documents).
 */
const PER_DOCUMENT = new Set([
  "status",
  "state",
  "owner",
  "owners",
  "author",
  "authors",
  "assignee",
  "assignees",
  "reviewer",
  "reviewers",
  "approver",
  "approvers",
  "lead",
  "team",
  "contact",
  "deadline",
  "due",
  "due date",
  "date",
  "created",
  "updated",
  "last updated",
  "start",
  "start date",
  "end",
  "end date",
  "eta",
  "target date",
  "version",
  "priority",
  "progress",
  "phase",
  "type",
  "title",
  "id",
  "tags",
  "audience",
  "attendees",
]);

const KV =
  /^\s*(?:[-*+]\s+)?(?:\*\*|__)?([A-Za-z][\w /-]{1,40}?)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*([^\n]{1,80}?)\s*$/;
const IS_NUMBER =
  /\b(?:the\s+)?([a-z][a-z /-]{2,30}?)\s+(?:is|of|=)\s+(\d+(?:\.\d+)?\s?(?:ms|s|seconds?|minutes?|min|hours?|h|days?|%|kb|mb|gb|tb|req\/s|rps)?)\b/gi;
/** Labels that are headings of a list, not facts ("Note:", "Example:"). */
const NOT_FACTS = new Set([
  "note",
  "example",
  "tip",
  "warning",
  "important",
  "decision",
  "see",
  "e.g",
  "i.e",
  "todo",
  "question",
  "answer",
  "why",
  "how",
  "what",
  "step",
  "steps",
]);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9.% /]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function keyFacts(text: string): KeyFact[] {
  const out: KeyFact[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = KV.exec(line);
    if (m) {
      const key = norm(m[1] ?? "");
      const value = norm(m[2] ?? "");
      if (key && value && !skip(key) && key.split(" ").length <= 4 && value.split(" ").length <= 8)
        out.push({ key, value, label: (m[1] ?? "").trim(), shown: asWritten(m[2] ?? "") });
    }
    for (const n of line.matchAll(IS_NUMBER)) {
      const key = norm(n[1] ?? "");
      if (key && !skip(key))
        out.push({ key, value: norm(n[2] ?? ""), label: (n[1] ?? "").trim(), shown: asWritten(n[2] ?? "") });
    }
  }
  return out;
}

const skip = (key: string) => NOT_FACTS.has(key) || PER_DOCUMENT.has(key);
const asWritten = (s: string) => s.replace(/\*\*|__|`/g, "").trim();

export interface Conflict {
  readonly fact: KeyFact;
  /** Where the other value is stated (as written there). */
  readonly other: { readonly file: string; readonly value: string };
}

/** A document as the conflict check sees it: its path, its title, the docs it links to (workspace-relative). */
export interface DocRef {
  readonly file: string;
  readonly title?: string | undefined;
  readonly links: readonly string[];
}

/** A document's key facts, with what tells related documents apart. */
export interface FactsOfDoc extends DocRef {
  readonly facts: readonly KeyFact[];
}

/**
 * The documents `me` may be compared with: the ones it links to, the ones that link to it, and the ones with the
 * same title (two versions of one doc). Unrelated docs that happen to share a field name are left alone (owner
 * report 2026-11-17).
 */
export function relatedTo<T extends DocRef>(me: DocRef, all: readonly T[]): T[] {
  const title = me.title ? norm(me.title) : "";
  return all.filter(
    (o) =>
      o.file !== me.file &&
      (me.links.includes(o.file) ||
        o.links.includes(me.file) ||
        (title !== "" && o.title !== undefined && norm(o.title) === title)),
  );
}

/** The facts of `mine` that another doc states differently (each reported once, the first other doc wins). */
export function conflictsWith(
  mine: readonly KeyFact[],
  others: readonly { readonly file: string; readonly facts: readonly KeyFact[] }[],
): Conflict[] {
  const out: Conflict[] = [];
  for (const f of mine) {
    for (const o of others) {
      const hit = o.facts.find((x) => x.key === f.key && x.value !== f.value);
      if (hit) {
        out.push({ fact: f, other: { file: o.file, value: hit.shown } });
        break;
      }
    }
  }
  return out;
}
