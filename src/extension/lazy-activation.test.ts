import { readFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, INTERNAL_LIMITS, INTERNAL_TIMINGS } from "../core/config/config";

const mocks = vi.hoisted(() => {
  const findFiles = vi.fn(async () => [] as unknown[]);
  const readFile = vi.fn(async () => new TextEncoder().encode("# Doc\n\nBody.\n"));
  const stat = vi.fn(async () => ({ size: 16, mtime: Date.now() }));
  const uncommittedFilesHere = vi.fn(async () => ["C:\\repo\\src\\app.ts"]);
  const configValues = new Map<string, unknown>();
  const codeLensProviders: { provideCodeLenses: (doc: unknown) => unknown[] }[] = [];
  const saveListeners: ((doc: { uri: ReturnType<typeof makeUri> }) => void)[] = [];

  class Emitter<T> {
    private readonly listeners: ((e: T) => void)[] = [];
    readonly event = (fn: (e: T) => void) => {
      this.listeners.push(fn);
      return { dispose: () => undefined };
    };
    fire(e: T): void {
      for (const fn of this.listeners) fn(e);
    }
    dispose(): void {
      this.listeners.length = 0;
    }
  }

  const disposable = () => ({ dispose: () => undefined });
  const makeUri = (fsPath: string) => ({
    scheme: "file",
    fsPath,
    path: fsPath.replace(/\\/g, "/"),
    toString: () => `file:///${fsPath.replace(/\\/g, "/")}`,
  });

  return {
    findFiles,
    readFile,
    stat,
    uncommittedFilesHere,
    configValues,
    codeLensProviders,
    saveListeners,
    Emitter,
    disposable,
    makeUri,
  };
});

vi.mock("./git", () => ({
  uncommittedFilesHere: mocks.uncommittedFilesHere,
  gitUserName: vi.fn(async () => undefined),
  lastAuthor: vi.fn(async () => undefined),
}));

vi.mock("./repo-facts", () => ({
  repoFactsFor: vi.fn(async () => undefined),
  disposeRepoFacts: vi.fn(),
}));

vi.mock("./snapshot", () => ({
  browserOpener: vi.fn(),
  clearSnapshots: vi.fn(async () => undefined),
  openSnapshot: vi.fn(async () => undefined),
  setBrowserOpener: vi.fn(),
  snapshotsDir: vi.fn(() => "C:\\tmp\\snapshots"),
}));

vi.mock("./seen-text", () => ({
  initSeenTexts: vi.fn(),
}));

vi.mock("./saved-data", () => ({
  cleanUpSavedData: vi.fn(async () => undefined),
  clearSavedData: vi.fn(async () => undefined),
}));

vi.mock("./reports", () => ({
  registerReports: vi.fn(() => mocks.disposable()),
  writeReport: vi.fn(async (title: string, content: string) => ({
    uri: mocks.makeUri(`C:\\tmp\\${title}.md`),
    languageId: "markdown",
    getText: () => content,
  })),
}));

