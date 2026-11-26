/**
 * Enter at the end of a list item, task or quote line continues it (2.0 writing helpers); Enter on an empty item
 * ends the list. Pure: given the line up to the cursor, says what Enter should do. Undefined = an ordinary Enter.
 */
export type EnterAction = { readonly kind: "continue"; readonly prefix: string } | { readonly kind: "end" };

const ITEM = /^(\s*)([-*+]|(\d{1,9})([.)]))(\s+)(\[[ xX]\]\s+)?(.*)$/;
const QUOTE = /^(\s*(?:>\s?)+)(.*)$/;

/** Whether line `line` (0-based) is inside a fenced code block, reading the lines above it. */
export function inCodeFence(lines: readonly string[], line: number): boolean {
  let fence: string | undefined;
  for (let i = 0; i < line; i++) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i] ?? "");
    if (!m) continue;
    const mark = m[1] ?? "";
    if (fence === undefined) fence = mark;
    else if (mark[0] === fence[0] && mark.length >= fence.length) fence = undefined;
  }
  return fence !== undefined;
}

export function onEnter(beforeCursor: string): EnterAction | undefined {
  const item = ITEM.exec(beforeCursor);
  if (item) {
    const [, indent = "", bullet = "", num, delim = ".", space = " ", task, rest = ""] = item;
    if (rest.trim() === "") return { kind: "end" };
    const marker = num !== undefined ? `${Number(num) + 1}${delim}` : bullet;
    return { kind: "continue", prefix: `${indent}${marker}${space}${task ? "[ ] " : ""}` };
  }
  const quote = QUOTE.exec(beforeCursor);
  if (quote) {
    if ((quote[2] ?? "").trim() === "") return { kind: "end" };
    return { kind: "continue", prefix: quote[1] ?? "> " };
  }
  return undefined;
}

/** Bold / italic / strikethrough: wraps the text, or unwraps it when it is already wrapped. */
export function toggleMarker(selected: string, before: string, after: string, marker: string) {
  if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker))
    return { text: selected.slice(marker.length, -marker.length), unwrapOutside: false };
  if (before.endsWith(marker) && after.startsWith(marker)) return { text: selected, unwrapOutside: true };
  return { text: `${marker}${selected}${marker}`, unwrapOutside: false };
}
