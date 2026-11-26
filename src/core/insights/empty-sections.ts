/**
 * #36: the sections of a doc that have nothing in them yet — a heading followed only by blank lines, template hints
 * (`<!-- … -->`) or a placeholder (TBD, TODO, …). A heading whose text is only its own sub-headings is not empty.
 * Fenced code is skipped. Pure.
 */

const PLACEHOLDER = /^(?:tbd|todo|tba|n\/a|\.\.\.|…|-|_|\(empty\)|\(tbd\)|\(todo\))\.?$/i;

interface Section {
  readonly level: number;
  readonly title: string;
  body: string[];
}

const blank = (lines: readonly string[]): boolean =>
  lines
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .every((l) => !l.trim() || PLACEHOLDER.test(l.trim()));

/** The headings (## to ######, as written) of the sections with no content. */
export function emptySections(text: string): string[] {
  const sections: Section[] = [];
  let fence: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f?.[1]) {
      const mark = (f[1] as string)[0];
      fence = fence ? (mark === fence ? undefined : fence) : mark;
      sections.at(-1)?.body.push(line);
      continue;
    }
    const h = fence ? null : /^\s{0,3}(#{2,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h?.[1] && h[2]) sections.push({ level: h[1].length, title: h[2], body: [] });
    else sections.at(-1)?.body.push(line);
  }
  return sections
    .filter((s, i) => {
      const next = sections[i + 1];
      const hasChildren = next !== undefined && next.level > s.level;
      return !hasChildren && blank(s.body);
    })
    .map((s) => s.title);
}
