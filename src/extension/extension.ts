import * as vscode from "vscode";
import { docFacts } from "../core/agent/prompts";
import type { DocmapConfig } from "../core/config/config";
import { openTasks } from "../core/insights/analyze";
import { KINDS } from "../core/insights/standards";
import { createMarkdownItEngine } from "../core/markdown/markdown-it-engine";
import { addPromptsToProject, pickAndDeliver, relativePath } from "./agent";
import { initAi } from "./ai";
import { registerAiTools } from "./ai-tools";
import { showAtlas } from "./atlas-panel";
import { COMMAND_GUIDE } from "./command-guide";
import { CommitHint } from "./commit-hint";
import { checkDesign } from "./design-check";
import { DocLinks } from "./doc-links";
import { compareWithStandard, writeDocMap } from "./doc-standards";
import { newDocFromTemplate } from "./doc-templates";
import { FolderMapProvider } from "./folder-map";
import { DocsInbox } from "./inbox";
import { LiveView } from "./live-view";
import { log } from "./log";
import { MapPanel, type Placement } from "./map-panel";
import { installServer, setupAgentTools } from "./mcp-setup";
import { NotesStore } from "./notes";
import { isPageShowing, PageEditorProvider, showPage, showSource } from "./page-editor";
import { PlaceStore } from "./places";
import { showPlansDashboard } from "./plans-panel";
import { QuickLaunchProvider } from "./quick-launch";
import { disposeRepoFacts } from "./repo-facts";
import { registerReports, writeReport } from "./reports";
import { addRulePointers } from "./rule-pointers";
import { cleanUpSavedData, clearSavedData, type SavedData, type SavedDataId } from "./saved-data";
import { searchDocs } from "./search-docs";
import { initSeenTexts } from "./seen-text";
import { readConfig } from "./settings";
import { registerSideBySide } from "./side-by-side";
import { browserOpener, clearSnapshots, openSnapshot, setBrowserOpener, snapshotsDir } from "./snapshot";
import { registerWriting } from "./writing";

/** What activate() returns — used by the integration tests. */
export interface DocmapApi {
  readonly config: () => DocmapConfig;
  readonly testing: {
    readonly panelFor: (uri: vscode.Uri) => MapPanel | undefined;
    /** The page shown in the file's own tab (0.2.0), if open. */
    readonly pageFor: (uri: vscode.Uri) => MapPanel | undefined;
    /** Replaces the browser launch (tests record the snapshot instead of opening a browser). */
    readonly setBrowserOpener: typeof setBrowserOpener;
    readonly folderMap: FolderMapProvider;
    readonly inbox: DocsInbox;
    readonly commitHint: CommitHint;
    /** #41: the stores "Clear docmap's Saved Data…" and the start-up clean-up work on. */
    readonly saved: SavedData;
    /** The live browser view (3.0): the tests read its server's address and listen for its updates. */
    readonly live: LiveView;
  };
}

