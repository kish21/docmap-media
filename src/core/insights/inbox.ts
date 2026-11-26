import type { DocFacts } from "./analyze";
import type { DocKind } from "./formats";
import { kindFromPath } from "./standards";

/**
 * The Docs Inbox rules (2.0): which Markdown files need the reader, which are probably out of date, which are worth
 * reading first. Pure: the extension gathers the facts (text, dates, what exists on disk), these decide.
 */

export interface InboxFile {
  readonly id: string;
  readonly facts: DocFacts;
  /** Last change on disk (ms since epoch). */
  readonly modified: number;
  /** Hash of the text now, and when the reader last read it (undefined: never read). */
  readonly hash: number;
  readonly readHash?: number;
  /** Paths the doc names (`codePaths`, `mdLinks`) that do not exist. */
  readonly missing: readonly string[];
  /** How many other docs link to this one. */
  readonly inbound: number;
  /** Agent instruction file (AGENTS.md, CLAUDE.md, copilot-instructions.md, .cursor rules). */
  readonly instructions: boolean;
}

export type ReadState = "new" | "changed" | "read";

export function readState(file: InboxFile): ReadState {
  if (file.readHash === undefined) return "new";
  return file.readHash === file.hash ? "read" : "changed";
}

/**
 * #43: whether the inbox lists a file under "New": never opened, changed within `newDays`, and changed after
 * `baseline` (when docmap first read this project) — so on install the files already there count as known, and a
 * project's 60 old tool or archive files never flood the group.
 */
export function isNewDoc(file: InboxFile, now: number, newDays: number, baseline?: number): boolean {
  if (readState(file) !== "new") return false;
  if (baseline !== undefined && file.modified <= baseline) return false;
  return now - file.modified <= newDays * 86_400_000;
}

/** #43: the first `max` items of a group, and how many are left for its "Show all" row. */
export function firstOf<T>(items: readonly T[], max: number): { shown: T[]; hidden: number } {
  if (max <= 0 || items.length <= max) return { shown: [...items], hidden: 0 };
  return { shown: items.slice(0, max), hidden: items.length - max };
}

/** Why a file is probably out of date — empty when it is not. */
export function staleReasons(file: InboxFile, now: number, staleDays: number): string[] {
  const reasons: string[] = [];
  const days = Math.floor((now - file.modified) / 86_400_000);
  if (staleDays > 0 && days >= staleDays) reasons.push(`not changed in ${days} days`);
  if (file.facts.tasksDone > 0 && file.facts.tasksOpen === 0) reasons.push("every task is done");
  if (file.missing.length > 0)
    reasons.push(
      `mentions ${file.missing.length} missing file${file.missing.length === 1 ? "" : "s"} (${file.missing.slice(0, 2).join(", ")}${file.missing.length > 2 ? ", …" : ""})`,
    );
  return reasons;
}

/** Higher = read it sooner: open tasks, decisions, warnings, docs pointing at it, a summary to start from. */
export function worthScore(file: InboxFile): number {
  const f = file.facts;
  return (
    Math.min(f.tasksOpen, 20) * 2 +
    Math.min(f.decisions.length, 10) * 3 +
    Math.min(f.warnings, 10) * 2 +
    Math.min(file.inbound, 10) * 2 +
    (f.tldr ? 1 : 0)
  );
}

/** The one-line description the inbox shows beside a file. */
export function describe(file: InboxFile, now: number): string {
  const f = file.facts;
  const parts: string[] = [];
  if (f.tasksOpen + f.tasksDone > 0) parts.push(`${f.tasksDone}/${f.tasksOpen + f.tasksDone} done`);
  if (f.decisions.length > 0)
    parts.push(`${f.decisions.length} decision${f.decisions.length === 1 ? "" : "s"}`);
  if (f.warnings > 0) parts.push(`${f.warnings} warning${f.warnings === 1 ? "" : "s"}`);
  parts.push(`${Math.max(1, Math.round(f.words / 230))} min`);
  parts.push(age(now - file.modified));
  return parts.join(" · ");
}

