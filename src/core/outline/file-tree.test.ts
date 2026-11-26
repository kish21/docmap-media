import { describe, expect, it } from "vitest";
import { buildFileTree, type FolderNode, relativeTo } from "./file-tree";

/** The tree as indented lines, for readable expectations. */
function lines(folder: FolderNode, depth = 0): string[] {
  const pad = "  ".repeat(depth);
  return [
    ...folder.folders.flatMap((f) => [`${pad}${f.name}/`, ...lines(f, depth + 1)]),
    ...folder.files.map((f) => `${pad}${f.name}`),
  ];
}

describe("buildFileTree: the folder map's shape", () => {
  it("nests files in their folders, folders first, sorted by name (numbers in order)", () => {
    const tree = buildFileTree([
      "README.md",
      "docs/plan.md",
      "docs/adr/0010-x.md",
      "docs/adr/0002-y.md",
      "a.md",
    ]);
    expect(lines(tree)).toEqual([
      "docs/",
      "  adr/",
      "    0002-y.md",
      "    0010-x.md",
      "  plan.md",
      "a.md",
      "README.md",
    ]);
  });

  it("shows a chain of single folders as one row, like VS Code's compact folders", () => {
    const tree = buildFileTree(["src/core/notes/a.md", "src/core/notes/b.md", "top.md"]);
    expect(lines(tree)).toEqual(["src/core/notes/", "  a.md", "  b.md", "top.md"]);
    expect(tree.folders[0]?.path).toBe("src/core/notes"); // the path is still the real one
  });

  it("ignores duplicates and empty or '.' segments", () => {
    const tree = buildFileTree(["./a.md", "a.md", "docs//b.md", ""]);
    expect(lines(tree)).toEqual(["docs/", "  b.md", "a.md"]);
    expect(tree.folders[0]?.files[0]?.path).toBe("docs/b.md");
  });
});

describe("relativeTo", () => {
  it("matches a Windows folder and its files whatever the drive letter's case", () => {
    // what VS Code reported for a folder opened as C:\…: the folder upper-case, its files lower-case
    expect(relativeTo("/C:/work/project", "/c:/work/project/docs/plan.md")).toBe("docs/plan.md");
    expect(relativeTo("/c:/work/project/", "/C:/work/project/README.md")).toBe("README.md");
  });

  it("leaves out files outside the folder, and a folder that only starts with the same name", () => {
    expect(relativeTo("/c:/work/project", "/c:/work/other/a.md")).toBeUndefined();
    expect(relativeTo("/c:/work/project", "/c:/work/project-old/a.md")).toBeUndefined();
    expect(relativeTo("/home/me/project", "/home/me/project/a.md")).toBe("a.md");
  });
});
