import * as path from "node:path";
import * as vscode from "vscode";
import {
  checkDocTool,
  decisionsTool,
  outlineTool,
  plansTool,
  questionsTool,
  searchTool,
  TOOLS,
  type ToolDoc,
  type ToolName,
} from "../core/agent/tools";
import { INTERNAL_LIMITS } from "../core/config/config";
import type { MarkdownEngine } from "../core/markdown/engine";
import type { DocsInbox } from "./inbox";
import { existsConfinedPath, resolveConfinedFile } from "./links";
import { log } from "./log";
import { readConfig } from "./settings";

/**
 * 3.0 AI level 2, in VS Code: docmap's tools for Copilot agent mode (`#docmapPlans`, `#docmapOutline`…). Declared
 * in package.json behind `config.docmap.ai.tools` (off by default) and answered here, from the files on this
 * computer. An editor without the language model tools API simply has no tools (level 0 and 1 still work).
 */
export function registerAiTools(inbox: DocsInbox, engine: MarkdownEngine): vscode.Disposable {
  const lm = vscode.lm as Partial<typeof vscode.lm> | undefined;
  if (typeof lm?.registerTool !== "function") return new vscode.Disposable(() => undefined);
  const disposables = TOOLS.map((def) =>
    lm.registerTool!<{ file?: string; query?: string }>(def.name, {
      invoke: async (options) => {
        const text = await answer(def.name, options.input, inbox, engine);
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
      },
    }),
  );
  return vscode.Disposable.from(...disposables);
}

/** One tool's answer (shared by the Copilot tools; the MCP server has its own file access). */
export async function answer(
  name: ToolName,
  input: { file?: string; query?: string } | undefined,
  inbox: DocsInbox,
  engine: MarkdownEngine,
): Promise<string> {
  if (!readConfig().aiTools) return "docmap's tools are off: turn on the setting docmap.ai.tools.";
  const now = Date.now();
  try {
    switch (name) {
      case "docmap_plans":
        return plansTool(await inbox.toolDocs(), now, readConfig().staleDays, INTERNAL_LIMITS.aiToolItems);
      case "docmap_open_questions":
        return questionsTool(await inbox.toolDocs(), now);
      case "docmap_decisions":
        return decisionsTool(await inbox.toolDocs());
      case "docmap_search":
        return searchTool(await inbox.toolDocs(), input?.query ?? "");
      default: {
        const file = input?.file;
        const doc = await readDoc(file);
        if (!doc) return `No Markdown file "${file ?? ""}" in this workspace.`;
        if (name === "docmap_outline") return outlineTool(doc.doc, engine);
        return checkDocTool(doc.doc, (p) =>
          [path.resolve(doc.root, p), path.resolve(path.dirname(doc.abs), p)].some((x) =>
            existsConfinedPath(x, doc.root),
          ),
        );
      }
    }
  } catch (error) {
    log().warn(`agent tool ${name} failed: ${String(error)}`);
    return `docmap could not answer: ${String(error)}`;
  }
}

/** A workspace Markdown file named by an agent: relative to a workspace folder, never outside one or via symlink escape. */
async function readDoc(
  file: string | undefined,
): Promise<{ doc: ToolDoc; abs: string; root: string } | undefined> {
  if (!file || !/\.(md|markdown|mdc)$/i.test(file)) return undefined;
  const normalized = file.replace(/\\/g, "/");
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== "file") continue;
    const root = folder.uri.fsPath;
    const confined = resolveConfinedFile(normalized, root);
    if (!confined) continue;
    const rel = path.relative(root, path.resolve(root, normalized));
    try {
      const uri = vscode.Uri.file(confined);
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > readConfig().largeFileBytes) continue;
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      return {
        doc: { file: rel.split(path.sep).join("/"), text, modified: stat.mtime },
        abs: confined,
        root,
      };
    } catch {
      // not in this folder
    }
  }
  return undefined;
}
