import { type DocKind, FORMATS } from "../insights/formats";
import { DOC_TYPES, type DocType, type DocTypeId } from "./templates";

/**
 * #37 New Doc's short list: a few known formats, each with one line on what it is for and a "read more" link.
 * Picking one writes its section headings only, no text. Only formats whose licence lets us credit them are offered
 * (see docs/doc-formats.md, #38); the others stay link-only and are used just to compare a doc's headings.
 */
export interface Starter {
  readonly id: string;
  readonly name: string;
  /** One line: what this format is for. */
  readonly purpose: string;
  /** The "read more" page (also the credit). */
  readonly source: string;
  /** The kind of doc it makes (decides the folder and numbering), if any. */
  readonly kind?: DocKind;
  /** Where the file goes when the kind gives no folder (`{slug}` = the title as a file name). */
  readonly file: string;
  /** Headings in order; "### " marks a sub-heading, anything else is a "## " section. */
  readonly headings: readonly string[];
  /**
   * docmap's own template in this same format (front matter and writing hints): picking the starter makes that one,
   * and "More doc types…" leaves it out, so each format is offered once (2026-11-22 review).
   */
  readonly docType?: DocTypeId;
}

const fromFormat = (id: string, purpose: string, file: string, docType?: DocTypeId): Starter | undefined => {
  const f = FORMATS.find((x) => x.id === id);
  return f
    ? {
        id,
        name: f.name,
        purpose,
        source: f.source,
        kind: f.kind,
        file,
        headings: f.parts.map((p) => p.heading),
        ...(docType ? { docType } : {}),
      }
    : undefined;
};

/** "More doc types…": docmap's templates that the short list does not already offer. */
export function moreDocTypes(): DocType[] {
  const covered = new Set(STARTERS.map((s) => s.docType));
  return DOC_TYPES.filter((t) => !covered.has(t.id));
}

/** Why a new doc cannot go at `rel` (workspace-relative), or undefined when it can. */
export function checkNewDocPath(rel: string): string | undefined {
  const p = rel.trim().replace(/\\/g, "/");
  if (!p) return "Give the file a name, for example docs/plans/checkout.md";
  if (!/\.md$/i.test(p)) return "The name must end in .md";
  if (/^[a-z]:/i.test(p) || p.startsWith("/"))
    return "Keep it inside the open folder: write a path like docs/x.md";
  const depth = p.split("/").reduce((d, part) => (d < 0 ? d : part === ".." ? d - 1 : d + 1), 0);
  if (depth < 0 || p.split("/").includes("..")) return "Keep it inside the open folder: no ../ in the path";
  return undefined;
}

export const STARTERS: readonly Starter[] = [
  fromFormat(
    "madr",
    "Record one decision: the options weighed and why one won",
    "docs/decisions/{slug}.md",
    "decision",
  ),
  fromFormat(
    "nygard",
    "A short decision record: context, decision, consequences",
    "docs/decisions/{slug}.md",
  ),
  fromFormat("rust-rfc", "Propose a change in detail before building it", "docs/rfcs/{slug}.md"),
  fromFormat(
    "spec-kit",
    "Describe a feature by what users do and how you know it works",
    "docs/specs/{slug}.md",
    "spec",
  ),
  {
    id: "keep-a-changelog",
    name: "Keep a Changelog",
    purpose: "List what changed in each release, newest first",
    source: "https://keepachangelog.com/",
    file: "CHANGELOG.md",
    headings: [
      "Unreleased",
      "### Added",
      "### Changed",
      "### Deprecated",
      "### Removed",
      "### Fixed",
      "### Security",
    ],
  },
].filter((s): s is Starter => s !== undefined);

/** A new doc of this format: the title and its section headings, nothing else. */
export function headingsOnly(starter: Starter, title: string): string {
  const lines = [`# ${title}`, ""];
  for (const h of starter.headings) lines.push(h.startsWith("### ") ? h : `## ${h}`, "");
  return `${lines.join("\n").trimEnd()}\n`;
}
