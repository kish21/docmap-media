/**
 * Easy reading (owner call 2026-11-24, after a sample on MarkVid's ad-format-dialogue.md): where a long doc stands,
 * read from the doc itself by rules — no AI. Its parts ("7. V3-a — the contract") with their newest state, the story
 * in date order, each top section's state and first sentence, and a warning when the Status line at the top still
 * talks about a built part as not done. Also where to cut a long paragraph after two sentences. Pure.
 */

import type { Heading } from "../outline/types";

/** Markdown marks out, the whole text kept (analyze's `plain` shortens long text; a Status line must stay whole). */
const plain = (s: string) =>
  s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/(^|\W)[*_](\S[^*_]*\S|\S)[*_](?=\W|$)/g, "$1$2");

export type PartState = "built" | "decided" | "draft" | "changed";

export interface StandingPart {
  /** "V3-a", "Phase 2" … */
  readonly label: string;
  /** From the part's first section: "the contract". */
  readonly name: string;
  readonly state: PartState;
  /** YYYY-MM-DD, when the doc gives one. */
  readonly date?: string;
  /** The part's first section, for a link. */
  readonly headingId: string;
  /** Its build record, as a link from this doc (set by the host from `recordsFor`). */
  readonly record?: { readonly href: string; readonly title: string };
}

export interface StandingEvent {
  readonly date: string;
  /** The part label, or "Decided". */
  readonly label: string;
  readonly what: string;
  readonly state: PartState;
  readonly headingId: string;
}

export interface StandingSection {
  readonly headingId: string;
  readonly title: string;
  readonly state?: PartState;
  readonly date?: string;
  /** The section's first sentence of prose (plain text), if it has one. */
  readonly first?: string;
}

export interface Standing {
  /** The Status line as written, as plain text (absent: the doc has none). */
  readonly status?: string;
  readonly parts: readonly StandingPart[];
  readonly events: readonly StandingEvent[];
  readonly sections: readonly StandingSection[];
  /** Plain-words warnings: the Status line disagrees with the sections. */
  readonly disagree: readonly string[];
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const ISO = /\b(20\d\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/g;
/** "**Status:** …" or "Status: …" near the top, up to the first blank line. */
/** Also inside a note box: "> - **Status:** done — …" (what "Make this easy to read" writes). */
const STATUS = /^\s*(?:>\s*)*(?:[-*]\s+)?(?:\*\*|__)?status:?(?:\*\*|__)?:?\s*(.+)$/i;
/** "7. V3-a — the contract", "Phase 2: rollout", "M1 – discovery" (an optional section number first). */
const PART =
  /^(?:\d+(?:\.\d+)*[.)]?\s+)?((?:[A-Z]{1,4}\d[\w.-]*)|(?:phase|stage|step|milestone|part|slice|session|wave)\s+[\w.-]+)\s+[—–:-]\s+(.+)$/i;
const STATES: readonly [RegExp, PartState][] = [
  [/\b(built|shipped|live|done|merged|complete[d]?)\b|✅/i, "built"],
  [/\b(decided|decisions?)\b/i, "decided"],
  [/\b(draft|awaiting|proposed|planned|not built)\b/i, "draft"],
  [/\brevised\b/i, "changed"],
];
/** Words that end in a full stop without ending a sentence. */
const NOT_AN_END = /\b(e\.g|i\.e|etc|vs|cf|approx|no|fig|v\d+(\.\d+)*)\.$/i;
/** A long paragraph: this many words or more. */
const LONG_WORDS = 70;
/** Fold only when at least this many words would go behind "more". */
const MIN_FOLDED = 25;

const stateOf = (text: string): PartState | undefined => STATES.find(([re]) => re.test(text))?.[1];
const lastDate = (texts: readonly string[]): string | undefined =>
  texts.flatMap((t) => [...t.matchAll(ISO)].map((m) => m[1] as string)).at(-1);
const cleanName = (s: string) =>
  s
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+[—–-]\s+\*{0,2}(revised|built|draft|decided)\b.*$/i, "")
    .trim();

