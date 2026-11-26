import { describe, expect, it } from "vitest";
import { analyze, plain } from "./analyze";

describe("analyze", () => {
  const doc = [
    "# Migration plan",
    "",
    "We move the **billing** service to the new queue.",
    "",
    "## TL;DR",
    "",
    "Ship in two steps; keep the old path for a week.",
    "",
    "## Tasks",
    "- [x] write the adapter",
    "- [ ] switch traffic",
    "* [ ] delete `src/billing/old-queue.ts`",
    "",
    "**Decision:** use the managed queue, not our own.",
    "> [!WARNING]",
    "> Payments must not double-charge.",
    "See [the runbook](docs/runbook.md#rollback) and [site](https://example.com/x.md).",
    "```md",
    "- [ ] not a task, it is code",
    "Decision: not a decision either",
    "```",
  ].join("\n");
  const facts = analyze(doc);

  it("finds the title and prefers the doc's own TL;DR over its first paragraph", () => {
    expect(facts.title).toBe("Migration plan");
    expect(facts.tldr).toBe("Ship in two steps; keep the old path for a week.");
  });
  it("counts open and done tasks, not ones inside code", () => {
    expect([facts.tasksOpen, facts.tasksDone]).toEqual([2, 1]);
  });
  it("lists decisions with their line, as plain text", () => {
    expect(facts.decisions).toEqual([{ line: 13, text: "use the managed queue, not our own." }]);
  });
  it("counts warning boxes", () => {
    expect(facts.warnings).toBe(1);
  });
  it("collects repository paths named in code and relative Markdown links (not web links)", () => {
    expect(facts.codePaths).toEqual(["src/billing/old-queue.ts"]);
    expect(facts.mdLinks).toEqual(["docs/runbook.md"]);
  });
  it("falls back to the first paragraph, skipping a list before it", () => {
    expect(analyze("# Notes\n\n- a\n- b\n\nThe real summary.\n").tldr).toBe("The real summary.");
  });
  it("skips front matter: it is not the summary, and line numbers stay the file's own", () => {
    const f = analyze("---\ntitle: Plan\nstatus: draft\n---\n# Plan\n\nThe real start.\n\nDecision: go.\n");
    expect(f.tldr).toBe("The real start.");
    expect(f.decisions).toEqual([{ line: 8, text: "go." }]);
  });
  it("works with no headings at all", () => {
    const f = analyze("Just a line of text.\n");
    expect(f.title).toBeUndefined();
    expect(f.tldr).toBe("Just a line of text.");
    expect(f.words).toBe(5);
  });
  it("plain() strips marks and cuts long text", () => {
    expect(plain("**bold** `code` [link](x) _it_")).toBe("bold code link it");
    expect(plain("a".repeat(400)).length).toBe(280);
  });
});
