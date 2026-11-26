---
name: docmap
description: Navigate and audit a repository's Markdown docs via docmap's local stdio MCP tools (docmap_outline, docmap_plans, docmap_open_questions, docmap_check_doc) before reading long files.
---

# docmap — Markdown Navigation & Audit Skill

Use docmap's local MCP tools to inspect Markdown documentation quickly without loading entire long files into context.

All tools are **read-only**, run locally over stdio, make **zero network requests**, collect **zero telemetry**, and are strictly confined to the configured workspace directory.

## Available Tools

| Tool | Input | When to use |
|---|---|---|
| `docmap_outline` | `{ "file": "relative/path.md" }` | **Before reading any long Markdown file.** Returns headings with levels and 1-based line numbers, plus open tasks and open questions so you can read only the relevant line range. |
| `docmap_plans` | `{}` | **When asked about project status, roadmap, or plans.** Scans Markdown docs and returns one consolidated table: progress, status, owners, dates/overdue items, open questions, risks, decisions, and what needs attention. |
| `docmap_open_questions` | `{}` | **When looking for blockers, decisions needed, or unresolved items.** Lists every open question across all Markdown docs with file paths, line numbers, and named people. |
| `docmap_check_doc` | `{ "file": "relative/path.md" }` | **When verifying whether a doc is up to date with the codebase.** Checks every file, folder, and path named in backticks against the repository and lists the ones that no longer exist. |

## Recommended Workflow

1. **Before reading a long Markdown file (> ~100 lines):**
   - Call `docmap_outline` with the workspace-relative path (e.g. `docs/architecture.md`).
   - Use the returned heading line numbers to read only the section(s) you need.
2. **To get oriented in a repository with many docs:**
   - Call `docmap_plans` to see active plans, completion status, and overdue or stale items.
   - Call `docmap_open_questions` to surface unresolved questions across the project.
3. **Before trusting or updating a design doc or spec:**
   - Call `docmap_check_doc` on the file to find broken or moved code paths it still references.

## Constraints

- Always pass **workspace-relative** paths (e.g. `docs/plan.md`, not absolute paths or `../` traversals — paths outside the target folder are rejected).
- Only Markdown files (`.md`, `.markdown`, `.mdc`) are inspected; dependency and build directories (`node_modules`, `.git`, `dist`, `build`, etc.) are skipped automatically.
