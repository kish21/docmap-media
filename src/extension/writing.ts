import * as vscode from "vscode";
import { inCodeFence, onEnter, toggleMarker } from "../core/authoring/lists";
import { formatTable, isTable } from "../core/authoring/table";
import { buildToc, tocEdit } from "../core/authoring/toc";
import type { MarkdownEngine } from "../core/markdown/engine";
import { isVsCode } from "./agent";
import { parseSettings, readConfig } from "./settings";

/**
 * Writing helpers (2.0, owner call "one-stop"): bold / italic / strikethrough keys, lists that continue on Enter,
 * a table formatter and a table of contents kept up to date. The keys are on only while `docmap.writingHelpers` is on
 * AND Markdown All in One is not installed (it has the same keys — two extensions fighting over Enter is the fastest
 * way to be uninstalled). The commands always work from the Command Palette.
 */
/** Extensions that already bind the same writing keys in Markdown (bold, italic, Enter in lists). */
const OTHER_HELPERS = [
  "yzhang.markdown-all-in-one",
  "mdickin.markdown-shortcuts",
  "dzhavat.bracket-pair-toggler",
];
/** Extensions that bind Ctrl+Alt+V in Markdown (Paste Image): then the preview switch keeps only its button. */
const PASTE_KEY_OWNERS = ["mushan.vscode-paste-image", "telesoho.vscode-markdown-paste-image"];

export function registerWriting(context: vscode.ExtensionContext, engine: MarkdownEngine): void {
  const updateKeys = () => {
    const installed = (ids: readonly string[]) =>
      ids.some((id) => vscode.extensions.getExtension(id) !== undefined);
    const on = readConfig().writingHelpers && !installed(OTHER_HELPERS);
    void vscode.commands.executeCommand("setContext", "docmap.toggleKeyOff", installed(PASTE_KEY_OWNERS));
    // the keys' when-clauses read these "off" flags: unset (before activation) means on, so no key is dead
    void vscode.commands.executeCommand("setContext", "docmap.writingKeysOff", !on);
    // Ctrl+I is the AI agent's key in Cursor and other editors built on VS Code: italic takes it only in VS Code
    void vscode.commands.executeCommand("setContext", "docmap.italicKeyOff", !(on && isVsCode()));
  };
  updateKeys();
  context.subscriptions.push(
    vscode.extensions.onDidChange(updateKeys),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("docmap.writingHelpers")) updateKeys();
    }),
    // plain commands on the active editor, not registerTextEditorCommand: that one does not wait for an async edit,
    // so the command would report done before the text changed (CI run 112)
    vscode.commands.registerCommand("docmap.bold", () => onEditor((e) => wrap(e, "**"))),
    vscode.commands.registerCommand("docmap.italic", () => onEditor((e) => wrap(e, "*"))),
    vscode.commands.registerCommand("docmap.strikethrough", () => onEditor((e) => wrap(e, "~~"))),
    vscode.commands.registerCommand("docmap.onEnter", () => enter()),
    vscode.commands.registerCommand("docmap.formatTable", () => onEditor((e) => formatTables(e))),
    vscode.commands.registerCommand("docmap.updateToc", () => onEditor((e) => updateToc(e, engine))),
  );
}

async function onEditor(run: (editor: vscode.TextEditor) => Promise<void>): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor) await run(editor);
}

async function wrap(editor: vscode.TextEditor, marker: string): Promise<void> {
  const doc = editor.document;
  await editor.edit((edit) => {
    for (const sel of editor.selections) {
      let range: vscode.Range = sel;
      if (sel.isEmpty) range = doc.getWordRangeAtPosition(sel.active) ?? sel; // no selection: the word at the cursor
      const line = doc.lineAt(range.start.line).text;
      const before = line.slice(0, range.start.character);
      const after = range.isSingleLine ? line.slice(range.end.character) : "";
      const result = toggleMarker(doc.getText(range), before, after, marker);
      if (result.unwrapOutside)
        edit.replace(
          range.with(range.start.translate(0, -marker.length), range.end.translate(0, marker.length)),
          result.text,
        );
      else edit.replace(range, result.text);
    }
  });
}

/** Enter in a Markdown list or quote: continue it (or end it on an empty item); anywhere else a plain Enter. */
async function enter(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const sel = editor?.selection;
  if (!editor || !sel || editor.selections.length > 1 || !sel.isEmpty) return plainEnter();
  const line = editor.document.lineAt(sel.active.line);
  const before = line.text.slice(0, sel.active.character);
  const atEnd = line.text.slice(sel.active.character).trim() === "";
  const action = atEnd && !inFence(editor.document, sel.active.line) ? onEnter(before) : undefined;
  if (!action) return plainEnter();
  if (action.kind === "end") {
    await editor.edit((e) => e.replace(line.range, ""));
    return;
  }
  await editor.edit((e) => e.insert(sel.active, `\n${action.prefix}`));
  editor.revealRange(editor.selection);
}

/** Inside a ``` code block, Enter is always a plain Enter (reads at most the lines above the cursor). */
function inFence(doc: vscode.TextDocument, line: number): boolean {
  const lines = Array.from({ length: line }, (_, i) => doc.lineAt(i).text);
  return inCodeFence(lines, line);
}

async function plainEnter(): Promise<void> {
  await vscode.commands.executeCommand("type", { source: "keyboard", text: "\n" });
}

/** Formats the table under the cursor, or every table in the file when the cursor is in none. */
async function formatTables(editor: vscode.TextEditor): Promise<void> {
  const doc = editor.document;
  const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
  const blocks: { start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; ) {
    if (lines[i]!.includes("|")) {
      let j = i;
      while (j < lines.length && lines[j]!.includes("|") && lines[j]!.trim() !== "") j++;
      if (isTable(lines.slice(i, j))) blocks.push({ start: i, end: j });
      i = j + 1;
    } else i++;
  }
  const cursor = editor.selection.active.line;
  const target = blocks.filter((b) => cursor >= b.start && cursor < b.end);
  const chosen = target.length > 0 ? target : blocks;
  if (chosen.length === 0) {
    void vscode.window.showInformationMessage("No Markdown table found here.");
    return;
  }
  await editor.edit((edit) => {
    for (const b of chosen) {
      const formatted = formatTable(lines.slice(b.start, b.end));
      if (formatted)
        edit.replace(new vscode.Range(b.start, 0, b.end - 1, lines[b.end - 1]!.length), formatted.join("\n"));
    }
  });
}

/** Inserts a table of contents after the title, or refreshes the one already there. */
async function updateToc(editor: vscode.TextEditor, engine: MarkdownEngine): Promise<void> {
  const doc = editor.document;
  const parsed = engine.parse(doc.getText(), doc.version, parseSettings());
  if (!parsed.ok || parsed.document.headings.length < 2) {
    void vscode.window.showInformationMessage(
      "This file needs at least two headings for a table of contents.",
    );
    return;
  }
  const lines = doc.getText().split(/\r?\n/);
  const {
    start,
    end,
    lines: next,
  } = tocEdit(lines, parsed.document.headings, buildToc(parsed.document.headings));
  await editor.edit((edit) => {
    const range =
      end > start
        ? new vscode.Range(start, 0, end - 1, lines[end - 1]!.length)
        : new vscode.Range(start, 0, start, 0);
    edit.replace(range, end > start ? next.join("\n") : `${next.join("\n")}\n`);
  });
}
