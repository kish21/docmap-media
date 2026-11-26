import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { readConfig } from "./settings";

/**
 * 3.0 AI level 2, for agents outside VS Code's chat: "Set Up docmap Tools for My Agent". The MCP server ships inside
 * the extension (dist/mcp.js); it is copied to the extension's storage folder, whose path stays the same across
 * updates, and the reader gets the exact line to give their agent (copied to the clipboard — docmap never edits an
 * agent's own config files). The agent then starts the server itself, on this computer, for its own project.
 */
export async function setupAgentTools(context: vscode.ExtensionContext): Promise<void> {
  if (!readConfig().aiTools) {
    const on = await vscode.window.showInformationMessage(
      "docmap's tools for agents are off (AI level 2). Turn them on?",
      {
        modal: true,
        detail:
          "Agents then get: plans, open questions, a doc's outline, and paths a doc names that no longer exist. Everything runs on this computer.",
      },
      "Turn on",
    );
    if (on !== "Turn on") return;
    await vscode.workspace
      .getConfiguration("docmap")
      .update("ai.tools", true, vscode.ConfigurationTarget.Global);
  }
  const server = await installServer(context);
  if (!server) {
    void vscode.window.showErrorMessage("docmap could not copy its MCP server into its storage folder.");
    return;
  }
  const quoted = JSON.stringify(server);
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "Claude Code",
        description: "a command to run once in a terminal",
        text: `claude mcp add docmap --scope user -- node ${quoted}`,
        note: "Command copied — run it once in a terminal. Claude Code then has docmap's tools in every project.",
      },
      {
        label: "Cursor, Windsurf and other MCP agents",
        description: "a JSON entry for the agent's mcp.json",
        text: JSON.stringify(
          { mcpServers: { docmap: { command: "node", args: [server, "${workspaceFolder}"] } } },
          null,
          2,
        ),
        note: "JSON copied — add the docmap entry to your agent's mcp.json (in Cursor: Settings → MCP).",
      },
      {
        label: "Just the command",
        description: "node <server> [project folder]",
        text: `node ${quoted}`,
        note: "Command copied. The server reads the Markdown under the folder it is started in (or the one given).",
      },
    ],
    { title: "Give my agent docmap's tools (MCP, runs on this computer)" },
  );
  if (!pick) return;
  await vscode.env.clipboard.writeText(pick.text);
  void vscode.window.showInformationMessage(pick.note);
}

/** Copies dist/mcp.js to <global storage>/mcp/docmap-mcp.js (refreshed on each call) and returns that path. */
export async function installServer(context: vscode.ExtensionContext): Promise<string | undefined> {
  try {
    const from = path.join(context.extensionPath, "dist", "mcp.js");
    const dir = path.join(context.globalStorageUri.fsPath, "mcp");
    const to = path.join(dir, "docmap-mcp.js");
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(from, to);
    return to;
  } catch {
    return undefined;
  }
}
