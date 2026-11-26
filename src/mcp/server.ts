/**
 * 3.0 AI level 2, for any agent: docmap's tools as a local MCP server (stdio, JSON-RPC 2.0, one message per line).
 * Claude Code, Cursor and other agents start it themselves (`node docmap-mcp.js [folder]`); it reads the Markdown
 * files under that folder (default: the current directory) and answers with the same pure tools as Copilot's. It
 * never writes, never opens a network connection, and reads nothing outside the folder. No `vscode` here.
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
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
const INCLUDE_DOT_DIRS = new Set([".github"]);
const SAFE_ENV_FILE = /^\.env\.(?:example|sample|template)$/i;
const VERSION = "3.3.0";

function isSecretEnvPath(filePath: string): boolean {
  const base = path.basename(filePath);
  return /^\.env(?:\.|$)/i.test(base) && !SAFE_ENV_FILE.test(base);
}

function realRootOf(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

function isWithinRoot(rootReal: string, targetPath: string): boolean {
  const rel = path.relative(rootReal, targetPath);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Markdown files under the root (dependency, dot, and build folders skipped), capped by file count and total bytes. */
export function listDocs(dir = root): ToolDoc[] {
  const out: ToolDoc[] = [];
  let totalBytes = 0;
  const walk = (d: string) => {
    if (out.length >= INTERNAL_LIMITS.folderMapFiles || totalBytes >= INTERNAL_LIMITS.inboxTotalScanBytes)
      return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= INTERNAL_LIMITS.folderMapFiles || totalBytes >= INTERNAL_LIMITS.inboxTotalScanBytes)
        return;
      if (e.isSymbolicLink()) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue;
        if (e.name.startsWith(".") && !INCLUDE_DOT_DIRS.has(e.name)) continue;
        walk(abs);
      } else if (e.isFile() && /\.(md|markdown|mdc)$/i.test(e.name)) {
        const doc = readDoc(path.relative(dir, abs), dir);
        if (doc) {
          const bytes = Buffer.byteLength(doc.text, "utf8");
          if (totalBytes + bytes > INTERNAL_LIMITS.inboxTotalScanBytes) continue;
          totalBytes += bytes;
          out.push(doc);
        }
      }
    }
  };
  walk(dir);
  return out;
}

/** One Markdown file under the root, by relative path — undefined outside it, symlink escape, secret .env, too big, or not Markdown. */
export function readDoc(file: string, dir = root): ToolDoc | undefined {
  const abs = path.resolve(dir, file);
  const rel = path.relative(dir, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel) || !/\.(md|markdown|mdc)$/i.test(rel)) return undefined;
  try {
    const rootReal = realRootOf(dir);
    const absReal = realpathSync(abs);
    if (!isWithinRoot(rootReal, absReal) || isSecretEnvPath(absReal)) return undefined;
    const stat = statSync(absReal);
    if (!stat.isFile() || stat.size > DEFAULT_CONFIG.largeFileBytes) return undefined;
    return {
      file: rel.split(path.sep).join("/"),
      text: readFileSync(absReal, "utf8"),
      modified: stat.mtimeMs,
    };
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
  const rootReal = realRootOf(dir);
  const existsInRoot = (candidate: string): boolean => {
    if (isSecretEnvPath(candidate) || !existsSync(candidate)) return false;
    try {
      const real = realpathSync(candidate);
      if (isSecretEnvPath(real)) return false;
      return isWithinRoot(rootReal, real);
    } catch {
      return false;
    }
  };
  return {
    text: checkDocTool(doc, (p) => [path.resolve(dir, p), path.resolve(docDir, p)].some(existsInRoot)),
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
export function handle(msg: unknown, dir = root): object | undefined {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
  }
  const m = msg as Message;
  const reply = (result: object) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  const fail = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id: m.id ?? null,
    error: { code, message },
  });
  if (m.id === undefined) return undefined; // notifications (initialized, cancelled) need no answer
  switch (m.method) {
    case "initialize":
      return reply({
        protocolVersion:
          typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2024-11-05",
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
      const name = typeof m.params?.name === "string" ? m.params.name : "";
      const args = (m.params?.arguments ?? {}) as { file?: unknown };
      const { text, isError } = callTool(name, args, dir);
      return reply({ content: [{ type: "text", text }], isError });
    }
    default:
      return fail(-32601, `Method not found: ${m.method ?? ""}`);
  }
}

/** Starts the stdio JSON-RPC 2.0 loop (one message per line). */
export function startStdio(dir = root): void {
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    if (Buffer.byteLength(line, "utf8") > INTERNAL_LIMITS.mcpMaxLineBytes) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } })}\n`,
      );
      return;
    }
    let msg: Message;
    try {
      msg = JSON.parse(line) as Message;
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`,
      );
      return;
    }
    const out = handle(msg, dir);
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  });
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  startStdio();
}
