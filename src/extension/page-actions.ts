import * as path from "node:path";
import * as vscode from "vscode";
import { agentBundle, sizeLabel } from "../core/agent/context-bundle";
import { shellCommand } from "../core/authoring/shell";
import { DEFAULT_CONFIG, INTERNAL_LIMITS } from "../core/config/config";
import { type CodePeek, peekAt } from "../core/insights/code-peek";
import { MAX_COMMENT_LENGTH } from "../core/protocol/messages";
import { claimsIn } from "../core/trust/claims";
import { codeRefs, declarationLine, parseCodeRef, replaceCodePath } from "../core/trust/code-refs";
import { relativePath } from "./agent";
import { allowedRoots } from "./document-roots";
import {
  existsConfinedPath,
  isCodeFile,
  isSecretEnvFile,
  isSecretFile,
  resolveConfinedFile,
  resolveLocalTarget,
} from "./links";
import { log } from "./log";
import { repoFactsFor } from "./repo-facts";
import { replaceOneLine } from "./tick";

/**
 * The page's 2026-11-22 actions (owner: "fix everything"): clickable code names, comments on selected text, "Copy for
 * my AI", "▶ Terminal" on shell blocks, and the one-click fix for a moved file. The page only asks; everything here
 * runs in the host, and nothing leaves this computer except what the reader pastes or sends to their own AI.
 */

/** The `code` spans of the doc that name a file, function or class the project has (empty when none or no folder). */
export async function codeRefsFor(document: vscode.TextDocument): Promise<string[]> {
  const repo = await repoFactsFor(document.uri).catch(() => undefined);
  return repo ? codeRefs(document.getText(), repo) : [];
}

/**
 * Easy reading: the code for a name the reader points at — a listed code name (`cart.py:12`) or a link to a code file
 * (`backend/cart.py#L12`). Inside the project only; a missing, too-large or unreadable file gives nothing.
 */
export async function codePeekFor(
  document: vscode.TextDocument,
  text: string,
  listedRef: boolean,
): Promise<CodePeek | undefined> {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) return undefined;
  let file: vscode.Uri | undefined;
  let line: number | undefined;
  if (listedRef) {
    const ref = parseCodeRef(text);
    const repo = ref?.path ? await repoFactsFor(document.uri).catch(() => undefined) : undefined;
    const rel = ref?.path ? repo?.findPath?.(ref.path) : undefined;
    if (rel && folder.uri.scheme === "file") {
      const confined = resolveConfinedFile(rel, folder.uri.fsPath);
      if (confined) {
        file = vscode.Uri.file(confined);
        line = ref?.line;
      }
    }
  } else if (document.uri.scheme === "file") {
    const target = resolveLocalTarget(text, path.dirname(document.uri.fsPath), allowedRoots(document));
    if (target && isCodeFile(target.file) && !isSecretEnvFile(target.file)) {
      file = vscode.Uri.file(target.file);
      line = Number(/^L(\d{1,7})/.exec(target.fragment ?? "")?.[1]) || undefined;
    }
  }
  if (!file || isSecretEnvFile(file.fsPath)) return undefined;
  try {
    const stat = await vscode.workspace.fs.stat(file);
    if (stat.type !== vscode.FileType.File || stat.size > INTERNAL_LIMITS.codePeekBytes) return undefined;
    const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
    return peekAt(source, relativePath(file), line);
  } catch {
    return undefined; // gone between the check and the read, or unreadable: nothing to show
  }
}

