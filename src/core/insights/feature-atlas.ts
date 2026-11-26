/**
 * Doc Atlas, per feature (owner calls 2026-11-23/24: "per feature, not one big atlas"; one diagram of 459 docs was
 * unreadable). Which docs are features, the code a doc names (found or gone), and a doc's code-details page: the docs
 * around it, its files and functions linked to the line, the names no longer in the code. The graph itself is
 * atlas-graph.ts. Direction is docs → the code they name, never code → code. Pure.
 */

import { isUnchecked, type RepoFacts } from "../trust/check";
import { declarationLine, parseCodeRef } from "../trust/code-refs";
import type { DocKind } from "./formats";
import { isArchivedPath } from "./inbox";

type Repo = Pick<RepoFacts, "hasPath" | "findPath" | "symbols" | "identifiers">;
const SPAN = /`([^`\n]{1,200})`/g;
/** At most this many code names per feature page. */
const MAX_CODE = 200;

/** The `code` spans of a doc, once each, as written. */
const spans = (text: string) => [...new Set([...text.matchAll(SPAN)].map((m) => (m[1] ?? "").trim()))];

/** #55 Cached code spans that parse as a code reference (capped at MAX_CODE) so atlasGraph() needs no re-reads. */
export function codeSpans(text: string): string[] {
  const out: string[] = [];
  for (const raw of spans(text)) {
    if (out.length >= MAX_CODE) break;
    if (parseCodeRef(raw)) out.push(raw);
  }
  return out;
}

/** The project files a doc names that exist (workspace-relative), so the caller can read them for function lines. */
export function namedFiles(text: string, repo: Repo): string[] {
  const out = new Set<string>();
  for (const raw of spans(text)) {
    const ref = parseCodeRef(raw);
    if (!ref?.path || isUnchecked(ref.path) || !repo.hasPath(ref.path)) continue;
    const rel = repo.findPath?.(ref.path);
    if (rel) out.add(rel);
  }
  return [...out];
}

/**
 * The files, functions and class names a feature doc names, each found in the code or not. `sources` holds the text
 * of the files the doc names: a function defined in one of them gets that file and line. A class-like word the code
 * does not have is left out (it may be plain prose); a function call or a path that is gone is reported.
 */
export function codeItemsIn(text: string, repo: Repo, sources: ReadonlyMap<string, string>): CodeItem[] {
  return codeItemsFromSpans(spans(text), repo, sources);
}

/** #55 Same as `codeItemsIn`, operating on pre-extracted code spans without re-reading the document. */
export function codeItemsFromSpans(
  rawSpans: readonly string[],
  repo: Repo,
  sources: ReadonlyMap<string, string>,
): CodeItem[] {
  const out: CodeItem[] = [];
  for (const raw of rawSpans) {
    if (out.length >= MAX_CODE) break;
    const ref = parseCodeRef(raw);
    if (!ref) continue;
    if (ref.path) {
      if (isUnchecked(ref.path)) continue;
      const found = repo.hasPath(ref.path);
      const file = found ? repo.findPath?.(ref.path) : undefined;
      out.push({
        name: raw,
        kind: "file",
        ...(file ? { file } : {}),
        ...(file && ref.line ? { line: ref.line } : {}),
        found,
      });
      continue;
    }
    const symbol = ref.symbol ?? "";
    const call = raw.endsWith("()");
    // not indexed: no claim either way
    const found = !repo.symbols || repo.symbols.has(symbol) || repo.identifiers?.has(symbol) === true;
    if (!found && !call) continue;
    let at: { file: string; line: number } | undefined;
    if (found)
      for (const [file, source] of sources) {
        const line = declarationLine(source, symbol);
        if (line !== undefined) {
          at = { file, line: line + 1 };
          break;
        }
      }
    out.push({ name: raw, kind: call ? "function" : "name", ...(at ?? {}), found });
  }
  return out;
}

/** At most this many docs drawn around a feature, so its diagram stays readable. */
export const MAX_AROUND = 12;

const FEATURE_FOLDER = /(?:^|\/)(?:features?|specs?|specifications?)\//i;
const FEATURE_KINDS: readonly DocKind[] = ["design", "spec"];

/** A doc describes a feature: it sits in a features / specs folder, or reads as a design or spec. Never archived. */
export function isFeatureDoc(path: string, kind: DocKind | undefined): boolean {
  if (isArchivedPath(path)) return false;
  return FEATURE_FOLDER.test(path) || (kind !== undefined && FEATURE_KINDS.includes(kind));
}

export interface FeatureDoc {
  /** Workspace-relative, "/" separated. */
  readonly path: string;
  readonly title: string;
  /** The doc's own summary or first paragraph (plain text); the list shows its first sentence. */
  readonly tldr?: string;
}

export interface CodeItem {
  /** As the doc writes it (`extract_prices()`, `backend/app/x.py:12`). */
  readonly name: string;
  /** A file, a function call (`name()`), or a class / type name. */
  readonly kind: "file" | "function" | "name";
  /** Workspace-relative file it opens (a function: the file that defines it, when known). */
  readonly file?: string;
  /** 1-based line. */
  readonly line?: number;
  /** False: the doc names it, the code no longer has it. */
  readonly found: boolean;
}

export interface FeaturePage extends FeatureDoc {
  /** Docs that link to this one, and docs it links to (workspace-relative). */
  readonly linksIn: readonly string[];
  readonly linksOut: readonly string[];
  readonly code: readonly CodeItem[];
}

const href = (file: string) => encodeURI(file).replace(/\(/g, "%28").replace(/\)/g, "%29");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const fileName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const code = (s: string) => `\`${s.replace(/`/g, "")}\``;
/** Text safe inside a Mermaid "quoted" label. */
const label = (text: string) => text.replace(/["#<>`]/g, (c) => `#${c.charCodeAt(0)};`);
/** A summary's first sentence, at most 160 characters (the atlas's one line "what it is"). */
export const firstSentence = (s: string): string => {
  const t = s.replace(/\s+/g, " ").trim();
  const m = /^(.+?[.!?])(?:\s|$)/.exec(t);
  const one = m?.[1] ?? t;
  return one.length > 160 ? `${one.slice(0, 159)}…` : one;
};

/** Which neighbours to draw: links out first (up to half), then links in, then the rest of the room. */
export function neighbours(
  linksIn: readonly string[],
  linksOut: readonly string[],
  max: number,
): { shownIn: string[]; shownOut: string[]; more: number } {
  const half = Math.floor(max / 2);
  const shownOut = linksOut.slice(0, Math.min(linksOut.length, Math.max(half, max - linksIn.length)));
  const shownIn = linksIn.slice(0, max - shownOut.length);
  return { shownIn, shownOut, more: linksIn.length + linksOut.length - shownIn.length - shownOut.length };
}

/** One feature's page: the docs around it (small diagram + list), its code by top folder, what is gone. */
export function featurePageMarkdown(page: FeaturePage): string {
  const lines = [`# ${page.title}`, ""];
  if (page.tldr) lines.push(`> ${cell(firstSentence(page.tldr))}`, "");
  lines.push(`[Open the doc](${href(page.path)}) · \`${page.path}\``, "");

  const linksIn = page.linksIn.filter((p) => p !== page.path);
  const linksOut = page.linksOut.filter((p) => p !== page.path);
  lines.push("## Docs around it", "");
  if (linksIn.length + linksOut.length === 0)
    lines.push("No other doc links to it, and it links to none.", "");
  else {
    const { shownIn, shownOut, more } = neighbours(linksIn, linksOut, MAX_AROUND);
    lines.push("```mermaid", "flowchart LR", `  me["${label(page.title)}"]`);
    for (const [i, p] of shownIn.entries()) lines.push(`  i${i}["${label(fileName(p))}"] --> me`);
    for (const [i, p] of shownOut.entries()) lines.push(`  me --> o${i}["${label(fileName(p))}"]`);
    lines.push("```", "");
    if (more > 0) lines.push(`_${more} more linked docs are listed below, not drawn._`, "");
    const list = (title: string, paths: readonly string[]) => {
      if (paths.length === 0) return;
      lines.push(
        `**${title}:**`,
        "",
        ...paths.map((p) => `- [${cell(fileName(p))}](${href(p)}) · \`${p}\``),
        "",
      );
    };
    list("Links to it", linksIn);
    list("It links to", linksOut);
  }

  const found = page.code.filter((c) => c.found);
  lines.push("## Code it names", "");
  if (found.length === 0) lines.push("The doc names no file or function the code has.", "");
  const top = (c: CodeItem) => (c.file ? (c.file.split("/")[0] ?? "") : "");
  const groups = [...new Set(found.map(top))].sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
  );
  for (const g of groups) {
    lines.push(`### ${cell(g || "Elsewhere in the code")}`, "", "| Code | What it is |", "|---|---|");
    for (const c of found.filter((x) => top(x) === g)) {
      const target = c.file ? `${href(c.file)}${c.line ? `#L${c.line}` : ""}` : undefined;
      const name = target ? `[${code(c.name)}](${target})` : code(c.name);
      const thing = c.kind === "function" ? "function" : "name";
      const what =
        c.kind !== "file"
          ? c.file
            ? `${thing} in ${code(c.file)}`
            : `${thing}, defined elsewhere in the code`
          : c.line
            ? `file, line ${c.line}`
            : "file";
      lines.push(`| ${cell(name)} | ${cell(what)} |`);
    }
    lines.push("");
  }

  const gone = page.code.filter((c) => !c.found);
  if (gone.length > 0) {
    lines.push(
      "## No longer in the code",
      "",
      "_The doc names these, but the code no longer has them: the doc may be out of date._",
      "",
      ...gone.map((c) => `- ${code(c.name)}`),
      "",
    );
  }
  return lines.join("\n");
}
