/**
 * #46 "Before you commit": docs that name files with uncommitted changes, so the reader can update them in the same
 * commit. Pure: the extension supplies the changed files (from git) and who mentions each one (the Docs Inbox scan).
 */

/** A doc that names a file, as the Docs Inbox scan knows it. */
export interface DocMention {
  /** A stable key for the doc (its absolute path). */
  readonly doc: string;
  readonly title: string;
  /** 0-based line of the first mention. */
  readonly line: number;
}

/** One doc to check before committing, with the changed files it names. */
export interface DocToCheck {
  readonly doc: string;
  readonly title: string;
  readonly line: number;
  readonly files: readonly string[];
}

/**
 * The docs that name any changed file. A doc that is itself among the changed files is left out: the reader is
 * already updating it. Most changed files first, then by title.
 */
export function docsToCheck(
  changed: readonly string[],
  mentionsOf: (file: string) => readonly DocMention[],
): DocToCheck[] {
  const changedSet = new Set(changed);
  const byDoc = new Map<string, { doc: string; title: string; line: number; files: string[] }>();
  for (const file of changed) {
    for (const m of mentionsOf(file)) {
      if (changedSet.has(m.doc)) continue;
      const entry = byDoc.get(m.doc) ?? { doc: m.doc, title: m.title, line: m.line, files: [] };
      if (!entry.files.includes(file)) entry.files.push(file);
      entry.line = Math.min(entry.line, m.line);
      byDoc.set(m.doc, entry);
    }
  }
  return [...byDoc.values()].sort(
    (a, b) => b.files.length - a.files.length || a.title.localeCompare(b.title),
  );
}

/** Status bar text for the hint: empty when nothing needs checking. */
export function checkLabel(docs: number): string {
  if (docs === 0) return "";
  return `${docs} doc${docs === 1 ? " mentions" : "s mention"} files you changed`;
}

/**
 * Paths from `git status --porcelain=v1 -z`, relative to the repository root. A rename or copy names the new path
 * (the old one follows it and is skipped); deleted files are included (a doc naming them needs updating too).
 */
export function changedPaths(porcelain: string): string[] {
  const parts = porcelain.split("\0");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? "";
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    out.push(entry.slice(3));
    if (status.includes("R") || status.includes("C")) i++;
  }
  return out;
}
