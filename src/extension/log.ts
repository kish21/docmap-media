import * as vscode from "vscode";

/** The one log sink: VS Code's "All-in-One Markdown Viewer" Output channel (structured, levelled). No console.*, no telemetry. */
let channel: vscode.LogOutputChannel | undefined;

export function log(): vscode.LogOutputChannel {
  channel ??= vscode.window.createOutputChannel("All-in-One Markdown Viewer", { log: true });
  return channel;
}
