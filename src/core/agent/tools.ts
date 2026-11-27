/**
 * 3.0 AI level 2: docmap's tools for agents — the same four in Copilot agent mode (VS Code language model tools) and
 * in the local MCP server (Claude Code, Cursor, …). Pure: the caller lists and reads the files; these answer in
 * Markdown an agent can read. Nothing here calls a model.
 */

import { analyze } from "../insights/analyze";
import { docItems, questionsReport } from "../insights/items";
import { type PlanRow, planRow } from "../insights/plans";
import { dashboardMarkdown } from "../insights/plans-dashboard";
import { searchDoc } from "../insights/search";
import type { MarkdownEngine } from "../markdown/engine";
import { claimsIn } from "../trust/claims";

export type ToolName =
  | "docmap_plans"
  | "docmap_open_questions"
  | "docmap_outline"
  | "docmap_check_doc"
  | "docmap_decisions"
  | "docmap_search";

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
const QUERY = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Plain-text search phrase (at least 2 characters, case-insensitive)",
    },
  },
  required: ["query"],
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
  {
    name: "docmap_decisions",
    title: "Decision log",
    description:
      "Every decision ('Decision:', 'We decided:', 'We chose:'…) recorded across the workspace's Markdown docs, grouped by file with line numbers.",
    inputSchema: NONE,
  },
  {
    name: "docmap_search",
    title: "Search all docs",
    description:
      "Search every Markdown doc in the workspace for a plain-text phrase, returning matching files, heading trails, line numbers, and snippets.",
    inputSchema: QUERY,
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

/** Every recorded decision across workspace Markdown docs, grouped by file with 1-based line links. */
export function decisionsTool(docs: readonly ToolDoc[], max = 200): string {
  const sections: string[] = [];
  let total = 0;
  for (const d of docs) {
    if (total >= max) break;
    const facts = analyze(d.text);
    if (facts.decisions.length === 0) continue;
    const take = facts.decisions.slice(0, max - total);
    total += take.length;
    const label = facts.title ? `${facts.title} (\`${d.file}\`)` : `\`${d.file}\``;
    sections.push(
      `## ${label}`,
      "",
      ...take.map((dec) => `- ${dec.text} _([line ${dec.line + 1}](${d.file}#L${dec.line + 1}))_`),
      "",
    );
  }
  if (total === 0) return "No decisions found across the workspace's Markdown docs.";
  return [`# Decisions (${total})`, "", ...sections].join("\n").trimEnd();
}

/** Case-insensitive plain-text search across workspace Markdown docs with heading trails and line numbers. */
export function searchTool(docs: readonly ToolDoc[], query: string, maxPerDoc = 10, maxTotal = 60): string {
  const q = query.trim();
  if (q.length < 2) return "Search query must be at least 2 characters.";
  const sections: string[] = [];
  let total = 0;
  let matchingFiles = 0;
  for (const d of docs) {
    if (total >= maxTotal) break;
    const hits = searchDoc(d.text, q, Math.min(maxPerDoc, maxTotal - total));
    if (hits.length === 0) continue;
    matchingFiles++;
    total += hits.length;
    sections.push(
      `## \`${d.file}\``,
      "",
      ...hits.map((h) => {
        const trail = h.trail.length > 0 ? `**${h.trail.join(" › ")}** — ` : "";
        return `- ${trail}${h.snippet} _([line ${h.line + 1}](${d.file}#L${h.line + 1}))_`;
      }),
      "",
    );
  }
  if (total === 0) return `No matches for "${q}" across ${docs.length} Markdown docs.`;
  return [
    `# Search results for "${q}" (${total} match${total === 1 ? "" : "es"} in ${matchingFiles} file${matchingFiles === 1 ? "" : "s"})`,
    "",
    ...sections,
  ]
    .join("\n")
    .trimEnd();
}
