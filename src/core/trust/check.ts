import type { Claim } from "./claims";

/**
 * What the repository says, gathered by the extension (files, scripts, symbols, env vars, versions) — checked here
 * against a paragraph's claims. Pure. Only definite contradictions are reported: a check that cannot be made (no
 * package.json, symbol index skipped) never produces a finding.
 */
export interface RepoFacts {
  /** Whether a workspace-relative path (file or folder) exists. Resolved by the caller (root and the doc's folder). */
  readonly hasPath: (path: string) => boolean;
  /** Script / target names per runner: "npm" covers npm, pnpm, yarn and bun (package.json scripts); make, just. */
  readonly scripts?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Declared function / class / type names in the code (undefined: not indexed — no symbol findings). */
  readonly symbols?: ReadonlySet<string>;
  /** Environment variable names the code or .env example files use (undefined: not indexed). */
  readonly envVars?: ReadonlySet<string>;
  /** Package → version range or version as written (package.json dependencies, engines.node, .nvmrc). */
  readonly versions?: ReadonlyMap<string, string>;
  /**
   * Every word in the code, declared there or not (a library's `LogOutputChannel`, a constant like `INTERNAL_LIMITS`).
   * A name the code still uses is never reported missing. Undefined: not indexed.
   */
  readonly identifiers?: ReadonlySet<string>;
  /** The workspace-relative path a named path really is (clickable names in the preview). */
  readonly findPath?: (path: string) => string | undefined;
  /** Where a missing file most likely went (one-click fix), if one answer stands out. */
  readonly movedTo?: (path: string) => string | undefined;
}

/** Folders docmap does not index (build output, installed packages): a path inside one cannot be checked. */
const UNCHECKED =
  /(?:^|\/)(?:node_modules|dist|out|build|target|vendor|coverage|\.next|\.venv|venv|__pycache__)(?:\/|$)/;
export const isUnchecked = (path: string): boolean => UNCHECKED.test(path.replace(/\\/g, "/"));

/**
 * Which paths exist, from a list of workspace-relative files (folders are added). `has` also accepts a path written
 * shorter than it is, as long as it ends a real one at a `/`: docs often write `webview/extras.ts` for
 * `src/webview/extras.ts` (seen in the 2026-11-22 sweep).
 */
export function pathIndex(paths: Iterable<string>): {
  readonly has: (docDir: string, named: string) => boolean;
  /** The real workspace-relative path a named one is (undefined: none). */
  readonly resolve: (docDir: string, named: string) => string | undefined;
  /**
   * Where a missing file most likely went: the one file with its name, or the one closest to the old path — written
   * relative to the deepest folder above `docDir` that holds it (the way the doc writes paths).
   */
  readonly moved: (named: string, docDir?: string) => string | undefined;
  readonly size: number;
} {
  const files = new Set<string>();
  /** a path's endings at each `/` → the first full path with that ending */
  const tails = new Map<string, string>();
  const byName = new Map<string, string[]>();
  const addTails = (p: string) => {
    if (!tails.has(p)) tails.set(p, p);
    for (let i = p.indexOf("/"); i >= 0; i = p.indexOf("/", i + 1))
      if (!tails.has(p.slice(i + 1))) tails.set(p.slice(i + 1), p);
  };
  for (const f of paths) {
    let p = f.replace(/\\/g, "/").replace(/\/$/, "");
    const name = p.slice(p.lastIndexOf("/") + 1);
    byName.set(name, [...(byName.get(name) ?? []), p]);
    files.add(p);
    addTails(p);
    while (p.includes("/")) {
      p = p.slice(0, p.lastIndexOf("/"));
      files.add(p);
      addTails(p);
    }
  }
  const resolve = (docDir: string, named: string) => {
    const candidates = pathCandidates(docDir, named);
    const found = candidates.find((c) => files.has(c));
    if (found !== undefined) return found;
    const first = candidates[0] ?? "";
    return first.includes("/") ? tails.get(first) : undefined;
  };
  return {
    size: files.size,
    has: (docDir, named) => resolve(docDir, named) !== undefined,
    resolve,
    moved: (named, docDir = "") => {
      const parts = posixNormalize(named.replace(/\\/g, "/")).split("/");
      const options = (byName.get(parts[parts.length - 1] ?? "") ?? []).filter((c) => c !== parts.join("/"));
      // written the way the doc writes paths: from the deepest folder above the doc that holds the new path
      const dirs = docDir.replace(/\\/g, "/").split("/").filter(Boolean);
      const asWritten = (p: string | undefined) => {
        if (p === undefined) return undefined;
        for (let n = dirs.length; n > 0; n--) {
          const base = `${dirs.slice(0, n).join("/")}/`;
          if (p.startsWith(base)) return p.slice(base.length);
        }
        return p;
      };
      if (options.length <= 1) return asWritten(options[0]);
      // the most folder names in common with the old path, counted from the file upwards
      const score = (c: string) => {
        const cp = c.split("/");
        let n = 0;
        while (n < cp.length && n < parts.length && cp[cp.length - 1 - n] === parts[parts.length - 1 - n])
          n++;
        return n;
      };
      const best = Math.max(...options.map(score));
      const top = options.filter((c) => score(c) === best);
      return top.length === 1 ? asWritten(top[0]) : undefined;
    },
  };
}

