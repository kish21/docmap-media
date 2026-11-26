import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { PlanRow, PlanSort } from "../core/insights/plans";
import { isPlansToHost } from "../core/protocol/messages";
import { log } from "./log";
import { plansHtml } from "./panel-html";

/** Payload embedded in the interactive Plans Dashboard webview. */
export interface PlansDashboardData {
  readonly rows: readonly PlanRow[];
  readonly now: number;
  readonly sort: PlanSort;
}

export interface PlansPanelHandlers {
  readonly refresh: () => Promise<void>;
  readonly setSort: (sort: PlanSort) => Promise<void>;
  readonly exportMd: () => Promise<void>;
  readonly exportCsv: () => Promise<void>;
  readonly askAgent: () => Promise<void>;
  readonly newPlan: () => Promise<void>;
}

/**
 * 3.3.0 interactive Plans Dashboard panel: one panel, reused. The page asks; the host opens only plan files
 * it put in the page's data, inside the first workspace folder.
 */
let current: vscode.WebviewPanel | undefined;
let listening: vscode.Disposable | undefined;

export function showPlansDashboard(
  context: vscode.ExtensionContext,
  data: PlansDashboardData,
  handlers: PlansPanelHandlers,
): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
  if (!current) {
    current = vscode.window.createWebviewPanel("docmap.plans", "Plans Dashboard", vscode.ViewColumn.Active, {
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
  const files = new Set(data.rows.map((r) => r.file));
  const at = (rel: string) => (folder ? vscode.Uri.joinPath(folder.uri, ...rel.split("/")) : undefined);
  listening?.dispose();
  const listener = panel.webview.onDidReceiveMessage(async (m: unknown) => {
    if (!isPlansToHost(m)) return;
    try {
      if (m.type === "plansOpen") {
        if (!files.has(m.file)) return;
        const uri = at(m.file);
        if (!uri) return;
        if (m.kind === "browser") {
          await vscode.commands.executeCommand("docmap.openInBrowser", uri);
        } else {
          await vscode.commands.executeCommand("docmap.openMapAt", uri);
        }
        return;
      }
      if (m.type === "plansSort") {
        await handlers.setSort(m.sort);
        return;
      }
      if (m.type === "plansAction") {
        switch (m.action) {
          case "refresh":
            await handlers.refresh();
            return;
          case "exportMd":
            await handlers.exportMd();
            return;
          case "exportCsv":
            await handlers.exportCsv();
            return;
          case "askAgent":
            await handlers.askAgent();
            return;
          case "newPlan":
            await handlers.newPlan();
            return;
        }
      }
    } catch (e) {
      log().info(`Plans Dashboard action failed: ${String(e)}`);
      void vscode.window.showInformationMessage("docmap could not complete that Plans Dashboard action.");
    }
  });
  listening = listener;
  const w = panel.webview;
  w.html = plansHtml({
    cspSource: w.cspSource,
    nonce: randomBytes(16).toString("base64"),
    tokensCss: w.asWebviewUri(vscode.Uri.joinPath(dist, "tokens.css")).toString(),
    stylesCss: w.asWebviewUri(vscode.Uri.joinPath(dist, "plans.css")).toString(),
    script: w.asWebviewUri(vscode.Uri.joinPath(dist, "plans.js")).toString(),
    title: "Plans Dashboard",
    data,
  });
  panel.reveal();
}
