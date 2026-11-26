/**
 * The folder map's shape (0.0.8): Markdown file paths → a folder tree, folders first, each level sorted by name.
 * Pure (no `vscode`): the extension lists the files, this decides how they nest.
 */

export interface FolderNode {
  readonly kind: "folder";
  readonly name: string;
  /** Path from the root, "/"-separated ("" for the root itself). */
  readonly path: string;
  readonly folders: FolderNode[];
  readonly files: FileNode[];
}

export interface FileNode {
  readonly kind: "file";
  readonly name: string;
  readonly path: string;
}

/** `paths` are relative, "/"-separated ("docs/plan.md"). Duplicates and empty segments are ignored. */
export function buildFileTree(paths: readonly string[]): FolderNode {
  const root: FolderNode = { kind: "folder", name: "", path: "", folders: [], files: [] };
  const folders = new Map<string, FolderNode>([["", root]]);
  const seen = new Set<string>();
  for (const raw of paths) {
    const parts = raw.split("/").filter((p) => p !== "" && p !== ".");
    if (parts.length === 0) continue;
    const path = parts.join("/");
    if (seen.has(path)) continue;
    seen.add(path);
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = parts.slice(0, i + 1).join("/");
      let folder = folders.get(folderPath);
      if (!folder) {
        folder = { kind: "folder", name: parts[i] ?? "", path: folderPath, folders: [], files: [] };
        folders.set(folderPath, folder);
        parent.folders.push(folder);
      }
      parent = folder;
    }
    parent.files.push({ kind: "file", name: parts[parts.length - 1] ?? "", path });
  }
  sortTree(root);
  return compact(root);
}

/**
 * `filePath` relative to `folderPath` (both URI paths, "/"-separated), or undefined when the file is not inside.
 * Windows drive letters are compared without case: VS Code can report the folder as "/C:/…" and its files as
 * "/c:/…", and a plain prefix test then dropped every file (the Markdown Files list showed none).
 */
export function relativeTo(folderPath: string, filePath: string): string | undefined {
  const drive = (p: string) => p.replace(/^\/([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}:`);
  const prefix = `${drive(folderPath).replace(/\/$/, "")}/`;
  const file = drive(filePath);
  return file.startsWith(prefix) ? file.slice(prefix.length) : undefined;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

function sortTree(folder: FolderNode): void {
  folder.folders.sort(byName);
  folder.files.sort(byName);
  for (const f of folder.folders) sortTree(f);
}

/**
 * A folder whose only content is one folder is shown as one row ("docs/guides"), as VS Code's Explorer does with
 * compact folders — fewer clicks to reach the files.
 */
function compact(folder: FolderNode): FolderNode {
  const folders = folder.folders.map((child) => {
    let merged = child;
    while (merged.files.length === 0 && merged.folders.length === 1) {
      const only = merged.folders[0] as FolderNode;
      merged = { ...only, name: `${merged.name}/${only.name}` };
    }
    return compact(merged);
  });
  return { ...folder, folders };
}
