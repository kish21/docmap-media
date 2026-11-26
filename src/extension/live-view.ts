import { randomBytes } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { debounceForBytes, INTERNAL_LIMITS, INTERNAL_TIMINGS } from "../core/config/config";
import type { MarkdownEngine } from "../core/markdown/engine";
import { utf8Bytes } from "../core/markdown/markdown-it-engine";
import { allowedRoots, fileNameOf } from "./document-roots";
import { resolveLocalTarget } from "./links";
import { type LiveServer, startLiveServer } from "./live-server";
import { log } from "./log";
import { readConfig } from "./settings";
import { type BrowserOpener, confirmLarge, draw, readPageAssets, renderMessage } from "./snapshot";
import { localLinks, snapshotHtml } from "./snapshot-html";

/**
 * "Open in browser", live (owner call 2026-11-17: re-pressing after every edit is annoying). The same page as the
 * saved snapshot, served by docmap's own local server (`live-server.ts`), which tells the tab to fetch the newest
 * map after each edit. Serves only the documents opened this way and the Markdown files they link to (inside the
 * opened folders, like the panel), and only image files the map approved. Started on the first use, stopped with
 * VS Code; nothing is written to disk.
 */
export class LiveView implements vscode.Disposable {
  private server: Promise<LiveServer> | undefined;
  private readonly docs: { readonly uri: vscode.Uri; allowLarge: boolean }[] = [];
  private readonly ids = new Map<string, number>();
  private readonly files = new Map<string, { readonly path: string; readonly type: string }>();
  private readonly fileKeys = new Map<string, string>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly engine: MarkdownEngine,
  ) {
    this.subscriptions = [
      vscode.workspace.onDidChangeTextDocument((e) => this.changed(e.document.uri)),
      // a reading setting changed (theme, text size, reading tools…): every open tab draws again
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("docmap")) void this.server?.then((s) => s.notify());
      }),
    ];
  }

  /**
   * Opens the live page of `document` in the browser.
   * @returns the page's URL, or undefined when the live view can't be used here (the caller saves a copy instead)
   */
  async open(
    document: vscode.TextDocument,
    allowLarge: boolean,
    opener: BrowserOpener,
  ): Promise<string | undefined> {
    // VS Code in a browser (and hosted editors) can't reach a server on its own machine as 127.0.0.1
    if (vscode.env.uiKind === vscode.UIKind.Web) return undefined;
    if (!(await confirmLarge(document.getText(), allowLarge))) return "";
    const id = this.register(document.uri, true);
    if (id === undefined) return undefined;
    const server = await this.start();
    if (!server) return undefined;
    const local = vscode.Uri.parse(`${server.base}/doc/${id}`);
    // in a remote window (SSH, WSL, container) VS Code forwards the port to this computer
    const target = vscode.env.remoteName ? await vscode.env.asExternalUri(local) : local;
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(target.authority)) return undefined;
    const url = target.toString(true);
    const opened = await Promise.resolve(opener(target)).catch(() => false);
    if (!opened)
      void vscode.window.showInformationMessage(`Live page ready at ${url} — open it in your browser.`);
    log().info(`live view: ${document.uri.toString()} as page ${id}`);
    return url;
  }

  dispose(): void {
    for (const s of this.subscriptions) s.dispose();
    for (const t of this.timers.values()) clearTimeout(t);
    void this.server?.then((s) => s.close());
    this.server = undefined;
  }

  /** For the integration tests: the running server, if any. */
  running(): Promise<LiveServer> | undefined {
    return this.server;
  }

  private start(): Promise<LiveServer | undefined> {
    this.server ??= startLiveServer(
      {
        page: (id) => this.page(id),
        data: async (id) => {
          const drawn = await this.drawn(id);
          return drawn && JSON.stringify(drawn.render);
        },
        file: (key) => this.files.get(key),
      },
      {
        keepAliveMs: INTERNAL_TIMINGS.liveKeepAliveMs,
        maxListeners: INTERNAL_LIMITS.liveListeners,
        onError: (e) => log().warn(`live view: ${String(e)}`),
      },
    );
    return this.server.catch((error: unknown) => {
      log().error("live view: could not start the local server", error);
      this.server = undefined;
      return undefined;
    });
  }

  /** A document's number in this server's links; a new one only while under the page limit. */
  private register(uri: vscode.Uri, allowLarge = false): number | undefined {
    const key = uri.toString();
    const known = this.ids.get(key);
    if (known !== undefined) {
      const doc = this.docs[known];
      if (doc && allowLarge) doc.allowLarge = true;
      return known;
    }
    if (this.docs.length >= INTERNAL_LIMITS.livePages) return undefined;
    this.docs.push({ uri, allowLarge });
    this.ids.set(key, this.docs.length - 1);
    return this.docs.length - 1;
  }

  /**
   * An approved file under a random key (its path never appears in a URL), as a path on this server — same origin
   * also when VS Code forwards the port to another number (remote windows).
   */
  private fileUrl(base: string, file: string, type: string): string | undefined {
    let key = this.fileKeys.get(file);
    if (key === undefined) {
      if (this.files.size >= INTERNAL_LIMITS.liveFiles) return undefined;
      key = randomBytes(12).toString("hex");
      this.fileKeys.set(file, key);
      this.files.set(key, { path: file, type });
    }
    return `${new URL(base).pathname}/file/${key}`;
  }

  private changed(uri: vscode.Uri): void {
    const id = this.ids.get(uri.toString());
    if (id === undefined || !this.server) return;
    clearTimeout(this.timers.get(id));
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    const bytes = open ? utf8Bytes(open.getText()) : 0;
    this.timers.set(
      id,
      setTimeout(
        () => {
          this.timers.delete(id);
          void this.server?.then((s) => s.notify(id));
        },
        debounceForBytes(readConfig().updateDebounceMs, bytes),
      ),
    );
  }

  /** The document's map now: the open (maybe unsaved) text if it is open in VS Code, else the file on disk. */
  private async drawn(id: number) {
    const doc = this.docs[id];
    const server = await this.server;
    if (!doc || !server) return undefined;
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === doc.uri.toString());
    let text: string;
    let version: number;
    let name: string;
    if (open) {
      text = open.getText();
      version = open.version;
      name = fileNameOf(open);
    } else {
      try {
        text = new TextDecoder().decode(await vscode.workspace.fs.readFile(doc.uri));
      } catch {
        return undefined;
      }
      version = 1;
      name = doc.uri.path.split("/").pop() || "Markdown";
    }
    if (!doc.allowLarge && utf8Bytes(text) > readConfig().largeFileBytes) return undefined;
    const roots = allowedRoots(open ?? { uri: doc.uri });
    const result = draw({ uri: doc.uri, text, version }, this.engine, roots, (file) =>
      this.fileUrl(server.base, file, imageType(file)),
    );
    if (!result) return undefined;
    // links to other Markdown files inside the opened folders open their own live page
    const links: Record<string, string> = {};
    if (doc.uri.scheme === "file") {
      for (const href of localLinks(result.html)) {
        const target = resolveLocalTarget(href, path.dirname(doc.uri.fsPath), roots);
        if (!target || !/\.(md|markdown)$/i.test(target.file)) continue;
        const to = this.register(vscode.Uri.file(target.file));
        if (to === undefined) continue;
        const page = new URL(`${server.base}/doc/${to}`).pathname;
        links[href] = target.fragment ? `${page}#${encodeURIComponent(target.fragment)}` : page;
      }
    }
    return {
      name,
      result,
      links,
      render: renderMessage(this.context, name, result, text),
      server,
    };
  }

  private async page(id: number): Promise<string | undefined> {
    const drawn = await this.drawn(id);
    if (!drawn) return undefined;
    const { name, result, links, render, server } = drawn;
    const withDiagrams = readConfig().diagrams && result.html.includes('class="language-mermaid"');
    const library = path.join(this.context.extensionUri.fsPath, "dist", "mermaid.js");
    const diagramsSrc = withDiagrams
      ? this.fileUrl(server.base, library, "text/javascript; charset=utf-8")
      : undefined;
    const pathOf = (url: string) => new URL(url).pathname;
    return snapshotHtml({
      nonce: randomBytes(16).toString("base64"),
      title: `${name} — docmap live`,
      ...(await readPageAssets(this.context)),
      render,
      links,
      ...(diagramsSrc ? { diagramsSrc } : {}),
      live: { data: pathOf(`${server.base}/data/${id}`), events: pathOf(`${server.base}/events/${id}`) },
    });
  }
}

/** The content type of an approved image (the map only approves image files). */
function imageType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
  };
  return types[ext] ?? "application/octet-stream";
}
