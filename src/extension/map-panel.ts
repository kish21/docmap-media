import { randomBytes } from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import { buildPrompt, docFacts } from "../core/agent/prompts";
import { debounceForBytes, INTERNAL_LIMITS, INTERNAL_TIMINGS } from "../core/config/config";
import { analyze, frontMatter, openTasks } from "../core/insights/analyze";
import { docItems, sectionBadges } from "../core/insights/items";
import { BROWSER_FRAGMENT } from "../core/insights/plans-dashboard";
import { alignBlocks } from "../core/insights/redline";
import { changedSections, sectionHashes } from "../core/insights/sections";
import { signedHash, signoffs, withSignoff } from "../core/insights/signoff";
import { fnv1a } from "../core/insights/similarity";
import { recognise } from "../core/insights/standards";
import { recordsFor, standing } from "../core/insights/standing";
import type { MarkdownEngine, ParseResult } from "../core/markdown/engine";
import { utf8Bytes } from "../core/markdown/markdown-it-engine";
import { headingAtLine, type LineEdit, shiftLineThrough } from "../core/outline/moved";
import type { Heading, SourceBlock } from "../core/outline/types";
import {
  type BlockTrust,
  type HostToWebview,
  isWebviewToHost,
  MAX_REDLINE_HTML,
  type PageExtras,
  type Redline,
  type SectionCounts,
  type WebviewToHost,
} from "../core/protocol/messages";
import { deliverPrompt, pickAndDeliver, relativePath } from "./agent";
import { mapLimit } from "./concurrency";
import { compareWithStandard } from "./doc-standards";
import { allowedRoots, fileNameOf } from "./document-roots";
import { commitBefore, fileAt, fileCommits, gitUserName, mainBranchOf, tags } from "./git";
import { outlineLayout, saveOutlineLayout } from "./layout";
import { createResolver, isCodeFile, isImageFile, openKind, resolveLocalTarget } from "./links";
import { log } from "./log";
import { NotesStore } from "./notes";
import {
  applyMovedFix,
  askComment,
  codePeekFor,
  codeRefsFor,
  copyForAgent,
  movedFixes,
  openCodeRef,
  runInTerminal,
} from "./page-actions";
import { panelHtml } from "./panel-html";
import { PlaceStore } from "./places";
import { isReport } from "./reports";
import { readSeenText, writeSeenText } from "./seen-text";
import { parseSettings, readConfig } from "./settings";
import { showSideBySide } from "./side-by-side";
import { changeStatus, tickTask } from "./tick";
import { blockHash, blockText, computeTrust, type OtherDocs } from "./trust-service";

/**
 * One Map panel for one Markdown file (keyed by URI). The host owns the document; the webview only draws.
 * If the file is closed and reopened, VS Code hands out a NEW TextDocument — the panel re-attaches to it.
 * Closing the file's tab does not close its map (0.0.11, owner call): the map keeps showing the file, and opens it
 * again when it needs it (a click, a redraw, a change on disk). Only a file that is gone says so.
 *
 * A map lives in one of two places (0.2.0): a "panel" of its own (beside the file, or over it), or a "page" — the
 * file's own tab, shown as the page instead of its source (a read-only custom editor; page-editor.ts swaps the tab
 * between the two). The page is the same map; only who owns the tab differs.
 */

