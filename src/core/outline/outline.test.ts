import { describe, expect, it } from "vitest";
import { buildOutline } from "./outline";
import type { Heading, HeadingLevel, OutlineNode } from "./types";

const h = (text: string, level: HeadingLevel, line: number): Heading => ({ id: text, text, level, line });
const shape = (nodes: OutlineNode[]): unknown => nodes.map((n) => [n.heading.text, shape([...n.children])]);

describe("buildOutline", () => {
  it("nests deeper headings under the previous shallower one", () => {
    const tree = buildOutline([h("A", 1, 0), h("A.1", 2, 1), h("A.1.a", 3, 2), h("A.2", 2, 3), h("B", 1, 4)]);
    expect(shape(tree)).toEqual([
      [
        "A",
        [
          ["A.1", [["A.1.a", []]]],
          ["A.2", []],
        ],
      ],
      ["B", []],
    ]);
  });

  it("nests across skipped levels (h1 → h3) instead of losing the heading", () => {
    expect(shape(buildOutline([h("A", 1, 0), h("deep", 3, 1), h("mid", 2, 2)]))).toEqual([
      [
        "A",
        [
          ["deep", []],
          ["mid", []],
        ],
      ],
    ]);
  });

  it("keeps documents that start below h1 as several roots", () => {
    expect(shape(buildOutline([h("x", 2, 0), h("y", 2, 1)]))).toEqual([
      ["x", []],
      ["y", []],
    ]);
  });

  it("is empty for a document without headings", () => {
    expect(buildOutline([])).toEqual([]);
  });

  it("keeps every heading exactly once, in document order", () => {
    const flat = [h("a", 2, 0), h("b", 1, 1), h("c", 3, 2), h("d", 2, 3), h("e", 6, 4), h("f", 1, 5)];
    const walk = (nodes: OutlineNode[]): string[] =>
      nodes.flatMap((n) => [n.heading.text, ...walk([...n.children])]);
    expect(walk(buildOutline(flat))).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
});
