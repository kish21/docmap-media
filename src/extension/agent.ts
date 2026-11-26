import * as vscode from "vscode";
import {
  buildPrompt,
  PROMPTS,
  type PromptContext,
  type PromptId,
  promptFile,
  promptsFor,
  type Scope,
} from "../core/agent/prompts";
import { answerHere } from "./ai";
import { pickDocType } from "./doc-templates";
import { log } from "./log";
import { readConfig } from "./settings";

/**
 * Hands a prompt to the reader's own AI agent (2.0). docmap runs no model and sends nothing: with Copilot Chat in
 * this editor, the prompt opens there; otherwise (Claude Code, Cursor, Antigravity, …) it is copied to the clipboard
 * with a note to paste it. Setting `docmap.agentTarget`: "clipboard" (default since 2026-11-16) or "auto" (Copilot Chat when present).
 */
export async function deliverPrompt(
  text: string,
  via?: { readonly id: PromptId; readonly ctx: PromptContext },
): Promise<void> {
  // 3.0 level 1 (off by default): a prompt that only asks for an answer is answered by the reader's own model
  if (via && (await answerHere(via.id, text, via.ctx))) return;
  if (readConfig().agentTarget === "auto" && hasCopilotChat()) {
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes("workbench.action.chat.open")) {
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open", {
          query: text,
          isPartialQuery: true,
        });
        log().info("agent prompt opened in the editor's chat");
        return;
      } catch (error) {
        log().info(`chat could not be opened (${String(error)}) — copying instead`);
      }
    }
  }
  await vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage(
    "Prompt copied — paste it into your AI agent (Claude Code, Codex, Copilot, Cursor, …).",
  );
}

/**
 * The editor's chat is the reader's agent only in VS Code itself with Copilot Chat installed. Cursor, Antigravity,
 * Windsurf, VSCodium and other editors built on VS Code may have the same chat command but route it to an empty or
 * different panel — there the prompt is copied, to paste into the agent the reader actually uses (2.0.1).
 */
export function hasCopilotChat(): boolean {
  return isVsCode() && vscode.extensions.getExtension("GitHub.copilot-chat") !== undefined;
}

/** Microsoft's VS Code (Stable, Insiders, Exploration, or VS Code in a browser) — not an editor built on it. */
export function isVsCode(): boolean {
  return /^Visual Studio Code\b/.test(vscode.env.appName) || vscode.env.appName === "Code - OSS Dev";
}

/** A quick pick of the prompts for this scope; builds and delivers the chosen one. */
export async function pickAndDeliver(
  scopes: readonly Scope[],
  ctx: PromptContext,
  title: string,
): Promise<void> {
  const items = promptsFor(scopes, ctx).map((p) => ({
    label: p.label,
    detail: p.detail,
    id: p.id,
  }));
  const pick = await vscode.window.showQuickPick(items, { title, placeHolder: "Ask my AI agent to…" });
  if (!pick) return;
  let full = ctx;
  if (pick.id === "restructure") {
    // which shape: the agent gets that type's sections (or all of them, to pick the best fit)
    const type = await pickDocType("Pick the kind of doc, or let your agent choose");
    if (!type) return;
    if (type !== "auto") full = { ...ctx, docType: type };
  }
  await deliverPrompt(buildPrompt(pick.id as PromptId, full), { id: pick.id as PromptId, ctx: full });
}

/** Writes the file prompts into the workspace where each agent finds them (Copilot prompt files, Claude commands). */
export async function addPromptsToProject(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    void vscode.window.showInformationMessage("Open a folder first: the prompts are saved inside it.");
    return;
  }
  const targets = await vscode.window.showQuickPick(
    [
      {
        label: "GitHub Copilot",
        description: ".github/prompts/*.prompt.md",
        target: "copilot" as const,
        picked: true,
      },
      { label: "Claude Code", description: ".claude/commands/*.md", target: "claude" as const, picked: true },
    ],
    { canPickMany: true, title: "Add Markdown prompts to this project", placeHolder: "Which agents?" },
  );
  if (!targets || targets.length === 0) return;
  let written = 0;
  let skipped = 0;
  for (const { target } of targets) {
    const dir = vscode.Uri.joinPath(
      root,
      ...(target === "copilot" ? [".github", "prompts"] : [".claude", "commands"]),
    );
    for (const def of PROMPTS.filter((p) => p.scope === "file" && !p.hidden)) {
      const { name, content } = promptFile(def, target);
      const file = vscode.Uri.joinPath(dir, name);
      const exists = await vscode.workspace.fs.stat(file).then(
        () => true,
        () => false,
      );
      if (exists) {
        skipped++;
        continue; // never overwrite a prompt the user may have edited
      }
      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(content));
      written++;
    }
  }
  void vscode.window.showInformationMessage(
    `Added ${written} prompt file${written === 1 ? "" : "s"}${skipped ? ` (${skipped} already there, left as they are)` : ""}. Your agent now has them as commands.`,
  );
}

/** A workspace-relative path for prompts (the agent opens files by it); an absolute path outside the workspace. */
export function relativePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false);
}
