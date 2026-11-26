# docmap-mcp

Local stdio [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [docmap](https://github.com/kish21/markdown-docmap) — gives Claude Desktop, Claude Code, Cursor, Antigravity, and other MCP-compatible agents fast, structured access to a project's Markdown docs without installing VS Code.

- **Zero runtime dependencies** — single standalone Node.js bundle (`node >= 22`)
- **Zero network access & zero telemetry** — runs 100% locally over stdio
- **Read-only & sandboxed** — confined strictly to the target folder (`process.argv[2]` or `process.cwd()`); path traversal outside the folder is rejected

## Tools

- `docmap_plans` — Every plan in the folder's Markdown docs as one table (progress, status, owners, dates/overdue, open questions, risks, decisions, what needs attention).
- `docmap_open_questions` — Every open question across all Markdown docs, grouped by file with line numbers and named owners.
- `docmap_outline` — A Markdown file's headings with levels and line numbers, plus open tasks and questions (call before reading a long doc).
- `docmap_check_doc` — File and folder paths a Markdown doc names in `` `code` `` that no longer exist in the repository.

## Quick Start

```bash
npx -y docmap-mcp /path/to/your/project
```

If no folder argument is passed, `docmap-mcp` uses the current working directory.

## Agent Configuration

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "docmap": {
      "command": "npx",
      "args": ["-y", "docmap-mcp", "/absolute/path/to/your/project"]
    }
  }
}
```

### Claude Code

Using the CLI:

```bash
claude mcp add docmap -- npx -y docmap-mcp /absolute/path/to/your/project
```

Or in your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "docmap": {
      "command": "npx",
      "args": ["-y", "docmap-mcp", "."]
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "docmap": {
      "command": "npx",
      "args": ["-y", "docmap-mcp", "${workspaceFolder}"]
    }
  }
}
```

### Antigravity (`mcp_config.json`)

```json
{
  "mcpServers": {
    "docmap": {
      "command": "npx",
      "args": ["-y", "docmap-mcp", "/absolute/path/to/your/project"]
    }
  }
}
```

## Agent Skill (`SKILL.md`)

This package ships a ready-to-use [`SKILL.md`](./SKILL.md) that teaches agents when and how to call `docmap_outline`, `docmap_plans`, `docmap_open_questions`, and `docmap_check_doc` before reading long Markdown files. Copy `SKILL.md` into your agent's skills directory (for example `.claude/skills/docmap/SKILL.md` or `.agents/skills/docmap/SKILL.md`).

## License

MIT — see [LICENSE](./LICENSE).
