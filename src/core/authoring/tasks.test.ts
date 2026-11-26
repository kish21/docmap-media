import { describe, expect, it } from "vitest";
import { cellSpans, setStatusCell, setTask, splitCells, statusKind, updatedLabel } from "./tasks";

describe("updatedLabel", () => {
  it("names the file and the 1-based line, and says when the file was not saved", () => {
    expect(updatedLabel("/w/docs/plan.md", 11, true)).toBe("plan.md, line 12");
    expect(updatedLabel("/w/docs/plan.md", 0, false)).toBe("plan.md, line 1 — not saved yet");
  });
});

describe("setTask", () => {
  it("ticks and clears a task box, keeping the rest of the line", () => {
    expect(setTask("- [ ] Switch traffic", true)).toBe("- [x] Switch traffic");
    expect(setTask("  * [X] Write the adapter", false)).toBe("  * [ ] Write the adapter");
    expect(setTask("1. [ ] First", true)).toBe("1. [x] First");
    expect(setTask("> - [ ] quoted", true)).toBe("> - [x] quoted");
  });
  it("refuses a line that is not a task (the file changed since the page was drawn)", () => {
    expect(setTask("- Switch traffic", true)).toBeUndefined();
    expect(setTask("## Steps", true)).toBeUndefined();
    expect(setTask("[ ] not a list item", true)).toBeUndefined();
  });
});

describe("setStatusCell", () => {
  it("changes a status word in one cell and leaves the others", () => {
    expect(setStatusCell("| Switch traffic | blocked |", 1, "done")).toBe("| Switch traffic | done    |");
    expect(setStatusCell("| Load test | in progress |", 1, "done")).toBe("| Load test | done        |");
    expect(setStatusCell("|Shadow mode|done|", 1, "blocked")).toBe("|Shadow mode|blocked|");
    expect(setStatusCell("Shadow mode | done", 1, "at risk")).toBe("Shadow mode | at risk");
  });
  it("counts cells correctly around `code` and escaped pipes", () => {
    expect(cellSpans("| `a|b` | x\\|y | done |").length).toBe(3);
    expect(splitCells("| `a|b` | x\\|y | done |")).toEqual(["`a|b`", "x\\|y", "done"]);
    expect(setStatusCell("| `a|b` | x\\|y | done |", 2, "blocked")).toBe("| `a|b` | x\\|y | blocked |");
  });
  it("refuses when the cell no longer holds a status, the column is missing, or the word is not a status", () => {
    expect(setStatusCell("| Switch traffic | Sam |", 1, "done")).toBeUndefined();
    expect(setStatusCell("| Switch traffic | blocked |", 5, "done")).toBeUndefined();
    expect(setStatusCell("| Switch traffic | blocked |", 1, "banana")).toBeUndefined();
    expect(setStatusCell("no table here", 0, "done")).toBeUndefined();
  });
});

describe("statusKind", () => {
  it("reads the words Clean view colours", () => {
    expect(statusKind(" In  Progress ")).toBe("progress");
    expect(statusKind("✅")).toBe("done");
    expect(statusKind("Sam")).toBeUndefined();
  });
});
