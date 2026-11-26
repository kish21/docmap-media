import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { AtlasGraph } from "../core/insights/atlas-graph";
import { isAtlasToHost } from "../core/protocol/messages";
import { log } from "./log";
import { atlasHtml } from "./panel-html";

/**
 * The Doc Atlas graph panel (owner call 2026-11-24): one panel, reused. The page asks; the host opens only docs and
 * code files it put in the page's data, inside the first workspace folder. Nothing is written.
 */
let current: vscode.WebviewPanel | undefined;
/** The reused panel's click listener for the graph it shows now (replaced with the graph, never stacked). */
let listening: vscode.Disposable | undefined;

export function showAtlas(
  context: vscode.ExtensionContext,
  graph: AtlasGraph,
  details: (doc: vscode.Uri) => Promise<void>,
  options: { readonly beside?: boolean } = {},
): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
  // easy reading: opened from a doc's page, the graph sits beside the doc (the doc stays where it is)
  const column = options.beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
  if (!current) {
    current = vscode.window.createWebviewPanel("docmap.atlas", "Doc Atlas", column, {
      enableScripts: true,
      localResourceRoots: [dist],
      retainContextWhenHidden: true,
    });
    current.onDidDispose(() => {
      listening?.dispose();
      listening = undefined;
      current = undefined;
    });
  }
  const panel = current;
  const docs = new Set(graph.docs.map((d) => d.p));
  const code = new Set(graph.docs.flatMap((d) => d.c));
  const at = (rel: string) => vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
  listening?.dispose();
  const listener = panel.webview.onDidReceiveMessage(async (m: unknown) => {
    if (!isAtlasToHost(m)) return;
    try {
      if (m.kind === "code") {
        if (!code.has(m.path)) return;
        await vscode.window.showTextDocument(at(m.path), {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
        });
      } else if (docs.has(m.path)) {
        if (m.kind === "details") await details(at(m.path));
        else await vscode.commands.executeCommand("docmap.openMapAt", at(m.path));
      }
    } catch (e) {
      log().info(`Doc Atlas: could not open ${m.path}: ${String(e)}`);
      void vscode.window.showInformationMessage("docmap could not open that file.");
    }
  });
  listening = listener;
  const w = panel.webview;
  w.html = atlasHtml({
    cspSource: w.cspSource,
    nonce: randomBytes(16).toString("base64"),
    tokensCss: w.asWebviewUri(vscode.Uri.joinPath(dist, "tokens.css")).toString(),
    stylesCss: w.asWebviewUri(vscode.Uri.joinPath(dist, "atlas.css")).toString(),
    script: w.asWebviewUri(vscode.Uri.joinPath(dist, "atlas.js")).toString(),
    title: "Doc Atlas",
    data: graph,
  });
  // a reused panel moves beside the doc too (code review 2026-11-24: it stayed where it was, covering the doc)
  panel.reveal(options.beside ? vscode.ViewColumn.Beside : undefined);
}
