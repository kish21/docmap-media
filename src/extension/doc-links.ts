import * as vscode from "vscode";
import type { DocsInbox, Mention } from "./inbox";
import { readConfig } from "./settings";

/**
 * 3.0 docs ↔ code: above a code file that docs name, "📄 Mentioned in N docs" (CodeLens); a click lists them and opens
 * the doc's page at that line. The reverse direction — a doc naming a file that is gone — is the trust marker's
 * "doesn't match the code". Built from the Docs Inbox scan; nothing leaves the computer. Off: docmap.codeLens.
 */
export class DocLinks implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly inbox: DocsInbox) {
    this.disposables.push(
      inbox.onScanned(() => this.changed.fire()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("docmap.codeLens")) this.changed.fire();
      }),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (
      !readConfig().codeLens ||
      !this.inbox.hasScanned ||
      document.uri.scheme !== "file" ||
      document.languageId === "markdown"
    )
      return [];
    const docs = this.inbox.mentionsOf(document.uri);
    if (docs.length === 0) return [];
    const top = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(top, {
        title: `📄 Mentioned in ${docs.length} doc${docs.length === 1 ? "" : "s"}`,
        tooltip: docs.map((d) => `${d.rel}:${d.line + 1}`).join("\n"),
        command: "docmap.showMentions",
        arguments: [document.uri],
      }),
    ];
  }

  /** The docs that name a file: pick one to read it at that line. */
  async show(uri: unknown): Promise<void> {
    const file = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
    if (!file) return;
    if (!this.inbox.hasScanned) await this.inbox.scan();
    const docs = this.inbox.mentionsOf(file);
    if (docs.length === 0) {
      void vscode.window.showInformationMessage("No Markdown doc names this file.");
      return;
    }
    const pick = await vscode.window.showQuickPick(
      docs.map((d: Mention) => ({ label: d.title, description: `${d.rel}:${d.line + 1}`, d })),
      { title: "Docs that mention this file", matchOnDescription: true },
    );
    if (!pick) return;
    const editor = await vscode.window.showTextDocument(pick.d.doc, { preview: true });
    const at = new vscode.Position(pick.d.line, 0);
    editor.selection = new vscode.Selection(at, at);
    editor.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenter);
  }

  dispose(): void {
    this.changed.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
