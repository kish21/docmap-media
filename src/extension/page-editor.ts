import * as vscode from "vscode";
import { INTERNAL_LIMITS, INTERNAL_TIMINGS } from "../core/config/config";
import type { MarkdownEngine } from "../core/markdown/engine";
import { utf8Bytes } from "../core/markdown/markdown-it-engine";
import { currentHeadingIndex } from "../core/outline/current";
import type { Heading } from "../core/outline/types";
import { log } from "./log";
import { MapPanel, PAGE_VIEW_TYPE } from "./map-panel";
import { parseSettings, readConfig } from "./settings";

/**
 * The page in the file's own tab (0.2.0, owner report: "the preview opens a separate tab, so the reader shifts
 * between the source and the preview"). A read-only custom editor for Markdown: the tab that showed the source
 * shows the page instead, and one button swaps it back — the same tab, at the same section. It never edits: the
 * document is only read, as in every other map (`#Scope` non-goal "no editing" holds).
 *
 * `priority: "option"` in package.json: a `.md` file still opens as source unless the reader picks the page as the
 * default (VS Code's own "Reopen Editor With… → Configure default editor"). Taking over every `.md` file
 * unasked is how an extension gets uninstalled.
 */
export class PageEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly engine: MarkdownEngine,
  ) {}

  static register(context: vscode.ExtensionContext, engine: MarkdownEngine): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      PAGE_VIEW_TYPE,
      new PageEditorProvider(context, engine),
      {
        // Ctrl+F searches the page's text, as in the panel; one page per file (a second group just moves it)
        webviewOptions: { enableFindWidget: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
    MapPanel.adoptPage(this.context, document, this.engine, webviewPanel);
  }
}

/**
 * Shows a Markdown file as its page in the active tab group, replacing its source tab there, at the section the
 * source was showing (or at `headingId`, when one is given — a folder-map row, a link's #heading).
 */
export async function showPage(engine: MarkdownEngine, uri: vscode.Uri, headingId?: string): Promise<void> {
  const group = vscode.window.tabGroups.activeTabGroup;
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri.toString() && e.viewColumn === group.viewColumn,
  );
  const target =
    headingId ??
    (editor ? headingAtLine(engine, editor.document, editor.visibleRanges[0]?.start.line) : undefined);
  if (target !== undefined) MapPanel.revealPage(uri, target);
  const column = group.viewColumn;
  log().info(`show preview: ${uri.toString()} in group ${column}`);
  await vscode.commands.executeCommand("vscode.openWith", uri, PAGE_VIEW_TYPE, {
    viewColumn: column,
    preview: false,
  });
  // the page tab is there now (or a moment later in some editors): close the source tab it replaces
  if (!(await settled(() => findTab(column, uri, "page")))) {
    log().warn("show preview: the preview tab did not appear — source tab left open");
    return;
  }
  await closeReplaced(column, uri, "source");
}

/** Shows the source of a file whose page is the active tab, in that tab's place, at the section being read. */
export async function showSource(engine: MarkdownEngine, uri: vscode.Uri): Promise<void> {
  const column = vscode.window.tabGroups.activeTabGroup.viewColumn;
  const place = MapPanel.placeOf(uri);
  log().info(`show source: ${uri.toString()} in group ${column}`);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { viewColumn: column, preview: false });
  if (place !== undefined) {
    const line = headingLine(engine, document, place);
    if (line !== undefined) {
      const position = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
    }
  }
  await closeReplaced(column, uri, "page");
}

/**
 * Closes the tab the swap replaced, so the reader has one tab, not two. Looked up again by file and kind, not kept
 * from before the swap: some editors built on VS Code (Antigravity, Cursor) hand out new tab objects after a change,
 * so a tab kept from before is never found (0.2.2, owner report: two tabs there). Never a tab with unsaved changes:
 * closing it would ask to save or discard the reader's own text — that tab stays, and nothing is lost.
 */
async function closeReplaced(column: vscode.ViewColumn, uri: vscode.Uri, kind: TabKind): Promise<void> {
  const tab = findTab(column, uri, kind);
  if (!tab) {
    log().info(`swap: no ${kind} tab left to close (replaced in place)`);
    return;
  }
  const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (tab.isDirty || document?.isDirty) {
    log().info(`swap: the ${kind} tab has unsaved changes — left open`);
    return;
  }
  const closed = await vscode.window.tabGroups.close(tab, true).then(
    (ok) => ok,
    (e: unknown) => {
      log().warn(`swap: closing the ${kind} tab failed: ${String(e)}`);
      return false;
    },
  );
  log().info(`swap: ${kind} tab ${closed ? "closed" : "not closed"}`);
}

type TabKind = "source" | "page";

/** Whether the active tab is this file's preview (the tab model, not a context key: it is right in every editor). */
export function isPageShowing(uri: vscode.Uri): boolean {
  return isTab(vscode.window.tabGroups.activeTabGroup.activeTab, uri, "page");
}

/** Whether a tab is the file's source or preview — by file and kind, never by object (forks re-create tabs). */
function isTab(tab: vscode.Tab | undefined, uri: vscode.Uri, kind: TabKind): tab is vscode.Tab {
  const key = uri.toString();
  const input = tab?.input;
  return kind === "source"
    ? input instanceof vscode.TabInputText && input.uri.toString() === key
    : input instanceof vscode.TabInputCustom &&
        input.viewType.endsWith(PAGE_VIEW_TYPE) && // some editors prefix the view type
        input.uri.toString() === key;
}

/** The file's source tab or preview tab in an editor group, read from the tab model as it is now. */
function findTab(column: vscode.ViewColumn, uri: vscode.Uri, kind: TabKind): vscode.Tab | undefined {
  return vscode.window.tabGroups.all
    .find((g) => g.viewColumn === column)
    ?.tabs.find((t) => isTab(t, uri, kind));
}

/** Waits (briefly) until `check` finds something: the tab model can update a moment after a command returns. */
async function settled<T>(check: () => T | undefined): Promise<T | undefined> {
  for (let i = 0; i < INTERNAL_TIMINGS.swapSettleTries; i++) {
    const found = check();
    if (found) return found;
    await new Promise((r) => setTimeout(r, INTERNAL_TIMINGS.swapSettleStepMs));
  }
  return check();
}

/** The headings of a document, or none when it is over the large-file limit (the same guard as the map's). */
function headingsOf(engine: MarkdownEngine, document: vscode.TextDocument): readonly Heading[] {
  const text = document.getText();
  if (utf8Bytes(text) > readConfig().largeFileBytes) return [];
  const parsed = engine.parse(text, document.version, parseSettings());
  return parsed.ok ? parsed.document.headings : [];
}

/**
 * The id of the section shown at the top of the editor: the last heading at or above its first visible line — or
 * just below it, since VS Code's sticky headings can cover the first lines (a heading scrolled to the top is
 * reported a line or two lower than the first visible line).
 */
function headingAtLine(engine: MarkdownEngine, document: vscode.TextDocument, top: number | undefined) {
  if (top === undefined || top <= 0) return undefined;
  const headings = headingsOf(engine, document);
  return headings[currentHeadingIndex(headings, top + INTERNAL_LIMITS.stickyLines)]?.id;
}

/** The source line of a heading, by id. */
function headingLine(engine: MarkdownEngine, document: vscode.TextDocument, id: string): number | undefined {
  return headingsOf(engine, document).find((h) => h.id === id)?.line;
}
