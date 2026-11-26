import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_LIMITS } from "../core/config/config";

interface VirtualFile {
  readonly uri: ReturnType<typeof mocks.makeUri>;
  mtime: number;
  size: number;
  bytes: Uint8Array;
}

const mocks = vi.hoisted(() => {
  const files = new Map<string, VirtualFile>();
  const findFiles = vi.fn(async () => [...files.values()].map((f) => f.uri));
  const stat = vi.fn(async (uri: { fsPath: string }) => {
    const f = files.get(uri.fsPath);
    if (!f) throw new Error(`ENOENT: ${uri.fsPath}`);
    return { size: f.size, mtime: f.mtime };
  });
  const readFile = vi.fn(async (uri: { fsPath: string }) => {
    const f = files.get(uri.fsPath);
    if (!f) throw new Error(`ENOENT: ${uri.fsPath}`);
    return f.bytes;
  });

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

  const lastAuthor = vi.fn(async () => "dev");
  const repoFactsFor = vi.fn(async () => undefined);

  return { files, findFiles, stat, readFile, lastAuthor, repoFactsFor, Emitter, disposable, makeUri };
});

vi.mock("./git", () => ({
  uncommittedFilesHere: vi.fn(async () => []),
  gitUserName: vi.fn(async () => undefined),
  lastAuthor: mocks.lastAuthor,
}));

vi.mock("./repo-facts", () => ({
  repoFactsFor: mocks.repoFactsFor,
  disposeRepoFacts: vi.fn(),
}));

