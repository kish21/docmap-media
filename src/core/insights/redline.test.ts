import { describe, expect, it } from "vitest";
import { alignBlocks, similarity, wordDiff } from "./redline";

describe("alignBlocks", () => {
  it("finds added, changed and removed blocks between unchanged ones", () => {
    const before = ["Intro.", "We ship on Monday with the old queue.", "Gone paragraph.", "Outro."];
    const after = ["Intro.", "Brand new.", "We ship on Friday with the old queue.", "Outro.", "Appendix."];
    expect(alignBlocks(before, after)).toEqual({
      added: [1, 4],
      changed: [[2, 1]],
      removed: [[3, 2]],
    });
  });

  it("whitespace-only edits are not changes", () => {
    expect(alignBlocks(["a  b\nc"], ["a b c"])).toEqual({ added: [], changed: [], removed: [] });
  });

  it("a block removed before the first unchanged one, and everything gone at the end", () => {
    expect(alignBlocks(["x y z", "Keep."], ["Keep."]).removed).toEqual([[0, 0]]);
    expect(alignBlocks(["Keep.", "tail one", "tail two"], ["Keep."]).removed).toEqual([
      [1, 1],
      [1, 2],
    ]);
  });
});

describe("wordDiff", () => {
  it("marks the words that changed, and joins back to each text", () => {
    const ops = wordDiff("We ship on Monday with the old queue.", "We ship on Friday with the new queue.");
    expect(ops.filter((o) => o.kind !== "same")).toEqual([
      { kind: "del", text: "Monday " },
      { kind: "add", text: "Friday " },
      { kind: "del", text: "old " },
      { kind: "add", text: "new " },
    ]);
    expect(
      ops
        .filter((o) => o.kind !== "del")
        .map((o) => o.text)
        .join(""),
    ).toBe("We ship on Friday with the new queue.");
  });

  it("similarity is the share of words kept", () => {
    expect(similarity("a b c d", "a b c e")).toBe(0.75);
    expect(similarity("", "")).toBe(1);
  });
});
