import { describe, expect, it } from "vitest";
import type { RepoFacts } from "./check";
import { designCheck, designCheckRows, designCheckTitle, findingLines } from "./design-check";

const repo: RepoFacts = {
  hasPath: (p) => p === "src/orders/api.ts",
  scripts: new Map([["npm", new Set(["build"])]]),
  symbols: new Set(["createOrder"]),
  versions: new Map([["node", ">=22"]]),
};

const DOC = [
  "---",
  "type: design",
  "note: `src/front/matter.ts`",
  "---",
  "# Orders design",
  "",
  "## Data flow",
  "",
  "Requests reach `src/orders/api.ts`, then",
  "go to `src/orders/queue.ts`.",
  "",
  "```ts",
  "import { gone } from `src/in/code.ts`;",
  "markPaid();",
  "```",
  "",
  "## Payments",
  "",
  "`createOrder()` then `markPaid()` are called.",
  "",
  "## Setup",
  "",
  "Needs Node 18. Run `npm run build`.",
].join("\n");

describe("#40 design check", () => {
  it("lists what no longer matches, with the section and the line the paragraph starts on", () => {
    const found = designCheck(DOC, repo);
    expect(found.map((f) => [f.line, f.section, f.mismatch.claim.value])).toEqual([
      [8, "Data flow", "src/orders/queue.ts"],
      [18, "Payments", "markPaid"],
      [22, "Setup", "node"],
    ]);
  });

  it("skips code blocks and front matter, and finds nothing when the doc matches", () => {
    expect(designCheck("```\n`src/x/y.ts`\n```\n\n`src/orders/api.ts`", repo)).toEqual([]);
    expect(designCheck("---\na: `src/x/y.ts`\n---\nAll good.", repo)).toEqual([]);
  });

  it("works with Windows line endings", () => {
    expect(designCheck("# A\r\n\r\nSee `src/x/y.ts`.\r\n", repo).map((f) => f.line)).toEqual([2]);
  });

  it("titles the list and writes one line per finding for the AI", () => {
    expect(designCheckTitle("Orders design", 0)).toBe("Orders design: nothing contradicts the code");
    expect(designCheckTitle("Orders design", 1)).toBe("Orders design: 1 thing no longer matches the code");
    expect(designCheckTitle("Orders design", 3)).toBe("Orders design: 3 things no longer match the code");
    expect(findingLines(designCheck(DOC, repo))[0]).toBe(
      'line 9 ("Data flow"): mentions `src/orders/queue.ts`, which is not in the repository',
    );
  });

  it("puts 'ask my AI' as the list's first row, then one row per finding to jump to", () => {
    const findings = designCheck(DOC, repo);
    const rows = designCheckRows(findings);
    expect(rows).toHaveLength(findings.length + 1);
    expect(rows[0]).toMatchObject({ label: "$(sparkle) Ask my AI to fix these", ask: true });
    expect(rows[0]?.line).toBeUndefined();
    expect(rows[1]).toMatchObject({ label: "Data flow", description: "line 9", line: 8, ask: false });
    expect(rows[1]?.detail).toContain("src/orders/queue.ts");
  });
});