vi.mock("./reports", () => ({
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
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    Uri: {
      file: (p: string) => mocks.makeUri(p),
      joinPath: (base: { fsPath: string }, ...parts: string[]) =>
        mocks.makeUri(path.join(base.fsPath, ...parts)),
    },
    ThemeIcon: class {
      constructor(public id: string) {}
    },
    TreeItem: class {
      constructor(
        public label: string,
        public collapsibleState?: number,
      ) {}
    },
    MarkdownString: class {
      appendMarkdown() {
        return this;
      }
      appendText() {
        return this;
      }
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
    },
    workspace: {
      workspaceFolders: [workspaceFolder],
      getConfiguration: () => ({
        get: () => undefined,
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
    },
    commands: {
      executeCommand: vi.fn(async () => undefined),
    },
  };
});

import { DocsInbox } from "./inbox";
import type { NotesStore } from "./notes";

const enc = new TextEncoder();

function makeNotes(): NotesStore {
  return {
    onChange: () => ({ dispose: () => undefined }),
    readHash: () => undefined,
    setReadHash: () => undefined,
  } as unknown as NotesStore;
}

function addDoc(relPath: string, content: string, mtime = 1_700_000_000_000): VirtualFile {
  const fsPath = path.join("C:\\repo", relPath);
  const bytes = enc.encode(content);
  const vf: VirtualFile = { uri: mocks.makeUri(fsPath), mtime, size: bytes.byteLength, bytes };
  mocks.files.set(fsPath, vf);
  return vf;
}

function makeNormalDoc(index: number): string {
  return [
    `# Service Guide ${index}`,
    "",
    `Overview for component ${index} handling requests, retries, and configuration validation.`,
    "",
    `- [ ] Review rollout plan for service ${index}`,
    `- [x] Confirm metrics dashboard ${index}`,
    "",
    `Decision: Keep service ${index} stateless with bounded retries.`,
    `Status: active`,
    `Owner: team-${index % 10}`,
    "",
    `See [neighbor](doc-${Math.max(0, index - 1)}.md) for details.`,
    "",
  ].join("\n");
}

function makeMultiMbDoc(index: number, targetBytes = 2 * 1024 * 1024): string {
  const chunk = `Paragraph ${index} with distinct prose words alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.\n\n`;
  const repeats = Math.ceil(targetBytes / chunk.length);
  return `# Huge Log ${index}\n\n${chunk.repeat(repeats)}`;
}

describe("#53 DocsInbox.doScan() streaming, size cap, event-loop yield, and caching", () => {
  beforeEach(() => {
    mocks.files.clear();
    mocks.findFiles.mockClear();
    mocks.stat.mockClear();
    mocks.readFile.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips reading oversized files above the scan size cap without running MinHash or heavy regexes", async () => {
    addDoc("docs/small.md", makeNormalDoc(1));
    const huge = addDoc("docs/huge.md", makeMultiMbDoc(1, 1024 * 1024));

    const inbox = new DocsInbox(makeNotes());
    await inbox.scan();

    const readPaths = mocks.readFile.mock.calls.map((c) => (c[0] as { fsPath: string }).fsPath);
    expect(readPaths).not.toContain(huge.uri.fsPath);
    expect(readPaths).toHaveLength(1);
    inbox.dispose();
  });

  it("enforces the total scan byte budget and streams files one at a time without concurrent text accumulation", async () => {
    // 60 files × 200 KB = 12 MB (> 10 MB total scan budget), each under the 256 KB per-file cap
    const docBody = `# Budget Doc\n\n\`\`\`\n${"x".repeat(200 * 1024)}\n\`\`\`\n`;
    for (let i = 0; i < 60; i++) addDoc(`docs/chunk-${i}.md`, docBody);

    let inFlight = 0;
    let maxInFlight = 0;
    mocks.readFile.mockImplementation(async (uri: { fsPath: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight--;
      const f = mocks.files.get(uri.fsPath);
      if (!f) throw new Error(`ENOENT: ${uri.fsPath}`);
      return f.bytes;
    });

    const inbox = new DocsInbox(makeNotes());
    await inbox.scan();

    // Streaming: at most 1 file is read/decoded at a time (never batching 32+ file texts into raw[])
    expect(maxInFlight).toBe(1);
    // Total byte budget stops deep-reading once exhausted (< 60 reads)
    const maxExpectedReads = Math.floor(INTERNAL_LIMITS.inboxTotalScanBytes / (200 * 1024));
    expect(mocks.readFile.mock.calls.length).toBeLessThanOrEqual(maxExpectedReads);
    expect(mocks.readFile.mock.calls.length).toBeGreaterThan(0);
    inbox.dispose();
  }, 15_000);

  it("caches per-file results by (mtime, size) and only re-reads changed files on rescan", async () => {
    const f1 = addDoc("docs/one.md", makeNormalDoc(1), 1000);
    const f2 = addDoc("docs/two.md", makeNormalDoc(2), 1000);
    addDoc("docs/three.md", makeNormalDoc(3), 1000);

    const inbox = new DocsInbox(makeNotes());
    await inbox.scan();
    expect(mocks.readFile).toHaveBeenCalledTimes(3);

    // Second scan with no changes: 0 file reads
    mocks.readFile.mockClear();
    await inbox.scan();
    expect(mocks.readFile).toHaveBeenCalledTimes(0);

    // Mutate mtime on one file and size on another: only those 2 are re-read
    f1.mtime = 2000;
    const updatedText = `${makeNormalDoc(2)}\nExtra updated paragraph.\n`;
    f2.bytes = enc.encode(updatedText);
    f2.size = f2.bytes.byteLength;
    mocks.readFile.mockClear();

    await inbox.scan();
    expect(mocks.readFile).toHaveBeenCalledTimes(2);
    const rereadPaths = mocks.readFile.mock.calls.map((c) => (c[0] as { fsPath: string }).fsPath);
    expect(rereadPaths).toContain(f1.uri.fsPath);
    expect(rereadPaths).toContain(f2.uri.fsPath);
    inbox.dispose();
  });

  it("stress test: 500+ docs including multi-MB fixtures completes quickly, yields to event loop, and stays within budget", async () => {
    // 500 normal docs + 2 near-duplicates + 5 multi-MB (2 MB each = 10 MB) fixtures
    for (let i = 0; i < 500; i++) addDoc(`docs/doc-${i}.md`, makeNormalDoc(i));
    const dupBody =
      "# Shared Architecture Spec\n\n" +
      "This architecture specification describes how the distributed ingestion pipeline validates incoming records, " +
      "persists structured checkpoints, retries transient storage errors with exponential backoff, and exposes " +
      "health metrics for operators across every deployment region in production. " +
      "Each worker streams payloads incrementally so memory remains bounded during peak traffic bursts and rolling restarts.\n";
    addDoc("docs/dup-a.md", dupBody);
    addDoc("docs/dup-b.md", `${dupBody}\nMinor trailing note.\n`);

    const hugePaths: string[] = [];
    for (let i = 0; i < 5; i++) {
      const vf = addDoc(`docs/huge-${i}.md`, makeMultiMbDoc(i, 2 * 1024 * 1024));
      hugePaths.push(vf.uri.fsPath);
    }

    const inbox = new DocsInbox(makeNotes());

    // Track event-loop yields while doScan() runs
    let eventLoopTicks = 0;
    let scanning = true;
    const tick = () => {
      if (!scanning) return;
      eventLoopTicks++;
      setImmediate(tick);
    };
    setImmediate(tick);

    const started = performance.now();
    await inbox.scan();
    const firstScanMs = performance.now() - started;
    scanning = false;

    // 1. Completed quickly (multi-MB MinHash without cap takes many seconds)
    expect(firstScanMs).toBeLessThan(2000);
    // 2. Oversized files were never read into memory
    const readPaths = new Set(mocks.readFile.mock.calls.map((c) => (c[0] as { fsPath: string }).fsPath));
    for (const p of hugePaths) expect(readPaths.has(p)).toBe(false);
    // 3. Event loop remained responsive during the 500+ file scan
    expect(eventLoopTicks).toBeGreaterThanOrEqual(50);
    // 4. Normal duplicate detection still works
    expect(
      inbox.newerDuplicate(mocks.makeUri(path.join("C:\\repo", "docs/dup-a.md")) as never),
    ).toBeUndefined();
    const groups = await inbox.getChildren();
    expect(groups.some((g) => g.kind === "group" && g.group === "duplicates")).toBe(true);

    // 5. Cached rescan reads 0 files and finishes almost instantly
    mocks.readFile.mockClear();
    const rescanStart = performance.now();
    await inbox.scan();
    const rescanMs = performance.now() - rescanStart;
    expect(mocks.readFile).toHaveBeenCalledTimes(0);
    expect(rescanMs).toBeLessThan(500);
    expect(INTERNAL_LIMITS.folderMapFiles).toBeGreaterThanOrEqual(500);
    inbox.dispose();
  }, 30_000);
});

describe("#55 DocsInbox home(), atlasGraph(), and planRows() bounded I/O and cache reuse", () => {
  beforeEach(() => {
    mocks.files.clear();
    mocks.findFiles.mockClear();
    mocks.stat.mockClear();
    mocks.readFile.mockClear();
    mocks.lastAuthor.mockReset();
    mocks.lastAuthor.mockResolvedValue("dev");
    mocks.repoFactsFor.mockReset();
    mocks.repoFactsFor.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("home() reuses cached scan metadata instead of re-reading every workspace Markdown file", async () => {
    for (let i = 0; i < 25; i++) addDoc(`docs/doc-${i}.md`, makeNormalDoc(i));
    addDoc("NEXT-SESSION.md", "# Next Session\n\n**Next:**\n- Finish issue #55\n");

    const inbox = new DocsInbox(makeNotes());
    await inbox.scan();
    mocks.readFile.mockClear();

    const opened: string[] = [];
    await inbox.home((doc) => opened.push(doc.getText()), { skipScan: true });

    // At most the single handover note is read; none of the 25 other docs are re-read from disk
    expect(mocks.readFile.mock.calls.length).toBeLessThanOrEqual(1);
    expect(opened[0]).toContain("Finish issue #55");
    inbox.dispose();
  });

  it("atlasGraph() reuses cached code spans instead of re-reading every Markdown file from disk", async () => {
    for (let i = 0; i < 20; i++) {
      addDoc(`docs/feat-${i}.md`, `# Feature ${i}\n\nUses \`src/mod-${i}.ts\` and \`missingFn()\`.`);
    }
    mocks.repoFactsFor.mockResolvedValue({
      hasPath: (p: string) => p.startsWith("src/mod-"),
      findPath: (p: string) => p,
      symbols: new Set<string>(),
      identifiers: new Set<string>(),
    } as never);

    const inbox = new DocsInbox(makeNotes());
    await inbox.scan();
    mocks.readFile.mockClear();

    const graph = await inbox.atlasGraph(false);

    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(graph.docs).toHaveLength(20);
    expect(graph.docs[0]?.c).toContain("src/mod-0.ts");
    expect(graph.docs[0]?.g).toBe(1);
    inbox.dispose();
  });

  it("plansDashboard() bounds concurrent git log calls in planRows()", async () => {
    for (let i = 0; i < 20; i++) {
      addDoc(`plans/plan-${i}.md`, `# Plan ${i}\n\n- [ ] Task A\n- [x] Task B\n`);
    }

    let inFlight = 0;
    let maxInFlight = 0;
    mocks.lastAuthor.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return "alice";
    });

    const inbox = new DocsInbox(makeNotes());
    await inbox.plansDashboard(() => undefined);

    expect(mocks.lastAuthor).toHaveBeenCalledTimes(20);
    expect(maxInFlight).toBeLessThanOrEqual(INTERNAL_LIMITS.ioConcurrency);
    expect(maxInFlight).toBeGreaterThan(1);
    inbox.dispose();
  });
});
