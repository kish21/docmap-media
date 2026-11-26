import * as path from "node:path";
import * as vscode from "vscode";
import { rootContaining } from "./links";

/** The folders a document's links and images may reach: the workspace folders, or its own folder if outside one. */
export function allowedRoots(document: Pick<vscode.TextDocument, "uri">): string[] {
  if (document.uri.scheme !== "file") return [];
  const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  const docPath = document.uri.fsPath;
  const inside = folders.filter((f) => rootContaining(docPath, [f]) !== undefined); // cross-drive safe
  return inside.length > 0 ? inside : [path.dirname(docPath)];
}

export function fileNameOf(document: vscode.TextDocument): string {
  return document.uri.path.split("/").pop() || "Markdown";
}
