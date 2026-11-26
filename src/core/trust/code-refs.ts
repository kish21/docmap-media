import type { RepoFacts } from "./check";
import { PATH_PATTERN } from "./claims";

/**
 * Clickable code names in the preview (2026-11-22 review): a `code` span naming a file of the project (optionally
 * `:line`), a function (`addItem()`) or a class (`PaymentConsumer`) the code defines opens it beside the doc. Only
 * names that exist are offered — the page never guesses. Pure.
 */

const CODE = /`([^`\n]{1,200})`/g;
const SYMBOL = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(\)$/;
const CLASSNAME = /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+$/;

export interface CodeRef {
  readonly path?: string;
  /** 1-based, as written after the path (`src/cart.js:12`). */
  readonly line?: number;
  readonly symbol?: string;
}

/** What a code span points to, by its shape alone (undefined: not a file, function or class name). */
export function parseCodeRef(text: string): CodeRef | undefined {
  const t = text.trim();
  const at = /^(.*\S):(\d{1,7})$/.exec(t);
  if (at && PATH_PATTERN.test(at[1] ?? "")) return { path: at[1] ?? "", line: Number(at[2]) };
  if (PATH_PATTERN.test(t)) return { path: t };
  const call = SYMBOL.exec(t);
  if (call) return { symbol: (call[1] ?? "").split(".").pop() ?? "" };
  if (CLASSNAME.test(t)) return { symbol: t };
  return undefined;
}

/** The code spans of `text` (as written, in order, once each) that name something the project has. */
export function codeRefs(text: string, repo: Pick<RepoFacts, "hasPath" | "symbols">): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CODE)) {
    const raw = (m[1] ?? "").trim();
    if (out.includes(raw)) continue;
    const ref = parseCodeRef(raw);
    if (!ref) continue;
    if (ref.path ? repo.hasPath(ref.path) : ref.symbol && repo.symbols?.has(ref.symbol)) out.push(raw);
  }
  return out;
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The 0-based line of `text` where `name` is defined (function, class, def, const … = function / arrow, a method),
 * when VS Code's language support cannot say. Undefined: not defined in this text.
 */
export function declarationLine(text: string, name: string): number | undefined {
  const n = literal(name);
  const re = new RegExp(
    `\\b(?:function\\*?|class|interface|type|enum|def|func|fn|struct|trait|module)\\s+${n}\\b|\\b(?:const|let|var)\\s+${n}\\s*=\\s*(?:async\\s*)?(?:\\(|function|\\w+\\s*=>)|^\\s*(?:public|private|protected|static|async|\\s)*${n}\\s*\\([^)]*\\)\\s*(?::\\s*[\\w<>[\\], |.]+)?\\s*\\{`,
    "m",
  );
  const m = re.exec(text);
  return m
    ? text.slice(0, m.index + (m[0].length - m[0].trimStart().length)).split("\n").length - 1
    : undefined;
}

/**
 * One-click fix for a moved file: `line` with every `old` (or `old:N`) inside backticks changed to `next`.
 * Undefined when the line has none (prose mentions are left alone).
 */
export function replaceCodePath(line: string, old: string, next: string): string | undefined {
  const re = new RegExp(`\`${literal(old)}(:\\d+)?\``, "g");
  const out = line.replace(re, (_m, at: string | undefined) => `\`${next}${at ?? ""}\``);
  return out === line ? undefined : out;
}
