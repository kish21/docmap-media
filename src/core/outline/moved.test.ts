import { describe, expect, it } from "vitest";
import { createMarkdownItEngine } from "../markdown/markdown-it-engine";
import { headingAtLine, type LineEdit, shiftLine, shiftLineThrough } from "./moved";

const insert = (atLine: number, lines: number): LineEdit => ({
  startLine: atLine,
  endLine: atLine,
  endsAtLineStart: true,
  insertedLines: lines,
});

describe("shiftLine: a line carried through edits", () => {
  it("moves down by the lines inserted above it, and not for edits below it", () => {
    expect(shiftLine(10, [insert(0, 2)])).toBe(12);
    expect(shiftLine(10, [insert(10, 3)])).toBe(13); // inserted at the very start of the line: the line moves
    expect(shiftLine(10, [insert(11, 3)])).toBe(10);
  });

  it("moves up when lines above it are deleted", () => {
    expect(shiftLine(10, [{ startLine: 2, endLine: 5, endsAtLineStart: true, insertedLines: 0 }])).toBe(7);
  });

  it("is lost when an edit touched the line itself", () => {
    expect(shiftLine(10, [{ startLine: 10, endLine: 10, endsAtLineStart: false, insertedLines: 0 }])).toBe(
      undefined,
    );
    expect(shiftLine(10, [{ startLine: 8, endLine: 12, endsAtLineStart: false, insertedLines: 1 }])).toBe(
      undefined,
    );
  });

  it("follows several events in order", () => {
    expect(shiftLineThrough(10, [[insert(0, 2)], [insert(0, 1)]])).toBe(13);
    expect(shiftLineThrough(10, [])).toBe(10);
  });
});

describe("headingAtLine: the same heading, found again after an edit", () => {
  const engine = createMarkdownItEngine();
  const headingsOf = (text: string) => {
    const r = engine.parse(text, 1);
    if (!r.ok) throw new Error(r.reason);
    return r.document.headings;
  };

  it("a new same-named heading above shifts the ids: the clicked one is still found by its moved line", () => {
    const before = headingsOf("# A\n\n## Setup\n\n## Setup\n");
    const clicked = before[2]; // the second "Setup", id "setup-1", line 4
    expect(clicked?.id).toBe("setup-1");
    const after = headingsOf("## Setup\n\n# A\n\n## Setup\n\n## Setup\n"); // "## Setup\n\n" inserted at the top
    // by id, "setup-1" is now the heading at line 4 — the wrong one
    expect(after.find((h) => h.id === "setup-1")?.line).toBe(4);
    const line = shiftLine(clicked?.line ?? -1, [insert(0, 2)]) ?? -1;
    expect(headingAtLine(after, line, clicked?.id ?? "")).toMatchObject({ line: 6, id: "setup-2" });
  });

  it("does not match a different heading that now sits on that line", () => {
    const after = headingsOf("# A\n\n## Setup guide\n");
    expect(headingAtLine(after, 2, "setup")).toBeUndefined();
    expect(headingAtLine(after, 2, "setup-guide")?.text).toBe("Setup guide");
    expect(headingAtLine(after, 1, "a")).toBeUndefined(); // no heading on that line
  });
});
