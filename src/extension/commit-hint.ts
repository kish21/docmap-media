import * as path from "node:path";
import * as vscode from "vscode";
import { buildPrompt } from "../core/agent/prompts";
import { INTERNAL_TIMINGS } from "../core/config/config";
import { checkLabel, type DocToCheck, docsToCheck } from "../core/insights/commit-hint";
import { deliverPrompt } from "./agent";
import { uncommittedFilesHere } from "./git";
import type { DocsInbox } from "./inbox";

/**
 * #46 "Before you commit": when files with uncommitted changes are named in docs, a quiet status bar item says how many
 * docs mention them (never a pop-up). A click lists those docs: pick one to open it at the mention, or use its button
 * to hand "update this doc to match my change" to the reader's own AI. Uses the user's git; nothing leaves the computer.
 */
export class CommitHint implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private docs: DocToCheck[] = [];
  private checking: Promise<void> | undefined;

  constructor(private readonly inbox: DocsInbox) {
    this.item.name = "docmap: docs to check before committing";
    this.item.command = "docmap.commitHint.show";
    const later = () => this.later();
    this.disposables.push(this.item, inbox.onScanned(later), vscode.workspace.onDidSaveTextDocument(later));
    // a commit, stage or checkout changes the index: check again so the hint goes away after committing
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, ".git/{index,HEAD}"),
      );
      this.disposables.push(
        watcher,
        watcher.onDidChange(later),
        watcher.onDidCreate(later),
        watcher.onDidDelete(later),
      );
    }
    // #52: stay completely idle (zero git scans, zero inbox scans) until the user activates Docs Inbox / Home / Atlas
  }

  /** The docs the hint currently counts (the integration test reads it). */
  get current(): readonly DocToCheck[] {
    return this.docs;
  }

  private later(): void {
    if (!this.inbox.hasScanned) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), INTERNAL_TIMINGS.commitHintMs);
  }

  /** Checks git and the docs again now. */
  refresh(): Promise<void> {
    this.checking ??= this.check().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  private async check(): Promise<void> {
    if (!this.inbox.hasScanned) {
      this.docs = [];
      this.item.hide();
      return;
    }
    const changed: string[] = [];
    if (vscode.workspace.isTrusted)
      for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (folder.uri.scheme !== "file") continue;
        for (const file of await uncommittedFilesHere(folder.uri.fsPath))
          if (!changed.includes(file)) changed.push(file);
      }
    this.docs = docsToCheck(changed, (file) =>
      this.inbox
        .mentionsOf(vscode.Uri.file(file))
        .map((m) => ({ doc: path.normalize(m.doc.fsPath), title: m.title, line: m.line })),
    );
    const label = checkLabel(this.docs.length);
    if (!label) {
      this.item.hide();
      return;
    }
    this.item.text = `$(book) ${label}`;
    this.item.tooltip = `${label}. Click to see them before you commit.`;
    this.item.show();
  }

  /** The docs that name changed files: pick one to open it; its button hands an update prompt to the reader's AI. */
  async show(): Promise<void> {
    if (!this.inbox.hasScanned) await this.inbox.scan();
    await this.refresh();
    if (this.docs.length === 0) {
      void vscode.window.showInformationMessage("No doc mentions the files you changed.");
      return;
    }
    const ask: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon("sparkle"),
      tooltip: "Ask my AI to update this doc to match my change",
    };
    const rel = (p: string) => vscode.workspace.asRelativePath(p, false);
    const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { doc: DocToCheck }>();
    picker.title = "Docs that mention files you changed";
    picker.placeholder =
      "Pick a doc to open it · point at a doc and click the sparkle icon on its right to ask your AI to update it";
    picker.matchOnDescription = true;
    picker.items = this.docs.map((doc) => ({
      label: doc.title,
      description: rel(doc.doc),
      detail: `Mentions: ${doc.files.map(rel).join(", ")}`,
      buttons: [ask],
      doc,
    }));
    picker.onDidTriggerItemButton(async (e) => {
      picker.hide();
      const ctx = { file: rel(e.item.doc.doc), changedCode: e.item.doc.files.map(rel) };
      await deliverPrompt(buildPrompt("updateForChange", ctx), { id: "updateForChange", ctx });
    });
    picker.onDidAccept(async () => {
      const pick = picker.selectedItems[0];
      picker.hide();
      if (!pick) return;
      const editor = await vscode.window.showTextDocument(vscode.Uri.file(pick.doc.doc), { preview: true });
      const at = new vscode.Position(pick.doc.line, 0);
      editor.selection = new vscode.Selection(at, at);
      editor.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenter);
    });
    picker.onDidHide(() => picker.dispose());
    picker.show();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }
}
