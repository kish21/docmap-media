import * as vscode from "vscode";

/**
 * 3.0: pages docmap writes for the reader (Plans dashboard, Decision log) — read-only virtual Markdown documents
 * under the `docmap-report:` scheme. They open in the preview (Clean view lays the tables out), never ask to be
 * saved, live only in memory, and their links resolve from the first workspace folder.
 */
export const REPORT_SCHEME = "docmap-report";

class ReportStore implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly pages = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.pages.get(uri.path) ?? "";
  }

  set(uri: vscode.Uri, content: string): void {
    this.pages.set(uri.path, content);
    this.changed.fire(uri);
  }

  dispose(): void {
    this.changed.dispose();
    this.pages.clear();
  }
}

let store: ReportStore | undefined;

export function registerReports(): vscode.Disposable {
  store = new ReportStore();
  return vscode.Disposable.from(
    vscode.workspace.registerTextDocumentContentProvider(REPORT_SCHEME, store),
    store,
  );
}

/** Writes (or rewrites) a report and returns its document. `name` is the tab title, without ".md". */
export async function writeReport(name: string, content: string): Promise<vscode.TextDocument> {
  const uri = vscode.Uri.from({ scheme: REPORT_SCHEME, path: `/${name}.md` });
  store?.set(uri, content);
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.languageId !== "markdown") return vscode.languages.setTextDocumentLanguage(doc, "markdown");
  return doc;
}

export const isReport = (uri: vscode.Uri): boolean => uri.scheme === REPORT_SCHEME;
