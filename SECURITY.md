# Security & Enterprise Privacy Guide

This document provides an auditable summary of what **All-in-One Markdown Viewer (`docmap`)** accesses, what runs locally, its security boundaries, and how enterprise teams can configure or lock down optional features.

---

## 1. Zero Telemetry & Zero External Network Calls

- **Zero telemetry:** docmap collects no usage metrics, analytics, crash reports, or user identifiers. There are no accounts and no docmap backend servers.
- **Zero external network calls:** The extension makes no outbound HTTP, HTTPS, or WebSocket requests. Markdown parsing, Mermaid diagram rendering (bundled locally), search, Docs Inbox indexing, and trust checks execute 100% locally inside VS Code's extension host and sandboxed webview.
- **Lazy activation:** The extension activates on `onLanguage:markdown` (never eagerly on `*` / startup) and does not run background workspace scans on startup.
- **Untrusted workspaces (Restricted Mode):** Supported (`capabilities.untrustedWorkspaces.supported: true`) for safe, read-only Markdown previewing. All `git` subprocess calls are automatically disabled when a workspace is untrusted (`!vscode.workspace.isTrusted`).

---

## 2. Exact Files Read & `.env` Non-Access Guarantee

### `.env` files are never read

**docmap never reads `.env` or secret `.env.*` files** (such as `.env.local`, `.env.production`, or `.env.staging`). In `src/extension/repo-facts.ts`, non-template `.env*` files are explicitly excluded from both file reading and file-system watcher triggers.

When building environment-variable facts for trust markers, docmap strictly reads only:
- Template files: `.env.example`, `.env.sample`, `.env.template`
- Container/CI definitions: `docker-compose*.yml`/`.yaml` and `.github/workflows/*.yml`/`.yaml`
- Environment variable key references in source code (e.g. `process.env.KEY`, `os.environ["KEY"]`)

### Workspace files read locally

| Feature | Files accessed (read-only) | Scope & limits |
| --- | --- | --- |
| **Markdown preview & navigation** | The active Markdown file (`*.md`, `*.markdown`, `*.mdc`) and local images it references | Files above `docmap.largeFileBytes` (default `2097152` = 2 MB) prompt before opening. |
| **Docs Inbox, Plans Dashboard, Search, Doc Atlas** | Workspace Markdown files (`*.md`, `*.markdown`, `*.mdc`) on demand | Skips dot-folders (except `docmap.includeFolders`, default `[".github"]`), dependency/build folders, and `docmap.skipFolders`. |
| **Trust markers (`repo-facts.ts`)** | Workspace file path list, `package.json` (scripts & dependency versions), `.nvmrc` / `.node-version`, `Makefile`, `justfile`, template/CI env files above, and bounded source-code files (`*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.mjs`, `*.cjs`, `*.py`, `*.go`, `*.rs`, `*.java`, `*.kt`, `*.cs`, `*.rb`, `*.php`, `*.swift`, `*.scala`, `*.c`, `*.cc`, `*.cpp`, `*.h`, `*.hpp`) | Built on demand per workspace folder. Skips `node_modules`, `.git`, `.venv`, `dist`, `out`, `build`, `target`, `vendor`, `.next`, `coverage`, `__pycache__`, `tmp`, `.cache`, etc. Enforces strict file-count, byte, and identifier caps. |
| **Git metadata (`git.ts`)** | Read-only `git` queries (`blame`, `log`, `show`, `rev-list`, `tag`, `symbolic-ref`, `for-each-ref`, `config user.name`, `status`) via `execFile("git", ...)` without shell interpolation | Trusted workspaces only; skipped in untrusted workspaces and on large files for `git blame`. |

### Local storage & file writes

- **VS Code local storage only:** Remembered heading positions (heading IDs only when `docmap.rememberPlace` is enabled), review marks, highlights, trust verdicts, and section fingerprints are stored in VS Code's local `workspaceState` (storage keys `"docmap.places"` and `"docmap.notes"`). Last-read file copies for **Compare → Since I last read it** are stored in VS Code's local `globalStorageUri` and automatically pruned.
- **Clear all saved data:** Run **All-in-One Markdown Viewer: Clear docmap's Saved Data…** from the Command Palette at any time to wipe stored places, notes, last-read copies, and AI consent state.
- **No automatic edits:** docmap never modifies your repository files automatically. Workspace writes happen only on explicit user actions (ticking a task checkbox, changing a table status cell, applying a moved-file link fix, formatting a table / updating a TOC, creating a doc from a template, or adding agent prompt files).

---

## 3. Webview Security Model

Every preview panel and custom editor page runs under defense-in-depth rules (`src/core/markdown/markdown-it-engine.ts`, `src/extension/panel-html.ts`):

