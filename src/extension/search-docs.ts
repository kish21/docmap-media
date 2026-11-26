import * as vscode from "vscode";
import { INTERNAL_LIMITS } from "../core/config/config";
import { type DocMatch, searchDoc } from "../core/insights/search";
import { relativePath } from "./agent";
import { mapLimit } from "./concurrency";
import { leftOut, readConfig } from "./settings";

/**
 * 3.0 "Search All Docs…" (owner call 2026-11-18): one search box over every Markdown file in the opened folders;
 * each result names its file and the headings it sits under. Read-only: picking a result opens the file at that
 * line. Files are read once when the box opens (open editors' unsaved text wins); excluded and build folders skipped.
 */
export interface DocHit extends DocMatch {
  readonly uri: vscode.Uri;
  readonly rel: string;
}

const GLOB = "**/*.{md,markdown}";

/** Every Markdown file's text (capped like the folder map; files over the large-file limit skipped). */
export async function loadDocs(): Promise<{ uri: vscode.Uri; text: string }[]> {
  const config = readConfig();
  const limit = config.largeFileBytes;
  const found = (await vscode.workspace.findFiles(GLOB, undefined, INTERNAL_LIMITS.folderMapFiles)).filter(
    (u) => !leftOut(u, config),
  );
  const open = new Map(vscode.workspace.textDocuments.map((d) => [d.uri.toString(), d]));
  const batch = await mapLimit(found, INTERNAL_LIMITS.ioConcurrency, async (uri) => {
    const doc = open.get(uri.toString());
    if (doc) return { uri, text: doc.getText() };
    try {
      if ((await vscode.workspace.fs.stat(uri)).size > limit) return undefined;
      return { uri, text: new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)) };
    } catch {
      return undefined;
    }
  });
  const out = batch.filter((b): b is { uri: vscode.Uri; text: string } => b !== undefined);
  return out.sort((a, b) => relativePath(a.uri).localeCompare(relativePath(b.uri)));
}

/** The matches of `query` across the loaded docs, capped per file and in total. */
export function findInDocs(docs: readonly { uri: vscode.Uri; text: string }[], query: string): DocHit[] {
  const hits: DocHit[] = [];
  for (const d of docs) {
    const left = INTERNAL_LIMITS.searchResults - hits.length;
    if (left <= 0) break;
    const rel = relativePath(d.uri);
    for (const m of searchDoc(d.text, query, Math.min(left, INTERNAL_LIMITS.searchPerFile)))
      hits.push({ ...m, uri: d.uri, rel });
  }
  return hits;
}

export async function searchDocs(initial?: string): Promise<void> {
  type Item = vscode.QuickPickItem & { hit?: DocHit };
  const box = vscode.window.createQuickPick<Item>();
  box.title = "Search all docs";
  box.placeholder = "Type at least 2 letters: results show each doc and the headings a match sits under";
  box.matchOnDescription = true;
  box.matchOnDetail = true;
  box.busy = true;
  box.show();
  const docs = await loadDocs();
  box.busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = (query: string) => {
    const hits = findInDocs(docs, query);
    const items: Item[] = [];
    let file = "";
    for (const hit of hits) {
      if (hit.rel !== file) {
        file = hit.rel;
        items.push({ label: file, kind: vscode.QuickPickItemKind.Separator });
      }
      items.push({
        label: hit.trail.length ? `› ${hit.trail.join(" › ")}` : "(top of the file)",
        description: `line ${hit.line + 1}`,
        detail: hit.snippet,
        // the box's own filter would hide hits whose label lacks the words; every hit already matched
        alwaysShow: true,
        hit,
      });
    }
    box.items = items;
    box.title =
      query.trim().length < 2
        ? `Search all docs (${docs.length} files)`
        : `${hits.length >= INTERNAL_LIMITS.searchResults ? `First ${hits.length}` : hits.length} matches in ${new Set(hits.map((h) => h.rel)).size} of ${docs.length} files`;
  };
  box.onDidChangeValue((q) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => update(q), 150);
  });
  box.onDidAccept(async () => {
    const hit = box.selectedItems[0]?.hit;
    if (!hit) return;
    box.hide();
    const editor = await vscode.window.showTextDocument(hit.uri, { preview: true });
    const at = new vscode.Position(hit.line, 0);
    editor.selection = new vscode.Selection(at, at);
    editor.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenter);
  });
  box.onDidHide(() => box.dispose());
  if (initial) box.value = initial;
  update(box.value);
}
