/**
 * Named doc formats (3.0): recognise what kind of doc a file is, name the recognised format it follows, and list the
 * parts a chosen format has that the doc does not. Pure, no AI, no score: a doc in another style is never "wrong",
 * and a team's own format (its template, or the shape its existing docs share) always wins over a public standard.
 * The kinds and formats themselves are data in `formats.ts`.
 */

import { type DocKind, FORMATS, KINDS, type KindInfo, type NamedFormat, type Part } from "./formats";

export type { DocKind, NamedFormat, Part } from "./formats";
export { FORMATS, formatsOf, KINDS, kindInfo } from "./formats";

/** "## 2. **Requirements** *(mandatory)*:" → "requirements" (numbers, marks, notes and trailing colon dropped). */
export function normHeading(text: string): string {
  return text
    .replace(/\{#[^}]*\}\s*$/, "")
    .replace(/[*_`]/g, "")
    .replace(/^\s*(?:\d+(?:\.\d+)*\.?|[ivx]+\.)\s+/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/[:\s]+$/, "")
    .trim()
    .toLowerCase();
}

/** The doc's `##`/`###` headings, normalised; fenced code skipped. */
export function sectionHeadings(text: string): string[] {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f?.[1]) {
      const mark = f[1];
      if (!fence) fence = mark[0] as string;
      else if (mark[0] === fence) fence = undefined;
      continue;
    }
    if (fence) continue;
    const h = /^\s{0,3}#{2,3}\s+(.*?)\s*#*\s*$/.exec(line);
    if (h?.[1]) out.push(normHeading(h[1]));
  }
  return out;
}

const has = (headings: readonly string[], part: Part): boolean => {
  const names = [part.heading.toLowerCase(), ...(part.alsoCalled ?? [])];
  return headings.some((h) => names.includes(h));
};

const TEMPLATE_FILE = /(?:^|\/)(?:templates?\/[^/]*|[^/]*template[^/]*)\.md$/i;
export const isTemplate = (path: string): boolean => TEMPLATE_FILE.test(path);

/** The kind a path alone says (its folder first, then its file name); undefined = the path says nothing. */
export function kindFromPath(path: string): DocKind | undefined {
  if (isTemplate(path)) return undefined;
  return (KINDS.find((k) => k.folder.test(path)) ?? KINDS.find((k) => k.file?.test(path)))?.kind;
}

export const kindFromType = (type: string | undefined): DocKind | undefined => {
  const t = type?.trim().toLowerCase();
  return t ? KINDS.find((k) => k.types.includes(t))?.kind : undefined;
};

/** The first named format of `kind` (or of any kind) whose required parts are all in the doc. */
export function matchFormat(text: string, kind?: DocKind): NamedFormat | undefined {
  const headings = sectionHeadings(text);
  return FORMATS.find(
    (f) => (!kind || f.kind === kind) && f.parts.every((p) => !p.required || has(headings, p)),
  );
}

/** The front matter's `type:` value, if any. */
export const frontMatterType = (text: string): string | undefined =>
  /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]?.match(/^type:\s*["']?([^"'\r\n]+)/m)?.[1];

export interface Recognised {
  readonly kind: DocKind;
  readonly label: string;
  /** The named format whose required parts are all present; undefined = this kind in its own style. */
  readonly format: NamedFormat | undefined;
}

/**
 * What kind of doc this is, or undefined when docmap is not sure (then it shows nothing). The front matter's
 * `type:` wins, then where the file lives, then a named format the headings fully match.
 * `path` is workspace-relative with `/`.
 */
export function recognise(path: string, text: string, type?: string): Recognised | undefined {
  if (isTemplate(path)) return undefined;
  const kind = kindFromType(type) ?? kindFromPath(path) ?? matchFormat(text)?.kind;
  if (!kind) return undefined;
  const info = KINDS.find((k) => k.kind === kind) as KindInfo;
  return { kind, label: info.label, format: matchFormat(text, kind) };
}

export interface TeamFormat {
  /** Where the shape comes from: a template file's path, or "N docs in <folder>". */
  readonly from: string;
  readonly parts: readonly Part[];
}

/** A team's template file → its shape (every `##`/`###` heading counts as a part the team expects). */
export function formatFromTemplate(path: string, text: string): TeamFormat | undefined {
  const parts = sectionHeadings(text)
    .filter((h) => h && !/[{}<>[\]]/.test(h))
    .map((h) => ({ heading: h, required: true }));
  return parts.length ? { from: path, parts } : undefined;
}

/** Fewest sibling docs before their shared headings count as the team's format. */
export const MIN_SIBLINGS = 3;

/**
 * The shape a folder's existing docs share: headings found in more than half of them.
 * Needs at least `MIN_SIBLINGS` docs and two shared headings, else undefined (no guessing from too little).
 */
export function formatFromSiblings(folder: string, docs: readonly string[]): TeamFormat | undefined {
  if (docs.length < MIN_SIBLINGS) return undefined;
  const count = new Map<string, number>();
  const order: string[] = [];
  for (const text of docs)
    for (const h of new Set(sectionHeadings(text))) {
      if (!count.has(h)) order.push(h);
      count.set(h, (count.get(h) ?? 0) + 1);
    }
  const parts = order
    .filter((h) => (count.get(h) ?? 0) * 2 > docs.length)
    .map((h) => ({ heading: h, required: true }));
  return parts.length >= 2 ? { from: `${docs.length} docs in ${folder || "."}`, parts } : undefined;
}

export interface Comparison {
  readonly present: readonly string[];
  /** Parts the format expects that the doc has not got. */
  readonly missing: readonly string[];
  /** Optional parts of the format the doc does not use (information only). */
  readonly unused: readonly string[];
}

/** Which of the format's parts the doc has. Extra headings of the doc's own are never reported. */
export function compare(text: string, parts: readonly Part[]): Comparison {
  const headings = sectionHeadings(text);
  const present: string[] = [];
  const missing: string[] = [];
  const unused: string[] = [];
  for (const p of parts) {
    if (has(headings, p)) present.push(p.heading);
    else (p.required ? missing : unused).push(p.heading);
  }
  return { present, missing, unused };
}

/** Template file names looked for inside a kind's folder (before the kind's usual places at the root). */
export const TEMPLATES_IN_FOLDER = [
  "template.md",
  "adr-template.md",
  "0000-template.md",
  "templates/template.md",
];

/** adr-tools' `.adr-dir` file or log4brains' `.log4brains.yml` (`adrFolder:`) → the folder, if named. */
export function folderFromConfig(file: ".adr-dir" | ".log4brains.yml", text: string): string | undefined {
  const raw =
    file === ".adr-dir" ? text.split(/\r?\n/)[0] : /^\s*adrFolder:\s*["']?([^"'#\r\n]+)/m.exec(text)?.[1];
  const dir = raw?.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return dir && !dir.startsWith("/") && !/^[a-z]:/i.test(dir) && !dir.split("/").includes("..")
    ? dir
    : undefined;
}

/** File name for a new doc: numbered like its neighbours when they are (`0007-slug.md`), else `slug.md`. */
export function nextRecordName(existing: readonly string[], slug: string): string {
  let width = 0;
  let max = 0;
  for (const name of existing) {
    const m = /^(\d{3,4})[-_]/.exec(name);
    if (m?.[1]) {
      width = Math.max(width, m[1].length);
      max = Math.max(max, Number(m[1]));
    }
  }
  return width ? `${String(max + 1).padStart(width, "0")}-${slug}.md` : `${slug}.md`;
}

/** A team template made into a new doc: its first `#` title replaced by the given one (else one added on top). */
export function fillTemplate(template: string, title: string): string {
  const lines = template.split(/\r?\n/);
  const i = lines.findIndex((l) => /^\s{0,3}#\s/.test(l));
  if (i >= 0) lines[i] = `# ${title}`;
  else lines.unshift(`# ${title}`, "");
  return lines.join("\n");
}

/** True when the path alone says this is a doc of `kind` (templates never count). */
export const isKindDoc = (path: string, kind: DocKind): boolean => kindFromPath(path) === kind;