/** Activation: each feature registers itself here in one line. */
export function activate(context: vscode.ExtensionContext): DocmapApi {
  const logger = log();
  context.subscriptions.push(logger);
  logger.info("docmap activated", readConfig());
  const engine = createMarkdownItEngine();
  // 2.0.4: browser pages left by earlier versions (one per file ever opened, ~5 MB each with diagrams) are removed
  void clearSnapshots(snapshotsDir(context));
  const live = new LiveView(context, engine);
  context.subscriptions.push(live);
  registerSideBySide(context);

  /**
   * The Markdown document a button was pressed for: the file the editor-title button belongs to (VS Code passes its
   * URI), else the file in the active editor, else — when the map itself is the active tab — that map's file.
   * Otherwise tells the user why nothing happened.
   */
  const targetDocument = async (arg: unknown): Promise<vscode.TextDocument | undefined> => {
    if (arg instanceof vscode.Uri) {
      const doc = await vscode.workspace.openTextDocument(arg).then(undefined, () => undefined);
      if (doc?.languageId === "markdown") return doc;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId === "markdown") return editor.document;
    const shown = MapPanel.activeDocument();
    if (shown) return shown;
    void vscode.window.showInformationMessage("Open a Markdown file first.");
    return undefined;
  };
  /** Preview ⇄ source in the same tab: the source when this file's preview is the active tab, else the preview. */
  const togglePage = async (arg: unknown): Promise<void> => {
    const document = await targetDocument(arg);
    if (!document) return;
    if (isPageShowing(document.uri)) await showSource(engine, document.uri);
    else await showPage(engine, document.uri);
  };
  const openMap = (placement: Placement) => async (arg?: unknown) => {
    const document = await targetDocument(arg);
    if (document) MapPanel.show(context, document, engine, placement);
  };

  // the editor-title buttons: map beside the file · the file's tab as its page (and back) · snapshot in the browser
  context.subscriptions.push(
    PageEditorProvider.register(context, engine),
    vscode.commands.registerCommand("docmap.openMap", openMap("beside")),
    // one toggle behind both buttons and the key (0.2.3, owner report: a second click stayed on the preview): it
    // reads what the tab shows NOW, so it switches even where an editor shows the other button than expected
    vscode.commands.registerCommand("docmap.openMapHere", async (arg?: unknown) => togglePage(arg)),
    vscode.commands.registerCommand("docmap.showSource", async (arg?: unknown) => togglePage(arg)),
    vscode.commands.registerCommand("docmap.openInBrowser", async (arg?: unknown) => {
      const document = await targetDocument(arg);
      if (!document) return;
      // live by default (the page follows the editor); a saved copy where a local server can't be reached
      if (readConfig().liveBrowser) {
        const url = await live.open(document, MapPanel.allowsLarge(document.uri), browserOpener());
        if (url !== undefined) return;
      }
      await openSnapshot(context, document, engine, browserOpener(), {
        allowLarge: MapPanel.allowsLarge(document.uri),
      });
    }),
  );

  // the folder map: every Markdown file in the workspace and its headings, in the Explorer
  const folderMap = new FolderMapProvider(engine);
  context.subscriptions.push(
    folderMap,
    vscode.window.createTreeView("docmap.folderMap", { treeDataProvider: folderMap, showCollapseAll: true }),
    vscode.commands.registerCommand("docmap.refreshFolderMap", () => folderMap.refresh()),
    // a row of the folder map: the file's map where the reader is working, at the heading if one was clicked
    vscode.commands.registerCommand("docmap.openMapAt", async (uri: unknown, headingId?: unknown) => {
      if (!(uri instanceof vscode.Uri)) return;
      const document = await vscode.workspace.openTextDocument(uri).then(undefined, () => undefined);
      if (!document) {
        void vscode.window.showInformationMessage("That file could not be opened.");
        return;
      }
      // a Cursor rule file (.mdc) or other non-Markdown file from the Docs Inbox: open it as text
      if (document.languageId !== "markdown") {
        await vscode.window.showTextDocument(document, { preview: false });
        return;
      }
      // the file's own tab shows its page (0.2.0): one tab per file, not a map tab beside its source tab
      await showPage(
        engine,
        document.uri,
        typeof headingId === "string" && headingId !== "" ? headingId : undefined,
      );
    }),
  );

  // ---------- 2.0 ----------
  MapPanel.notes ??= new NotesStore(context.workspaceState);
  MapPanel.placeStore ??= new PlaceStore(context.workspaceState, () => readConfig().rememberPlace);
  const inbox = new DocsInbox(MapPanel.notes, context.workspaceState);
  // #41: throwaway data goes automatically (places of deleted files); the rest only through the command
  const saved: SavedData = {
    notes: MapPanel.notes,
    places: MapPanel.placeStore,
    browserDir: snapshotsDir(context),
    clearInboxCache: () => inbox.clearCache(),
  };
  void cleanUpSavedData(saved);
  // 3.0: pages docmap writes (Plans dashboard, Decision log) open as a preview, read-only, never asking to be saved
  context.subscriptions.push(registerReports());
  initSeenTexts(context.globalStorageUri.fsPath);
  const docLinks = new DocLinks(inbox);
  const commitHint = new CommitHint(inbox); // #46: "N docs mention files you changed"
  const showReport = (doc: vscode.TextDocument) => {
    MapPanel.show(context, doc, engine, "here");
  };
  initAi(context.globalState, showReport);
  void whatsNew(context); // never on a fresh install (#45: a first run shows only the inbox's summary line)
  if (readConfig().aiTools) void installServer(context);
  MapPanel.others = { facts: () => inbox.allKeyFacts(), newerDuplicate: (uri) => inbox.newerDuplicate(uri) };
  context.subscriptions.push(inbox);
  // #52: Home on start is opt-in (off by default) so opening a workspace never triggers background scans
  if (readConfig().homeOnStart)
    void inbox.homeOnStart(showReport).catch((e) => log().warn(`home on start: ${String(e)}`));
  // 3.3.0: labeled Quick Launch view in the dedicated docmap Activity Bar sidebar
  try {
    context.subscriptions.push(
      vscode.window.createTreeView("docmap.quickLaunch", { treeDataProvider: new QuickLaunchProvider() }),
    );
  } catch (error) {
    logger.warn(`Quick Launch view not available (reload the window after an update): ${String(error)}`);
  }
  // A view the editor does not know yet throws ("No view is registered with id: docmap.inbox") — seen after an
  // update without a window reload, when the editor still has the old manifest's views (owner report, 2.0.2). Only
  // the inbox is skipped then: everything after this line (review, export, writing, prompts) must still register.
  try {
    const inboxView = vscode.window.createTreeView("docmap.inbox", {
      treeDataProvider: inbox,
      showCollapseAll: true,
    });
    inbox.view = inboxView;
    context.subscriptions.push(
      inboxView,
      inboxView.onDidChangeVisibility((e) => e.visible && inbox.shown()),
    );
  } catch (error) {
    logger.warn(`Docs Inbox view not available (reload the window after an update): ${String(error)}`);
  }
  registerWriting(context, engine);
  const exportAs = (print: boolean) => async (arg?: unknown) => {
    const document = await targetDocument(arg);
    if (!document) return;
    let saveTo: vscode.Uri | undefined;
    if (!print) {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const base =
        document.uri.scheme === "file"
          ? document.uri.fsPath.replace(/\.(md|markdown|mdc)$/i, "")
          : folder
            ? vscode.Uri.joinPath(folder, "page").fsPath
            : "page";
      saveTo = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${base}.html`),
        filters: { "Web page": ["html"] },
        title: "Export as HTML",
      });
      if (!saveTo) return;
    }
    await openSnapshot(context, document, engine, browserOpener(), {
      allowLarge: MapPanel.allowsLarge(document.uri),
      ...(saveTo ? { saveTo } : {}),
      print,
    });
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("docmap.inbox.refresh", () => inbox.scan()),
    vscode.commands.registerCommand("docmap.inbox.markRead", (node) => inbox.markRead(node)),
    vscode.commands.registerCommand("docmap.inbox.askAgent", (node) => inbox.askAgent(node)),
    vscode.commands.registerCommand("docmap.inbox.archive", (node) => inbox.archive(node)),
    vscode.commands.registerCommand("docmap.inbox.compare", (node) => inbox.compare(node)),
    vscode.commands.registerCommand("docmap.inbox.showAll", (group) => inbox.expand(group)),
    vscode.commands.registerCommand("docmap.inbox.askDupes", (node, id) => inbox.askDupes(node, id)),
    vscode.commands.registerCommand("docmap.inbox.whyStale", (node) => inbox.whyStale(node)),
    vscode.commands.registerCommand("docmap.decisionLog", () => inbox.decisionLog(showReport)),
    vscode.commands.registerCommand("docmap.plansDashboard", async () => {
      const openInteractive = async (rescan = false) => {
        const data = await inbox.plansData(rescan);
        showPlansDashboard(context, data, {
          refresh: async () => {
            await openInteractive(true);
          },
          setSort: async (sort) => {
            inbox.setPlanSort(sort);
            await openInteractive(false);
          },
          exportMd: () => inbox.exportPlans(false),
          exportCsv: () => inbox.exportPlans(true),
          askAgent: () => inbox.askPlansAgent(),
          newPlan: async () => {
            await newDocFromTemplate("plan");
          },
        });
        return data;
      };
      return openInteractive(true);
    }),
    // 2026-11-24: one home page for the daily questions (owner: "I only use 1–2 features")
    vscode.commands.registerCommand("docmap.home", () => inbox.home(showReport)),
    // 3.0: a vision, scope, plan, spec… in the shapes docmap reads best (type and title may be passed, for tests)
    vscode.commands.registerCommand("docmap.newDocFromTemplate", (type?: unknown, title?: unknown) =>
      newDocFromTemplate(
        typeof type === "string" ? type : undefined,
        typeof title === "string" ? title : undefined,
      ),
    ),
    // 2026-11-22 review: right-click a folder in the Explorer → the new doc goes in that folder
    vscode.commands.registerCommand(
      "docmap.newDocHere",
      (folder?: unknown, type?: unknown, title?: unknown) =>
        newDocFromTemplate(
          typeof type === "string" ? type : undefined,
          typeof title === "string" ? title : undefined,
          folder instanceof vscode.Uri ? folder : undefined,
        ),
    ),
    // 3.0 named formats: which parts of the team's format / MADR / a design-doc format… a doc has (information only).
    // `pick` (a format's label) and `kind` are for tests: they skip the questions and the result list.
    vscode.commands.registerCommand(
      "docmap.compareWithStandard",
      async (arg?: unknown, pick?: unknown, kind?: unknown) => {
        const document = await targetDocument(arg);
        if (!document) return undefined;
        const asKind = KINDS.find((k) => k.kind === kind)?.kind;
        return typeof pick === "string"
          ? compareWithStandard(document, { pick, show: false, ...(asKind ? { kind: asKind } : {}) })
          : compareWithStandard(document);
      },
    ),
    // 3.0 doc map: where each kind of doc lives and its shape, into AGENTS.md / CLAUDE.md (left unsaved to review)
    vscode.commands.registerCommand("docmap.writeDocMap", () => writeDocMap()),
    // 3.0 (owner call 2026-11-18): pointer files for other AI tools, only on request; never replaces a file.
    // `only` (paths) is for tests: it skips the picker.
    vscode.commands.registerCommand("docmap.addRulePointers", (only?: unknown) =>
      addRulePointers(
        Array.isArray(only) ? only.filter((p): p is string => typeof p === "string") : undefined,
      ),
    ),
    vscode.commands.registerCommand("docmap.searchDocs", (query?: unknown) =>
      searchDocs(typeof query === "string" ? query : undefined),
    ),
    // Doc Atlas (owner call 2026-11-24): the graph you walk; with a doc, that doc's code details page instead
    vscode.commands.registerCommand("docmap.docAtlas", async (doc?: unknown) => {
      const details = (uri: vscode.Uri) => inbox.docAtlas(showReport, uri);
      if (doc instanceof vscode.Uri) return details(doc);
      let graph = await inbox.atlasGraph();
      // easy reading: "◈ Doc Atlas" on a doc's page — the graph beside it, centred on that doc
      const from = doc && typeof doc === "object" && "atlasFor" in doc ? doc.atlasFor : undefined;
      if (from instanceof vscode.Uri) {
        const rel = vscode.workspace.asRelativePath(from, false).replace(/\\/g, "/");
        // a doc written since docmap read the project: read it again once, before falling back to the first feature
        if (!graph.docs.some((d) => d.p === rel)) graph = await inbox.atlasGraph(true);
        const found = graph.docs.some((d) => d.p === rel);
        const centred = found ? { ...graph, start: rel, forDoc: true } : graph;
        showAtlas(context, centred, details, { beside: true });
        return centred;
      }
      showAtlas(context, graph, details);
      return graph;
    }),
    vscode.commands.registerCommand("docmap.whereToStart", () => inbox.whereToStart(showReport)),
    // 2026-11-22: every command in one list, by what you want to do; pick one to run it
    vscode.commands.registerCommand("docmap.whatCanItDo", async () => {
      type Item = vscode.QuickPickItem & { command?: string };
      const items: Item[] = COMMAND_GUIDE.flatMap((g) => [
        { label: g.title, kind: vscode.QuickPickItemKind.Separator },
        ...g.entries.map((e) => ({ label: e.label, detail: e.what, command: e.command })),
      ]);
      const pick = await vscode.window.showQuickPick(items, {
        title: "What can docmap do?",
        placeHolder: "Type what you want to do (for example: compare, plan, AI), then press Enter to run it",
        matchOnDetail: true,
      });
      if (pick?.command) await vscode.commands.executeCommand(pick.command);
    }),
    vscode.commands.registerCommand("docmap.plansMenu", () => inbox.plansMenu(showReport)),
    vscode.commands.registerCommand("docmap.openQuestions", () => inbox.openQuestions(showReport)),
    vscode.commands.registerCommand("docmap.myItems", () => inbox.myItems(showReport)),
    docLinks,
    commitHint,
    vscode.commands.registerCommand("docmap.commitHint.show", () => commitHint.show()),
    // #41: `picks` is for tests: removes those kinds without asking
    vscode.commands.registerCommand("docmap.clearSavedData", (picks?: unknown) =>
      clearSavedData(saved, Array.isArray(picks) ? (picks as SavedDataId[]) : undefined),
    ),
    // #40: `show: false` is for tests: returns the findings without the list
    vscode.commands.registerCommand("docmap.checkDesign", async (arg?: unknown, show?: unknown) => {
      const document = await targetDocument(arg);
      return document ? checkDesign(document, show === false ? { show: false } : {}) : undefined;
    }),
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, docLinks),
    vscode.commands.registerCommand("docmap.showMentions", (uri?: unknown) => docLinks.show(uri)),
    registerAiTools(inbox, engine),
    vscode.commands.registerCommand("docmap.setupAgentTools", () => setupAgentTools(context)),
    // 3.0: every feature on one read-only page, shown in docmap's own preview (Clean view and all)
    vscode.commands.registerCommand("docmap.help", async () => {
      const file = vscode.Uri.joinPath(context.extensionUri, "HELP.md");
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
      showReport(await writeReport("Help", text));
    }),
    vscode.commands.registerCommand("docmap.addPrompts", () => addPromptsToProject()),
    vscode.commands.registerCommand("docmap.exportHtml", exportAs(false)),
    vscode.commands.registerCommand("docmap.exportPdf", exportAs(true)),
    vscode.commands.registerCommand("docmap.sendReview", async () => {
      const map = MapPanel.active();
      if (map) await map.sendReview();
      else
        void vscode.window.showInformationMessage(
          "Open a Markdown preview first, and mark sections with the ⋯ beside a heading.",
        );
    }),
    vscode.commands.registerCommand("docmap.askAgent", async (arg?: unknown) => {
      const map = MapPanel.active();
      if (map && !(arg instanceof vscode.Uri)) return map.askAboutFile();
      const document = await targetDocument(arg);
      if (document)
        await pickAndDeliver(
          ["file"],
          {
            file: relativePath(document.uri),
            openTasks: openTasks(document.getText()),
            ...docFacts(relativePath(document.uri), document.getText()),
          },
          relativePath(document.uri),
        );
    }),
    vscode.commands.registerCommand("docmap.chooseLook", () => chooseLook()),
    vscode.commands.registerCommand("docmap.compare", async () => {
      const map = MapPanel.active();
      if (map) await map.redlineMenu();
      else void vscode.window.showInformationMessage("Open a Markdown preview first.");
    }),
  );

  return {
    config: readConfig,
    testing: {
      panelFor: (uri) => MapPanel.for(uri),
      pageFor: (uri) => MapPanel.pageFor(uri),
      setBrowserOpener,
      folderMap,
      inbox,
      live,
      commitHint,
      saved,
    },
  };
}

export function deactivate(): void {
  disposeRepoFacts();
  MapPanel.flushPlaces();
}

/** One quick pick for the reading look: theme, text size, line width (saved as settings, for every file). */
async function chooseLook(): Promise<void> {
  const config = readConfig();
  type Item = vscode.QuickPickItem & { key?: string; value?: unknown };
  const mark = (on: boolean) => (on ? "$(check) " : "");
  const themes: [string, string, string][] = [
    ["vscode", "Follow VS Code", "Your editor's colours (default)"],
    ["paper", "Paper", "Warm, book-like, serif"],
    ["github", "GitHub", "Familiar, clean light"],
    ["github-dark", "GitHub Dark", "Familiar, clean dark"],
    ["night", "Night", "Dark and soft on the eyes"],
    ["warm-dark", "Warm Dark", "Soft espresso dark, serif"],
    ["solarized-light", "Solarized Light", "Classic warm cream"],
    ["focus", "Focus", "One calm column, nothing else"],
  ];
  const items: Item[] = [
    { label: "Theme", kind: vscode.QuickPickItemKind.Separator },
    ...themes.map(([value, label, detail]) => ({
      label: `${mark(config.theme === value)}${label}`,
      description: detail,
      key: "theme",
      value,
    })),
    { label: "Text size", kind: vscode.QuickPickItemKind.Separator },
    ...[0.9, 1, 1.15, 1.3].map((v) => ({
      label: `${mark(config.fontScale === v)}${v === 1 ? "Normal" : v < 1 ? "Smaller" : v < 1.2 ? "Larger" : "Largest"}`,
      description: `${Math.round(v * 100)}%`,
      key: "fontScale",
      value: v,
    })),
    { label: "Line width", kind: vscode.QuickPickItemKind.Separator },
    ...(["narrow", "normal", "wide", "full"] as const).map((v) => ({
      label: `${mark(config.lineWidth === v)}${v.charAt(0).toUpperCase()}${v.slice(1)}`,
      key: "lineWidth",
      value: v,
    })),
  ];
  const pick = await vscode.window.showQuickPick(items, { title: "Reading look" });
  if (pick?.key)
    await vscode.workspace
      .getConfiguration("docmap")
      .update(pick.key, pick.value, vscode.ConfigurationTarget.Global);
}

/**
 * 3.0: once per new minor or major version (not on a fresh install, not on a patch), a short "what's new" with the
 * help page and the Get Started tour one click away. Users otherwise never find the new features.
 */
async function whatsNew(context: vscode.ExtensionContext): Promise<void> {
  const KEY = "docmap.lastVersion";
  const now = String(context.extension.packageJSON.version ?? "");
  const before = context.globalState.get<string>(KEY);
  await context.globalState.update(KEY, now);
  const minor = (v: string) => v.split(".").slice(0, 2).join(".");
  if (!before || minor(before) === minor(now) || context.extensionMode === vscode.ExtensionMode.Test) return;
  const finder = "What can docmap do?";
  const pick = await vscode.window.showInformationMessage(
    `All-in-One Markdown Viewer ${minor(now)}: dedicated docmap Activity Bar sidebar, a calm 4-control preview top bar, and a 1-click Look popover with 8 reading themes.`,
    "What's new (with examples)",
    finder,
  );
  if (pick === finder) await vscode.commands.executeCommand("docmap.whatCanItDo");
  else if (pick) await vscode.commands.executeCommand("docmap.help");
}