vi.mock("vscode", () => {
  const workspaceFolder = { uri: mocks.makeUri("C:\\repo"), name: "repo", index: 0 };
  const makeWatcher = () => ({
    onDidChange: () => mocks.disposable(),
    onDidCreate: () => mocks.disposable(),
    onDidDelete: () => mocks.disposable(),
    dispose: () => undefined,
  });

  return {
    EventEmitter: mocks.Emitter,
    Disposable: {
      from: (...items: { dispose: () => void }[]) => ({
        dispose: () => {
          for (const item of items) item.dispose();
        },
      }),
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    TextEditorRevealType: { InCenter: 2 },
    Uri: {
      file: (p: string) => mocks.makeUri(p),
      joinPath: (base: { fsPath: string }, ...parts: string[]) =>
        mocks.makeUri(path.join(base.fsPath, ...parts)),
      from: (parts: { scheme: string; path: string }) => ({
        ...mocks.makeUri(parts.path),
        scheme: parts.scheme,
      }),
    },
    RelativePattern: class {
      constructor(
        public base: unknown,
        public pattern: string,
      ) {}
    },
    Range: class {
      constructor(
        public startLine: number,
        public startChar: number,
        public endLine: number,
        public endChar: number,
      ) {}
    },
    CodeLens: class {
      constructor(
        public range: unknown,
        public command?: unknown,
      ) {}
    },
    ThemeIcon: class {
      constructor(public id: string) {}
    },
    window: {
      createOutputChannel: () => ({
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        trace: () => undefined,
        dispose: () => undefined,
      }),
      createStatusBarItem: () => ({
        name: "",
        command: "",
        text: "",
        tooltip: "",
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined,
      }),
      createTreeView: () => ({
        visible: false,
        badge: undefined,
        message: undefined,
        onDidChangeVisibility: () => mocks.disposable(),
        dispose: () => undefined,
      }),
      registerCustomEditorProvider: () => mocks.disposable(),
      onDidChangeActiveTextEditor: () => mocks.disposable(),
      onDidChangeTextEditorSelection: () => mocks.disposable(),
      onDidChangeTextEditorVisibleRanges: () => mocks.disposable(),
      tabGroups: { all: [], onDidChangeTabs: () => mocks.disposable() },
      activeTextEditor: undefined,
      showInformationMessage: vi.fn(async () => undefined),
    },
    workspace: {
      isTrusted: true,
      workspaceFolders: [workspaceFolder],
      getConfiguration: () => ({
        get: (key: string) => mocks.configValues.get(key),
        update: async (key: string, value: unknown) => {
          mocks.configValues.set(key, value);
        },
      }),
      createFileSystemWatcher: () => makeWatcher(),
      findFiles: mocks.findFiles,
      fs: {
        stat: mocks.stat,
        readFile: mocks.readFile,
      },
      asRelativePath: (uri: { fsPath: string } | string) => {
        const p = typeof uri === "string" ? uri : uri.fsPath;
        return path.relative("C:\\repo", p).replace(/\\/g, "/");
      },
      getWorkspaceFolder: () => workspaceFolder,
      onDidSaveTextDocument: (fn: (doc: { uri: ReturnType<typeof mocks.makeUri> }) => void) => {
        mocks.saveListeners.push(fn);
        return mocks.disposable();
      },
      onDidChangeTextDocument: () => mocks.disposable(),
      onDidCloseTextDocument: () => mocks.disposable(),
      onDidChangeWorkspaceFolders: () => mocks.disposable(),
      onDidChangeConfiguration: () => mocks.disposable(),
      registerTextDocumentContentProvider: () => mocks.disposable(),
    },
    commands: {
      registerCommand: () => mocks.disposable(),
      executeCommand: vi.fn(async () => undefined),
    },
    languages: {
      registerCodeLensProvider: (
        _selector: unknown,
        provider: { provideCodeLenses: (doc: unknown) => unknown[] },
      ) => {
        mocks.codeLensProviders.push(provider);
        return mocks.disposable();
      },
    },
    extensions: {
      getExtension: () => undefined,
      onDidChange: () => mocks.disposable(),
    },
    lm: {
      registerTool: () => mocks.disposable(),
    },
    env: {
      appName: "Visual Studio Code",
      uriScheme: "vscode",
    },
  };
});

import { activate } from "./extension";
import { DocsInbox } from "./inbox";

function makeContext() {
  const state = new Map<string, unknown>();
  const memento = {
    keys: () => [...state.keys()],
    get: <T>(key: string) => state.get(key) as T | undefined,
    update: async (key: string, value: unknown) => {
      state.set(key, value);
    },
  };
  return {
    subscriptions: [] as { dispose: () => void }[],
    workspaceState: memento,
    globalState: memento,
    extensionUri: mocks.makeUri("C:\\ext"),
    globalStorageUri: mocks.makeUri("C:\\storage"),
    extensionMode: 1,
    extension: { packageJSON: { version: "3.2.1" } },
  };
}

describe("#52 lazy activation: no full-workspace or git scans on startup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.findFiles.mockClear();
    mocks.uncommittedFilesHere.mockClear();
    mocks.configValues.clear();
    mocks.codeLensProviders.length = 0;
    mocks.saveListeners.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("package.json does not activate on workspaceContains:**/*.md and homeOnStart defaults to false", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      activationEvents: string[];
      contributes: { configuration: { properties: Record<string, { default?: unknown }> }[] };
    };
    expect(manifest.activationEvents).not.toContain("workspaceContains:**/*.md");
    const allProps = Object.assign({}, ...manifest.contributes.configuration.map((s) => s.properties));
    expect(allProps["docmap.homeOnStart"]?.default).toBe(false);
    expect(DEFAULT_CONFIG.homeOnStart).toBe(false);
  });

  it("activate() performs zero Markdown scans and zero git scans, even after CommitHint timer and DocLinks CodeLens", async () => {
    const doScanSpy = vi.spyOn(DocsInbox.prototype as unknown as { doScan: () => Promise<void> }, "doScan");
    const ctx = makeContext();

    const api = activate(ctx as never);
    await vi.advanceTimersByTimeAsync(INTERNAL_TIMINGS.commitHintMs + 5000);

    expect(doScanSpy).not.toHaveBeenCalled();
    expect(mocks.findFiles).not.toHaveBeenCalled();
    expect(mocks.uncommittedFilesHere).not.toHaveBeenCalled();

    // Opening a code file and requesting DocLinks CodeLens must not trigger a scan before user activates inbox
    for (const provider of mocks.codeLensProviders) {
      const lenses = provider.provideCodeLenses({
        uri: mocks.makeUri("C:\\repo\\src\\app.ts"),
        languageId: "typescript",
      });
      expect(lenses).toEqual([]);
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(doScanSpy).not.toHaveBeenCalled();
    expect(mocks.findFiles).not.toHaveBeenCalled();

    // Saving a file or refreshing CommitHint before inbox is activated must not trigger git or inbox scans
    for (const fn of mocks.saveListeners) fn({ uri: mocks.makeUri("C:\\repo\\src\\app.ts") });
    await vi.advanceTimersByTimeAsync(INTERNAL_TIMINGS.commitHintMs + 1000);
    await api.testing.commitHint.refresh();
    expect(doScanSpy).not.toHaveBeenCalled();
    expect(mocks.uncommittedFilesHere).not.toHaveBeenCalled();

    for (const d of ctx.subscriptions) d.dispose();
  });

  it("homeOnStart() scans only once (no duplicate scan inside home()) when explicitly opted in", async () => {
    mocks.configValues.set("homeOnStart", true);
    const docs = Array.from({ length: INTERNAL_LIMITS.homeMinDocs }, (_, i) =>
      mocks.makeUri(`C:\\repo\\docs\\doc-${i}.md`),
    );
    mocks.findFiles.mockResolvedValueOnce(docs);

    const doScanSpy = vi.spyOn(DocsInbox.prototype as unknown as { doScan: () => Promise<void> }, "doScan");
    const ctx = makeContext();
    const api = activate(ctx as never);
    // Wait for homeOnStart invoked during activate() when opted in
    await vi.advanceTimersByTimeAsync(100);

    expect(doScanSpy).toHaveBeenCalledTimes(1);

    for (const d of ctx.subscriptions) d.dispose();
    expect(api.testing.inbox).toBeDefined();
  });
});
