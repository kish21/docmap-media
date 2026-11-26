import { describe, expect, it } from "vitest";
import { docMapSection, importsAgents, MAP_END, MAP_START, withDocMap } from "./doc-map";

describe("doc map", () => {
  const section = docMapSection([
    {
      kind: "decision",
      folder: "doc/adr",
      count: 12,
      team: { from: "doc/adr/template.md", headings: ["why", "choice"] },
    },
    { kind: "design", count: 0 },
    { kind: "runbook", folder: "docs/runbooks", count: 1 },
  ]);

  it("the team's format wins; else the named format with its required parts; a missing folder is a suggestion", () => {
    expect(section).toContain(
      "| Decision record | `doc/adr/` (12 docs) | The team's format, from `doc/adr/template.md`: why · choice |",
    );
    expect(section).toContain(
      "| Design doc | `docs/design/` (suggested; none yet) | [Google design doc](https://www.industrialempathy.com/posts/design-docs-at-google/): Context and scope · Goals and non-goals · The actual design · Alternatives considered |",
    );
    // no single standard for runbooks: docmap's own template, said plainly to be a suggestion
    expect(section).toContain(
      "| Runbook | `docs/runbooks/` (1 doc) | docmap's suggested template (no single standard exists): In short · When to use it · Before you start · Steps · Check it worked · Roll back · If it goes wrong · Related |",
    );
    expect(section).toContain("suggestions, not rules");
    const ds = docMapSection([{ kind: "design-system", count: 0 }]);
    expect(ds).toContain(
      "| Design system (DESIGN.md) | `DESIGN.md` (suggested; none yet) | docmap's suggested template",
    );
    expect(docMapSection([{ kind: "design-system", count: 1 }])).toContain("| `DESIGN.md` |");
    expect(section.startsWith(MAP_START) && section.endsWith(MAP_END)).toBe(true);
  });

  it("is added at the end once, then replaced in place — the rest of the file untouched", () => {
    const first = withDocMap("# Agents\n\nRules.\n", section);
    expect(first).toBe(`# Agents\n\nRules.\n\n${section}\n`);
    const again = withDocMap(`${first}\n## After\n`, docMapSection([{ kind: "spec", count: 0 }]));
    expect(again.split(MAP_START).length).toBe(2);
    expect(again).toContain("Feature spec");
    expect(again).not.toContain("Decision record");
    expect(again.startsWith("# Agents\n\nRules.\n\n")).toBe(true);
    expect(again.endsWith("\n## After\n")).toBe(true);
    expect(withDocMap("", section)).toBe(`${section}\n`);
  });

  it("a table cell cannot be broken by a heading with a pipe", () => {
    const s = docMapSection([{ kind: "decision", count: 0, team: { from: "t.md", headings: ["a|b"] } }]);
    expect(s).toContain("a\\|b");
  });

  it("#34: a project with design docs gets a 'read them before building' line; none, no line", () => {
    const withDesign = docMapSection([
      { kind: "design", folder: "docs/design", count: 2 },
      { kind: "design-system", count: 1 },
      { kind: "architecture", count: 0 },
    ]);
    expect(withDesign).toContain(
      "**Before building:** read the design doc(s) in `docs/design/`, `DESIGN.md` first and build to them.",
    );
    expect(withDesign.indexOf("Before building")).toBeLessThan(withDesign.indexOf("| Kind |"));
    expect(withDesign.endsWith(MAP_END)).toBe(true);
    expect(section).not.toContain("Before building");
  });

  it("knows a CLAUDE.md that already imports AGENTS.md", () => {
    expect(importsAgents("@AGENTS.md\n")).toBe(true);
    expect(importsAgents("# Notes\nSee AGENTS.md")).toBe(false);
  });
});
