import { describe, expect, it } from "vitest";
import { filterHeadings } from "./filter";
import type { Heading } from "./types";

const h = (id: string, text: string): Heading => ({ id, text, level: 2, line: 0 });
const headings = [h("a", "Getting Started"), h("b", "Setup"), h("c", "Advanced setup"), h("d", "FAQ")];

describe("filterHeadings", () => {
  it("keeps only headings whose text contains the query, case-insensitively, with the match range", () => {
    const result = filterHeadings(headings, "setup");
    expect([...result.matches.keys()]).toEqual(["b", "c"]);
    expect(result.matches.get("c")).toEqual({ start: 9, end: 14 });
    expect(result.total).toBe(4);
  });

  it("an empty or blank query shows everything", () => {
    expect(filterHeadings(headings, "").matches.size).toBe(4);
    expect(filterHeadings(headings, "   ").matches.size).toBe(4);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect([...filterHeadings(headings, "  faq ").matches.keys()]).toEqual(["d"]);
  });

  it("treats the query as plain text, not a pattern", () => {
    expect(filterHeadings([h("x", "a.b (c)*")], ".b (c)*").matches.size).toBe(1);
    expect(filterHeadings([h("x", "abc")], ".*").matches.size).toBe(0);
  });

  it("finds nothing when nothing matches", () => {
    expect(filterHeadings(headings, "zzz").matches.size).toBe(0);
  });

  it("reports match offsets in the ORIGINAL text, even when lower-casing changes its length", () => {
    const result = filterHeadings([h("i", "İstanbul setup")], "setup");
    expect(result.matches.get("i")).toEqual({ start: 9, end: 14 });
    expect("İstanbul setup".slice(9, 14)).toBe("setup");
  });

  it("matches across an emoji without splitting it", () => {
    const result = filterHeadings([h("e", "🚀 Launch plan")], "launch");
    const m = result.matches.get("e");
    expect("🚀 Launch plan".slice(m?.start, m?.end)).toBe("Launch");
  });

  it("matches a Greek word ending in a final sigma, as it did before offsets were mapped", () => {
    const m = filterHeadings([h("g", "ΟΔΟΣ ΚΑΙ")], "ΟΔΟΣ").matches.get("g");
    expect(m).toEqual({ start: 0, end: 4 });
  });
});
