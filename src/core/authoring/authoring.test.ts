import { describe, expect, it } from "vitest";
import { onEnter, toggleMarker } from "./lists";
import { formatTable, splitRow } from "./table";
import { buildToc, TOC_END, TOC_START, tocEdit } from "./toc";

describe("table formatter", () => {
  it("lines the columns up and keeps alignment", () => {
    expect(formatTable(["|Role|Value|", "|:-|-:|", "|Page background|`#FFF`|", "|x|`a|b`|"])).toEqual([
      "| Role            |  Value |",
      "| :-------------- | -----: |",
      "| Page background | `#FFF` |",
      "| x               |  `a|b` |",
    ]);
  });
  it("keeps escaped pipes and pipes in code inside the cell; refuses non-tables", () => {
    expect(splitRow("| a \\| b | `c|d` |")).toEqual(["a \\| b", "`c|d`"]);
    expect(formatTable(["not", "a table"])).toBeUndefined();
  });
});

describe("table of contents", () => {
  const headings = [
    { id: "title", text: "Title", level: 1, line: 0 },
    { id: "setup", text: "Setup", level: 2, line: 2 },
    { id: "run-it", text: "Run it", level: 3, line: 4 },
  ] as const;
  it("links h2 and below, nested", () => {
    expect(buildToc(headings)).toBe("- [Setup](#setup)\n  - [Run it](#run-it)");
  });
  it("goes after the title the first time, and replaces itself after that", () => {
    const first = tocEdit(["# Title", "", "## Setup"], headings, "- x");
    expect(first.start).toBe(1);
    const lines = ["# Title", TOC_START, "old", TOC_END, "## Setup"];
    const again = tocEdit(lines, headings, "- y");
    expect([again.start, again.end, again.lines]).toEqual([1, 4, [TOC_START, "", "- y", "", TOC_END]]);
  });
});

describe("Enter in lists", () => {
  it("continues bullets, numbers, tasks and quotes", () => {
    expect(onEnter("- item")).toEqual({ kind: "continue", prefix: "- " });
    expect(onEnter("  9. item")).toEqual({ kind: "continue", prefix: "  10. " });
    expect(onEnter("- [x] done")).toEqual({ kind: "continue", prefix: "- [ ] " });
    expect(onEnter("> quote")).toEqual({ kind: "continue", prefix: "> " });
  });
  it("knows when a line is inside a code block (Enter there stays plain)", async () => {
    const { inCodeFence } = await import("./lists");
    const lines = ["- a", "```md", "- b", "```", "- c"];
    expect([0, 2, 4].map((l) => inCodeFence(lines, l))).toEqual([false, true, false]);
  });
  it("ends the list on an empty item, and leaves other lines alone", () => {
    expect(onEnter("- ")).toEqual({ kind: "end" });
    expect(onEnter("plain text")).toBeUndefined();
  });
  it("bold toggles on and off", () => {
    expect(toggleMarker("word", "a ", " b", "**")).toEqual({ text: "**word**", unwrapOutside: false });
    expect(toggleMarker("**word**", "", "", "**")).toEqual({ text: "word", unwrapOutside: false });
    expect(toggleMarker("word", "a **", "** b", "**")).toEqual({ text: "word", unwrapOutside: true });
  });
});
