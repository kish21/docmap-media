import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import {
  describe as describeFile,
  firstOf,
  type InboxFile,
  inboxSummary,
  isArchivedPath,
  isInstructionFile,
  isLeftOut,
  isNewDoc,
  isSkippedPath,
  readState,
  staleReasons,
  worthScore,
} from "./inbox";
import { changedSections, sectionHashes } from "./sections";
import { duplicateGroups, signature, similarity } from "./similarity";

const words = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => `${seed}${i % 97}w${i}`).join(" ");

describe("similarity", () => {
  const base = `# Plan\n\n${words(300, "a")}`;
  const nearCopy = `${base}\n\nOne extra closing line about rollout.`;
  const other = `# Other\n\n${words(300, "z")}`;
  it("near copies score high, unrelated docs low; short docs are not compared", () => {
    const a = signature(base)!;
    expect(similarity(a, signature(nearCopy)!)).toBeGreaterThan(0.8);
    expect(similarity(a, signature(other)!)).toBeLessThan(0.2);
    expect(signature("too short")).toBeUndefined();
  });
  it("groups duplicates, transitively, and leaves the rest out", () => {
    const groups = duplicateGroups(
      [
        { id: "plan.md", signature: signature(base) },
        { id: "other.md", signature: signature(other) },
        { id: "plan-v2.md", signature: signature(nearCopy) },
        { id: "stub.md", signature: signature("tiny") },
      ],
      0.6,
    );
    expect(groups.map((g) => g.ids)).toEqual([["plan.md", "plan-v2.md"]]);
    expect(groups[0]!.similarity).toBeGreaterThan(0.8);
  });
});

describe("sections", () => {
  const headings = [
    { id: "a", text: "A", level: 1, line: 0 },
    { id: "b", text: "B", level: 2, line: 2 },
  ] as const;
  it("marks only the sections whose text changed; nothing when never read", () => {
    const before = sectionHashes("# A\nx\n## B\ny", headings);
    const after = sectionHashes("# A\nx\n## B\ny changed", headings);
    expect(changedSections(before, after, headings)).toEqual(["b"]);
    expect(changedSections(undefined, after, headings)).toEqual([]);
  });
});

describe("inbox rules", () => {
  const now = Date.UTC(2026, 10, 15);
  const file = (over: Partial<InboxFile>, text = "# T\n\n- [ ] a\n"): InboxFile => ({
    id: "x.md",
    facts: analyze(text),
    modified: now,
    hash: 1,
    missing: [],
    inbound: 0,
    instructions: false,
    ...over,
  });
  it("read state: new, changed, read", () => {
    expect(readState(file({}))).toBe("new");
    expect(readState(file({ readHash: 2 }))).toBe("changed");
    expect(readState(file({ readHash: 1 }))).toBe("read");
  });
  it("stale: old, finished, or naming files that are gone", () => {
    expect(staleReasons(file({}), now, 90)).toEqual([]);
    expect(staleReasons(file({ modified: now - 100 * 86_400_000 }), now, 90)).toEqual([
      "not changed in 100 days",
    ]);
    expect(staleReasons(file({}, "# T\n- [x] a\n"), now, 90)).toEqual(["every task is done"]);
    expect(staleReasons(file({ missing: ["src/a.ts"] }), now, 90)).toEqual([
      "mentions 1 missing file (src/a.ts)",
    ]);
  });
  it("worth reading: open tasks and decisions count; a describe line says so", () => {
    const busy = file({}, "# T\n\nSummary.\n\n- [ ] a\n- [x] b\n\nDecision: go.\n");
    expect(worthScore(busy)).toBeGreaterThan(worthScore(file({}, "# T\n\nNothing.\n")));
    expect(describeFile(busy, now)).toBe("1/2 done · 1 decision · 1 min · today");
  });
  it("recognises agent instruction files", () => {
    for (const p of [
      "AGENTS.md",
      "pkg/CLAUDE.md",
      ".github/copilot-instructions.md",
      ".cursor/rules/style.mdc",
    ])
      expect(isInstructionFile(p), p).toBe(true);
    expect(isInstructionFile("docs/agents-guide.md")).toBe(false);
  });
  it("doc lists skip tool copies: VS Code's test install and agent worktrees (owner report 2026-11-18)", () => {
    for (const p of [
      "/c:/repo/.vscode-test/user-data/User/globalStorage/x/seen/1lwd5pn.md",
      ".claude/worktrees/nifty/PRODUCT.md",
      "C:\\repo\\.claude\\worktrees\\nifty\\PLAN.md",
      "node_modules/pkg/README.md",
    ])
      expect(isSkippedPath(p), p).toBe(true);
    for (const p of [
      "PRODUCT.md",
      ".claude/commands/review.md",
      ".github/copilot-instructions.md",
      "docs/plan.md",
    ])
      expect(isSkippedPath(p), p).toBe(false);
  });
});

