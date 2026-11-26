import { describe, expect, it } from "vitest";
import { searchDoc } from "./search";

const DOC = [
  "# Product",
  "Intro mentions the port.",
  "## Scope",
  "### Deferred",
  "Live view needs a PORT design.",
  "## Security",
  "```md",
  "# not a heading, but port is here",
  "```",
  "Only one port answers.",
].join("\n");

describe("search across docs", () => {
  it("each match names the headings it sits under, case-insensitive", () => {
    const m = searchDoc(DOC, "port", 10);
    expect(m.map((x) => [x.line, x.trail.join(" › ")])).toEqual([
      [1, "Product"],
      [4, "Product › Scope › Deferred"],
      [7, "Product › Security"],
      [9, "Product › Security"],
    ]);
  });
  it("headings inside code blocks do not change the trail", () => {
    const m = searchDoc(DOC, "only one", 10);
    expect(m[0]?.trail).toEqual(["Product", "Security"]);
  });
  it("a match in a heading shows its parents, not itself", () => {
    expect(searchDoc(DOC, "deferred", 10)[0]?.trail).toEqual(["Product", "Scope"]);
  });
  it("respects the cap and ignores very short queries", () => {
    expect(searchDoc(DOC, "port", 2)).toHaveLength(2);
    expect(searchDoc(DOC, "p", 10)).toEqual([]);
    expect(searchDoc(DOC, "  ", 10)).toEqual([]);
  });
  it("long lines are cut around the match", () => {
    const long = `${"a".repeat(300)} needle ${"b".repeat(300)}`;
    const [m] = searchDoc(long, "needle", 1);
    expect(m?.snippet).toContain("needle");
    expect(m?.snippet.startsWith("…")).toBe(true);
    expect(m?.snippet.endsWith("…")).toBe(true);
    expect((m?.snippet.length ?? 0) < 130).toBe(true);
  });
  it("regex characters in the query are plain text", () => {
    expect(searchDoc("a (b) c", "(b)", 5)).toHaveLength(1);
  });
});