/** Opens what a clicked code name points to, beside the doc: the file (at its line), or where a name is defined. */
export async function openCodeRef(document: vscode.TextDocument, text: string): Promise<void> {
  const ref = parseCodeRef(text);
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!ref || !folder) return;
  if (ref.path) {
    const repo = await repoFactsFor(document.uri).catch(() => undefined);
    const rel = repo?.findPath?.(ref.path);
    if (!rel) {
      void vscode.window.showInformationMessage(`${ref.path} is not in this project.`);
      return;
    }
    if (folder.uri.scheme === "file") {
      const candidate = path.resolve(folder.uri.fsPath, ...rel.split("/"));
      if (!existsConfinedPath(candidate, folder.uri.fsPath)) return;
      const confined = resolveConfinedFile(rel, folder.uri.fsPath);
      if (confined) {
        const at = new vscode.Position(Math.max(0, (ref.line ?? 1) - 1), 0);
        await vscode.window.showTextDocument(vscode.Uri.file(confined), {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
          selection: new vscode.Range(at, at),
        });
        return;
      }
      const dirUri = vscode.Uri.file(candidate);
      const stat = await vscode.workspace.fs.stat(dirUri).then(undefined, () => undefined);
      if (stat?.type === vscode.FileType.Directory) {
        await vscode.commands.executeCommand("revealInExplorer", dirUri);
      }
      return;
    }
    const uri = vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
    const stat = await vscode.workspace.fs.stat(uri).then(undefined, () => undefined);
    if (stat?.type === vscode.FileType.Directory) {
      await vscode.commands.executeCommand("revealInExplorer", uri);
      return;
    }
    const at = new vscode.Position(Math.max(0, (ref.line ?? 1) - 1), 0);
    await vscode.window.showTextDocument(uri, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
      selection: new vscode.Range(at, at),
    });
    return;
  }
  const symbol = ref.symbol ?? "";
  const found =
    (await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      symbol,
    )) ?? [];
  const exact = found.filter((s) => s.name === symbol || s.name === `${symbol}()`);
  const hit = exact.find((s) => !s.location.uri.path.includes("/node_modules/")) ?? exact[0];
  const at = hit?.location ?? (await findDeclaration(folder, symbol));
  if (!at) {
    void vscode.window.showInformationMessage(`docmap could not find where ${symbol} is defined.`);
    return;
  }
  await vscode.window.showTextDocument(at.uri, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
    selection: at.range,
  });
}

const CODE_FILES = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,cs,rb,php,swift,scala,c,cc,cpp,h,hpp}";

/** Where `name` is defined, by reading the project's code files (when no language extension answers). */
async function findDeclaration(
  folder: vscode.WorkspaceFolder,
  name: string,
): Promise<vscode.Location | undefined> {
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, CODE_FILES),
    "**/{node_modules,dist,out,build,.git}/**",
    2000,
  );
  for (const uri of files) {
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      continue;
    }
    if (!text.includes(name)) continue;
    const line = declarationLine(text, name);
    if (line !== undefined) return new vscode.Location(uri, new vscode.Position(line, 0));
  }
  return undefined;
}

/**
 * "▶ Terminal": puts a shell block's commands in the terminal without pressing Enter. One line is typed in; several
 * lines go through VS Code's own paste, which asks before pasting more than one line.
 */
export async function runInTerminal(code: string): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showInformationMessage(
      "Running terminal commands from Markdown is disabled in Restricted Mode.",
    );
    return;
  }
  const command = shellCommand(code);
  if (!command) return;
  const terminal = vscode.window.activeTerminal ?? vscode.window.createTerminal("docmap");
  terminal.show();
  if (!command.includes("\n")) {
    terminal.sendText(command, false);
    vscode.window.setStatusBarMessage("$(terminal) In the terminal: press Enter to run it", 4000);
    return;
  }
  await vscode.env.clipboard.writeText(command);
  await vscode.commands.executeCommand("workbench.action.terminal.paste");
}

/** Asks for a comment on the selected text (undefined: cancelled). */
export async function askComment(quote: string): Promise<string | undefined> {
  const short = quote.length > 60 ? `${quote.slice(0, 57)}…` : quote;
  const note = await vscode.window.showInputBox({
    title: "Comment",
    prompt: `On "${short}". Kept on this computer; "Send my review to my AI agent" sends it.`,
    placeHolder: "For example: use Postgres here, not SQLite",
    validateInput: (v) => (v.length > MAX_COMMENT_LENGTH ? "Shorter, please" : undefined),
  });
  return note?.trim() || undefined;
}

