import { slugify } from "./slug";
import type { Heading } from "./types";

/**
 * Finding a clicked heading again after the file was edited. A heading id depends on its position among
 * same-named headings ("setup", "setup-1"), so a click drawn before "## Setup" was inserted above would, by id,
 * land on the wrong one. Instead the clicked line is carried through the edits made since, and the heading found
 * there — if it still has the same name.
 */

/** One edit, in the lines of the text BEFORE it (as VS Code reports a content change). */
export interface LineEdit {
  readonly startLine: number;
  readonly endLine: number;
  /** The replaced range ends at the very start of `endLine` (nothing on that line itself was replaced). */
  readonly endsAtLineStart: boolean;
  /** Line breaks in the inserted text. */
  readonly insertedLines: number;
}

/**
 * Where `line` is after a batch of non-overlapping edits that were all made to the same text (one change event).
 * `undefined` when an edit touched the line itself: it is no longer the line that was clicked.
 */
export function shiftLine(line: number, edits: readonly LineEdit[]): number | undefined {
  let shifted = line;
  for (const edit of edits) {
    const before = edit.endLine < line || (edit.endLine === line && edit.endsAtLineStart);
    if (before) shifted += edit.insertedLines - (edit.endLine - edit.startLine);
    else if (edit.startLine <= line) return undefined;
  }
  return shifted;
}

/** `line` carried through change events in order (each event's edits are in the text left by the previous one). */
export function shiftLineThrough(line: number, events: readonly (readonly LineEdit[])[]): number | undefined {
  let current: number | undefined = line;
  for (const edits of events) {
    if (current === undefined) return undefined;
    current = shiftLine(current, edits);
  }
  return current;
}

/** The heading at `line`, if it has the name the clicked id was made from (`setup` ≈ `setup-2`, not `setup-guide`). */
export function headingAtLine(
  headings: readonly Heading[],
  line: number,
  clickedId: string,
): Heading | undefined {
  const heading = headings.find((h) => h.line === line);
  if (!heading) return undefined;
  const base = slugify(heading.text) || "section";
  return clickedId === base || new RegExp(`^${escapeRegExp(base)}-\\d+$`).test(clickedId)
    ? heading
    : undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
