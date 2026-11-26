import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_LIMITS } from "../core/config/config";

interface VirtualFile {
  readonly uri: ReturnType<typeof mocks.makeUri>;
  readonly size: number;
  readonly bytes: Uint8Array;
}

const mocks = vi.hoisted(() => {
  const files = new Map<string, VirtualFile>();
  const makeUri = (fsPath: string) =>
    ({
      scheme: "file",
      fsPath,
      path: fsPath.replace(/\\/g, "/"),
      toString: () => `file:///${fsPath.replace(/\\/g, "/")}`,
    }) as unknown as import("vscode").Uri;

  const folderA = { uri: makeUri("C:\\repo-a"), name: "repo-a", index: 0 };
  const folderB = { uri: makeUri("C:\\repo-b"), name: "repo-b", index: 1 };
  const folders = [folderA, folderB];

  const watcherHandlers = {
    create: [] as ((u: ReturnType<typeof makeUri>) => void)[],
    delete: [] as ((u: ReturnType<typeof makeUri>) => void)[],
    change: [] as ((u: ReturnType<typeof makeUri>) => void)[],
  };

  const findFiles = vi.fn(
    async (pattern: { baseUri?: { fsPath: string }; pattern?: string }, _exclude?: unknown, max?: number) => {
      const base = pattern.baseUri?.fsPath ?? "";
      const isCode = typeof pattern.pattern === "string" && pattern.pattern.includes(".{ts,");
      const out: ReturnType<typeof makeUri>[] = [];
      for (const f of files.values()) {
        if (base && !f.uri.fsPath.startsWith(base)) continue;
        if (isCode && !/\.(?:ts|tsx|js|jsx|py|go|rs)$/i.test(f.uri.fsPath)) continue;
        out.push(f.uri);
        if (max !== undefined && out.length >= max) break;
      }
      return out;
    },
  );

  const stat = vi.fn(async (uri: { fsPath: string }) => {
    const f = files.get(uri.fsPath);
    if (!f) throw new Error(`ENOENT: ${uri.fsPath}`);
    return { size: f.size, mtime: 1000 };
  });

  const readFile = vi.fn(async (uri: { fsPath: string }) => {
    const f = files.get(uri.fsPath);
    if (!f) throw new Error(`ENOENT: ${uri.fsPath}`);
    return f.bytes;
  });

  return { files, makeUri, folderA, folderB, folders, watcherHandlers, findFiles, stat, readFile };
});

vi.mock("vscode", () => ({
  RelativePattern: class {
    constructor(
      public base: { uri: { fsPath: string } },
      public pattern: string,
    ) {}
    get baseUri() {
      return this.base.uri;
    }
  },
  Uri: {
    file: (p: string) => mocks.makeUri(p),
    joinPath: (base: { fsPath: string }, ...parts: string[]) =>
      mocks.makeUri(path.join(base.fsPath, ...parts)),
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
    getWorkspaceFolder: (uri: { fsPath: string }) =>
      mocks.folders.find((f) => uri.fsPath.startsWith(f.uri.fsPath)),
    createFileSystemWatcher: () => ({
      onDidCreate: (fn: (u: ReturnType<typeof mocks.makeUri>) => void) => {
        mocks.watcherHandlers.create.push(fn);
        return { dispose: () => undefined };
      },
      onDidDelete: (fn: (u: ReturnType<typeof mocks.makeUri>) => void) => {
        mocks.watcherHandlers.delete.push(fn);
        return { dispose: () => undefined };
      },
      onDidChange: (fn: (u: ReturnType<typeof mocks.makeUri>) => void) => {
        mocks.watcherHandlers.change.push(fn);
        return { dispose: () => undefined };
      },
      dispose: () => {
        mocks.watcherHandlers.create.length = 0;
        mocks.watcherHandlers.delete.length = 0;
        mocks.watcherHandlers.change.length = 0;
      },
    }),
    findFiles: mocks.findFiles,
    fs: {
      stat: mocks.stat,
      readFile: mocks.readFile,
    },
  },
}));

import { disposeRepoFacts, repoFactsFor } from "./repo-facts";

const enc = new TextEncoder();

function addFile(folder: typeof mocks.folderA, rel: string, content: string, sizeOverride?: number) {
  const full = path.join(folder.uri.fsPath, ...rel.split("/"));
  const bytes = enc.encode(content);
  const uri = mocks.makeUri(full);
  mocks.files.set(full, { uri, size: sizeOverride ?? bytes.byteLength, bytes });
  return uri;
}

function readPaths(): string[] {
  return mocks.readFile.mock.calls.map((c) => (c[0] as { fsPath: string }).fsPath.replace(/\\/g, "/"));
}

