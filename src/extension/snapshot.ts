import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as vscode from "vscode";
import { INTERNAL_LIMITS } from "../core/config/config";
import { standing } from "../core/insights/standing";
import type { MarkdownEngine, ParseResult } from "../core/markdown/engine";
import { utf8Bytes } from "../core/markdown/markdown-it-engine";
import type { HostToWebview, OutlineLayout } from "../core/protocol/messages";
import { allowedRoots, fileNameOf } from "./document-roots";
import { outlineLayout } from "./layout";
import { createResolver, isImageFile, resolveLocalTarget } from "./links";
import { log } from "./log";
import { parseSettings, readConfig } from "./settings";
import { localLinks, snapshotHtml, snapshotPath } from "./snapshot-html";

/** Opens a file in the user's browser — swappable so the integration tests never launch one. */
export type BrowserOpener = (uri: vscode.Uri) => Thenable<boolean>;

let opener: BrowserOpener = (uri) => vscode.env.openExternal(uri);
/** The opener in use (VS Code's own, unless a test replaced it). */
export const browserOpener = (): BrowserOpener => opener;
/** For the integration tests only: record instead of launching a browser. */
export function setBrowserOpener(replacement: BrowserOpener): void {
  opener = replacement;
}

/**
 * "Open in browser" (`#Scope`: snapshot, not live): writes the map of the document AS IT IS NOW to one
 * self-contained HTML file in the extension's own storage folder, then opens it in the default browser. The only
 * file docmap ever writes (`docs/contracts.md` §5); one file per document, overwritten on every press.
 *
 * @returns the snapshot's path, or undefined if nothing was written (declined, parse failure, write failure)
 */
export async function openSnapshot(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  engine: MarkdownEngine,
  open: BrowserOpener,
  options: {
    readonly allowLarge?: boolean;
    /** 2.0 Export HTML: write the page here (this file only, no linked pages) and do not open a browser. */
    readonly saveTo?: vscode.Uri;
    /** 2.0 Export PDF: the page opens the print dialog (Save as PDF) when it is drawn. */
    readonly print?: boolean;
  } = {},
): Promise<string | undefined> {
  const text = document.getText();
  if (!(await confirmLarge(text, options.allowLarge))) return undefined;

  const roots = allowedRoots(document);
  const main: Page = {
    uri: document.uri,
    name: fileNameOf(document),
    text,
    version: document.version,
    file: snapshotPath(context.globalStorageUri.fsPath, document.uri.toString(), fileNameOf(document)),
  };
  const drawn = draw(main, engine, roots);
  if (!drawn) {
    log().error(`snapshot: could not parse ${document.uri.toString()}`);
    void vscode.window.showErrorMessage("Couldn't read this file, so no snapshot was made.");
    return undefined;
  }

  // 0.0.13: the Markdown files it links to (and they link to) get their own pages beside it, so links between them
  // work in the browser — only files inside the opened folders, at most INTERNAL_LIMITS.snapshotPages pages
  const exported = options.saveTo ? { ...main, file: options.saveTo.fsPath } : main;
  const pages = options.saveTo
    ? [{ page: exported, result: drawn, links: {} }]
    : await collectLinkedPages(context, main, drawn, engine, roots);
  const file = exported.file;
  try {
    const dist = path.join(context.extensionUri.fsPath, "dist");
    const read = (f: string) => readFile(path.join(dist, f), "utf8");
    const { tokensCss, stylesCss, script } = await readPageAssets(context);
    let diagrams: Promise<string> | undefined; // read once, only if a page has a diagram (it is ~5 MB)
    // 2.0.4 (owner report: the cache kept growing): the browser view keeps ONE set of pages — the page and the pages
    // it links to. The previous set is removed first, and the diagram library is written once beside them, not
    // inlined into every page. An export (saveTo) is one self-contained file the user chose, so it is left alone.
    const shared = !options.saveTo;
    if (shared) await clearSnapshots(path.dirname(file));
    let libraryWritten = false;
    for (const { page, result, links } of pages) {
      const withDiagrams = readConfig().diagrams && result.html.includes('class="language-mermaid"');
      if (withDiagrams) diagrams ??= read("mermaid.js");
      const markup = snapshotHtml({
        nonce: randomBytes(16).toString("base64"),
        title: `${page.name} — docmap snapshot`,
        tokensCss,
        stylesCss,
        script,
        render: renderMessage(context, page.name, result, page.text),
        ...(options.print && page === pages[0]?.page ? { autoPrint: true } : {}),
        ...(withDiagrams && diagrams && !shared ? { diagrams: await diagrams } : {}),
        ...(withDiagrams && diagrams && shared ? { diagramsSrc: SHARED_LIBRARY } : {}),
        links,
      });
      if (shared && withDiagrams && diagrams && !libraryWritten) {
        await writeAtomically(path.join(path.dirname(file), SHARED_LIBRARY), await diagrams);
        libraryWritten = true;
      }
      await writeAtomically(page.file, markup, options.saveTo !== undefined);
    }
    log().info(
      `snapshot written: ${file} (${drawn.headings.length} headings, ${pages.length - 1} linked pages)`,
    );
  } catch (error) {
    log().error(`snapshot: could not write ${file}`, error);
    void vscode.window.showErrorMessage(`Couldn't write the snapshot to ${file}.`);
    return undefined;
  }

  if (options.saveTo) {
    const show = "Show in folder";
    void vscode.window.showInformationMessage(`Saved ${file}`, show).then((a) => {
      if (a === show) void vscode.commands.executeCommand("revealFileInOS", options.saveTo);
    });
    return file;
  }
  // in a remote window (SSH, WSL, container) or VS Code in a browser, the file is on another machine: the local
  // browser can't open it
  if (vscode.env.remoteName || vscode.env.uiKind === vscode.UIKind.Web) {
    void vscode.window.showInformationMessage(
      `Snapshot saved to ${file} on the remote machine — a browser on this computer can't open it directly.`,
    );
    return file;
  }
  const opened = await Promise.resolve(open(vscode.Uri.file(file))).catch(() => false);
  if (!opened) {
    void vscode.window.showInformationMessage(`Snapshot saved to ${file} — open it in your browser.`);
  }
  return file;
}

