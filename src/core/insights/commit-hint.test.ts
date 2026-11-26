import { describe, expect, it } from "vitest";
import { changedPaths, checkLabel, type DocMention, docsToCheck } from "./commit-hint";

const mentions: Record<string, DocMention[]> = {
  "/r/src/a.ts": [
    { doc: "/r/docs/design.md", title: "Design", line: 12 },
    { doc: "/r/README.md", title: "Readme", line: 3 },
  ],
  "/r/src/b.ts": [{ doc: "/r/docs/design.md", title: "Design", line: 4 }],
  "/r/src/c.ts": [{ doc: "/r/docs/plan.md", title: "Plan", line: 0 }],
};
const of = (f: string) => mentions[f] ?? [];

describe("docsToCheck (#46)", () => {
  it("lists each doc once with the changed files it names, most files first", () => {
    expect(docsToCheck(["/r/src/a.ts", "/r/src/b.ts", "/r/src/z.ts"], of)).toEqual([
      { doc: "/r/docs/design.md", title: "Design", line: 4, files: ["/r/src/a.ts", "/r/src/b.ts"] },
      { doc: "/r/README.md", title: "Readme", line: 3, files: ["/r/src/a.ts"] },
    ]);
  });

  it("leaves out a doc that is itself being changed", () => {
    const docs = docsToCheck(["/r/src/c.ts", "/r/docs/plan.md"], of);
    expect(docs).toEqual([]);
  });

  it("is empty when no changed file is named in a doc", () => {
    expect(docsToCheck(["/r/src/z.ts"], of)).toEqual([]);
  });
});

describe("checkLabel", () => {
  it("counts docs in plain words, and is empty for none", () => {
    expect(checkLabel(0)).toBe("");
    expect(checkLabel(1)).toBe("1 doc mentions files you changed");
    expect(checkLabel(3)).toBe("3 docs mention files you changed");
  });
});

describe("changedPaths", () => {
  it("reads modified, added, deleted and renamed entries", () => {
    const out = " M src/a.ts\0A  src/new.ts\0 D gone.ts\0R  src/to.ts\0src/from.ts\0";
    expect(changedPaths(out)).toEqual(["src/a.ts", "src/new.ts", "gone.ts", "src/to.ts"]);
  });

  it("is empty for a clean tree", () => {
    expect(changedPaths("")).toEqual([]);
  });
});
