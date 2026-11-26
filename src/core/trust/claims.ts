/**
 * Checkable claims in a paragraph of Markdown (3.0 trust markers) — the concrete things a doc can state about a repo
 * and be wrong about: file paths, functions / classes, commands, environment variables, package versions. Pure; only
 * text inside `code` spans counts for paths, symbols, commands and env vars (prose is too ambiguous).
 */
export type ClaimKind = "path" | "symbol" | "command" | "env" | "version";

export interface Claim {
  readonly kind: ClaimKind;
  /** What to look for: the path, the name, the script / target, the variable, or the package. */
  readonly value: string;
  /** For commands: the runner (npm, pnpm, yarn, bun, make, just). For versions: the version stated. */
  readonly detail?: string;
}

const CODE = /`([^`\n]{1,200})`/g;
const PATH =
  /^(?:\.{1,2}\/)?[\w@.-]+(?:\/[\w@.-]+)+\.[A-Za-z0-9]{1,8}$|^(?:\.{1,2}\/)?[\w@.-]+(?:\/[\w@.-]+){1,}\/$/;
/** A `code` span that reads as a file or folder path (`src/cart.js`, `docs/plans/`). */
export const PATH_PATTERN: RegExp = PATH;
const SYMBOL = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)$/; // `createOrder()`, `Orders.markPaid()`
const CLASSNAME = /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+$/; // `PaymentConsumer`
const COMMAND = /^(npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)|^(make|just)\s+([\w:.-]+)/;
const ENV = /^\$?\{?([A-Z][A-Z0-9]*_[A-Z0-9_]+)\}?$/;
const BUILTIN_SCRIPTS = new Set([
  "install",
  "i",
  "ci",
  "test",
  "start",
  "add",
  "remove",
  "publish",
  "init",
  "exec",
  "dlx",
  "x",
  "create",
  "update",
  "outdated",
  "audit",
  "link",
  "pack",
  "version",
]);
/** "Node 22", "React 18.2", "TypeScript 5.4" — a known package name followed by a version. */
const VERSION =
  /\b(Node(?:\.js)?|React|Vue|Angular|Svelte|TypeScript|Next\.js|Vite|Python|Django|Flask|FastAPI|Rails|Go|Rust|Java|Spring Boot|\.NET|Postgres(?:QL)?|MySQL|Redis|Kafka)\s+v?(\d+(?:\.\d+){0,2})\b/g;
const VERSION_PACKAGE: Record<string, string> = {
  node: "node",
  "node.js": "node",
  react: "react",
  vue: "vue",
  angular: "@angular/core",
  svelte: "svelte",
  typescript: "typescript",
  "next.js": "next",
  vite: "vite",
};

export function claimsIn(text: string): Claim[] {
  const out: Claim[] = [];
  const seen = new Set<string>();
  const add = (c: Claim) => {
    const key = `${c.kind}:${c.value}:${c.detail ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };
  for (const m of text.matchAll(CODE)) {
    const code = (m[1] ?? "").trim();
    if (/^https?:|^[a-z]+:\/\//i.test(code)) continue;
    if (/^(?:npm|pnpm|yarn|bun)\s+run\s*$/.test(code)) continue; // a bare `npm run`: names no script
    const cmd = COMMAND.exec(code);
    if (cmd) {
      const runner = cmd[1] ?? cmd[3] ?? "";
      const name = cmd[2] ?? cmd[4] ?? "";
      // npm runs a package.json script only through `npm run` (`npm view`, `npm ls` are npm's own commands)
      const npmOwn = runner === "npm" && !/^npm\s+run\s/.test(code);
      if (!npmOwn && !BUILTIN_SCRIPTS.has(name)) add({ kind: "command", value: name, detail: runner });
      continue;
    }
    if (PATH.test(code)) add({ kind: "path", value: code.replace(/^\.\//, "") });
    else if (SYMBOL.test(code))
      add({ kind: "symbol", value: (SYMBOL.exec(code)?.[1] ?? "").split(".").pop() ?? "" });
    else if (CLASSNAME.test(code)) add({ kind: "symbol", value: code });
    else if (ENV.test(code)) add({ kind: "env", value: ENV.exec(code)?.[1] ?? "" });
  }
  for (const m of text.matchAll(VERSION)) {
    const pkg = VERSION_PACKAGE[(m[1] ?? "").toLowerCase()];
    const year = /^(19|20)\d\d$/.test(m[2] ?? ""); // "TypeScript 2026 comparison": a year, not a version
    if (pkg && !year) add({ kind: "version", value: pkg, detail: m[2] ?? "" });
  }
  return out;
}