describe("Docs Inbox: New and group size (#43)", () => {
  const now = Date.UTC(2026, 10, 19);
  const day = 86_400_000;
  const doc = (over: Partial<InboxFile>): InboxFile => ({
    id: "x.md",
    facts: analyze("# T\n"),
    modified: now,
    hash: 1,
    missing: [],
    inbound: 0,
    instructions: false,
    ...over,
  });
  it("New = never opened and changed in the last N days", () => {
    expect(isNewDoc(doc({ modified: now - 2 * day }), now, 7)).toBe(true);
    expect(isNewDoc(doc({ modified: now - 8 * day }), now, 7)).toBe(false);
    expect(isNewDoc(doc({ modified: now - day, readHash: 1 }), now, 7)).toBe(false);
  });
  it("files already there when docmap first read the project are not New", () => {
    const baseline = now - 3 * day;
    expect(isNewDoc(doc({ modified: now - 4 * day }), now, 7, baseline)).toBe(false);
    expect(isNewDoc(doc({ modified: now - 2 * day }), now, 7, baseline)).toBe(true);
  });
  it("a group shows the first N, and says how many more", () => {
    const items = Array.from({ length: 13 }, (_, i) => i);
    expect(firstOf(items, 10)).toEqual({ shown: items.slice(0, 10), hidden: 3 });
    expect(firstOf(items.slice(0, 10), 10)).toEqual({ shown: items.slice(0, 10), hidden: 0 });
  });
});

describe("tool folders left out of every doc list (#44)", () => {
  const defaults = { skip: [] as string[], include: [".github"] };
  it("leaves out dot-folders (tool files) but keeps the project's own docs and .github", () => {
    for (const p of [
      ".factory/droids/a.md",
      ".agents/skills/x/SKILL.md",
      ".claude/commands/review.md",
      "a/.cache/n.md",
    ])
      expect(isLeftOut(p, defaults), p).toBe(true);
    for (const p of ["PRODUCT.md", "docs/plan.md", ".github/copilot-instructions.md", ".notes.md"])
      expect(isLeftOut(p, defaults), p).toBe(false);
  });
  it("still leaves out dependency and build folders", () => {
    expect(isLeftOut("node_modules/pkg/README.md", defaults)).toBe(true);
    expect(isLeftOut("dist/readme.md", defaults)).toBe(true);
  });
  it("only looks inside the project: a dot-folder above it does not hide everything", () => {
    expect(isLeftOut("docs/plan.md", defaults)).toBe(false);
    expect(isLeftOut("docs\\plan.md", defaults)).toBe(false);
  });
  it("follows the reader's skip and include settings", () => {
    const rules = { skip: ["archive", "docs/old"], include: [".github", ".claude"] };
    expect(isLeftOut("archive/2019.md", rules)).toBe(true);
    expect(isLeftOut("team/archive/2019.md", rules)).toBe(true);
    expect(isLeftOut("docs/old/x.md", rules)).toBe(true);
    expect(isLeftOut("docs/older/x.md", rules)).toBe(false);
    expect(isLeftOut(".claude/commands/review.md", rules)).toBe(false);
    expect(isLeftOut(".agents/x.md", rules)).toBe(true);
  });
});

describe("archived docs get their own group", () => {
  it("archive folders at any depth, with or without an underscore", () => {
    for (const p of [
      "archive/a.md",
      "docs/_archive/sdlc/plan.md",
      "docs\\Archived\\x.md",
      "old/notes.md",
      "docs/_old/v1.md",
    ])
      expect(isArchivedPath(p), p).toBe(true);
  });
  it("names that only contain the word, or a file called archive, are not archived", () => {
    for (const p of [
      "archive.md",
      "docs/archive-plan.md",
      "docs/archiver/x.md",
      "docs/golden/old.md",
      "README.md",
    ])
      expect(isArchivedPath(p), p).toBe(false);
  });
});

describe("Docs Inbox summary line (#45 quiet first run)", () => {
  it("says what was found and the one thing to do", () => {
    expect(inboxSummary(["README.md", "docs/design/api.md", "PLAN.md"], 2)).toBe(
      "Found 3 docs, 2 plans and 1 design doc. Click a doc to read it.",
    );
    expect(inboxSummary(["README.md"], 0)).toBe("Found 1 doc. Click a doc to read it.");
    expect(inboxSummary([], 0)).toBe("No Markdown docs found yet.");
  });
});
