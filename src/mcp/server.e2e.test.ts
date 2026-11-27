import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const binPath = path.join(repoRoot, "packages", "docmap-mcp", "bin", "docmap-mcp.mjs");
const fixturesDir = path.join(repoRoot, "tests", "fixtures");

type JsonRpcResponse = {
  jsonrpc: string;
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

async function runSession(
  messages: object[],
): Promise<{ responses: JsonRpcResponse[]; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, fixturesDir], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const responses: JsonRpcResponse[] = [];
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (line.trim()) responses.push(JSON.parse(line) as JsonRpcResponse);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      rl.close();
      resolve({ responses, stderr, code });
    });

    for (const msg of messages) {
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    }
    child.stdin.end();
  });
}

describe("docmap-mcp stdio binary e2e", () => {
  beforeAll(() => {
    execFileSync(process.execPath, [path.join(repoRoot, "scripts", "build.mjs"), "--mcp-only"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  }, 30_000);

  it("handles initialize, tools/list, all 4 tools, and rejects path traversal over stdio", async () => {
    const { responses, stderr, code } = await runSession([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "docmap_plans", arguments: {} } },
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "docmap_open_questions", arguments: {} },
      },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "docmap_outline", arguments: { file: "sample.md" } },
      },
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "docmap_check_doc", arguments: { file: "trust.md" } },
      },
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "docmap_outline", arguments: { file: "../outside.md" } },
      },
      {
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "docmap_check_doc", arguments: { file: "../outside.md" } },
      },
    ]);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    // Notification (no id) produces no response, so 8 requests -> 8 responses
    expect(responses).toHaveLength(8);

    const byId = new Map(responses.map((r) => [r.id, r]));

    // 1. initialize
    expect(byId.get(1)?.result).toMatchObject({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "docmap", version: "3.3.2" },
    });

    // 2. tools/list
    const tools = (byId.get(2)?.result?.tools ?? []) as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual([
      "docmap_plans",
      "docmap_open_questions",
      "docmap_outline",
      "docmap_check_doc",
      "docmap_decisions",
      "docmap_search",
    ]);

    // 3. docmap_plans
    const plansRes = byId.get(3)?.result as { isError: boolean; content: { type: string; text: string }[] };
    expect(plansRes.isError).toBe(false);
    expect(plansRes.content[0]?.text.length).toBeGreaterThan(0);

    // 4. docmap_open_questions
    const questionsRes = byId.get(4)?.result as {
      isError: boolean;
      content: { type: string; text: string }[];
    };
    expect(questionsRes.isError).toBe(false);
    expect(questionsRes.content[0]?.text.length).toBeGreaterThan(0);

    // 5. docmap_outline
    const outlineRes = byId.get(5)?.result as { isError: boolean; content: { type: string; text: string }[] };
    expect(outlineRes.isError).toBe(false);
    expect(outlineRes.content[0]?.text).toContain("# Outline of sample.md");
    expect(outlineRes.content[0]?.text).toContain("First section");
    expect(outlineRes.content[0]?.text).toContain("A subsection");
    expect(outlineRes.content[0]?.text).toContain("Second section");

    // 6. docmap_check_doc
    const checkRes = byId.get(6)?.result as { isError: boolean; content: { type: string; text: string }[] };
    expect(checkRes.isError).toBe(false);
    expect(checkRes.content[0]?.text).toContain("notes/missing-plan.md");
    expect(checkRes.content[0]?.text).not.toContain("`sample.md`");

    // 7 & 8. path traversal rejection
    const traversalOutline = byId.get(7)?.result as {
      isError: boolean;
      content: { type: string; text: string }[];
    };
    expect(traversalOutline.isError).toBe(true);
    expect(traversalOutline.content[0]?.text).toContain("../outside.md");

    const traversalCheck = byId.get(8)?.result as {
      isError: boolean;
      content: { type: string; text: string }[];
    };
    expect(traversalCheck.isError).toBe(true);
    expect(traversalCheck.content[0]?.text).toContain("../outside.md");
  }, 30_000);

  it("handles malformed JSON-RPC values (null, primitive, array) without crashing", async () => {
    const { responses, stderr, code } = await runSession([
      null as unknown as object,
      123 as unknown as object,
      [] as unknown as object,
      { jsonrpc: "2.0", id: 9, method: "ping" },
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(responses).toHaveLength(4);
    expect(responses[0]?.error?.code).toBe(-32600);
    expect(responses[1]?.error?.code).toBe(-32600);
    expect(responses[2]?.error?.code).toBe(-32600);
    expect(responses[3]).toEqual({ jsonrpc: "2.0", id: 9, result: {} });
  }, 30_000);

  it("rejects oversized stdio frames without buffering unbounded memory and keeps serving", async () => {
    const huge = { jsonrpc: "2.0", id: 10, method: "ping", params: { pad: "x".repeat(1024 * 1024 + 1024) } };
    const { responses, stderr, code } = await runSession([huge, { jsonrpc: "2.0", id: 11, method: "ping" }]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(responses).toHaveLength(2);
    expect(responses[0]?.error?.code).toBe(-32600);
    expect(responses[0]?.error?.message).toBe("Request too large");
    expect(responses[1]).toEqual({ jsonrpc: "2.0", id: 11, result: {} });
  }, 30_000);

  it("answers docmap_decisions and docmap_search over stdio and supports CLI flags", async () => {
    const { responses, stderr, code } = await runSession([
      { jsonrpc: "2.0", id: 20, method: "tools/call", params: { name: "docmap_decisions", arguments: {} } },
      {
        jsonrpc: "2.0",
        id: 21,
        method: "tools/call",
        params: { name: "docmap_search", arguments: { query: "First section" } },
      },
    ]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect((responses[0]?.result as { isError: boolean } | undefined)?.isError).toBe(false);
    const searchRes = responses[1]?.result as { isError: boolean; content: { text: string }[] };
    expect(searchRes.isError).toBe(false);
    expect(searchRes.content[0]?.text).toContain("sample.md");

    // CLI flags: --version, --help, --print-skill, --install-skill
    const ver = execFileSync(process.execPath, [binPath, "--version"], { encoding: "utf8" });
    expect(ver.trim()).toBe("docmap-mcp 3.3.2");
    const help = execFileSync(process.execPath, [binPath, "--help"], { encoding: "utf8" });
    expect(help).toContain("--install-skill");
    const skill = execFileSync(process.execPath, [binPath, "--print-skill"], { encoding: "utf8" });
    expect(skill).toContain("docmap_search");
    expect(skill).toContain("docmap_decisions");

    const tmp = mkdtempSync(path.join(tmpdir(), "docmap-skill-"));
    try {
      const out = execFileSync(process.execPath, [binPath, "--install-skill", "agents"], {
        cwd: tmp,
        encoding: "utf8",
      });
      expect(out).toContain(".agents/skills/docmap/SKILL.md");
      const written = readFileSync(path.join(tmp, ".agents", "skills", "docmap", "SKILL.md"), "utf8");
      expect(written).toContain("name: docmap");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);
});