interface Page {
  readonly uri: vscode.Uri;
  readonly name: string;
  readonly text: string;
  readonly version: number;
  /** Where its snapshot page is written. */
  readonly file: string;
}

export type Drawn = Extract<ParseResult, { ok: true }>["document"];

/**
 * The page's map, with images confined as in the panel: only an image file inside the opened folders gets a URL —
 * by default its REAL, checked path; the live view passes its own server's URL for it instead.
 */
export function draw(
  page: Pick<Page, "uri" | "text" | "version">,
  engine: MarkdownEngine,
  roots: readonly string[],
  imageUrl: (file: string) => string | undefined = (file) => pathToFileURL(file).href,
): Drawn | undefined {
  const resolve =
    page.uri.scheme === "file" ? createResolver(path.dirname(page.uri.fsPath), roots) : undefined;
  const result = engine.parse(page.text, page.version, {
    ...parseSettings(),
    blockIds: true,
    resolveImage: (src) => {
      const target = resolve?.(src);
      return target && isImageFile(target.file) ? imageUrl(target.file) : undefined;
    },
  });
  return result.ok ? result.document : undefined;
}

/** A file over the size limit asks first (unless the reader already said yes in the map). */
export async function confirmLarge(text: string, allowLarge: boolean | undefined): Promise<boolean> {
  const bytes = utf8Bytes(text);
  if (allowLarge || bytes <= readConfig().largeFileBytes) return true;
  const go = "Open anyway";
  const mb = (bytes / 1024 / 1024).toFixed(1);
  const answer = await vscode.window.showWarningMessage(
    `This file is ${mb} MB — the browser page may take a moment to open.`,
    go,
  );
  return answer === go;
}

/** The panel's own CSS and script from the built extension — the browser pages run the same code. */
export async function readPageAssets(
  context: vscode.ExtensionContext,
): Promise<{ tokensCss: string; stylesCss: string; script: string }> {
  const read = (f: string) => readFile(path.join(context.extensionUri.fsPath, "dist", f), "utf8");
  const [tokensCss, stylesCss, script] = await Promise.all([
    read("tokens.css"),
    read("styles.css"),
    read("webview.js"),
  ]);
  return { tokensCss, stylesCss, script };
}

/** The render message a browser page draws (the same fields for the saved copy and the live view). */
export function renderMessage(
  context: vscode.ExtensionContext,
  name: string,
  drawn: Drawn,
  text?: string,
): Extract<HostToWebview, { type: "render" }> {
  const { headings, html, docVersion } = drawn;
  const look = lookOf();
  // easy reading in the browser too (owner report 2026-11-24): "Where this stands" from the doc's own text
  const s = text !== undefined && look.clean !== false ? standing(text, headings) : undefined;
  const withStanding = s && (s.parts.length >= 2 || s.disagree.length > 0) ? { standing: s } : {};
  return {
    type: "render",
    docVersion,
    fileName: name,
    headings,
    html,
    readingTools: parseSettings().readingTools,
    ...layoutField(context),
    extras: { look, ...withStanding },
  };
}