export function standing(text: string, headings: readonly Heading[]): Standing {
  const lines = text.split(/\r?\n/);
  const inFence = fenceMask(lines);
  const top = headings.filter((h) => h.level === 2 && !inFence[h.line]);
  const status = statusLine(lines, inFence, headings);

  const sections: (StandingSection & { label?: string; name?: string })[] = top.map((h, i) => {
    const end = top[i + 1]?.line ?? lines.length;
    const subs = headings.filter((s) => s.level > 2 && s.line > h.line && s.line < end).map((s) => s.text);
    // newest first: a later "BUILT" sub-heading beats an earlier "DRAFT" in the section's own heading
    const built = [...subs].reverse().find((s) => stateOf(s) === "built");
    const state = built ? "built" : stateOf(h.text);
    const date = built ? (lastDate([built]) ?? lastDate([h.text])) : lastDate([h.text, ...subs]);
    const part = PART.exec(h.text);
    return {
      headingId: h.id,
      title: h.text,
      ...(state ? { state } : {}),
      ...(date ? { date } : {}),
      ...firstSentence(lines, h.line + 1, end, inFence),
      ...(part ? { label: part[1] as string, name: cleanName(part[2] as string) } : {}),
    };
  });

  // a part: its name from its first section, its state and date from its newest section that has one
  const parts = new Map<string, StandingPart>();
  for (const s of sections) {
    const label = s.label ?? sections.find((x) => x.label && s.title.includes(x.label) && x !== s)?.label;
    if (!label) continue;
    const first = parts.get(label);
    let state = s.state;
    let date = s.date;
    // no state in the headings: the Status line may say it ("V3-b-1 BUILT 2026-08-21", "V3-b-1 and V3-b-2 built …")
    const said = status ? saidBuilt(status, label) : undefined;
    if (!state && said) {
      state = "built";
      date = said.date ?? date;
    }
    if (!state) continue;
    parts.set(label, {
      label,
      name: first?.name ?? s.name ?? s.title,
      state,
      ...(date ? { date } : first?.date ? { date: first.date } : {}),
      headingId: first?.headingId ?? s.headingId,
    });
  }

  const events: StandingEvent[] = [];
  for (const s of sections)
    if (s.state === "decided" && s.date && !s.label)
      events.push({
        date: s.date,
        label: "Decided",
        // "6. Owner's decisions (2026-08-18) — these are now the spec" → "Owner's decisions"
        what: s.title
          .replace(/^\d+[.)]\s+/, "")
          .replace(/\s*\([^)]*\)/g, "")
          .split(/\s+[—–]\s+/)[0] as string,
        state: "decided",
        headingId: s.headingId,
      });
  for (const p of parts.values())
    if (p.date)
      events.push({ date: p.date, label: p.label, what: p.name, state: p.state, headingId: p.headingId });
  events.sort((a, b) => a.date.localeCompare(b.date));

  const disagree: string[] = [];
  if (status)
    for (const p of parts.values()) {
      if (p.state !== "built" || !status.includes(p.label)) continue;
      if (saidBuilt(status, p.label)) continue;
      const where = sections.filter((s) => s.label === p.label && s.state === "built").at(-1);
      const number = where?.title.match(/^(\d+)/)?.[1];
      disagree.push(
        `The Status line at the top still talks about ${p.label} as not done, but ${number ? `section ${number}` : "its section"} says built${p.date ? ` ${p.date}` : ""}.`,
      );
    }

  return {
    ...(status ? { status } : {}),
    parts: [...parts.values()],
    events,
    sections: sections.map(({ label: _l, name: _n, ...s }) => s),
    disagree,
  };
}

/**
 * Whether the Status line says this part is built: in one clause (between ";", "·", "—" or a full stop), the part,
 * then "built" / "shipped" / "done" / "live" after it — "V3-a BUILT 2026-08-18" or "V3-b-1, V3-b-2 and V3-b-3 built
 * 2026-08-21". The date is the first one after the part in that clause.
 */
function saidBuilt(status: string, label: string): { date?: string } | undefined {
  const part = new RegExp(`(^|[^\\w-])${escapeRe(label)}(?![\\w-])`);
  for (const clause of status.split(/\s*(?:;|·|—|\.\s)\s*/)) {
    const at = part.exec(clause);
    if (!at) continue;
    const after = clause.slice(at.index + at[0].length);
    if (!/\b(built|shipped|done|live)\b/i.test(after)) continue;
    const date = /\b(20\d\d-\d\d-\d\d)\b/.exec(after)?.[1];
    return date ? { date } : {};
  }
  return undefined;
}

/** A doc that links to this one (a build record, a review), as the host read it. */
export interface BackLink {
  /** Workspace-relative path. */
  readonly path: string;
  readonly title?: string;
  readonly text: string;
}

/**
 * Each part's build record (owner sample 2026-11-24: records 127/141/142/144 on the timeline): the record the Status
 * line names next to "PART BUILT", else a doc that links back to this one and whose newest part it mentions is this
 * one. A record named for one part is never given to another. Paths are workspace-relative.
 */