export function age(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} month${months === 1 ? "" : "s"} ago` : `${Math.floor(days / 365)}y ago`;
}

const INSTRUCTION_NAMES =
  /(?:^|\/)(?:agents\.md|claude\.md|gemini\.md|copilot-instructions\.md|\.cursorrules|[^/]+\.mdc)$/i;
/** Whether a workspace-relative path is an agent instruction file. */
export function isInstructionFile(path: string): boolean {
  return (
    INSTRUCTION_NAMES.test(path) ||
    /(?:^|\/)\.cursor\/rules\//i.test(path) ||
    /(?:^|\/)\.github\/instructions\//i.test(path)
  );
}

/**
 * Folders whose Markdown is not the user's docs: dependencies, build output, and tool copies — VS Code's test
 * install (`.vscode-test`, which holds docmap's own saved copies) and agent worktrees (`.claude/worktrees`, whole
 * copies of the project). Owner report 2026-11-18: these filled the Docs Inbox with duplicates.
 */
const SKIPPED =
  /(?:^|[\\/])(?:node_modules|\.git|\.venv|venv|dist|out|build|target|vendor|\.vscode-test|\.claude[\\/]worktrees)[\\/]/;
/** Whether a path (workspace-relative or absolute, either slash) lies in a folder docmap's doc lists skip. */
export function isSkippedPath(path: string): boolean {
  return SKIPPED.test(path);
}

/** Folder names that mean "kept for the record, not current" (docmap's own "Move to archive" uses `archive`). */
const ARCHIVE_FOLDER = /^_?(?:archive|archived|old)$/i;

/**
 * Whether a doc lies in an archive folder (`archive/`, `docs/_archive/`, `old/` at any depth). The Docs Inbox lists
 * these in their own "Archived" group and keeps them out of New, Worth reading, Plans, Out of date and Doubtful, so
 * old docs no longer mix with current ones (owner report 2026-11-23: a project with 47 archived docs).
 */
export function isArchivedPath(relPath: string): boolean {
  return relPath
    .replace(/\\/g, "/")
    .split("/")
    .slice(0, -1)
    .some((folder) => ARCHIVE_FOLDER.test(folder));
}

/** Which folders docmap's doc lists leave out besides the built-in ones (settings `docmap.skipFolders` / `includeFolders`). */
export interface FolderRules {
  /** Extra folders to leave out: a folder name (`archive`) or a path from the project root (`docs/old`). */
  readonly skip: readonly string[];
  /** Dot-folders to keep after all (`.github`), same forms. */
  readonly include: readonly string[];
}

function folderMatches(folders: readonly string[], entry: string): boolean {
  const e = entry.replace(/\\/g, "/").replace(/^\.?\/+|\/+$/g, "");
  if (!e) return false;
  if (!e.includes("/")) return folders.includes(e);
  const path = folders.join("/");
  return path === e || path.startsWith(`${e}/`);
}

/**
 * #44: whether docmap leaves a file out of every view (inbox, search, dashboard, trust, "Mentioned in N docs").
 * `relPath` is relative to the project root — a dot-folder ABOVE the project must not hide the whole project.
 * Tool folders (any folder whose name starts with a dot: `.factory`, `.agents`, `.claude`) are left out unless
 * included; so are the built-in dependency/build folders and the folders in `rules.skip`.
 */
export function isLeftOut(relPath: string, rules: FolderRules): boolean {
  const p = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (isSkippedPath(p)) return true;
  const folders = p.split("/").slice(0, -1);
  if (folders.length === 0) return false;
  if (rules.skip.some((e) => folderMatches(folders, e))) return true;
  const dotIndex = folders.findIndex((f) => f.startsWith(".") && f !== "." && f !== "..");
  if (dotIndex === -1) return false;
  return !rules.include.some(
    (e) => folderMatches(folders.slice(0, dotIndex + 1), e) || folderMatches(folders, e),
  );
}

const DESIGN_KINDS: readonly DocKind[] = ["design", "architecture", "design-system"];

/**
 * #45 quiet first run: the one line at the top of the Docs Inbox — what docmap found, and the one thing to do.
 * Replaces the pop-ups a new user met at once. `paths` are the listed docs (relative), `plans` how many read as plans.
 */
export function inboxSummary(paths: readonly string[], plans: number): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  if (paths.length === 0) return "No Markdown docs found yet.";
  const design = paths.filter((p) => {
    const kind = kindFromPath(p);
    return kind !== undefined && DESIGN_KINDS.includes(kind);
  }).length;
  const parts = [n(paths.length, "doc", "docs")];
  if (plans > 0) parts.push(n(plans, "plan", "plans"));
  if (design > 0) parts.push(n(design, "design doc", "design docs"));
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `Found ${list}. Click a doc to read it.`;
}
