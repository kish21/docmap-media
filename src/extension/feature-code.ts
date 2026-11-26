import * as vscode from "vscode";
import { type CodeItem, codeItemsIn, namedFiles } from "../core/insights/feature-atlas";
import { log } from "./log";
import { repoFactsFor } from "./repo-facts";

/** Files read per feature page to find where its functions are defined, and the largest one read. */
const MAX_SOURCES = 20;
const MAX_SOURCE_BYTES = 1_000_000;

/**
 * Doc Atlas per feature (owner call 2026-11-23): the code a feature doc names, each found or gone, a function linked to
 * the line that defines it in one of the files the doc names. Reads only workspace files; nothing is written.
 */
export async function codeItems(doc: vscode.Uri, text: string): Promise<CodeItem[]> {
  const repo = await repoFactsFor(doc).catch(() => undefined);
  const folder = vscode.workspace.getWorkspaceFolder(doc);
  if (!repo || !folder) return [];
  const sources = new Map<string, string>();
  for (const rel of namedFiles(text, repo).slice(0, MAX_SOURCES)) {
    const uri = vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File || stat.size > MAX_SOURCE_BYTES) continue;
      sources.set(rel, new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
    } catch (e) {
      log().info(`feature atlas: could not read ${rel}: ${String(e)}`);
    }
  }
  return codeItemsIn(text, repo, sources);
}
