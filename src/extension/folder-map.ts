import * as vscode from "vscode";
import { INTERNAL_LIMITS } from "../core/config/config";
import type { MarkdownEngine } from "../core/markdown/engine";
import { buildFileTree, type FileNode, type FolderNode, relativeTo } from "../core/outline/file-tree";
import { buildOutline } from "../core/outline/outline";
import type { OutlineNode } from "../core/outline/types";
import { log } from "./log";
import { leftOut, parseSettings, readConfig } from "./settings";

/** A row of the folder map: a workspace folder, a folder, a Markdown file, or one of its headings. */
export type FolderMapItem =
  | { readonly kind: "root"; readonly workspace: vscode.WorkspaceFolder; readonly tree: FolderNode }
  | { readonly kind: "folder"; readonly workspace: vscode.WorkspaceFolder; readonly node: FolderNode }
  | { readonly kind: "file"; readonly uri: vscode.Uri; readonly node: FileNode }
  | { readonly kind: "heading"; readonly uri: vscode.Uri; readonly node: OutlineNode }
  | { readonly kind: "note"; readonly text: string };

const MARKDOWN_GLOB = "**/*.{md,markdown}";

/**
 * The folder map (0.0.8, owner call): every Markdown file in the workspace, in its folders, each with its headings —
 * one map across all docs, in the Explorer. Files are listed once (and again when one is added or removed); a file's
 * headings are read only when the reader opens it in the tree, and kept until the file changes.
 */
export class FolderMapProvider implements vscode.TreeDataProvider<FolderMapItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<FolderMapItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private listing: Promise<FolderMapItem[]> | undefined;
  private readonly outlines = new Map<string, OutlineNode[] | string>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly engine: MarkdownEngine) {
    const watcher = vscode.workspace.createFileSystemWatcher(MARKDOWN_GLOB);
    this.disposables.push(
      this.changed,
      watcher,
      watcher.onDidCreate(() => this.refresh()),
      watcher.onDidDelete(() => this.refresh()),
      watcher.onDidChange((uri) => this.forget(uri)),
      vscode.workspace.onDidSaveTextDocument((d) => this.forget(d.uri)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        // heading ids depend on these (structure hints add headings): re-read every file's outline
        if (e.affectsConfiguration("docmap.readingTools") || e.affectsConfiguration("docmap.inferHeadings"))
          this.refresh();
      }),
    );
  }

  /** Lists the files again and forgets every outline (the refresh button, and files added or removed). */
  refresh(): void {
    this.listing = undefined;
    this.outlines.clear();
    this.changed.fire(undefined);
  }

  private forget(uri: vscode.Uri): void {
    if (this.outlines.delete(uri.toString())) this.changed.fire(undefined);
  }

  getTreeItem(item: FolderMapItem): vscode.TreeItem {
    switch (item.kind) {
      case "root":
        return folderItem(item.workspace.name, vscode.TreeItemCollapsibleState.Expanded);
      case "folder": {
        const t = folderItem(item.node.name, vscode.TreeItemCollapsibleState.Collapsed);
        t.resourceUri = vscode.Uri.joinPath(item.workspace.uri, item.node.path);
        return t;
      }
      case "file": {
        const t = new vscode.TreeItem(item.uri, vscode.TreeItemCollapsibleState.Collapsed);
        t.label = item.node.name;
        t.contextValue = "docmap.file";
        t.command = { command: "docmap.openMapAt", title: "Open Map", arguments: [item.uri] };
        return t;
      }
      case "heading": {
        const { heading, children } = item.node;
        const t = new vscode.TreeItem(
          heading.text,
          children.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        );
        t.iconPath = new vscode.ThemeIcon("symbol-string");
        if (heading.inferred) t.description = "hint";
        t.tooltip = `${heading.text} — line ${heading.line + 1}`;
        t.command = { command: "docmap.openMapAt", title: "Open Map", arguments: [item.uri, heading.id] };
        return t;
      }
      case "note":
        return new vscode.TreeItem(item.text, vscode.TreeItemCollapsibleState.None);
    }
  }

  async getChildren(item?: FolderMapItem): Promise<FolderMapItem[]> {
    if (!item) {
      this.listing ??= this.list();
      return this.listing;
    }
    switch (item.kind) {
      case "root":
        return children(item.workspace, item.tree);
      case "folder":
        return children(item.workspace, item.node);
      case "file":
        return this.headingsOf(item.uri);
      case "heading":
        return item.node.children.map((node) => ({ kind: "heading", uri: item.uri, node }));
      case "note":
        return [];
    }
  }

  /** Every Markdown file in the workspace (VS Code's files.exclude applies; node_modules is skipped). */
  private async list(): Promise<FolderMapItem[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const cap = INTERNAL_LIMITS.folderMapFiles;
    const found = await vscode.workspace.findFiles(MARKDOWN_GLOB, undefined, cap + 1);
    const config = readConfig();
    const files = found.filter((u) => !leftOut(u, config)); // tool dot-folders and build output too (#44)
    const roots: FolderMapItem[] = [];
    for (const workspace of folders) {
      const paths = files
        .map((u) => relativeTo(workspace.uri.path, u.path))
        .filter((p): p is string => p !== undefined);
      const tree = buildFileTree(paths);
      if (tree.files.length > 0 || tree.folders.length > 0) roots.push({ kind: "root", workspace, tree });
    }
    const items: FolderMapItem[] =
      roots.length === 1 && roots[0]?.kind === "root" ? children(roots[0].workspace, roots[0].tree) : roots;
    if (found.length > cap)
      items.push({ kind: "note", text: `Showing the first ${cap} Markdown files of this workspace.` });
    log().debug(`folder map: ${files.length} Markdown files`);
    return items;
  }

  /** A file's headings, read and parsed the first time the reader opens it in the tree. */
  private async headingsOf(uri: vscode.Uri): Promise<FolderMapItem[]> {
    const key = uri.toString();
    let outline = this.outlines.get(key);
    if (outline === undefined) {
      outline = await this.readOutline(uri);
      this.outlines.set(key, outline);
    }
    if (typeof outline === "string") return [{ kind: "note", text: outline }];
    if (outline.length === 0) return [{ kind: "note", text: "No headings" }];
    return outline.map((node) => ({ kind: "heading", uri, node }));
  }

  private async readOutline(uri: vscode.Uri): Promise<OutlineNode[] | string> {
    try {
      // an open (maybe unsaved) document wins over the file on disk, so the tree matches what the map shows
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      const limit = readConfig().largeFileBytes;
      let text: string;
      if (open) {
        text = open.getText();
      } else {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > limit) return "Very large file — open its map";
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength > limit) return "Very large file — open its map";
        text = new TextDecoder().decode(bytes);
      }
      const parsed = this.engine.parse(text, 0, parseSettings()); // the same settings as the map: the same ids
      return parsed.ok ? buildOutline(parsed.document.headings) : "Could not read this file";
    } catch (error) {
      log().error(`folder map: could not read ${uri.toString()}`, error);
      return "Could not read this file";
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

function folderItem(label: string, state: vscode.TreeItemCollapsibleState): vscode.TreeItem {
  const t = new vscode.TreeItem(label, state);
  t.iconPath = vscode.ThemeIcon.Folder;
  return t;
}

function children(workspace: vscode.WorkspaceFolder, folder: FolderNode): FolderMapItem[] {
  return [
    ...folder.folders.map((node): FolderMapItem => ({ kind: "folder", workspace, node })),
    ...folder.files.map(
      (node): FolderMapItem => ({ kind: "file", uri: vscode.Uri.joinPath(workspace.uri, node.path), node }),
    ),
  ];
}