beforeEach(() => {
  disposeRepoFacts();
  mocks.files.clear();
  mocks.findFiles.mockClear();
  mocks.stat.mockClear();
  mocks.readFile.mockClear();
});

afterEach(() => {
  disposeRepoFacts();
  vi.useRealTimers();
});

describe("#54 repoFactsFor — security: never read .env files", () => {
  it("never reads .env, .env.local, or .env.production, while still reading .env.example/.sample/.template", async () => {
    const doc = addFile(mocks.folderA, "README.md", "# Docs\n");
    addFile(mocks.folderA, ".env", "SECRET_API_KEY=sk-live-123\n");
    addFile(mocks.folderA, ".env.local", "LOCAL_DB_PASSWORD=hunter2\n");
    addFile(mocks.folderA, ".env.production", "PROD_SECRET=topsecret\n");
    addFile(mocks.folderA, "apps/api/.env", "NESTED_SECRET=nope\n");
    addFile(mocks.folderA, "apps/api/.env.local", "NESTED_LOCAL_SECRET=nope\n");
    addFile(mocks.folderA, ".env.example", "PUBLIC_EXAMPLE_URL=https://example.com\n");
    addFile(mocks.folderA, "apps/api/.env.sample", "SAMPLE_PORT=3000\n");
    addFile(mocks.folderA, "apps/web/.env.template", "TEMPLATE_FLAG=true\n");

    const facts = await repoFactsFor(doc);
    expect(facts).toBeDefined();

    const touched = readPaths();
    expect(touched.some((p) => /(?:^|\/)\.env$/.test(p))).toBe(false);
    expect(touched.some((p) => p.endsWith("/.env.local"))).toBe(false);
    expect(touched.some((p) => p.endsWith("/.env.production"))).toBe(false);

    expect(touched.some((p) => p.endsWith("/.env.example"))).toBe(true);
    expect(touched.some((p) => p.endsWith("/.env.sample"))).toBe(true);
    expect(touched.some((p) => p.endsWith("/.env.template"))).toBe(true);

    expect(facts?.envVars?.has("PUBLIC_EXAMPLE_URL")).toBe(true);
    expect(facts?.envVars?.has("SAMPLE_PORT")).toBe(true);
    expect(facts?.envVars?.has("TEMPLATE_FLAG")).toBe(true);
    expect(facts?.envVars?.has("SECRET_API_KEY")).toBe(false);
    expect(facts?.envVars?.has("LOCAL_DB_PASSWORD")).toBe(false);
    expect(facts?.envVars?.has("PROD_SECRET")).toBe(false);
    expect(facts?.envVars?.has("NESTED_SECRET")).toBe(false);
  });
});

describe("#54 repoFactsFor — watcher ignores build/temp/node_modules/.git and scopes invalidation", () => {
  it("does not invalidate the cache on build, temp, node_modules, .git, or .env changes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const docA = addFile(mocks.folderA, "README.md", "# A\n");
    addFile(mocks.folderA, "src/app.ts", "export function runApp() {}\n");

    await repoFactsFor(docA);
    const initialFinds = mocks.findFiles.mock.calls.length;

    const ignoredPaths = [
      "node_modules/pkg/index.js",
      "node_modules/pkg/package.json",
      ".git/index.lock",
      ".git/objects/ab/1234",
      "dist/extension.js",
      "build/output.js",
      "out/test.js",
      "tmp/scratch.txt",
      ".tmp/cache.json",
      ".cache/data.bin",
      "src/file.tmp",
      "src/.#editing.ts",
      "src/app.ts.swp",
      ".env",
      ".env.local",
    ];

    for (const rel of ignoredPaths) {
      const uri = mocks.makeUri(path.join(mocks.folderA.uri.fsPath, ...rel.split("/")));
      for (const fn of mocks.watcherHandlers.create) fn(uri);
      for (const fn of mocks.watcherHandlers.delete) fn(uri);
      for (const fn of mocks.watcherHandlers.change) fn(uri);
    }

    vi.advanceTimersByTime(5000);
    await repoFactsFor(docA);
    expect(mocks.findFiles.mock.calls.length).toBe(initialFinds);
  });

  it("invalidates only the affected workspace folder on real file changes, not other folders", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const docA = addFile(mocks.folderA, "README.md", "# A\n");
    const docB = addFile(mocks.folderB, "README.md", "# B\n");

    await repoFactsFor(docA);
    await repoFactsFor(docB);
    const afterWarmup = mocks.findFiles.mock.calls.length;

    const newFileInA = mocks.makeUri(path.join(mocks.folderA.uri.fsPath, "src", "added.ts"));
    for (const fn of mocks.watcherHandlers.create) fn(newFileInA);
    vi.advanceTimersByTime(5000);

    // Folder B must still be cached (no new findFiles calls)
    await repoFactsFor(docB);
    expect(mocks.findFiles.mock.calls.length).toBe(afterWarmup);

    // Folder A was invalidated and rebuilds on demand
    await repoFactsFor(docA);
    expect(mocks.findFiles.mock.calls.length).toBeGreaterThan(afterWarmup);
  });

  it("invalidates the folder cache when .env.example changes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const docA = addFile(mocks.folderA, "README.md", "# A\n");
    const envExample = addFile(mocks.folderA, ".env.example", "FOO=1\n");

    const first = await repoFactsFor(docA);
    expect(first?.envVars?.has("FOO")).toBe(true);
    const afterFirst = mocks.findFiles.mock.calls.length;

    addFile(mocks.folderA, ".env.example", "FOO=1\nBAR=2\n");
    for (const fn of mocks.watcherHandlers.change) fn(envExample);
    vi.advanceTimersByTime(5000);

    const second = await repoFactsFor(docA);
    expect(mocks.findFiles.mock.calls.length).toBeGreaterThan(afterFirst);
    expect(second?.envVars?.has("BAR")).toBe(true);
  });
});

