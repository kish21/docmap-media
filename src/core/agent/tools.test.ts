import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMarkdownItEngine } from "../markdown/markdown-it-engine";
import {
  checkDocTool,
  decisionsTool,
  outlineTool,
  plansTool,
  questionsTool,
  searchTool,
  TOOLS,
} from "./tools";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const plan = {
  file: "docs/plan.md",
  text: "# Search plan\n\n**Goal:** fast.\n\n## Steps\n\n- [x] a\n- [ ] b\n\nDo we keep v1?\n\nDecision: keep zero runtime dependencies.\n\nSee `src/gone.ts` and `src/app.ts`.\n",
  modified: NOW,
};

describe("agent tools", () => {
  it("plans, questions, decisions, search, outline and check answer in Markdown", () => {
    expect(plansTool([plan, { file: "notes.md", text: "# Notes\n", modified: NOW }], NOW, 90, 100)).toContain(
      "[Search plan](docs/plan.md) | 1/2\u00a0(50%) | in progress",
    );
    expect(questionsTool([plan], NOW)).toContain("- Do we keep v1? _([line 10](docs/plan.md#L10))_");
    expect(decisionsTool([plan])).toContain(
      "- keep zero runtime dependencies. _([line 12](docs/plan.md#L12))_",
    );
    const found = searchTool([plan], "runtime");
    expect(found).toContain('Search results for "runtime"');
    expect(found).toContain("**Search plan › Steps**");
    expect(found).toContain("[line 12](docs/plan.md#L12)");
    expect(searchTool([plan], "x")).toContain("at least 2 characters");
    const outline = outlineTool(plan, createMarkdownItEngine());
    expect(outline).toContain("- Search plan (line 1)\n  - Steps (line 5)");
    expect(outline).toContain("## Open tasks (1)\n- b (line 8)");
    expect(checkDocTool(plan, (p) => p === "src/app.ts")).toContain("- `src/gone.ts`");
  });

  it("package.json declares exactly these tools for Copilot (names, schemas), behind the level-2 setting", () => {
    const declared = JSON.parse(readFileSync("package.json", "utf8")).contributes.languageModelTools as {
      name: string;
      inputSchema: unknown;
      when: string;
    }[];
    expect(declared.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(TOOLS.map((t) => t.name)).toEqual([
      "docmap_plans",
      "docmap_open_questions",
      "docmap_outline",
      "docmap_check_doc",
      "docmap_decisions",
      "docmap_search",
    ]);
    for (const t of declared) {
      expect(t.inputSchema).toEqual(TOOLS.find((d) => d.name === t.name)?.inputSchema);
      expect(t.when).toBe("config.docmap.ai.tools");
    }
  });
});
