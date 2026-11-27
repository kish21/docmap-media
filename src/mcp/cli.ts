import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { startStdio, VERSION } from "./server";

const args = process.argv.slice(2);

function readSkill(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const skillPath = path.resolve(here, "..", "SKILL.md");
  return readFileSync(skillPath, "utf8");
}

function printHelp(): void {
  process.stdout.write(
    [
      `docmap-mcp ${VERSION} — local stdio MCP server for Markdown docs`,
      "",
      "Usage:",
      "  npx -y docmap-mcp [folder]                  Start stdio MCP server (default: current directory)",
      "  npx -y docmap-mcp --install-skill [target]  Install SKILL.md into your project:",
      "                                                claude (default) -> .claude/skills/docmap/SKILL.md",
      "                                                agents           -> .agents/skills/docmap/SKILL.md",
      "  npx -y docmap-mcp --print-skill             Print SKILL.md to stdout",
      "  npx -y docmap-mcp --version                 Show version",
      "  npx -y docmap-mcp --help                    Show this help",
      "",
      "Tools: docmap_plans, docmap_open_questions, docmap_decisions, docmap_search, docmap_outline, docmap_check_doc",
      "Zero runtime dependencies · Zero network · Zero telemetry · Read-only & sandboxed",
      "",
    ].join("\n"),
  );
}

function installSkill(targetArg: string | undefined): void {
  const target = (targetArg ?? "claude").trim();
  const relDest =
    target === "claude"
      ? path.join(".claude", "skills", "docmap", "SKILL.md")
      : target === "agents"
        ? path.join(".agents", "skills", "docmap", "SKILL.md")
        : target;
  const cwd = process.cwd();
  const absDest = path.resolve(cwd, relDest);
  const relCheck = path.relative(cwd, absDest);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    process.stderr.write(`Refusing to write outside current directory: ${target}\n`);
    process.exit(1);
  }
  const content = readSkill();
  mkdirSync(path.dirname(absDest), { recursive: true });
  writeFileSync(absDest, content, "utf8");
  process.stdout.write(`Installed docmap agent skill to ${relCheck.split(path.sep).join("/")}\n`);
}

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`docmap-mcp ${VERSION}\n`);
  process.exit(0);
}

if (args.includes("--print-skill")) {
  process.stdout.write(readSkill());
  process.exit(0);
}

const installIdx = args.indexOf("--install-skill");
if (installIdx !== -1) {
  const next = args[installIdx + 1];
  installSkill(next && !next.startsWith("-") ? next : undefined);
  process.exit(0);
}

if (process.stdin.isTTY) {
  process.stderr.write(
    [
      `docmap-mcp ${VERSION} is a local stdio MCP server (waiting for JSON-RPC from an MCP client).`,
      "Configure it in Claude Desktop, Claude Code, Cursor, or Antigravity, or run:",
      "  npx -y docmap-mcp --help",
      "  npx -y docmap-mcp --install-skill",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

startStdio();