describe("#54 repoFactsFor — bounded code scanning and event-loop yielding", () => {
  it("yields to the event loop between batches during code scanning", async () => {
    const doc = addFile(mocks.folderA, "README.md", "# Docs\n");
    for (let i = 0; i < 65; i++) {
      addFile(mocks.folderA, `src/mod${i}.ts`, `export function fn${i}() { return ${i}; }\n`);
    }

    const immediateSpy = vi.spyOn(globalThis, "setImmediate");
    try {
      const facts = await repoFactsFor(doc);
      expect(facts?.symbols?.has("fn0")).toBe(true);
      expect(facts?.symbols?.has("fn64")).toBe(true);
      expect(immediateSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      immediateSpy.mockRestore();
    }
  });

  it("stops scanning early and drops partial symbol/identifier indexes when total bytes exceed budget", async () => {
    const doc = addFile(mocks.folderA, "README.md", "# Docs\n");
    // Create 120 files of 50 KB each (= 6 MB total, exceeding a 4 MB total budget while each file is < 100 KB)
    const chunk = "const x = 1;\n".repeat(3800); // ~49.4 KB
    for (let i = 0; i < 120; i++) {
      addFile(mocks.folderA, `src/big${i}.ts`, `export function bigFn${i}() {}\n${chunk}`);
    }

    const facts = await repoFactsFor(doc);
    expect(facts).toBeDefined();
    // Should not have read all 120 files
    const codeReads = readPaths().filter((p) => p.endsWith(".ts")).length;
    expect(codeReads).toBeLessThan(120);
    // Partial index is dropped rather than trusted half-full
    expect(facts?.symbols).toBeUndefined();
    expect(facts?.identifiers).toBeUndefined();
  });

  it("skips code scanning gracefully when file count exceeds repoCodeFiles limit", async () => {
    const doc = addFile(mocks.folderA, "README.md", "# Docs\n");
    const count = INTERNAL_LIMITS.repoCodeFiles + 2;
    for (let i = 0; i < count; i++) {
      addFile(mocks.folderA, `src/f${i}.ts`, `export function f${i}() {}\n`);
    }

    const facts = await repoFactsFor(doc);
    expect(facts).toBeDefined();
    expect(facts?.symbols).toBeUndefined();
    expect(facts?.identifiers).toBeUndefined();
    expect(readPaths().filter((p) => p.endsWith(".ts"))).toHaveLength(0);
  });

  it("stops scanning and drops partial indexes when unique identifiers exceed repoMaxIdentifiers", async () => {
    const doc = addFile(mocks.folderA, "README.md", "# Docs\n");
    // Generate > 50,000 unique identifiers across 60 small files (~1,000 unique names each, < 20 KB per file)
    let n = 0;
    for (let f = 0; f < 60; f++) {
      const names: string[] = [];
      for (let k = 0; k < 1000; k++) names.push(`id_${n++}`);
      addFile(mocks.folderA, `src/ids${f}.ts`, `export const v${f} = [${names.join(",")}];\n`);
    }

    const facts = await repoFactsFor(doc);
    expect(facts).toBeDefined();
    expect(facts?.symbols).toBeUndefined();
    expect(facts?.identifiers).toBeUndefined();
    expect(facts?.envVars).toBeUndefined();
  });
});
