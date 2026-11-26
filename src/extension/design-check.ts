import * as path from "node:path";
import * as vscode from "vscode";
import { buildPrompt } from "../core/agent/prompts";
import {
  type DesignCheckRow,
  type DesignFinding,
  designCheck,
  designCheckRows,
  designCheckTitle,
  findingLines,
} from "../core/trust/design-check";
import { deliverPrompt } from "./agent";
import { repoFactsFor } from "./repo-facts";

/**
 * #40 "Does the code still match this design?": on demand, checks every paragraph of a doc against the repository
 * (the trust markers' checks) and lists what no longer matches. Pick a line to jump to it; the first line hands the
 * doc and the list to the reader's own AI, which proposes fixes and changes nothing until they agree.
 * `show: false` (tests) skips the list and returns the findings.
 */
export async function checkDesign(
  document: vscode.TextDocument,
  options: { readonly show?: boolean } = {},
): Promise<readonly DesignFinding[] | undefined> {
  const repo = await repoFactsFor(document.uri).catch(() => undefined);
  if (!repo) {
    if (options.show !== false)
      void vscode.window.showInformationMessage(
        "docmap can check a doc against the code only when the doc is inside an open, trusted project folder.",
      );
    return undefined;
  }
  const text = document.getText();
  const findings = designCheck(text, repo);
  if (options.show === false) return findings;

  const title = designCheckTitle(docTitle(document, text), findings.length);
  const rel = vscode.workspace.asRelativePath(document.uri, false);
  const askAi = () =>
    deliverPrompt(buildPrompt("checkDesign", { file: rel, missing: findingLines(findings) }), {
      id: "checkDesign",
      ctx: { file: rel, missing: findingLines(findings) },
    });

  if (findings.length === 0) {
    const deeper = "Ask My AI to Check Deeper";
    const answer = await vscode.window.showInformationMessage(
      `${title}. docmap checks the files, functions, commands, settings and versions the doc names.`,
      deeper,
    );
    if (answer === deeper) await askAi();
    return findings;
  }

  const picker = vscode.window.createQuickPick<vscode.QuickPickItem & DesignCheckRow>();
  picker.title = title;
  picker.placeholder = "Pick a line to jump to it, or the first line to ask your AI to fix them";
  picker.matchOnDetail = true;
  picker.items = designCheckRows(findings);
  picker.onDidAccept(async () => {
    const pick = picker.selectedItems[0];
    picker.hide();
    if (!pick) return;
    if (pick.ask || pick.line === undefined) {
      await askAi();
      return;
    }
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    const at = new vscode.Position(pick.line, 0);
    editor.selection = new vscode.Selection(at, at);
    editor.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenter);
  });
  picker.onDidHide(() => picker.dispose());
  picker.show();
  return findings;
}

function docTitle(document: vscode.TextDocument, text: string): string {
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(text)?.[1];
  return h1 ?? path.basename(document.uri.fsPath);
}