/**
 * The page and the Markdown files reachable by its links, breadth first, up to the page limit — each with the map of
 * its links to the pages written (href → file: URL, with the #heading). A file that is too large, unreadable or
 * past the limit gets no page; links to it stay inert, as before 0.0.13.
 */
async function collectLinkedPages(
  context: vscode.ExtensionContext,
  main: Page,
  drawn: Drawn,
  engine: MarkdownEngine,
  roots: readonly string[],
): Promise<{ page: Page; result: Drawn; links: Record<string, string> }[]> {
  const found = [{ page: main, result: drawn }];
  const byUri = new Map<string, number>([[main.uri.toString(), 0]]);
  const targets: Map<string, { key: string; fragment: string | undefined }>[] = [];
  for (let i = 0; i < found.length; i++) {
    const { page, result } = found[i] as (typeof found)[number];
    const here = new Map<string, { key: string; fragment: string | undefined }>();
    targets.push(here);
    if (page.uri.scheme !== "file") continue;
    for (const href of localLinks(result.html)) {
      const target = resolveLocalTarget(href, path.dirname(page.uri.fsPath), roots);
      if (!target || !/\.(md|markdown)$/i.test(target.file)) continue;
      const uri = vscode.Uri.file(target.file);
      const key = uri.toString();
      if (!byUri.has(key)) {
        if (found.length >= INTERNAL_LIMITS.snapshotPages) continue;
        const linked = await readLinked(context, uri);
        const linkedResult = linked ? draw(linked, engine, roots) : undefined;
        if (!linked || !linkedResult) continue;
        byUri.set(key, found.length);
        found.push({ page: linked, result: linkedResult });
      }
      here.set(href, { key, fragment: target.fragment });
    }
  }
  return found.map(({ page, result }, i) => {
    const links: Record<string, string> = {};
    for (const [href, { key, fragment }] of targets[i] ?? []) {
      const index = byUri.get(key);
      const to = index === undefined ? undefined : found[index];
      if (!to) continue;
      const url = pathToFileURL(to.page.file).href;
      links[href] = fragment ? `${url}#${encodeURIComponent(fragment)}` : url;
    }
    return { page, result, links };
  });
}

/** A linked file's text: the open (maybe unsaved) document if there is one — what the map shows — else the disk. */
async function readLinked(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<Page | undefined> {
  const name = uri.path.split("/").pop() || "Markdown";
  const file = snapshotPath(context.globalStorageUri.fsPath, uri.toString(), name);
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) {
    const text = open.getText();
    return utf8Bytes(text) > readConfig().largeFileBytes
      ? undefined
      : { uri, name, text, version: open.version, file };
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.byteLength > readConfig().largeFileBytes) return undefined;
    return { uri, name, text: new TextDecoder().decode(bytes), version: 1, file };
  } catch (error) {
    log().info(`snapshot: linked file not read: ${uri.toString()} (${String(error)})`);
    return undefined;
  }
}

/** Whole file or nothing: a half-written page never replaces a good one. A copy of a document: owner-only. */
async function writeAtomically(file: string, markup: string, shared = false): Promise<void> {
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`; // unique: two quick presses never share one
  try {
    await mkdir(path.dirname(file), { recursive: true, ...(shared ? {} : { mode: 0o700 }) });
    // snapshots in the extension's storage: owner-only; an export the user saved to share: normal file permissions
    await writeFile(temp, markup, { encoding: "utf8", mode: shared ? 0o644 : 0o600 });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function layoutField(context: vscode.ExtensionContext): { layout?: OutlineLayout } {
  const layout = outlineLayout(context);
  return layout ? { layout } : {};
}

/** The reading look from settings (theme, text size, line width) — the same in the browser copy as in VS Code. */
function lookOf() {
  const { theme, fontScale, lineWidth, cleanView, headingNumbers } = readConfig();
  return { theme, fontScale, lineWidth, clean: cleanView, numbers: headingNumbers };
}

/** The diagram library's file name in the browser view's folder (written once per set of pages). */
const SHARED_LIBRARY = "docmap-mermaid.js";

/**
 * Empties the browser view's folder (the extension's own storage, never the user's files): the previous pages are
 * replaced, not kept. Missing folder = nothing to do.
 */
export async function clearSnapshots(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch((error: unknown) =>
    log().warn(`could not clear old browser pages in ${dir}: ${String(error)}`),
  );
}

/** At startup: old browser pages from earlier versions (one per file ever opened) are removed. */
export function snapshotsDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "snapshots");
}
