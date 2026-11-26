import { describe, expect, it } from "vitest";
import { currentHeadingIndex } from "./current";
import type { Heading } from "./types";

const at = (...lines: number[]): Heading[] =>
  lines.map((line, i) => ({ id: `h${i}`, text: `H${i}`, level: 2, line }));

describe("currentHeadingIndex", () => {
  const headings = at(3, 10, 25, 40);

  it.each([
    [0, -1],
    [2, -1],
    [3, 0],
    [9, 0],
    [10, 1],
    [24, 1],
    [25, 2],
    [39, 2],
    [40, 3],
    [10_000, 3],
  ])("line %i → heading %i", (line, expected) => {
    expect(currentHeadingIndex(headings, line)).toBe(expected);
  });

  it("is -1 for a document without headings", () => {
    expect(currentHeadingIndex([], 5)).toBe(-1);
  });

  it("agrees with a linear scan on a large outline", () => {
    const many = at(...Array.from({ length: 5000 }, (_, i) => i * 7 + 1));
    for (const line of [0, 1, 2, 700, 34_000, 34_994, 99_999]) {
      let linear = -1;
      many.forEach((h, i) => {
        if (h.line <= line) linear = i;
      });
      expect(currentHeadingIndex(many, line)).toBe(linear);
    }
  });
});