export function recordsFor(
  s: Standing,
  backLinks: readonly BackLink[],
  known: readonly string[],
): Map<string, { readonly path: string; readonly title: string }> {
  const out = new Map<string, { path: string; title: string }>();
  const order = s.parts.map((p) => p.label);
  const status = s.status ?? "";
  const segments = status.split(/\s+·\s+|\s*;\s+/);
  const named = new Map<string, string>();
  for (const label of order) {
    const seg = segments.find((x) =>
      new RegExp(`\\b${escapeRe(label)}\\s+(built|shipped|done)\\b`, "i").test(x),
    );
    const ref = seg?.match(/([\w./-]+\.md)\b/)?.[1];
    const hit = ref ? known.find((k) => k === ref || k.endsWith(`/${ref.replace(/^\.?\//, "")}`)) : undefined;
    if (hit) named.set(label, hit);
  }
  const claimed = new Set(named.values());
  const titleOf = (p: string) => backLinks.find((b) => b.path === p)?.title ?? p.split("/").pop() ?? p;
  for (const label of order) {
    const own = named.get(label);
    const back =
      own ??
      backLinks.find((b) => {
        if (claimed.has(b.path)) return false;
        const mentioned = order.filter((l) => new RegExp(`(^|[^\\w-])${escapeRe(l)}(?![\\w-])`).test(b.text));
        return mentioned.at(-1) === label;
      })?.path;
    if (back) {
      out.set(label, { path: back, title: titleOf(back) });
      claimed.add(back);
    }
  }
  return out;
}

/**
 * Where to cut a long paragraph so the reader sees its first two sentences (an index into `text`), or undefined
 * when it is short, has fewer than three sentences, or little would be folded away.
 */
export function cutPoint(text: string): number | undefined {
  if (words(text) < LONG_WORDS) return undefined;
  let seen = 0;
  for (const m of text.matchAll(/[.!?](?=\s+\S)/g)) {
    const at = (m.index ?? 0) + 1;
    if (NOT_AN_END.test(text.slice(Math.max(0, at - 12), at))) continue;
    if (++seen === 2) return words(text.slice(at)) >= MIN_FOLDED ? at : undefined;
  }
  return undefined;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function fenceMask(lines: readonly string[]): boolean[] {
  const mask: boolean[] = [];
  let fence: string | undefined;
  for (const line of lines) {
    const f = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      mask.push(true);
      if (f && f[0] === fence[0] && f.length >= fence.length) fence = undefined;
    } else if (f) {
      fence = f;
      mask.push(true);
    } else mask.push(false);
  }
  return mask;
}

/** The Status line before the first section (it may run over several lines, to the first blank one). */
function statusLine(
  lines: readonly string[],
  inFence: readonly boolean[],
  headings: readonly Heading[],
): string | undefined {
  const stop = headings.find((h) => h.level >= 2)?.line ?? lines.length;
  for (let i = 0; i < stop; i++) {
    const m = !inFence[i] ? STATUS.exec(lines[i] ?? "") : null;
    if (!m) continue;
    const parts = [m[1] as string];
    // in a note box the Status is one "> - " item: it goes on over "> " lines until the box's next item
    const boxed = /^\s*>/.test(lines[i] ?? "");
    for (let j = i + 1; j < stop && (lines[j] ?? "").trim() !== ""; j++) {
      const next = lines[j] as string;
      if (boxed && (!/^\s*>/.test(next) || /^\s*>\s*([-*+]|\d+[.)])\s/.test(next))) break;
      parts.push(boxed ? next.replace(/^\s*>\s?/, "") : next);
    }
    return plain(parts.join(" ")).replace(/\s+/g, " ").trim();
  }
  return undefined;
}

/** The first sentence of the section's first prose paragraph (not a table, list, quote or code). */
function firstSentence(
  lines: readonly string[],
  from: number,
  to: number,
  inFence: readonly boolean[],
): { first?: string } {
  for (let i = from; i < to; i++) {
    const line = lines[i] ?? "";
    if (inFence[i] || !line.trim() || /^\s*(#|\||>|[-*+]\s|\d+[.)]\s|<!--)/.test(line)) continue;
    const para: string[] = [];
    for (let j = i; j < to && (lines[j] ?? "").trim() && !inFence[j]; j++) para.push(lines[j] as string);
    const text = plain(para.join(" ")).replace(/\s+/g, " ").trim();
    const end = /[.!?](?=\s|$)/.exec(text);
    return { first: (end ? text.slice(0, end.index + 1) : text).slice(0, 200) };
  }
  return {};
}