/**
 * The workspace-relative places a path named in a doc may point to: from the top of the workspace, then from the
 * doc's folder and every folder above it. A sub-project's doc saying `src/x.js` means its own `src/` even when the
 * folder opened in VS Code is a parent (seen in hand testing: a false "not in the repository").
 */
export function pathCandidates(docDir: string, named: string): string[] {
  // posixNormalize already drops `./` segments; a leading dot of a name (`.github`) must stay
  const norm = (p: string) => posixNormalize(p.replace(/\\/g, "/")).replace(/\/$/, "");
  const out = [norm(named)];
  const parts = docDir.replace(/\\/g, "/").split("/").filter(Boolean);
  for (let n = parts.length; n > 0; n--) {
    const candidate = norm(`${parts.slice(0, n).join("/")}/${named.replace(/\\/g, "/")}`);
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/** `a/b/../c/./d` → `a/c/d` (no `node:path`: core stays runtime-free). */
function posixNormalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/") + (p.endsWith("/") ? "/" : "");
}

export interface Mismatch {
  readonly claim: Claim;
  /** Plain sentence for the hover: what the doc says and what the repo has. */
  readonly reason: string;
}

const RUNNER_GROUP: Record<string, string> = {
  npm: "npm",
  pnpm: "npm",
  yarn: "npm",
  bun: "npm",
  make: "make",
  just: "just",
};

export function mismatches(claims: readonly Claim[], repo: RepoFacts): Mismatch[] {
  const out: Mismatch[] = [];
  for (const c of claims) {
    switch (c.kind) {
      case "path":
        if (!isUnchecked(c.value) && !repo.hasPath(c.value))
          out.push({ claim: c, reason: `mentions \`${c.value}\`, which is not in the repository` });
        break;
      case "command": {
        const group = RUNNER_GROUP[c.detail ?? ""] ?? "";
        const known = repo.scripts?.get(group);
        if (known && !known.has(c.value))
          out.push({
            claim: c,
            reason: `says \`${c.detail} ${group === "npm" ? "run " : ""}${c.value}\`, but there is no "${c.value}" ${group === "npm" ? "script in package.json" : `target in the ${group === "make" ? "Makefile" : "justfile"}`}`,
          });
        break;
      }
      case "symbol":
        if (
          repo.symbols &&
          c.value.length > 2 &&
          !repo.symbols.has(c.value) &&
          !repo.identifiers?.has(c.value)
        )
          out.push({
            claim: c,
            reason: `mentions \`${c.value}\`, which is not defined anywhere in the code`,
          });
        break;
      case "env":
        if (repo.envVars && !repo.envVars.has(c.value) && !repo.identifiers?.has(c.value))
          out.push({ claim: c, reason: `mentions \`${c.value}\`, which the code and .env files never use` });
        break;
      case "version": {
        const actual = repo.versions?.get(c.value);
        const major = (v: string) => /(\d+)/.exec(v)?.[1];
        if (actual && major(actual) && major(actual) !== major(c.detail ?? ""))
          out.push({ claim: c, reason: `says ${c.value} ${c.detail}, but the project uses ${actual}` });
        break;
      }
    }
  }
  return out;
}
