/**
 * The doc map (3.0): a section for AGENTS.md / CLAUDE.md that tells AI agents where each kind of doc lives and which
 * shape it follows — the team's own template or shared shape first, else a named public format. Pure: the extension
 * gathers the facts, this writes the text and puts it between docmap's markers (replacing only that part).
 */

import { DOC_TYPES } from "../authoring/templates";
import { type DocKind, formatsOf, kindInfo } from "./formats";

export const MAP_START = "<!-- docmap:doc-map start -->";
export const MAP_END = "<!-- docmap:doc-map end -->";

export interface DocMapEntry {
  readonly kind: DocKind;
  /** The folder the team uses (relative, no trailing slash); undefined = none yet. */
  readonly folder?: string | undefined;
  /** How many docs of this kind docmap found. */
  readonly count: number;
  /** The team's shape: a template path, or "N docs in <folder>" with its headings. */
  readonly team?: { readonly from: string; readonly headings: readonly string[] } | undefined;
}

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** Kinds an agent must read before it builds (#34). */
const BUILD_FROM: readonly DocKind[] = ["design", "architecture", "design-system"];

/**
 * #34: agents code without the design doc because nobody told them about it. When the project has design docs,
 * the map opens with one line pointing at them; none → no line (nothing to read).
 */
export function beforeBuildingLine(entries: readonly DocMapEntry[]): string | undefined {
  const places = entries
    .filter((e) => e.count > 0 && BUILD_FROM.includes(e.kind))
    .map((e) => {
      const single = kindInfo(e.kind).single;
      return single ? `\`${single}\`` : e.folder ? `\`${e.folder}/\`` : undefined;
    })
    .filter((p): p is string => p !== undefined);
  if (!places.length) return undefined;
  return (
    `**Before building:** read the design doc(s) in ${places.join(", ")} first and build to them. ` +
    "If the code has to differ from a design doc, say where and why."
  );
}

/** One row per kind: where it goes and the shape to follow. */
export function docMapSection(entries: readonly DocMapEntry[]): string {
  const before = beforeBuildingLine(entries);
  const rows = entries.map((e) => {
    const info = kindInfo(e.kind);
    const where = info.single
      ? `\`${info.single}\`${e.count ? "" : " (suggested; none yet)"}`
      : e.folder
        ? `\`${e.folder}/\`${e.count ? ` (${e.count} doc${e.count === 1 ? "" : "s"})` : ""}`
        : `\`${info.folders[0]}/\` (suggested; none yet)`;
    const named = formatsOf(e.kind)[0];
    const suggested = DOC_TYPES.find((t) => t.id === info.docType);
    const shape = e.team
      ? `The team's format, from \`${e.team.from}\`: ${e.team.headings.join(" · ")}`
      : named
        ? `[${named.name}](${named.source}): ${named.parts
            .filter((p) => p.required)
            .map((p) => p.heading)
            .join(" · ")}`
        : suggested
          ? `docmap's suggested template (no single standard exists): ${suggested.sections.map(([h]) => h).join(" · ")}`
          : "Free form";
    return `| ${info.label} | ${cell(where)} | ${cell(shape)} |`;
  });
  return [
    MAP_START,
    "## Doc map",
    "",
    ...(before ? [before, ""] : []),
    "Where each kind of doc lives and the shape it follows. Put a new doc in its place, in that shape: these are",
    "suggestions, not rules — adapt a section when the doc needs it. The team's own template wins (add it as",
    '`docs/templates/<kind>.md`, e.g. `docs/templates/runbook.md`). Written by docmap ("Write Doc Map for Agents");',
    "run it again to refresh.",
    "",
    "| Kind | Where | Shape to follow |",
    "|---|---|---|",
    ...rows,
    MAP_END,
  ].join("\n");
}

/** The file with the doc map put in: replaces an earlier map between the markers, else adds it at the end. */
export function withDocMap(fileText: string, section: string): string {
  const start = fileText.indexOf(MAP_START);
  const end = fileText.indexOf(MAP_END, start + 1);
  if (start >= 0 && end > start)
    return fileText.slice(0, start) + section + fileText.slice(end + MAP_END.length);
  const body = fileText.replace(/\s*$/, "");
  return body ? `${body}\n\n${section}\n` : `${section}\n`;
}

/** A CLAUDE.md that already pulls in AGENTS.md (`@AGENTS.md`) needs no copy of its own. */
export const importsAgents = (claudeText: string): boolean => /(^|\s)@\.?\/?AGENTS\.md\b/m.test(claudeText);