export class MapPanel {
  private static readonly open = new Map<string, MapPanel>();
  /** The maps shown as a file's own tab (page-editor.ts), keyed by URI like `open`. */
  private static readonly pages = new Map<string, MapPanel>();
  /** A heading to scroll a page to when it opens (it is opened by VS Code, which hands it over a moment later). */
  private static readonly pendingPageReveal = new Map<string, string>();
  /** Where the reader was in each file's map (a heading id) — places.ts. */
  static placeStore: PlaceStore | undefined;
  /** 2.0: review marks, highlights, what the reader last saw — per file (notes.ts). */
  static notes: NotesStore | undefined;
  /** 3.0: the rest of the workspace, for "conflicts with another doc" and "a newer version exists". */
  static others: OtherDocs | undefined;
  /** 3.0: the latest trust markers, and the blocks they belong to (source line ranges). */
  private trust: BlockTrust[] = [];
  /** 2026-11-22: the doc's code names that open something (sent to the page as `codeRefs`). */
  private codeRefs: string[] = [];
  /** Easy reading: each part's build record, as a link from this doc (found in the background, like codeRefs). */
  private records = new Map<string, { href: string; title: string }>();
  private blocks: readonly SourceBlock[] = [];
  private trustRun = 0;
  /** 3.0 redline: what the page is compared with (none = not comparing), and that version parsed (cached). */
  private redlineBase: { label: string; text: string } | undefined;
  private redlineParsed?: { text: string; html: string; blocks: string[] };
  /** 3.0 redline: the text as the reader last read it (from the previous open), if kept. */
  private seenBefore: string | undefined;
  /** What the reader had seen of this file when the map opened (section fingerprints): "what changed" is against it. */
  private baseline: Record<string, number> | undefined;
  /** The latest render's fingerprints and headings, kept for "mark as read", the section menu and closing. */
  private markedRead = false;
  private lastSeen:
    | { hashes: Record<string, number>; hash: number; headings: readonly Heading[] }
    | undefined;
  /** A heading to scroll the map to after its next render: the remembered place, or a link's #heading. */
  private pendingReveal: string | undefined;
  private scrollTimer: ReturnType<typeof setTimeout> | undefined;
  private lastLinkOpen = Number.NEGATIVE_INFINITY;
  /** The line the last click in the map moved the editor to, and when (see syncScroll). */
  private jumped: { readonly line: number; readonly at: number } | undefined;
  /** The folders the panel may load images from, as last given to VS Code (refreshed when they change). */
  private resourceRoots = "";
  private readonly disposables: vscode.Disposable[] = [];
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private lastBytes = 0;
  private allowLarge = false;
  private detached = false;
  /** The edits made since recent versions (oldest first): a click drawn before them is carried to its new line. */
  private edits: { readonly version: number; readonly edits: readonly LineEdit[] }[] = [];
  /** The last message sent to the webview, overall and per type — read by the integration tests only. */
  lastPosted: HostToWebview | undefined;
  readonly lastByType = new Map<HostToWebview["type"], HostToWebview>();

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private document: vscode.TextDocument,
    private readonly engine: MarkdownEngine,
    private readonly dist: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
    private readonly mode: Mode = "panel",
  ) {
    const key = document.uri.toString();
    MapPanel.placeStore ??= new PlaceStore(context.workspaceState, () => readConfig().rememberPlace);
    this.pendingReveal = MapPanel.placeStore.get(key);
    MapPanel.notes ??= new NotesStore(context.workspaceState);
    this.baseline = MapPanel.notes.seen(key);
    void readSeenText(key).then((t) => {
      this.seenBefore = t;
    });
    this.disposables.push(
      panel.webview.onDidReceiveMessage((m: unknown) => {
        if (!isWebviewToHost(m)) {
          log().warn("ignored malformed message from the map panel");
          return;
        }
        this.receive(m).catch((error: unknown) => log().error(`map panel: ${m.type} failed`, error));
      }),
      vscode.workspace.onDidSaveTextDocument((d) => {
        if (d.uri.toString() === key) void this.refreshTrust(); // markers follow saved text (git sees saved files)
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        // a save or dirty-flag change fires with no content changes: nothing to redraw
        if (e.document.uri.toString() !== key || e.contentChanges.length === 0) return;
        this.recordEdits(e.document.version, e.contentChanges);
        if (this.lastBytes > 0) {
          let delta = 0;
          for (const c of e.contentChanges) delta += c.text.length - c.rangeLength;
          this.lastBytes = Math.max(1, this.lastBytes + delta);
        }
        this.scheduleRender();
      }),
      vscode.workspace.onDidCloseTextDocument((d) => {
        if (d.uri.toString() !== key) return;
        // the map stays as drawn; it opens the file again when it needs it (reattach)
        this.detached = true;
        clearTimeout(this.debounce);
        // an unsaved new file is gone once closed: nothing to open again
        if (d.uri.scheme === "untitled") this.showGone("It was closed without being saved.");
      }),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (e.textEditor.document.uri.toString() === key) this.scheduleScrollSync(e.textEditor);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        // reading tools / structure hints change what is drawn: redraw with the new settings
        if (
          [
            "readingTools",
            "inferHeadings",
            "theme",
            "fontScale",
            "lineWidth",
            "cleanView",
            "headingNumbers",
          ].some((k) => e.affectsConfiguration(`docmap.${k}`))
        )
          this.render();
        // diagrams on/off changes the page itself (its CSP): reload it; it asks for a render when ready
        if (e.affectsConfiguration("docmap.diagrams"))
          this.panel.webview.html = MapPanel.page(this.panel.webview, this.dist, this.fileName);
      }),
      panel.onDidDispose(() => this.dispose()),
    );
    if (document.uri.scheme === "file") {
      // while the file is closed, its map follows the file on disk (e.g. a git checkout) and notices it going
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(
          vscode.Uri.file(path.dirname(document.uri.fsPath)),
          path.basename(document.uri.fsPath),
        ),
      );
      const changedOnDisk = () => {
        if (this.detached) void this.reattach();
      };
      this.disposables.push(
        watcher,
        watcher.onDidChange(changedOnDisk),
        watcher.onDidCreate(changedOnDisk),
        watcher.onDidDelete(() => {
          if (this.detached) this.showGone("It was deleted, moved or renamed.");
        }),
      );
    }
  }

  /**
   * Opens the map for a document, or brings its existing map forward (re-attaching after a reopen).
   * "beside": next to the file, which keeps focus. "here": in the file's own editor group, full width, focused.
   */
  static show(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    engine: MarkdownEngine,
    placement: Placement = "beside",
    inColumn?: vscode.ViewColumn,
  ): MapPanel {
    const key = document.uri.toString();
    const column =
      inColumn ??
      (placement === "here"
        ? (vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Active)
        : vscode.ViewColumn.Beside);
    const existing = MapPanel.open.get(key);
    if (existing) {
      if (existing.document !== document || existing.detached) existing.attach(document);
      existing.panel.reveal(column, placement === "beside");
      return existing;
    }
    const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
    const name = fileNameOf(document);
    const roots = allowedRoots(document);
    const panel = vscode.window.createWebviewPanel(
      "docmap.map",
      `Preview: ${name}`,
      { viewColumn: column, preserveFocus: placement === "beside" },
      // the panel may load its own files, and images from the folders the user opened (refreshed on render);
      // VS Code's find bar (Ctrl+F / Cmd+F) searches the document text, not just the headings the filter covers
      {
        enableScripts: true,
        enableFindWidget: true,
        localResourceRoots: [dist, ...roots.map((r) => vscode.Uri.file(r))],
      },
    );
    panel.webview.html = MapPanel.page(panel.webview, dist, name);
    const mapPanel = new MapPanel(panel, document, engine, dist, context);
    mapPanel.resourceRoots = roots.join("\n"); // already given to VS Code above: no reload on the first render
    MapPanel.open.set(key, mapPanel);
    log().info(`map opened: ${key}`);
    return mapPanel;
  }

  /**
   * Draws the map in a webview VS Code made for the file's own tab (the "page" custom editor). Same page, same
   * locked-down options as a panel; the find bar is switched on where the editor is registered (page-editor.ts).
   */
  static adoptPage(
    context: vscode.ExtensionContext,
    document: vscode.TextDocument,
    engine: MarkdownEngine,
    webviewPanel: vscode.WebviewPanel,
  ): MapPanel {
    const key = document.uri.toString();
    const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
    const roots = allowedRoots(document);
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [dist, ...roots.map((r) => vscode.Uri.file(r))],
    };
    webviewPanel.webview.html = MapPanel.page(webviewPanel.webview, dist, fileNameOf(document));
    const page = new MapPanel(webviewPanel, document, engine, dist, context, "page");
    page.resourceRoots = roots.join("\n");
    const reveal = MapPanel.pendingPageReveal.get(key);
    MapPanel.pendingPageReveal.delete(key);
    if (reveal !== undefined) page.pendingReveal = reveal; // the heading the reader came from wins over the stored one
    MapPanel.pages.set(key, page);
    log().info(`page opened: ${key}`);
    return page;
  }

  /** The page (file's own tab) for a file, if one is open. */
  static pageFor(uri: vscode.Uri): MapPanel | undefined {
    return MapPanel.pages.get(uri.toString());
  }

  /** Scrolls a file's page to a heading: now if the page is open, else as soon as VS Code hands it over. */
  static revealPage(uri: vscode.Uri, headingId: string): void {
    const page = MapPanel.pages.get(uri.toString());
    if (page) page.revealAfterRender(headingId);
    else MapPanel.pendingPageReveal.set(uri.toString(), headingId);
  }

  /** The heading the reader was last in, in any map of this file (memory only; undefined if never read). */
  static placeOf(uri: vscode.Uri): string | undefined {
    return MapPanel.placeStore?.get(uri.toString());
  }

  /** The panel page: a new nonce each load; the diagram library's URI only while `docmap.diagrams` is on. */
  private static page(w: vscode.Webview, dist: vscode.Uri, name: string): string {
    const uri = (file: string) => w.asWebviewUri(vscode.Uri.joinPath(dist, file)).toString();
    return panelHtml({
      cspSource: w.cspSource,
      nonce: randomBytes(16).toString("base64"),
      tokensCss: uri("tokens.css"),
      stylesCss: uri("styles.css"),
      script: uri("webview.js"),
      title: `Preview: ${name}`,
      ...(readConfig().diagrams ? { diagrams: uri("mermaid.js") } : {}),
    });
  }

  /** The document of the map panel the user is looking at, if a map tab is the active one. */
  static activeDocument(): vscode.TextDocument | undefined {
    // the tab bar updates before a panel's own `active` flag does (e.g. right after "Open Map"): ask both
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const mapTab = tab?.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith("docmap.map");
    const maps = [...MapPanel.open.values()].filter((p) => !p.detached);
    const exact = maps.find((p) => p.panel.active); // preferred: two maps may share a title (same file name)
    const found = exact ?? (mapTab ? maps.find((p) => p.panel.title === tab?.label) : undefined);
    if (found) return found.document;
    // a page (the file's own tab): its tab names the file exactly
    const pageTab =
      tab?.input instanceof vscode.TabInputCustom && tab.input.viewType.endsWith(PAGE_VIEW_TYPE);
    const pages = [...MapPanel.pages.values()];
    return (
      pages.find((p) => p.panel.active) ??
      (pageTab ? MapPanel.pages.get((tab.input as vscode.TabInputCustom).uri.toString()) : undefined)
    )?.document;
  }

  /** Whether the user already chose "render anyway" for this file's large-file warning. */
  static allowsLarge(uri: vscode.Uri): boolean {
    const key = uri.toString();
    return (MapPanel.open.get(key)?.allowLarge || MapPanel.pages.get(key)?.allowLarge) ?? false;
  }

  /** The editor group the map is in, as VS Code last reported it (it updates a moment after a move). */
  get viewColumn(): vscode.ViewColumn | undefined {
    return this.panel.viewColumn;
  }

  /** Whether VS Code's find bar is on for this map — for the integration tests only. */
  get findWidget(): boolean {
    return this.panel.options.enableFindWidget === true;
  }

  /** The panel for a file, if one is open — for the integration tests only. */
  static for(uri: vscode.Uri): MapPanel | undefined {
    return MapPanel.open.get(uri.toString());
  }

  /** Handles one validated message from the webview. Public so the integration tests can drive a "click". */
  async receive(message: WebviewToHost): Promise<void> {
    switch (message.type) {
      case "ready":
        this.render();
        return;
      case "renderAnyway":
        this.allowLarge = true;
        this.render();
        return;
      case "jump":
        await this.jump(message.docVersion, message.line, message.headingId);
        return;
      case "openLink":
        await this.openLink(message.href);
        return;
      case "place":
        MapPanel.placeStore?.set(this.document.uri.toString(), message.headingId); // the URI outlives a close
        return;
      case "layout":
        // one outline size for every map (0.0.20): VS Code's own storage, a width and a flag — no document content
        await saveOutlineLayout(this.context, message);
        return;
      case "sectionMenu":
        await this.sectionMenu(message.headingId, message.slides === true);
        return;
      case "highlight": {
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        MapPanel.notes?.addHighlight(this.key, {
          id,
          headingId: message.headingId,
          text: message.text.trim(),
        });
        this.postExtras();
        return;
      }
      case "comment": {
        // 2026-11-22: a comment on selected text — kept like a highlight, sent with "Send my review"
        const note = await askComment(message.text.trim());
        if (!note) return;
        MapPanel.notes?.addHighlight(this.key, {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          headingId: message.headingId,
          text: message.text.trim(),
          note,
        });
        this.postExtras();
        return;
      }
      case "openCode":
        if (this.codeRefs.includes(message.text)) await openCodeRef(this.document, message.text);
        return;
      case "openAtlas":
        if (!isReport(this.document.uri))
          await vscode.commands.executeCommand("docmap.docAtlas", { atlasFor: this.document.uri });
        return;
      case "openPlans":
        await vscode.commands.executeCommand("docmap.plansDashboard");
        return;
      case "openQuestions":
        await vscode.commands.executeCommand("docmap.openQuestions");
        return;
      case "showSource":
        if (this.mode === "page")
          await vscode.commands.executeCommand("docmap.showSource", this.document.uri);
        return;
      case "peekCode": {
        const peek = await codePeekFor(this.document, message.text, this.codeRefs.includes(message.text));
        this.post({ type: "codePeek", text: message.text, ...(peek ? { peek } : {}) });
        return;
      }
      case "runInTerminal":
        await runInTerminal(message.text);
        return;
      case "unhighlight": {
        const h = MapPanel.notes?.highlights(this.key).find((x) => x.id === message.id);
        if (h?.note) {
          const remove = "Delete comment";
          const answer = await vscode.window.showInformationMessage(
            `Your comment: "${h.note}"`,
            remove,
            "Keep",
          );
          if (answer !== remove) return;
        }
        MapPanel.notes?.removeHighlight(this.key, message.id);
        this.postExtras();
        return;
      }
      case "markRead":
        this.markRead();
        return;
      case "copy":
        await vscode.env.clipboard.writeText(message.text);
        void vscode.window.setStatusBarMessage("Copied", 2000);
        return;
      case "blockMenu":
        await this.blockMenu(message.block);
        return;
      case "setTask":
        // the page undid the click; the edit's re-render shows the new state
        if (await this.reattach())
          await tickTask(this.document, this.lineAtNow(message.docVersion, message.line), message.checked);
        return;
      case "statusMenu":
        if (await this.reattach())
          await changeStatus(this.document, this.lineAtNow(message.docVersion, message.line), message.column);
        return;
      case "redlineMenu":
        await this.redlineMenu();
        return;
      case "compareFormat":
        await compareWithStandard(this.document);
        return;
      case "redlineOff":
        this.redlineBase = undefined;
        this.postExtras();
        return;
      case "redlineSideBySide":
        if (this.redlineBase)
          await showSideBySide(this.document, this.redlineBase.label, this.redlineBase.text);
        return;
      case "setClean":
        await vscode.workspace
          .getConfiguration("docmap")
          .update("cleanView", message.on, vscode.ConfigurationTarget.Global);
        return;
      case "setLook": {
        const cfg = vscode.workspace.getConfiguration("docmap");
        if (message.theme !== undefined)
          await cfg.update("theme", message.theme, vscode.ConfigurationTarget.Global);
        if (message.fontScale !== undefined)
          await cfg.update("fontScale", message.fontScale, vscode.ConfigurationTarget.Global);
        if (message.lineWidth !== undefined)
          await cfg.update("lineWidth", message.lineWidth, vscode.ConfigurationTarget.Global);
        return;
      }
      case "openInBrowser":
        if (!(await this.reattach())) return;
        // the same command as the editor-title button: the live page by default, else the saved copy
        await vscode.commands.executeCommand("docmap.openInBrowser", this.document.uri);
        return;
    }
  }

  /** Scrolls the map to a heading once it has drawn (now, if it already has). */
  revealAfterRender(headingId: string): void {
    this.pendingReveal = headingId;
    if (this.lastByType.has("render")) this.render();
  }

  private get fileName(): string {
    return fileNameOf(this.document);
  }

  /** Whether the map's file is closed right now — for the integration tests only. */
  get fileClosed(): boolean {
    return this.detached;
  }

  /**
   * Opens the map's file again after it was closed (quietly: no editor tab) and redraws from it. False when the file
   * cannot be opened any more — then the map says so.
   */
  private async reattach(): Promise<boolean> {
    if (!this.detached && !this.document.isClosed) return true;
    if (this.document.uri.scheme === "untitled") {
      this.showGone("It was closed without being saved.");
      return false;
    }
    try {
      const document = await vscode.workspace.openTextDocument(this.document.uri);
      if (this.detached || this.document.isClosed) this.attach(document);
      return true;
    } catch (error) {
      log().info(`map's file could not be opened again: ${this.document.uri.toString()} (${String(error)})`);
      this.showGone("It was deleted, moved or renamed.");
      return false;
    }
  }

  private showGone(detail: string): void {
    this.post({
      type: "state",
      state: "closed",
      fileName: this.fileName,
      detail: `${this.fileName}: ${detail}`,
    });
  }

  private attach(document: vscode.TextDocument): void {
    this.document = document;
    this.edits = []; // a reopened file's versions restart: old edits no longer apply
    this.detached = false;
    log().info(`map re-attached: ${document.uri.toString()}`);
    this.render();
  }

  private scheduleRender(): void {
    clearTimeout(this.debounce);
    const bytes = this.lastBytes || utf8Bytes(this.document.getText());
    this.debounce = setTimeout(() => this.render(), debounceForBytes(readConfig().updateDebounceMs, bytes));
  }

  /** Parses the current text and sends it. A hidden panel is skipped: it re-sends "ready" when shown. */
  private render(): void {
    if (!this.panel.visible) return;
    if (this.detached) {
      // a panel shown again after its file closed: open the file again and draw it (or say it is gone)
      void this.reattach();
      return;
    }
    const text = this.document.getText();
    const bytes = utf8Bytes(text);
    this.lastBytes = bytes;
    if (!this.allowLarge && bytes > readConfig().largeFileBytes) {
      this.post({ type: "state", state: "too-large", fileName: this.fileName, bytes });
      return;
    }
    const started = performance.now();
    const roots = allowedRoots(this.document); // once per render: realpath and friends touch the disk
    this.refreshResourceRoots(roots);
    const result = this.parse(text, roots);
    if (!result.ok) {
      log().error(`could not parse ${this.document.uri.toString()}: ${result.reason}`);
      this.post({ type: "state", state: "error", fileName: this.fileName, detail: result.reason });
      return;
    }
    const { headings, html, docVersion } = result.document;
    const firstDraw = this.blocks.length === 0;
    this.blocks = result.document.blocks ?? [];
    if (firstDraw) void this.refreshTrust();
    const { readingTools } = parseSettings();
    const layout = outlineLayout(this.context);
    this.lastSeen = { hashes: sectionHashes(text, headings), hash: fnv1a(text), headings };
    if (!this.markedRead) {
      // opened = read, for the Docs Inbox — once per open (closing records the final state), not on every keystroke
      this.markedRead = true;
      MapPanel.notes?.setReadHash(this.key, this.lastSeen.hash);
    }
    this.post({
      type: "render",
      docVersion,
      fileName: this.fileName,
      headings,
      html,
      readingTools,
      ...(layout ? { layout } : {}),
      extras: this.extras(text),
    });
    if (this.pendingReveal !== undefined) {
      this.post({ type: "reveal", docVersion, headingId: this.pendingReveal });
      this.pendingReveal = undefined;
    }
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === this.document);
    if (editor) this.syncScroll(editor); // mark "you are here" right away, not only after the next scroll
    const ms = Math.round(performance.now() - started);
    log().debug(`rendered v${docVersion}: ${headings.length} headings, ${bytes} bytes, ${ms} ms`);
  }

  /**
   * Reveals a heading's line in the editor, clamped to the document. A click naming a heading is resolved
   * against the CURRENT text by id — robust to edits since the panel drew, and to a closed-and-reopened file
   * (whose version numbers restart). If that heading is gone, the jump is dropped and the panel refreshed.
   */
  private async jump(docVersion: number, line: number, headingId: string | undefined): Promise<void> {
    // the file's tab was closed: open it again, and the click shows it beside the map as usual
    if (!(await this.reattach())) return;
    const stale = docVersion !== this.document.version;
    let target = line;
    if (headingId !== undefined) {
      const text = this.document.getText();
      const mayParse = this.allowLarge || utf8Bytes(text) <= readConfig().largeFileBytes; // same guard as render
      // headings only: a click must not re-resolve every image in the document
      const current = mayParse ? this.engine.parse(text, this.document.version, parseSettings()) : undefined;
      const found = current?.ok ? current.document.headings : [];
      // carried through the edits since the click was drawn, so a same-named heading added above cannot steal it
      const moved = stale ? this.lineNow(docVersion, line) : undefined;
      const heading =
        (moved !== undefined ? headingAtLine(found, moved, headingId) : undefined) ??
        found.find((h) => h.id === headingId);
      if (heading) target = heading.line;
      else if (stale) {
        log().info(`jump ignored: heading "${headingId}" is not in the edited document`);
        clearTimeout(this.debounce);
        this.render();
        return;
      }
    } else if (stale) {
      log().info("jump ignored: it was computed from an older version and names no heading");
      return;
    }
    if (stale) {
      clearTimeout(this.debounce);
      this.render(); // bring the panel up to date
    }
    target = Math.min(target, Math.max(0, this.document.lineCount - 1));
    const visible = vscode.window.visibleTextEditors.some((e) => e.document === this.document);
    if (!visible && this.mode === "page") {
      // the page IS the file's tab: a click reads on in the page (it scrolled itself); the source is one button away
      log().debug("jump: page with no source on screen — editor left as is");
      return;
    }
    const fileColumn = this.fileColumn();
    if (!visible && fileColumn !== undefined && fileColumn === this.panel.viewColumn) {
      // the map is covering its own file (same editor group): a click reads on in the map (it scrolled itself)
      // rather than swapping the map out for the editor. Decided from the layout, not from how the map was opened.
      log().debug("jump: the map covers its file — editor left as is");
      return;
    }
    const editor = await vscode.window.showTextDocument(this.document, {
      viewColumn: this.editorColumn(),
      preserveFocus: false,
    });
    const position = new vscode.Position(target, 0);
    this.jumped = { line: target, at: performance.now() };
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
  }

  private recordEdits(version: number, changes: readonly vscode.TextDocumentContentChangeEvent[]): void {
    const edits = changes.map((c) => ({
      startLine: c.range.start.line,
      endLine: c.range.end.line,
      endsAtLineStart: c.range.end.character === 0,
      insertedLines: c.text.split("\n").length - 1,
    }));
    this.edits.push({ version, edits });
    if (this.edits.length > INTERNAL_LIMITS.editHistory) this.edits.shift();
  }

  /** `lineNow`, also for the version the page shows now (no edit since). */
  private lineAtNow(docVersion: number, line: number): number | undefined {
    return docVersion === this.document.version ? line : this.lineNow(docVersion, line);
  }

  /** Where a line of version `docVersion` is now — undefined if an edit since then is not on record or touched it. */
  private lineNow(docVersion: number, line: number): number | undefined {
    const since = this.edits.filter((e) => e.version > docVersion);
    const complete =
      since.length === this.document.version - docVersion && since[0]?.version === docVersion + 1;
    return complete
      ? shiftLineThrough(
          line,
          since.map((e) => e.edits),
        )
      : undefined;
  }

  /** Parses the current document, resolving relative images to files the panel is allowed to load. */
  private parse(text: string, roots: readonly string[]): ParseResult {
    const resolve =
      this.document.uri.scheme === "file"
        ? createResolver(path.dirname(this.document.uri.fsPath), roots)
        : undefined;
    return this.engine.parse(text, this.document.version, {
      ...parseSettings(),
      blockIds: true,
      resolveImage: (src) => {
        const target = resolve?.(src);
        if (!target || !isImageFile(target.file)) return undefined; // only images load as images
        // the path the user opened (not the symlink-resolved one): VS Code checks resource roots on this form
        return this.panel.webview.asWebviewUri(vscode.Uri.file(target.lexical)).toString();
      },
    });
  }

  /** Keeps the panel's allowed image folders equal to the document's current roots (a folder may be added later). */
  private refreshResourceRoots(roots: readonly string[]): void {
    const key = roots.join("\n");
    if (key === this.resourceRoots) return;
    this.resourceRoots = key;
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.dist, ...roots.map((r) => vscode.Uri.file(r))],
    };
  }

  private scheduleScrollSync(editor: vscode.TextEditor): void {
    if (this.scrollTimer) return; // at most one pending sync: a throttle, so fast scrolling stays cheap
    this.scrollTimer = setTimeout(() => {
      this.scrollTimer = undefined;
      this.syncScroll(editor);
    }, INTERNAL_TIMINGS.scrollSyncMs);
  }

  private syncScroll(editor: vscode.TextEditor): void {
    if (this.detached || !this.panel.visible) return;
    let topLine = editor.visibleRanges[0]?.start.line ?? 0;
    // just after a click in the map: the clicked heading is "you are here", though VS Code's sticky headings keep the
    // last lines of the section above it at the top of the editor
    const jumped = this.jumped;
    if (
      jumped &&
      performance.now() - jumped.at < INTERNAL_TIMINGS.jumpSettleMs &&
      editor.visibleRanges.some((r) => r.start.line <= jumped.line && jumped.line <= r.end.line)
    )
      topLine = Math.max(topLine, jumped.line);
    this.post({ type: "editorScrolled", docVersion: this.document.version, topLine });
  }

  /**
   * Opens a relative link from the document — only a file inside the folders the user opened (links.ts decides).
   * Markdown opens as its own map in this map's place (at the #heading, if given), other text in the editor, images
   * in VS Code's image preview; any other
   * file type is refused (links.ts `openKind`).
   */
  private async openLink(href: string): Promise<void> {
    // throttled first, so a flood of clicks cannot become a flood of notifications either (monotonic clock)
    const now = performance.now();
    if (now - this.lastLinkOpen < INTERNAL_TIMINGS.linkOpenGapMs) return;
    this.lastLinkOpen = now;
    // a report docmap wrote (Plans dashboard) links workspace-relative paths: resolved from the first folder
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const report = isReport(this.document.uri);
    if (this.document.uri.scheme !== "file" && !(report && folders[0])) {
      void vscode.window.showInformationMessage("Save this file first — links are resolved from its folder.");
      return;
    }
    const target = report
      ? resolveLocalTarget(href, folders[0] ?? "", folders)
      : resolveLocalTarget(href, path.dirname(this.document.uri.fsPath), allowedRoots(this.document));
    // a code file a doc links to (`backend/cart.py#L12`) opens as text, at its line (easy reading, 2026-11-24:
    // before, only docmap's own reports could open code — a design doc's code links did nothing)
    const kind = target
      ? (openKind(target.file) ?? (isCodeFile(target.file) ? "text" : undefined))
      : undefined;
    if (!target || !kind) {
      // the link text is document content: logged for the owner, never echoed into a notification
      log().info(`link not opened (missing, outside the workspace, or not a text/image file): ${href}`);
      void vscode.window.showInformationMessage(
        "That link was not opened — it is missing, outside this workspace, or not a text or image file.",
      );
      return;
    }
    const uri = vscode.Uri.file(target.file);
    // the Plans dashboard's 🌐 beside a plan: that plan straight in the browser
    if (report && kind === "text" && target.fragment === BROWSER_FRAGMENT) {
      await vscode.commands.executeCommand("docmap.openInBrowser", uri);
      return;
    }
    if (kind === "image") {
      await vscode.commands.executeCommand("vscode.open", uri, { viewColumn: this.editorColumn() });
      return;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    await this.openDoc(doc, target.fragment, report);
    // owner report 2026-11-24: a doc opened from a report page is shown in the Explorer, so the reader sees where it is
    if (report) await revealInExplorer(uri);
  }

  /** Opens a linked text file: at its line (`#L12`), as a page or map (Markdown), else as text at its #heading. */
  private async openDoc(
    doc: vscode.TextDocument,
    fragment: string | undefined,
    report: boolean,
  ): Promise<void> {
    const uri = doc.uri;
    const target = { fragment };
    // a link to a line (`#L12`: the code table, the Open questions page's "line 12"): the file's text, at that line
    const lineAt = /^L(\d{1,7})$/.exec(target.fragment ?? "");
    if (lineAt) {
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: this.editorColumn(),
        preview: false,
      });
      const position = new vscode.Position(
        Math.min(Number(lineAt[1]) - 1, Math.max(0, doc.lineCount - 1)),
        0,
      );
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      return;
    }
    // owner report 2026-11-24: from a report, a doc opens as its preview in its own tab (the report stays open), where
    // "Show source" swaps it to the text — before, it replaced the report as a map with no way to the source
    if (doc.languageId === "markdown" && (this.mode === "page" || report)) {
      // reading on in a page: the linked file opens as a page too, in this tab group, at the linked heading
      await vscode.commands.executeCommand("docmap.openMapAt", uri, target.fragment);
      return;
    }
    if (doc.languageId === "markdown") {
      // reading on: a linked Markdown file opens as its own map, where this one is, at the linked heading
      const map = MapPanel.show(this.context, doc, this.engine, "here", this.panel.viewColumn);
      if (target.fragment) map.revealAfterRender(target.fragment);
      return;
    }
    const editor = await vscode.window.showTextDocument(doc, { viewColumn: this.editorColumn() });
    if (target.fragment) {
      const parsed = this.engine.parse(doc.getText(), doc.version, {
        ...parseSettings(),
      });
      const heading = parsed.ok ? parsed.document.headings.find((h) => h.id === target.fragment) : undefined;
      if (heading) {
        const position = new vscode.Position(heading.line, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
      }
    }
  }

  /** Where the file lives: its visible editor, else the group holding its tab (e.g. behind the map), else unknown. */
  private fileColumn(): vscode.ViewColumn | undefined {
    const visible = vscode.window.visibleTextEditors.find((e) => e.document === this.document);
    if (visible?.viewColumn) return visible.viewColumn;
    const key = this.document.uri.toString();
    const group = vscode.window.tabGroups.all.find((g) =>
      g.tabs.some((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === key),
    );
    return group?.viewColumn;
  }

  /** Where to show the file (or a linked file): where the file lives, else beside the map (never over it). */
  private editorColumn(): vscode.ViewColumn {
    return this.fileColumn() ?? (this.panel.active ? vscode.ViewColumn.Beside : vscode.ViewColumn.One);
  }

  private post(message: HostToWebview): void {
    this.lastPosted = message;
    this.lastByType.set(message.type, message);
    void this.panel.webview.postMessage(message);
  }

  private get key(): string {
    return this.document.uri.toString();
  }

  /** 3.0 named formats: the kind of doc and its named format, only when docmap is sure (else nothing is shown). */
  private docKind(text: string): Pick<PageExtras, "docKind"> {
    const rel = vscode.workspace.asRelativePath(this.document.uri, false).replace(/\\/g, "/");
    const type = frontMatter(text).find((f) => f.key.toLowerCase() === "type")?.value;
    const found = recognise(rel, text, type);
    return found
      ? { docKind: { label: found.label, ...(found.format ? { format: found.format.name } : {}) } }
      : {};
  }

  /** 2.0: what the page shows beyond the document — look, key points, changed sections, review marks, highlights. */
  private extras(text?: string): PageExtras {
    const config = readConfig();
    const seen = this.lastSeen;
    const reviews = MapPanel.notes?.reviews(this.key) ?? {};
    const facts = text !== undefined ? analyze(text) : undefined;
    return {
      look: {
        theme: config.theme,
        fontScale: config.fontScale,
        lineWidth: config.lineWidth,
        clean: config.cleanView,
        numbers: config.headingNumbers,
      },
      ...(text !== undefined ? { frontMatter: frontMatter(text) } : {}),
      ...(text !== undefined ? this.docKind(text) : {}),
      ...(facts
        ? {
            keyPoints: {
              ...(facts.tldr ? { tldr: facts.tldr } : {}),
              tasksOpen: facts.tasksOpen,
              tasksDone: facts.tasksDone,
              decisions: facts.decisions.length,
              warnings: facts.warnings,
            },
          }
        : {}),
      changed: seen ? changedSections(this.baseline, seen.hashes, seen.headings) : [],
      reviews: Object.entries(reviews).map(([headingId, r]) => ({ headingId, mark: r.mark })),
      highlights: MapPanel.notes?.highlights(this.key) ?? [],
      trust: this.trust,
      codeRefs: this.codeRefs,
      report: isReport(this.document.uri),
      inTab: this.mode === "page",
      ...(text !== undefined && this.redlineBase ? { redline: this.redline(text, this.redlineBase) } : {}),
      ...(text !== undefined ? { badges: this.badges(text) } : {}),
      ...(text !== undefined && config.cleanView ? this.standing(text) : {}),
      ...(text !== undefined
        ? {
            signoffs: signoffs(text).map((s) => ({
              who: s.who,
              date: s.date,
              current: s.hash === signedHash(text),
            })),
          }
        : {}),
    };
  }

  /** Easy reading: where a long doc stands — only when it has parts or a warning (an ordinary doc sends nothing). */
  private standing(text: string): Pick<PageExtras, "standing"> {
    const headings = this.lastSeen?.headings ?? [];
    if (headings.length === 0) return {};
    const s = standing(text, headings);
    if (s.parts.length < 2 && s.disagree.length === 0) return {};
    const parts = s.parts.map((p) => {
      const record = this.records.get(p.label);
      return record ? { ...p, record } : p;
    });
    return { standing: { ...s, parts } };
  }

  /** Each part's build record: read from the docs that link to this one (the Docs Inbox knows the links). */
  private async partRecords(): Promise<Map<string, { href: string; title: string }>> {
    const out = new Map<string, { href: string; title: string }>();
    const folder = vscode.workspace.getWorkspaceFolder(this.document.uri);
    if (!folder || !MapPanel.others || this.document.uri.scheme !== "file") return out;
    // the first draw starts this before it records the headings: parse them here, with the same settings
    const text = this.document.getText();
    const parsed = this.engine.parse(text, this.document.version, parseSettings());
    const headings = parsed.ok ? parsed.document.headings : [];
    const s = standing(text, headings);
    if (s.parts.length < 2) return out;
    const all = await MapPanel.others.facts();
    const me = vscode.workspace.asRelativePath(this.document.uri, false).replace(/\\/g, "/");
    const incoming = all
      .filter((d) => d.file !== me && d.links.includes(me))
      .slice(0, INTERNAL_LIMITS.recordBackLinks);
    const backLinks = await mapLimit(incoming, INTERNAL_LIMITS.ioConcurrency, async (d) => ({
      path: d.file,
      ...(d.title ? { title: d.title } : {}),
      text: await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, ...d.file.split("/"))).then(
        (b) => new TextDecoder().decode(b),
        () => "",
      ),
    }));
    const dir = path.dirname(this.document.uri.fsPath);
    for (const [label, r] of recordsFor(
      s,
      backLinks,
      all.map((d) => d.file),
    )) {
      const abs = path.join(folder.uri.fsPath, ...r.path.split("/"));
      out.set(label, { href: encodeURI(path.relative(dir, abs).replace(/\\/g, "/")), title: r.title });
    }
    return out;
  }

  /** 3.0 outline badges: per section, open tasks, open questions, and paragraphs whose trust marker doubts them. */
  private badges(text: string): SectionCounts[] {
    const headings = this.lastSeen?.headings ?? [];
    if (headings.length === 0) return [];
    const counts = new Map(sectionBadges(docItems(text), headings).map((b) => [b.headingId, b]));
    const sorted = [...headings].sort((a, b) => a.line - b.line);
    const doubts = new Map<string, number>();
    for (const t of this.trust) {
      if (t.state === "verified" || t.state === "superseded") continue;
      const line = this.blocks[t.block]?.line;
      if (line === undefined) continue;
      const h = sorted.filter((x) => x.line < line).at(-1);
      if (h) doubts.set(h.id, (doubts.get(h.id) ?? 0) + 1);
    }
    return sorted.flatMap((h) => {
      const c = counts.get(h.id);
      const d = doubts.get(h.id) ?? 0;
      return c || d
        ? [{ headingId: h.id, tasks: c?.tasks ?? 0, questions: c?.questions ?? 0, doubts: d }]
        : [];
    });
  }

  /** 3.0: sign off the current version — written into the file's front matter (and saved), so it travels with it. */
  async signOff(): Promise<void> {
    if (!(await this.reattach())) return;
    const names = readConfig().myNames;
    const folder = vscode.workspace.getWorkspaceFolder(this.document.uri)?.uri.fsPath;
    const known =
      names.find((n) => !n.startsWith("@")) ?? names[0] ?? (folder ? await gitUserName(folder) : undefined);
    const who = await vscode.window.showInputBox({
      title: "Sign off this version",
      prompt:
        "Your name — written into the file's front matter with today's date (set docmap.myNames to skip this)",
      value: known ?? "",
    });
    if (!who?.trim()) return;
    const text = this.document.getText();
    const next = withSignoff(text, who.trim(), new Date().toISOString().slice(0, 10));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      this.document.uri,
      new vscode.Range(this.document.positionAt(0), this.document.positionAt(text.length)),
      next,
    );
    if (!(await vscode.workspace.applyEdit(edit))) return;
    if (this.document.uri.scheme === "file") await this.document.save();
    void vscode.window.showInformationMessage(
      `Signed off as ${who.trim()}. Any later edit shows as "changed since sign-off".`,
    );
  }

  /** 3.0: the page compared with an older version — that version rendered, and which blocks were added / changed / removed. */
  private redline(text: string, base: { label: string; text: string }): Redline {
    if (this.redlineParsed?.text !== base.text) {
      const parsed = this.parse(base.text, allowedRoots(this.document));
      const lines = base.text.split(/\r?\n/);
      this.redlineParsed = parsed.ok
        ? {
            text: base.text,
            html: parsed.document.html,
            blocks: (parsed.document.blocks ?? []).map((b) => blockText(lines, b)),
          }
        : { text: base.text, html: "", blocks: [] };
    }
    const lines = text.split(/\r?\n/);
    const now = this.blocks.map((b) => blockText(lines, b));
    const { html, blocks } = this.redlineParsed;
    const fits = html.length <= MAX_REDLINE_HTML;
    return { label: base.label, oldHtml: fits ? html : "", ...alignBlocks(fits ? blocks : [], now) };
  }

  /** 3.0: compare the page with a version: the one last read, unsaved vs saved, last commit, a week ago, a tag, any commit. */
  async redlineMenu(): Promise<void> {
    type Item = vscode.QuickPickItem & { run?: () => Promise<unknown> | unknown };
    const uri = this.document.uri;
    const compare = (label: string, text: string | undefined) => {
      if (text === undefined) {
        void vscode.window.showInformationMessage(`No ${label} of this file to compare with.`);
        return;
      }
      this.compareWith(label, text);
    };
    const fromGit = async (label: string, rev: string | undefined) =>
      compare(label, rev ? await fileAt(uri, rev) : undefined);
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const items: Item[] = [];
    if (this.redlineBase)
      items.push(
        { label: `Comparing with ${this.redlineBase.label}`, kind: vscode.QuickPickItemKind.Separator },
        {
          label: "$(split-horizontal) Side by side",
          detail: "The older version on the left, this file on the right, in VS Code's compare view",
          run: () => {
            const base = this.redlineBase;
            return base && showSideBySide(this.document, base.label, base.text);
          },
        },
        {
          label: "$(sparkle) Ask my AI agent to summarise these changes",
          detail: "What changed, what it means, anything risky or needing a decision",
          run: () => this.summariseChanges(),
        },
        {
          label: "$(close) Stop comparing",
          run: () => {
            this.redlineBase = undefined;
            this.postExtras();
          },
        },
      );
    items.push({ label: "Compare the page with…", kind: vscode.QuickPickItemKind.Separator });
    if (this.seenBefore !== undefined)
      items.push({
        label: "$(eye) The version I last read",
        run: () => compare("the version you last read", this.seenBefore),
      });
    if (this.document.isDirty && uri.scheme === "file")
      items.push({
        label: "$(save) The saved file (see my unsaved edits)",
        run: async () =>
          compare("the saved file", new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))),
      });
    if (uri.scheme === "file" && vscode.workspace.isTrusted) {
      items.push(
        { label: "$(git-commit) The last commit", run: () => fromGit("the last commit", "HEAD") },
        {
          label: "$(git-merge) The main branch",
          detail: "The file as it is on the repository's main branch (main, master…)",
          run: async () => {
            const main = await mainBranchOf(uri);
            if (!main) {
              void vscode.window.showInformationMessage(
                "No main branch found in this repository (looked for origin's default, main and master).",
              );
              return;
            }
            await fromGit(`the main branch (${main})`, main);
          },
        },
        {
          label: "$(history) A week ago",
          run: async () => fromGit("a week ago", await commitBefore(uri, Date.now() - 7 * 86_400_000)),
        },
        {
          label: "$(tag) A tag…",
          run: async () => {
            const list = await tags(uri, INTERNAL_LIMITS.gitVersions);
            const tag = await vscode.window.showQuickPick(list, { title: "Compare with the file at tag…" });
            if (tag) await fromGit(`tag ${tag}`, tag);
          },
        },
        {
          label: "$(git-branch) A git version…",
          run: async () => {
            const commits = await fileCommits(uri, INTERNAL_LIMITS.gitVersions);
            const pick = await vscode.window.showQuickPick(
              commits.map((c) => ({ label: c.subject || c.rev, description: `${c.rev} · ${day(c.at)}`, c })),
              { title: "Compare with the file as it was in…", matchOnDescription: true },
            );
            if (pick) await fromGit(`${pick.c.rev} (${day(pick.c.at)})`, pick.c.rev);
          },
        },
      );
    }
    if (items.length === 1) {
      void vscode.window.showInformationMessage(
        "Nothing to compare with yet: open the file again after it changes, or keep it in git.",
      );
      return;
    }
    const pick = await vscode.window.showQuickPick(items, { title: "Show changes on the page" });
    await pick?.run?.();
  }

  /** 3.0: mark on the page what changed since `text` (an older version); undefined stops comparing. */
  compareWith(label: string, text: string | undefined): void {
    this.redlineBase = text === undefined ? undefined : { label, text };
    this.postExtras();
  }

  /** 3.0: the reader's own agent summarises the comparison — the changed, added and removed blocks are quoted. */
  private async summariseChanges(): Promise<void> {
    const base = this.redlineBase;
    if (!base) return;
    const text = this.document.getText();
    const r = this.redline(text, base);
    const lines = text.split(/\r?\n/);
    const now = (i: number) => {
      const b = this.blocks[i];
      return b ? blockText(lines, b) : "";
    };
    const old = (i: number) => this.redlineParsed?.blocks[i] ?? "";
    const changes = [
      ...r.changed.map(([n, o]) => ({ title: "Changed", text: `Before:\n${old(o)}\n\nNow:\n${now(n)}` })),
      ...r.added.map((n) => ({ title: "Added", text: now(n) })),
      ...r.removed.map(([, o]) => ({ title: "Removed", text: old(o) })),
    ];
    const ctx = { file: relativePath(this.document.uri), changed: changes, since: base.label };
    await deliverPrompt(buildPrompt("summariseChanges", ctx), { id: "summariseChanges", ctx });
  }

  /** Sends new extras (a mark, a highlight, read) without redrawing the document. */
  private postExtras(): void {
    const version = this.lastByType.get("render");
    if (version?.type !== "render") return;
    this.post({
      type: "extras",
      docVersion: version.docVersion,
      extras: this.extras(this.document.getText()),
    });
  }

  /** The reader has read the changes: what they see now becomes what they have seen. */
  markRead(): void {
    if (!this.lastSeen) return;
    this.baseline = this.lastSeen.hashes;
    MapPanel.notes?.setSeen(this.key, this.lastSeen.hashes, this.lastSeen.hash);
    this.seenBefore = this.document.getText();
    void writeSeenText(this.key, this.seenBefore, readConfig().largeFileBytes);
    this.postExtras();
  }

  /** The text of a heading's section (heading line to the next heading at its level or above). */
  private sectionText(headingId: string): { title: string; text: string } | undefined {
    const headings = this.lastSeen?.headings ?? [];
    const i = headings.findIndex((h) => h.id === headingId);
    const h = headings[i];
    if (!h) return undefined;
    const next = headings.slice(i + 1).find((n) => n.level <= h.level);
    const lines = this.document.getText().split(/\r?\n/);
    return { title: h.text, text: lines.slice(h.line, next ? next.line : lines.length).join("\n") };
  }

  /** 2.0: a heading's menu — review mark (approve / question / change), or ask the reader's agent about it. */
  private async sectionMenu(headingId: string, slides = false): Promise<void> {
    const section = headingId ? this.sectionText(headingId) : undefined;
    const reviews = MapPanel.notes?.reviews(this.key) ?? {};
    const current = headingId ? reviews[headingId] : undefined;
    type Item = vscode.QuickPickItem & { run?: () => Promise<void> | void };
    const mark = (m: "approve" | "question" | "change", ask?: string) => async () => {
      let note = "";
      if (ask) {
        const typed = await vscode.window.showInputBox({
          title: section?.title ?? this.fileName,
          prompt: ask,
          value: current?.note ?? "",
        });
        if (typed === undefined) return;
        note = typed;
      }
      MapPanel.notes?.setReview(this.key, headingId, { mark: m, note });
      this.postExtras();
    };
    const file = relativePath(this.document.uri);
    const items: Item[] = [];
    if (section) {
      items.push(
        { label: "Review", kind: vscode.QuickPickItemKind.Separator },
        { label: "$(check) Approve this section", run: mark("approve") },
        { label: "$(question) Ask a question…", run: mark("question", "Your question about this section") },
        { label: "$(edit) Request a change…", run: mark("change", "What should change?") },
      );
      if (current)
        items.push({
          label: "$(close) Clear my mark",
          run: () => {
            MapPanel.notes?.setReview(this.key, headingId, undefined);
            this.postExtras();
          },
        });
      items.push(
        { label: "Ask my AI agent about this section", kind: vscode.QuickPickItemKind.Separator },
        {
          label: "$(sparkle) Explain, challenge, find risks, make tasks, write tests…",
          run: () => pickAndDeliver(["section"], { file, section }, section.title),
        },
      );
    }
    const marked = Object.keys(reviews).length;
    const comments = (MapPanel.notes?.highlights(this.key) ?? []).filter((h) => h.note).length;
    if (!section) {
      items.push({ label: "This doc", kind: vscode.QuickPickItemKind.Separator });
      if (!isReport(this.document.uri)) {
        items.push({
          label: "$(checklist) Check against the code",
          detail: "Find file paths this doc names that no longer exist in the repo",
          run: async () => {
            await vscode.commands.executeCommand("docmap.checkDesign", this.document.uri);
          },
        });
      }
      if (this.mode === "page") {
        items.push({
          label: "$(edit) Show source",
          detail: "Switch this tab back to the Markdown text (Ctrl+Alt+V)",
          run: async () => {
            await vscode.commands.executeCommand("docmap.showSource", this.document.uri);
          },
        });
      }
      const cleanOn = readConfig().cleanView;
      items.push({
        label: cleanOn ? "$(eye) Clean view: Turn off" : "$(eye) Clean view: Turn on",
        detail: cleanOn
          ? "Show the file as written instead of the laid-out view"
          : "Lay the page out neatly (cards, callouts, progress)",
        run: async () => {
          await vscode.workspace
            .getConfiguration("docmap")
            .update("cleanView", !cleanOn, vscode.ConfigurationTarget.Global);
        },
      });
      // #48 (owner pick 2026-11-21): slides moved off the page's top bar into this menu
      if (slides)
        items.push({
          label: "$(play) Show as slides",
          detail: "The sections between --- lines, one at a time ( ← → , Esc )",
          run: () => {
            const rendered = this.lastByType.get("render");
            if (rendered?.type === "render")
              this.post({ type: "showSlides", docVersion: rendered.docVersion });
          },
        });
    }
    items.push({ label: "Review & AI", kind: vscode.QuickPickItemKind.Separator });
    if (marked > 0 || comments > 0) {
      const parts = [
        marked ? `${marked} section${marked === 1 ? "" : "s"}` : "",
        comments ? `${comments} comment${comments === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      items.push({
        label: `$(send) Send my review to my AI agent (${parts.join(", ")})`,
        run: () => this.sendReview(),
      });
    }
    if (!isReport(this.document.uri))
      items.push({ label: "$(verified) Sign off this version…", run: () => this.signOff() });
    items.push({ label: "$(sparkle) Ask my AI agent about this file…", run: () => this.askAboutFile() });
    if (!section) {
      items.push({
        label: "$(copy) Copy for my AI…",
        detail: "This doc and the linked docs you pick, as one text to paste into any AI chat",
        run: () => copyForAgent(this.document),
      });
      items.push(
        { label: "Export", kind: vscode.QuickPickItemKind.Separator },
        {
          label: "$(file-code) Export as HTML…",
          run: async () => {
            await vscode.commands.executeCommand("docmap.exportHtml", this.document.uri);
          },
        },
        {
          label: "$(file-pdf) Export as PDF (Print)…",
          run: async () => {
            await vscode.commands.executeCommand("docmap.exportPdf", this.document.uri);
          },
        },
        { label: "Workspace views", kind: vscode.QuickPickItemKind.Separator },
        {
          label: "$(home) Home",
          detail: "What's going on in this project",
          run: async () => {
            await vscode.commands.executeCommand("docmap.home");
          },
        },
        {
          label: "$(search) Search All Docs…",
          detail: "Find text across every Markdown file",
          run: async () => {
            await vscode.commands.executeCommand("docmap.searchDocs");
          },
        },
        {
          label: "$(compass) What can docmap do?",
          detail: "Every docmap command, by what you want to do",
          run: async () => {
            await vscode.commands.executeCommand("docmap.whatCanItDo");
          },
        },
      );
    }
    const pick = await vscode.window.showQuickPick(items, { title: section?.title ?? this.fileName });
    await pick?.run?.();
  }

  /** Builds the review prompt from the marked sections and hands it to the reader's agent. */
  async sendReview(): Promise<void> {
    const reviews = MapPanel.notes?.reviews(this.key) ?? {};
    const headings = this.lastSeen?.headings ?? [];
    const notes = headings
      .filter((h) => reviews[h.id])
      .map((h) => ({ section: h.text, mark: reviews[h.id]!.mark, note: reviews[h.id]!.note }));
    const commented = (MapPanel.notes?.highlights(this.key) ?? []).filter((h) => h.note);
    const comments = commented.map((h) => ({
      section: headings.find((x) => x.id === h.headingId)?.text ?? "",
      quote: h.text,
      note: h.note ?? "",
    }));
    if (notes.length === 0 && comments.length === 0) {
      void vscode.window.showInformationMessage(
        "Mark a section first (the ⋯ beside a heading → Approve / Question / Change), or select text → Comment.",
      );
      return;
    }
    await deliverPrompt(
      buildPrompt("review", { file: relativePath(this.document.uri), reviews: notes, comments }),
    );
    const clear = await vscode.window.showInformationMessage(
      "Review sent. Clear your marks and comments on this file?",
      "Clear",
      "Keep",
    );
    if (clear === "Clear") {
      MapPanel.notes?.clearReviews(this.key);
      for (const h of commented) MapPanel.notes?.removeHighlight(this.key, h.id);
      this.postExtras();
    }
  }

  /** The file prompts, with what docmap knows: changed sections, open tasks. */
  async askAboutFile(): Promise<void> {
    const text = this.document.getText();
    const seen = this.lastSeen;
    const changed = seen ? changedSections(this.baseline, seen.hashes, seen.headings) : [];
    await pickAndDeliver(
      ["file"],
      {
        file: relativePath(this.document.uri),
        openTasks: openTasks(text),
        ...docFacts(relativePath(this.document.uri), text),
        changed: changed.flatMap((id) => {
          const s = this.sectionText(id);
          return s ? [s] : [];
        }),
      },
      this.fileName,
    );
  }

  /** 3.0: recomputes the trust markers in the background and sends them to the page. */
  async refreshTrust(): Promise<void> {
    const run = ++this.trustRun;
    if (isReport(this.document.uri)) return; // a page docmap wrote has nothing to check against the code
    try {
      const [trust, refs, records] = await Promise.all([
        computeTrust(this.document, this.blocks, MapPanel.notes, MapPanel.others),
        codeRefsFor(this.document), // 2026-11-22: clickable code names
        this.partRecords(), // easy reading: each part's build record
      ]);
      if (run !== this.trustRun) return; // a newer run started meanwhile
      this.trust = trust;
      this.codeRefs = refs;
      this.records = records;
      this.postExtras();
    } catch (error) {
      log().warn(`trust markers: ${String(error)}`);
    }
  }

  /** 3.0: a block's trust menu — why, verified / wrong stamps, ask my agent to verify it. */
  private async blockMenu(index: number): Promise<void> {
    const b = this.blocks[index];
    if (!b) return;
    const lines = this.document.getText().split(/\r?\n/);
    const text = blockText(lines, b);
    const hash = blockHash(text);
    const mark = this.trust.find((t) => t.block === index);
    const stamped = MapPanel.notes?.stamps(this.key)[hash];
    type Item = vscode.QuickPickItem & { run?: () => Promise<void> | void };
    const stamp = (verdict: "verified" | "wrong", note?: string) => {
      MapPanel.notes?.setStamp(this.key, hash, { verdict, at: Date.now(), ...(note ? { note } : {}) });
      void this.refreshTrust();
    };
    const items: Item[] = [];
    if (mark)
      items.push(
        { label: "Why", kind: vscode.QuickPickItemKind.Separator },
        ...mark.reasons.map((r) => ({ label: r })),
      );
    // 2026-11-22: a file the paragraph names moved — one click writes the new path (that line only)
    const fixes = mark ? await movedFixes(this.document, b.line, b.end) : [];
    if (fixes.length)
      items.push(
        { label: "Fix it", kind: vscode.QuickPickItemKind.Separator },
        ...fixes.map((fix) => ({
          label: `$(arrow-right) Update ${fix.old} to ${fix.next}`,
          detail: `${fix.old} is gone; a file with that name is at ${fix.next}. Changes line ${fix.line + 1} only.`,
          run: async () => {
            if (await applyMovedFix(this.document, fix)) void this.refreshTrust();
          },
        })),
      );
    items.push(
      { label: "Your verdict", kind: vscode.QuickPickItemKind.Separator },
      { label: "$(pass) Mark as verified — it is true", run: () => stamp("verified") },
      {
        label: "$(error) Mark as wrong…",
        run: async () => {
          const note = await vscode.window.showInputBox({
            prompt: "What is wrong? (optional, kept on this computer)",
          });
          if (note !== undefined) stamp("wrong", note);
        },
      },
    );
    if (stamped)
      items.push({
        label: "$(close) Clear my verdict",
        run: () => {
          MapPanel.notes?.setStamp(this.key, hash, undefined);
          void this.refreshTrust();
        },
      });
    items.push(
      { label: "Ask my AI agent", kind: vscode.QuickPickItemKind.Separator },
      {
        label: "$(sparkle) Verify this paragraph against the code",
        run: () => {
          const ctx = {
            file: relativePath(this.document.uri),
            section: { title: `lines ${b.line + 1}–${b.end}`, text },
            ...(mark ? { missing: mark.reasons.filter((r) => r.startsWith("✗") || r.startsWith("⇄")) } : {}),
          };
          return deliverPrompt(buildPrompt("verifyParagraph", ctx), { id: "verifyParagraph", ctx });
        },
      },
    );
    const pick = await vscode.window.showQuickPick(items, { title: `Paragraph at line ${b.line + 1}` });
    await pick?.run?.();
  }

  /** The map the reader is looking at (panel or page), if any. */
  static active(): MapPanel | undefined {
    return (
      [...MapPanel.pages.values(), ...MapPanel.open.values()].find((p) => p.panel.active) ??
      [...MapPanel.pages.values(), ...MapPanel.open.values()].find((p) => p.panel.visible)
    );
  }

  private dispose(): void {
    // what the reader saw is now what they have read: the next open marks only later changes
    if (this.lastSeen) {
      MapPanel.notes?.setSeen(this.key, this.lastSeen.hashes, this.lastSeen.hash);
      if (!this.detached && !isReport(this.document.uri))
        void writeSeenText(this.key, this.document.getText(), readConfig().largeFileBytes);
    }
    clearTimeout(this.debounce);
    clearTimeout(this.scrollTimer);
    const key = this.document.uri.toString();
    const registry = this.mode === "page" ? MapPanel.pages : MapPanel.open;
    if (registry.get(key) === this) registry.delete(key);
    MapPanel.placeStore?.flush(); // a closed map keeps its place even if it closed within the save interval
    for (const d of this.disposables) d.dispose();
  }

  /** Writes any reading place not yet saved (VS Code is shutting the extension down). */
  static flushPlaces(): void {
    MapPanel.placeStore?.flush();
  }
}

export type Placement = "beside" | "here";
/** Where a map lives: a panel of its own, or the file's own tab ("page"). */
export type Mode = "panel" | "page";
/** The custom editor that shows a Markdown file's tab as its page (package.json `customEditors`). */
export const PAGE_VIEW_TYPE = "docmap.page";

/** Shows a file in the Explorer, then gives the keyboard back to the editor (the reader reads on). */
async function revealInExplorer(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.commands.executeCommand("revealInExplorer", uri);
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  } catch (e) {
    log().info(`reveal in Explorer: ${String(e)}`);
  }
}