const LINK = /\]\(\s*<?([^)\s#>]+\.(?:md|markdown))>?(?:#[^)\s]*)?(?:\s+"[^"]*")?\s*\)/gi;

/** "Copy for my AI": this doc plus the linked docs the reader ticks, as one text on the clipboard, with its size. */
export async function copyForAgent(document: vscode.TextDocument): Promise<void> {
  const linked: vscode.Uri[] = [];
  if (document.uri.scheme === "file") {
    const dir = path.dirname(document.uri.fsPath);
    const roots = allowedRoots(document);
    for (const m of document.getText().matchAll(LINK)) {
      const rawHref = m[1] ?? "";
      const resolved = resolveLocalTarget(rawHref, dir, roots);
      if (!resolved || isSecretFile(resolved.file)) continue;
      const uri = vscode.Uri.file(resolved.file);
      if (
        uri.toString() !== document.uri.toString() &&
        !linked.some((u) => u.toString() === uri.toString())
      ) {
        linked.push(uri);
      }
    }
  }
  let extra: vscode.Uri[] = [];
  if (linked.length) {
    const picks = await vscode.window.showQuickPick(
      linked.map((uri) => ({ label: relativePath(uri), uri })),
      {
        canPickMany: true,
        title: "Copy for my AI",
        placeHolder: "Tick the linked docs to add (none: just this doc), then press Enter",
      },
    );
    if (!picks) return;
    extra = picks.map((p) => p.uri);
  }
  const docs = [{ rel: relativePath(document.uri), text: document.getText() }];
  let totalBytes = Buffer.byteLength(docs[0]?.text ?? "", "utf8");
  for (const uri of extra) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (
        stat.type !== vscode.FileType.File ||
        stat.size > DEFAULT_CONFIG.largeFileBytes ||
        totalBytes + stat.size > INTERNAL_LIMITS.inboxTotalScanBytes
      ) {
        continue;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      totalBytes += bytes.byteLength;
      docs.push({
        rel: relativePath(uri),
        text: new TextDecoder().decode(bytes),
      });
    } catch (error) {
      log().warn(`copy for my AI: ${String(error)}`);
    }
  }
  const text = agentBundle(docs);
  await vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage(
    `Copied ${docs.length === 1 ? "this doc" : `${docs.length} docs`}: ${sizeLabel(text)}. Paste it into your AI chat.`,
  );
}

/**
 * One-click fix for a moved file: for each file the paragraph names that is gone, where it most likely went.
 * `lines` are the paragraph's source lines [from, to).
 */
export async function movedFixes(
  document: vscode.TextDocument,
  from: number,
  to: number,
): Promise<{ readonly old: string; readonly next: string; readonly line: number }[]> {
  const repo = await repoFactsFor(document.uri).catch(() => undefined);
  if (!repo?.movedTo) return [];
  const out: { old: string; next: string; line: number }[] = [];
  for (let line = from; line < Math.min(to, document.lineCount); line++) {
    for (const c of claimsIn(document.lineAt(line).text)) {
      if (c.kind !== "path" || repo.hasPath(c.value) || out.some((o) => o.old === c.value)) continue;
      const next = repo.movedTo(c.value);
      if (next) out.push({ old: c.value, next, line });
    }
  }
  return out;
}

/** Applies one moved-file fix: that one line, only if it still names the old path (same guard as task ticks). */
export async function applyMovedFix(
  document: vscode.TextDocument,
  fix: { readonly old: string; readonly next: string; readonly line: number },
): Promise<boolean> {
  if (fix.line >= document.lineCount) return false;
  const next = replaceCodePath(document.lineAt(fix.line).text, fix.old, fix.next);
  if (next === undefined) {
    void vscode.window.showInformationMessage("The file changed since the page was drawn — try again.");
    return false;
  }
  return replaceOneLine(document, fix.line, next);
}
