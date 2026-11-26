/**
 * Markdown table formatter (2.0 writing helpers): lines the columns up and normalises the separator row, keeping each
 * column's alignment. Pipes inside `code` or escaped as \| stay in their cell. Pure.
 */

type Align = "left" | "center" | "right" | "none";

/** Splits a table row into trimmed cells (outer pipes optional). */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let code = 0;
  const text = line.trim().replace(/^\|/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\\" && text[i + 1] === "|") {
      cell += "\\|";
      i++;
      continue;
    }
    if (ch === "`") {
      let n = 1;
      while (text[i + n] === "`") n++;
      cell += "`".repeat(n);
      i += n - 1;
      code = code === n ? 0 : code === 0 ? n : code;
      continue;
    }
    if (ch === "|" && code === 0) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += ch;
  }
  if (cell.trim() !== "" || !text.endsWith("|")) cells.push(cell.trim());
  return cells;
}

const SEPARATOR_CELL = /^:?-+:?$/;

/** Whether these lines are a Markdown table: a header row, a separator row, then rows. */
export function isTable(lines: readonly string[]): boolean {
  if (lines.length < 2 || !lines[0]!.includes("|")) return false;
  const sep = splitRow(lines[1]!);
  return sep.length > 0 && sep.every((c) => SEPARATOR_CELL.test(c));
}

/** The table, formatted — or undefined if the lines are not a table. */
export function formatTable(lines: readonly string[]): string[] | undefined {
  if (!isTable(lines)) return undefined;
  const indent = /^\s*/.exec(lines[0]!)?.[0] ?? "";
  const rows = lines.map(splitRow);
  const aligns: Align[] = rows[1]!.map((c) =>
    c.startsWith(":") && c.endsWith(":")
      ? "center"
      : c.endsWith(":")
        ? "right"
        : c.startsWith(":")
          ? "left"
          : "none",
  );
  const columns = Math.max(...rows.map((r) => r.length));
  const width = (s: string) => [...s].length;
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(3, ...rows.filter((_, i) => i !== 1).map((r) => width(r[c] ?? ""))),
  );
  const pad = (s: string, w: number, a: Align) => {
    const gap = w - width(s);
    if (a === "right") return " ".repeat(gap) + s;
    if (a === "center") return " ".repeat(Math.floor(gap / 2)) + s + " ".repeat(Math.ceil(gap / 2));
    return s + " ".repeat(gap);
  };
  return rows.map((r, i) => {
    const cells = Array.from({ length: columns }, (_, c) => {
      const w = widths[c]!;
      const a = aligns[c] ?? "none";
      if (i !== 1) return pad(r[c] ?? "", w, a);
      const dashes = "-".repeat(w - (a === "center" ? 2 : a === "none" ? 0 : 1));
      return a === "center"
        ? `:${dashes}:`
        : a === "left"
          ? `:${dashes}`
          : a === "right"
            ? `${dashes}:`
            : dashes;
    });
    return `${indent}| ${cells.join(" | ")} |`;
  });
}
