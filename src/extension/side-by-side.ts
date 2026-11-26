import * as vscode from "vscode";
import { fileNameOf } from "./document-roots";

/**
 * 3.0 Compare, side by side (owner call 2026-11-17: "like Notepad++'s comparison"): the older version on the left,
 * the file itself on the right, in VS Code's own compare view — every changed line lined up, next/previous change
 * arrows, and the right side stays the real, editable file.
 *
 * The older version is not a file on disk: it is served read-only from memory under the `docmap-version:` scheme
 * (only the versions opened this way; the newest few are kept).
 */
export const VERSION_SCHEME = "docmap-version";
const KEEP = 20;
const versions = new Map<string, string>();
let next = 0;

export function registerSideBySide(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(VERSION_SCHEME, {
      provideTextDocumentContent: (uri) => versions.get(uri.query) ?? "",
    }),
  );
}

export async function showSideBySide(
  document: vscode.TextDocument,
  label: string,
  text: string,
): Promise<void> {
  const id = String(++next);
  versions.set(id, text);
  for (const old of versions.keys()) if (versions.size > KEEP) versions.delete(old);
  const name = fileNameOf(document);
  // the file name keeps its extension, so the left side gets Markdown colours too
  const left = vscode.Uri.from({ scheme: VERSION_SCHEME, path: `/${name}`, query: id });
  await vscode.commands.executeCommand("vscode.diff", left, document.uri, `${name}: ${label} ↔ now`, {
    preview: false,
  });
}
