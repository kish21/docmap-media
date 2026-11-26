import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { callTool, handle, listDocs, readDoc } from "./server";

const dir = mkdtempSync(path.join(tmpdir(), "docmap-mcp-"));
mkdirSync(path.join(dir, "docs"));
mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
mkdirSync(path.join(dir, "src"));
writeFileSync(path.join(dir, "src", "app.ts"), "export {}\n");
writeFileSync(
  path.join(dir, "docs", "plan.md"),
  "# Rollout plan\n\n- [x] a\n- [ ] b\n\nShould we cache?\n\nSee `src/app.ts` and `src/gone.ts`.\n",
);
writeFileSync(path.join(dir, "node_modules", "x", "README.md"), "# dep\n");

describe("MCP server", () => {
  it("speaks MCP: initialize, tools/list, unknown methods, notifications", () => {
    expect(
      handle({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, dir),
    ).toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "docmap" } },
    });
    const list = handle({ id: 2, method: "tools/list" }, dir) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toContain("docmap_check_doc");
    expect(handle({ id: 3, method: "nope" }, dir)).toMatchObject({ error: { code: -32601 } });
    expect(handle({ method: "notifications/initialized" }, dir)).toBeUndefined();
  });

  it("lists docs (skipping dependencies) and answers each tool", () => {
    expect(listDocs(dir).map((d) => d.file)).toEqual(["docs/plan.md"]);
    expect(callTool("docmap_plans", {}, dir).text).toContain("[Rollout plan](docs/plan.md) | 1/2 (50%)");
    expect(callTool("docmap_open_questions", {}, dir).text).toContain(
      "- Should we cache? _([line 6](docs/plan.md#L6))_",
    );
    expect(callTool("docmap_check_doc", { file: "docs/plan.md" }, dir).text).toContain("- `src/gone.ts`");
    expect(callTool("docmap_check_doc", { file: "docs/plan.md" }, dir).text).not.toContain("src/app.ts`\n");
    const call = handle(
      {
        id: 4,
        method: "tools/call",
        params: { name: "docmap_outline", arguments: { file: "docs/plan.md" } },
      },
      dir,
    );
    expect(call).toMatchObject({ result: { isError: false, content: [{ type: "text" }] } });
    expect(callTool("docmap_readiness", { file: "docs/plan.md" }, dir)).toMatchObject({ isError: true });
  });

  it("reads nothing outside its folder, and only Markdown", () => {
    expect(readDoc("../etc/passwd.md", dir)).toBeUndefined();
    expect(readDoc("/etc/hosts", dir)).toBeUndefined();
    expect(readDoc("src/app.ts", dir)).toBeUndefined();
    expect(callTool("docmap_outline", { file: "../x.md" }, dir)).toMatchObject({ isError: true });
  });
});
