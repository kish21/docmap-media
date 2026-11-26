/**
 * 3.0 AI level 2: docmap's tools for agents — the same four in Copilot agent mode (VS Code language model tools) and
 * in the local MCP server (Claude Code, Cursor, …). Pure: the caller lists and reads the files; these answer in
 * Markdown an agent can read. Nothing here calls a model.
 */

import { analyze } from "../insights/analyze";
import { docItems, questionsReport } from "../insights/items";
import { type PlanRow, planRow } from "../insights/plans";
import { dashboardMarkdown } from "../insights/plans-dashboard";
import type { MarkdownEngine } from "../markdown/engine";
import { claimsIn } from "../trust/claims";

export type ToolName = "docmap_plans" | "docmap_open_questions" | "docmap_outline" | "docmap_check_doc";

export interface ToolDef {
  readonly name: ToolName;
  readonly title: string;
  readonly description: string;
  /** JSON Schema of the input (MCP `inputSchema`, VS Code `inputSchema`). */
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, { readonly type: "string"; readonly description: string }>;
    readonly required?: readonly string[];
  };
}

const FILE = {
  type: "object",
  properties: { file: { type: "string", description: "Workspace-relative path of the Markdown file" } },
  required: ["file"],
} as const;
const NONE = { type: "object", properties: {} } as const;

export const TOOLS: readonly ToolDef[] = [
  {
    name: "docmap_plans",
    title: "Plans dashboard",
    description:
      "Every plan in the workspace's Markdown docs as one table: progress, status, owners, next date or overdue, open questions, risks, decisions, last changed; plus what needs attention.",
    inputSchema: NONE,
  },
  {
    name: "docmap_open_questions",
    title: "Open questions",
    description:
      "Every open question in the workspace's Markdown docs, by file, with line numbers and who they name.",
    inputSchema: NONE,
  },
  {
    name: "docmap_outline",
    title: "Doc outline",
    description:
      "A Markdown file's headings with levels and line numbers, plus its open tasks and questions — read this before reading a long doc.",
    inputSchema: FILE,
  },
  {
    name: "docmap_check_doc",
    title: "Check a doc against the repo",
    description:
      "Files, folders and paths a Markdown doc names in `code` that do not exist in the repository — places where the doc no longer matches the code.",
    inputSchema: FILE,
  },
];

export interface ToolDoc {
  /** Workspace-relative path. */
  readonly file: string;
  readonly text: string;
  /** Last change (ms). */
  readonly modified: number;
}

export function plansTool(docs: readonly ToolDoc[], now: number, staleDays: number, max: number): string {
  const rows = docs
    .map((d) => planRow(d.text, d.file, d.modified, now, staleDays))
    .filter((r): r is PlanRow => r !== undefined)
    .slice(0, max);
  return dashboardMarkdown(rows, now, "attention");
}

export function questionsTool(docs: readonly ToolDoc[], now: number): string {
  return questionsReport(
    docs.map((d) => ({ file: d.file, title: analyze(d.text).title ?? d.file, items: docItems(d.text) })),
    new Date(now).toISOString().slice(0, 10),
  );
}

export function outlineTool(doc: ToolDoc, engine: MarkdownEngine): string {
  const parsed = engine.parse(doc.text, 0, {});
  const headings = parsed.ok ? parsed.document.headings : [];
  const items = docItems(doc.text);
  const out = [`# Outline of ${doc.file}`, ""];
  for (const h of headings) out.push(`${"  ".repeat(h.level - 1)}- ${h.text} (line ${h.line + 1})`);
  if (headings.length === 0) out.push("(no headings)");
  const tasks = items.filter((i) => i.kind === "task");
  const questions = items.filter((i) => i.kind === "question");
  if (tasks.length)
    out.push("", `## Open tasks (${tasks.length})`, ...tasks.map((t) => `- ${t.text} (line ${t.line + 1})`));
  if (questions.length)
    out.push(
      "",
      `## Open questions (${questions.length})`,
      ...questions.map((q) => `- ${q.text} (line ${q.line + 1})`),
    );
  return out.join("\n");
}

/** `exists` answers for a path relative to the repository root or to the doc's folder. */
export function checkDocTool(doc: ToolDoc, exists: (path: string) => boolean): string {
  const paths = [
    ...new Set(
      claimsIn(doc.text)
        .filter((c) => c.kind === "path")
        .map((c) => c.value),
    ),
  ];
  const missing = paths.filter((p) => !exists(p));
  return missing.length === 0
    ? `${doc.file}: every path it names (${paths.length}) exists in the repository.`
    : [
        `${doc.file} names ${missing.length} path${missing.length === 1 ? " that does" : "s that do"} not exist:`,
        ...missing.map((p) => `- \`${p}\``),
        "",
        "Find where each went (renamed, moved, removed) and update the doc, or ask the owner.",
      ].join("\n");
}