- **Raw HTML disabled (`html: false`):** `markdown-it` runs with `html: false`. Raw HTML in Markdown is rendered as escaped plain text and never executes. Only a small, balanced allowlist of benign tags (`<details>`, `<summary>`, `<kbd>`, `<br>`, `<picture>`, `<img>`, etc.) is re-emitted with attributes stripped or strictly validated (`src/core/markdown/safe-html.ts`).
- **URL validation:** Only `http:`, `https:`, `mailto:`, same-document `#` anchors, and relative paths are allowed as links; `javascript:` and other schemes stay plain text.
- **Strict nonce-based Content-Security-Policy (CSP):**
  - `default-src 'none'; base-uri 'none'; form-action 'none'`
  - `script-src 'nonce-<random>'` — scripts require a per-panel cryptographic nonce; inline scripts and `eval` are blocked.
  - `img-src <cspSource> data:; font-src <cspSource>`
  - `style-src <cspSource>` (adds `'unsafe-inline'` for styles only when `docmap.diagrams` is enabled so bundled Mermaid SVGs can render; turning off `docmap.diagrams` removes `'unsafe-inline'` completely).
- **Scoped resources & typed messaging:** `localResourceRoots` is limited to the extension's `dist/` directory and the workspace/document roots. Host ↔ webview messages are validated against a typed discriminated union (`src/core/protocol/messages.ts`).

---

## 4. Localhost-Only Live Browser Server

When a user explicitly clicks **Open Preview in Browser** with `docmap.liveBrowser` enabled, docmap starts an on-demand local HTTP server (`src/extension/live-server.ts`, `src/extension/live-view.ts`):

- **Never runs at startup:** Starts only on first explicit browser preview and closes automatically when VS Code exits.
- **Loopback binding only:** Binds exclusively to `127.0.0.1` on an ephemeral OS-assigned port (`0`) — never exposed to `0.0.0.0` or the local network.
- **32-byte random token:** Every URL path requires a cryptographically random 32-byte (64-hex-character) token verified with `crypto.timingSafeEqual`; requests without the exact token receive `404`.
- **DNS rebinding protection (`Host` header check):** Every request's `Host` header is checked against `127.0.0.1`, `localhost`, or `[::1]`; any other `Host` header is rejected with `403`.
- **Hardened responses:** Only `GET` and `HEAD` are accepted (`405` otherwise). All responses include `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: frame-ancestors 'none'`, and no CORS headers. Directly served files (such as images/SVGs) add `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'`.
- **Scoped content:** Serves only explicitly opened Markdown documents, linked Markdown files inside allowed workspace roots, and approved image/diagram assets.

To disable the local server entirely (falling back to static HTML snapshot files), set `"docmap.liveBrowser": false`.

---

## 5. Optional Features & Enterprise Configuration

All AI integration levels are **off by default**. Prompts are copied to the clipboard by default (`"docmap.agentTarget": "clipboard"`) and never transmitted by docmap.

| Feature | Setting | Default | Enterprise lockdown value & behavior |
| --- | --- | --- | --- |
| **Live browser server** | `docmap.liveBrowser` | `true` | `false` — disables the `127.0.0.1` HTTP server; **Open Preview in Browser** saves a static HTML snapshot instead. |
| **AI Level 1 (Answer with my model)** | `docmap.ai.answerWithMyModel` | `false` | `false` (default) — blocks direct calls to VS Code's `vscode.lm` language-model API. When enabled by a user, requires an explicit modal consent prompt before sending text to the user's own configured VS Code model. |
| **AI Level 2 (Copilot tools & local MCP server)** | `docmap.ai.tools` | `false` | `false` (default) — disables Copilot agent tools (`#docmapPlans`, `#docmapQuestions`, `#docmapOutline`, `#docmapCheckDoc`) and gates MCP setup. The bundled MCP server (`dist/mcp.js`) communicates over stdio only, reads Markdown files strictly inside the target folder, never writes, and opens no network connections. |
| **AI prompt delivery** | `docmap.agentTarget` | `"clipboard"` | `"clipboard"` (default) — copies prompts locally instead of opening Copilot Chat automatically. |
| **Mermaid diagrams** | `docmap.diagrams` | `true` | `false` — disables Mermaid rendering and removes `'unsafe-inline'` from the webview `style-src` CSP. |
| **CodeLens on code files** | `docmap.codeLens` | `true` | `false` — disables `Mentioned in N docs` CodeLens annotations above source files. |
| **Remember reading position** | `docmap.rememberPlace` | `true` | `false` — stops persisting last-read heading IDs across VS Code restarts. |
| **Home page on start** | `docmap.homeOnStart` | `false` | `false` (default) — prevents opening the Home summary automatically. |
| **Exclude sensitive/large folders** | `docmap.skipFolders` | `[]` | e.g. `["secrets", "vendor"]` — excludes folders from Docs Inbox, search, Plans Dashboard, and trust checks. |
| **Large file guardrail** | `docmap.largeFileBytes` | `2097152` | Prompt threshold in bytes (default 2 MB). |

### Recommended locked-down `settings.json` for corporate environments

```json
{
  "docmap.liveBrowser": false,
  "docmap.ai.answerWithMyModel": false,
  "docmap.ai.tools": false,
  "docmap.agentTarget": "clipboard",
  "docmap.homeOnStart": false
}
```

---

## 6. Reporting a Vulnerability

If you discover a security vulnerability in docmap:

1. Prefer GitHub's private **Report a vulnerability** (Security Advisories) tab on the repository, if available.
2. Otherwise, open a minimal issue at <https://github.com/kish21/markdown-docmap/issues> **without exploit details** and request a private reporting channel.

Please include the extension version, VS Code version, and reproduction steps once a private channel is established.
