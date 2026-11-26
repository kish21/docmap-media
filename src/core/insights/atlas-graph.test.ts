import { describe, expect, it } from "vitest";
import { atlasGraph, codeGrid, columnY, fitNeighbours, MAX_SIDE } from "./atlas-graph";

const doc = (
  path: string,
  links: string[] = [],
  extra: Partial<Parameters<typeof atlasGraph>[0][number]> = {},
) => ({
  path,
  title: path,
  links,
  code: [],
  gone: 0,
  feature: false,
  ...extra,
});

describe("atlas graph data (owner 2026-11-24: click a node, see its neighbours)", () => {
  it("keeps only links to known docs, once each, never to itself", () => {
    const g = atlasGraph([doc("a.md", ["b.md", "b.md", "a.md", "gone.md"]), doc("b.md")]);
    expect(g.docs.find((d) => d.p === "a.md")?.l).toEqual(["b.md"]);
  });
  it("starts on the first feature (by title), and trims long text", () => {
    const g = atlasGraph([
      doc("x.md", [], { title: "Zed", feature: true }),
      doc("y.md", [], { title: "Alpha", feature: true, what: "w".repeat(500) }),
    ]);
    expect(g.start).toBe("y.md");
    expect(g.docs.find((d) => d.p === "y.md")?.w.length).toBeLessThanOrEqual(200);
  });
  it("carries the code files and the count of names gone from the code", () => {
    const g = atlasGraph([doc("f.md", [], { code: ["a.py", "a.py", "b.py"], gone: 2 })]);
    expect(g.docs[0]).toMatchObject({ c: ["a.py", "b.py"], g: 2 });
  });
});

describe("atlas layout", () => {
  it("shows at most MAX_SIDE docs a side, the last box saying how many more", () => {
    const many = Array.from({ length: 20 }, (_, i) => `${i}.md`);
    const shown = fitNeighbours(many);
    expect(shown).toHaveLength(MAX_SIDE);
    expect(shown.at(-1)).toEqual({ more: 20 - MAX_SIDE + 1 });
    expect(fitNeighbours(["a.md"])).toEqual([{ path: "a.md" }]);
  });
  it("spreads a column around the middle line", () => {
    expect(columnY(1, 300, 600)).toEqual([300]);
    const ys = columnY(3, 300, 600);
    expect(ys[1]).toBe(300);
    expect(ys[0]).toBeLessThan(300);
  });
  it("puts code boxes in rows that fit the width, never overlapping", () => {
    const boxes = codeGrid(7, 600, 300, 500);
    const perRow = new Set(boxes.map((b) => b.y)).size;
    expect(perRow).toBeGreaterThan(1);
    for (const a of boxes)
      for (const b of boxes)
        if (a !== b && a.y === b.y) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(170);
  });
});
