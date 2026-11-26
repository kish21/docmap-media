import { describe, expect, it } from "vitest";
import { describeWords, formatReadingTime } from "./size";

describe("section size", () => {
  it.each([
    [0, "<1 min"],
    [85, "<1 min"],
    [230, "1 min"],
    [876, "4 min"],
    [3700, "16 min"],
    [13800, "1 h"],
    [15000, "1 h 5 min"],
  ])("%i words → %s", (words, shown) => {
    expect(formatReadingTime(words)).toBe(shown);
  });

  it("describes the size in full, with a reading time", () => {
    expect(describeWords(1)).toBe("1 word · under 1 min");
    expect(describeWords(1234)).toBe("1,234 words · about 5 min");
  });
});
