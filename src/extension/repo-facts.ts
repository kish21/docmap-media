import * as path from "node:path";
import * as vscode from "vscode";
import { INTERNAL_LIMITS, INTERNAL_TIMINGS } from "../core/config/config";
import { pathIndex, type RepoFacts } from "../core/trust/check";
import { isSecretEnvFile } from "./links";
import { log } from "./log";

/**
 * What a workspace folder's code says (3.0 trust markers): files and folders, package.json scripts and versions,
 * Makefile / justfile targets, declared function and class names, environment variables (from code and `.env`
 * template files only — never `.env` or `.env.*` secret files). Built on demand per folder and invalidated per folder
 * after relevant files change. Read-only, on this computer. Indexes that hit their cap are dropped rather than
 * trusted half-full — a missing name in a half index would be a false "doesn't match the code".
 */
const SKIP_DIRS =
  /(?:^|[\\/])(?:node_modules|\.git|\.venv|venv|dist|out|build|target|vendor|\.next|coverage|__pycache__|tmp|\.tmp|\.cache|\.turbo|\.parcel-cache|\.pytest_cache|\.mypy_cache|\.ruff_cache)(?:[\\/]|$)/;
const TEMP_FILE = /(?:^|[\\/])(?:\.#.*|.*\.tmp|.*\.sw[po]|.*\.bak|.*~|\.DS_Store|Thumbs\.db|.*\.log)$/i;
const EXCLUDE_GLOB =
  "**/{node_modules,.git,.venv,venv,dist,out,build,target,vendor,.next,coverage,__pycache__,tmp,.tmp,.cache,.turbo,.parcel-cache,.pytest_cache,.mypy_cache,.ruff_cache}/**";
const CODE_GLOB = "**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,java,kt,cs,rb,php,swift,scala,c,cc,cpp,h,hpp}";
const ENV_TEMPLATE = /(?:^|\/)\.env\.(?:example|sample|template)$/;
const ANY_ENV = /(?:^|\/)\.env(?:\.[\w.-]+)?$/;
const ENV_SOURCE =
  /(?:^|\/)\.env\.(?:example|sample|template)$|(?:^|\/)docker-compose[^/]*\.ya?ml$|(?:^|\/)\.github\/workflows\/[^/]*\.ya?ml$/;
const WATCHED_CONFIG =
  /(?:^|\/)(?:package\.json|Makefile|justfile|\.nvmrc|\.node-version|\.env\.(?:example|sample|template)|docker-compose[^/]*\.ya?ml)$|(?:^|\/)\.github\/workflows\/[^/]*\.ya?ml$/;
const DECLARATION =
  /\b(?:function\*?|class|interface|type|enum|def|func|fn|struct|trait|module|record|object|protocol)\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var|export\s+const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function|\w+\s*=>)|^\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[\w<>[\], |.]+)?\s*\{/gm;
const ENV_USE =
  /process\.env(?:\.([A-Z][A-Z0-9_]+)|\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\])|(?:os\.environ(?:\.get)?\s*[[(]\s*|getenv\s*\(\s*|env::var\s*\(\s*|ENV\s*\[\s*|Environment\.GetEnvironmentVariable\s*\(\s*)["']([A-Z][A-Z0-9_]+)["']|import\.meta\.env\.([A-Z][A-Z0-9_]+)/g;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function isIgnoredForWatcher(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/");
  if (SKIP_DIRS.test(norm) || TEMP_FILE.test(norm)) return true;
  if (ANY_ENV.test(norm) && !ENV_TEMPLATE.test(norm)) return true;
  return false;
}

interface Index {
  readonly root: string;
  readonly paths: ReturnType<typeof pathIndex>;
  readonly facts: Omit<RepoFacts, "hasPath">;
}

const cache = new Map<string, Promise<Index>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let watcher: vscode.FileSystemWatcher | undefined;

/** The repo facts for the folder holding `doc`, with paths resolved against the root and the doc's own folder. */
export async function repoFactsFor(doc: vscode.Uri): Promise<RepoFacts | undefined> {
  const folder = vscode.workspace.getWorkspaceFolder(doc);
  if (folder?.uri.scheme !== "file") return undefined;
  watch();
  const key = folder.uri.toString();
  let index = cache.get(key);
  if (!index) {
    index = build(folder);
    cache.set(key, index);
  }
  const ix = await index;
  const docDir = path.relative(ix.root, path.dirname(doc.fsPath));
  return {
    ...ix.facts,
    hasPath: (p) => ix.paths.has(docDir, p),
    findPath: (p) => ix.paths.resolve(docDir, p),
    movedTo: (p) => ix.paths.moved(p, docDir.replace(/\\/g, "/")),
  };
}

function invalidate(uri: vscode.Uri): void {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return;
  const key = folder.uri.toString();
  if (!cache.has(key)) return;
  const prev = timers.get(key);
  if (prev) clearTimeout(prev);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      cache.delete(key);
    }, INTERNAL_TIMINGS.repoFactsDebounceMs),
  );
}

function watch(): void {
  if (watcher) return;
  watcher = vscode.workspace.createFileSystemWatcher("**/*");
  const onPathStructureChange = (u: vscode.Uri) => {
    if (isIgnoredForWatcher(u.fsPath || u.path)) return;
    invalidate(u);
  };
  watcher.onDidCreate(onPathStructureChange);
  watcher.onDidDelete(onPathStructureChange);
  watcher.onDidChange((u) => {
    const filePath = u.fsPath || u.path;
    if (isIgnoredForWatcher(filePath)) return;
    if (WATCHED_CONFIG.test(filePath.replace(/\\/g, "/"))) invalidate(u);
  });
}

export function disposeRepoFacts(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  watcher?.dispose();
  watcher = undefined;
  cache.clear();
}

async function build(folder: vscode.WorkspaceFolder): Promise<Index> {
  const started = Date.now();
  const root = folder.uri.fsPath;
  const rel = (u: vscode.Uri) => path.relative(root, u.fsPath).replace(/\\/g, "/");
  const all = (
    await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, "**/*"),
      EXCLUDE_GLOB,
      INTERNAL_LIMITS.repoFiles + 1,
    )
  ).filter((u) => !SKIP_DIRS.test(u.fsPath) && !isSecretEnvFile(u.fsPath));
  const paths = pathIndex(all.map(rel));
  const files = new Set(all.map(rel));
  const read = async (p: string) => {
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, p)));
    } catch {
      return undefined;
    }
  };
  const scripts = new Map<string, Set<string>>();
  const versions = new Map<string, string>();
  const pkgText = await read("package.json");
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText) as Record<string, Record<string, string> | undefined>;
      scripts.set("npm", new Set(Object.keys(pkg.scripts ?? {})));
      for (const deps of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies])
        for (const [name, v] of Object.entries(deps ?? {}))
          versions.set(name, String(v).replace(/^[\^~]/, ""));
      if (pkg.engines?.node) versions.set("node", pkg.engines.node);
    } catch {
      // not JSON: no script or version checks
    }
  }
  const nvm = (await read(".nvmrc")) ?? (await read(".node-version"));
  if (nvm?.trim()) versions.set("node", nvm.trim());
  const make = await read("Makefile");
  if (make)
    scripts.set("make", new Set([...make.matchAll(/^([A-Za-z0-9_.-]+)\s*:(?!=)/gm)].map((m) => m[1] ?? "")));
  const just = await read("justfile");
  if (just)
    scripts.set(
      "just",
      new Set([...just.matchAll(/^([A-Za-z0-9_-]+)(?:\s[^:\n]*)?:(?!=)/gm)].map((m) => m[1] ?? "")),
    );

  // symbols + env vars from the code: only when the whole code base fits the caps, else no such checks
  const code = (
    await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, CODE_GLOB),
      EXCLUDE_GLOB,
      INTERNAL_LIMITS.repoCodeFiles + 1,
    )
  ).filter((u) => !SKIP_DIRS.test(u.fsPath));
  let symbols: Set<string> | undefined;
  let envVars: Set<string> | undefined;
  let identifiers: Set<string> | undefined;
  if (code.length <= INTERNAL_LIMITS.repoCodeFiles) {
    symbols = new Set();
    envVars = new Set();
    identifiers = new Set();
    let totalBytes = 0;
    let capped = false;
    const batchSize = INTERNAL_LIMITS.repoCodeBatchSize;
    for (let i = 0; i < code.length; i += batchSize) {
      const slice = code.slice(i, i + batchSize);
      const stats = await Promise.all(
        slice.map(async (u) => ({
          uri: u,
          stat: await vscode.workspace.fs.stat(u).then(undefined, () => undefined),
        })),
      );
      const toRead: vscode.Uri[] = [];
      for (const { uri, stat } of stats) {
        if (!stat || stat.size > INTERNAL_LIMITS.repoCodeFileBytes) continue;
        if (totalBytes + stat.size > INTERNAL_LIMITS.repoCodeTotalBytes) {
          capped = true;
          break;
        }
        totalBytes += stat.size;
        toRead.push(uri);
      }
      if (capped) break;
      const texts = await Promise.all(toRead.map((u) => read(rel(u))));
      for (const t of texts) {
        if (!t) continue;
        for (const m of t.matchAll(DECLARATION)) {
          const name = m[1] ?? m[2] ?? m[3];
          if (name) symbols.add(name);
        }
        for (const m of t.matchAll(ENV_USE)) {
          const name = m[1] ?? m[2] ?? m[3] ?? m[4];
          if (name) envVars.add(name);
        }
        for (const m of t.matchAll(/[A-Za-z_$][\w$]{2,}/g)) {
          identifiers.add(m[0]);
          if (identifiers.size > INTERNAL_LIMITS.repoMaxIdentifiers) {
            capped = true;
            break;
          }
        }
        if (capped) break;
      }
      await yieldToEventLoop();
      if (capped) break;
    }
    if (capped) {
      symbols = undefined;
      envVars = undefined;
      identifiers = undefined;
    } else {
      // Strictly template files (.env.example/.sample/.template) and CI/compose files — never .env or .env.local
      for (const f of [...files].filter((p) => ENV_SOURCE.test(p))) {
        const t = await read(f);
        for (const m of t?.matchAll(/^\s*(?:export\s+)?-?\s*([A-Z][A-Z0-9_]+)\s*[:=]/gm) ?? [])
          envVars.add(m[1] ?? "");
        for (const m of t?.matchAll(/\$\{?([A-Z][A-Z0-9_]+)/g) ?? []) envVars.add(m[1] ?? "");
      }
    }
  }
  log().info(
    `repo facts: ${paths.size} paths, ${symbols?.size ?? "no"} symbols, ${envVars?.size ?? "no"} env vars, ${Date.now() - started} ms`,
  );
  return {
    root,
    paths,
    facts: {
      ...(scripts.size ? { scripts } : {}),
      ...(symbols ? { symbols } : {}),
      ...(envVars ? { envVars } : {}),
      ...(identifiers ? { identifiers } : {}),
      ...(versions.size ? { versions } : {}),
    },
  };
}
