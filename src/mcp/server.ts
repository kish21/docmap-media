/**
 * 3.0 AI level 2, for any agent: docmap's tools as a local MCP server (stdio, JSON-RPC 2.0, one message per line).
 * Claude Code, Cursor and other agents start it themselves (`node docmap-mcp.js [folder]`); it reads the Markdown
 * files under that folder (default: the current directory) and answers with the same pure tools as Copilot's. It
 * never writes, never opens a network connection, and reads nothing outside the folder. No `vscode` here.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { createInterface } from "node:readline";
import {
  checkDocTool,
  outlineTool,
  plansTool,
  questionsTool,
  TOOLS,
  type ToolDoc,
  type ToolName,
} from "../core/agent/tools";
import { DEFAULT_CONFIG, INTERNAL_LIMITS } from "../core/config/config";
import { createMarkdownItEngine } from "../core/markdown/markdown-it-engine";

const root = path.resolve(process.argv[2] ?? process.cwd());
const engine = createMarkdownItEngine();
const SKIP = new Set(["node_modules", ".git", ".venv", "venv", "dist", "out", "build", "target", "vendor"]);
const VERSION = "3.1.0";

/** Markdown files under the root (dependency and build folders skipped), at most `folderMapFiles`. */
export function listDocs(dir = root): ToolDoc[] {
  const out: ToolDoc[] = [];
  const walk = (d: string) => {
    if (out.length >= INTERNAL_LIMITS.folderMapFiles) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= INTERNAL_LIMITS.folderMapFiles) return;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(abs);
      } else if (e.isFile() && /\.(md|markdown|mdc)$/i.test(e.name)) {
        const doc = readDoc(path.relative(dir, abs), dir);
        if (doc) out.push(doc);
      }
    }
  };
  walk(dir);
  return out;
}

/** One Markdown file under the root, by relative path — undefined outside it, too big, or not Markdown. */
export function readDoc(file: string, dir = root): ToolDoc | undefined {
  const abs = path.resolve(dir, file);
  const rel = path.relative(dir, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel) || !/\.(md|markdown|mdc)$/i.test(rel)) return undefined;
  try {
    const stat = statSync(abs);
    if (!stat.isFile() || stat.size > DEFAULT_CONFIG.largeFileBytes) return undefined;
    return { file: rel.split(path.sep).join("/"), text: readFileSync(abs, "utf8"), modified: stat.mtimeMs };
  } catch {
    return undefined;
  }
}

export function callTool(
  name: string,
  args: { file?: unknown },
  dir = root,
): { text: string; isError: boolean } {
  const now = Date.now();
  const tool = TOOLS.find((t) => t.name === name)?.name as ToolName | undefined;
  if (!tool) return { text: `Unknown tool: ${name}`, isError: true };
  if (tool === "docmap_plans")
    return {
      text: plansTool(listDocs(dir), now, DEFAULT_CONFIG.staleDays, INTERNAL_LIMITS.aiToolItems),
      isError: false,
    };
  if (tool === "docmap_open_questions") return { text: questionsTool(listDocs(dir), now), isError: false };
  const file = typeof args.file === "string" ? args.file : "";
  const doc = readDoc(file, dir);
  if (!doc) return { text: `No Markdown file "${file}" under ${dir}.`, isError: true };
  if (tool === "docmap_outline") return { text: outlineTool(doc, engine), isError: false };
  const docDir = path.dirname(path.resolve(dir, doc.file));
  return {
    text: checkDocTool(doc, (p) =>
      [path.resolve(dir, p), path.resolve(docDir, p)].some((x) => existsSync(x)),
    ),
    isError: false,
  };
}

type Message = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

/** Answers one JSON-RPC message (undefined for a notification). */
export function handle(msg: Message, dir = root): object | undefined {
  const reply = (result: object) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  const fail = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id: msg.id ?? null,
    error: { code, message },
  });
  if (msg.id === undefined) return undefined; // notifications (initialized, cancelled) need no answer
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion:
          typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "docmap", version: VERSION },
        instructions:
          "docmap reads this project's Markdown docs: plans, open questions, outlines, and paths a doc names that no longer exist.",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    case "tools/call": {
      const name = typeof msg.params?.name === "string" ? msg.params.name : "";
      const args = (msg.params?.arguments ?? {}) as { file?: unknown };
      const { text, isError } = callTool(name, args, dir);
      return reply({ content: [{ type: "text", text }], isError });
    }
    default:
      return fail(-32601, `Method not found: ${msg.method ?? ""}`);
  }
}

if (require.main === module) {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    let msg: Message;
    try {
      msg = JSON.parse(line) as Message;
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
      );
      return;
    }
    const out = handle(msg);
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  });
}
