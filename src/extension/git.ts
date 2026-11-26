import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { INTERNAL_LIMITS, INTERNAL_TIMINGS } from "../core/config/config";
import { changedPaths } from "../core/insights/commit-hint";
import { mainBranch } from "../core/insights/main-branch";
import { mapLimit } from "./concurrency";

/**
 * Read-only git questions for trust markers (3.0): when each line of a doc was last changed, and when a file was last
 * committed. Uses the user's own `git`; nothing is written. Unavailable (no git, not a repository, untrusted
 * folder, remote file) → undefined, and the "may be stale" marker is simply not shown.
 */
function git(cwd: string, args: string[]): Promise<string | undefined> {
  if (!vscode.workspace.isTrusted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: INTERNAL_TIMINGS.gitTimeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => resolve(error ? undefined : stdout),
    );
  });
}

/** Per 0-based line: when it was last changed (ms). Uncommitted lines count as now. */
export async function lineTimes(file: vscode.Uri): Promise<number[] | undefined> {
  if (file.scheme !== "file") return undefined;
  const out = await git(path.dirname(file.fsPath), [
    "blame",
    "--line-porcelain",
    "--",
    path.basename(file.fsPath),
  ]);
  if (!out) return undefined;
  const times: number[] = [];
  let current = Date.now();
  for (const line of out.split("\n")) {
    if (line.startsWith("author-time ")) current = Number(line.slice(12)) * 1000;
    else if (line.startsWith("\t")) times.push(current);
    else if (/^0{40} /.test(line)) current = Date.now();
  }
  return times;
}

const lastCommitCache = new Map<string, { at: number; value: number | undefined }>();

/** When a workspace-relative path was last committed (ms), cached for a minute. */
export async function lastChanged(root: string, rel: string): Promise<number | undefined> {
  const key = `${root}\n${rel}`;
  const hit = lastCommitCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const out = await git(root, ["log", "-1", "--format=%ct", "--", rel]);
  const value = out?.trim() ? Number(out.trim()) * 1000 : undefined;
  lastCommitCache.set(key, { at: Date.now(), value });
  return value;
}

/** 3.0 Plans dashboard: who made the last commit to a workspace-relative path; undefined without git. */
export async function lastAuthor(root: string, rel: string): Promise<string | undefined> {
  const out = await git(root, ["log", "-1", "--format=%an", "--", rel]);
  return out?.trim() || undefined;
}

/** 3.0 redline: a git version of a file ("HEAD", a commit, a tag); undefined when it did not exist there. */
export async function fileAt(file: vscode.Uri, rev: string): Promise<string | undefined> {
  if (file.scheme !== "file" || !/^[\w./~^-]+$/.test(rev) || rev.startsWith("-")) return undefined;
  return git(path.dirname(file.fsPath), ["show", `${rev}:./${path.basename(file.fsPath)}`]);
}

export interface FileVersion {
  readonly rev: string;
  /** Commit time (ms). */
  readonly at: number;
  readonly subject: string;
}

/** The commits that changed a file, newest first. */
export async function fileCommits(file: vscode.Uri, max: number): Promise<FileVersion[]> {
  if (file.scheme !== "file") return [];
  const out = await git(path.dirname(file.fsPath), [
    "log",
    `-n${max}`,
    "--format=%h%x09%ct%x09%s",
    "--",
    path.basename(file.fsPath),
  ]);
  return (out ?? "")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [rev = "", ct = "0", ...subject] = l.split("\t");
      return { rev, at: Number(ct) * 1000, subject: subject.join("\t") };
    });
}

/** The newest commit at or before a time (for "a week ago"), if any. */
export async function commitBefore(file: vscode.Uri, at: number): Promise<string | undefined> {
  if (file.scheme !== "file") return undefined;
  const out = await git(path.dirname(file.fsPath), [
    "rev-list",
    "-1",
    `--before=${Math.floor(at / 1000)}`,
    "HEAD",
  ]);
  return out?.trim() || undefined;
}

/** Tags, newest first. */
export async function tags(file: vscode.Uri, max: number): Promise<string[]> {
  if (file.scheme !== "file") return [];
  const out = await git(path.dirname(file.fsPath), [
    "tag",
    "--sort=-creatordate",
    "--format=%(refname:short)",
  ]);
  return (out ?? "").split("\n").filter(Boolean).slice(0, max);
}

/** The repository's main branch ("origin/main", "master"…), if one can be told (see `core/insights/main-branch`). */
export async function mainBranchOf(file: vscode.Uri): Promise<string | undefined> {
  if (file.scheme !== "file") return undefined;
  const cwd = path.dirname(file.fsPath);
  const [head, branches] = await Promise.all([
    git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]),
    git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]),
  ]);
  return mainBranch(head, branches);
}

/** git's user.name for a folder (sign-off and My Items fall back to it). */
export async function gitUserName(cwd: string): Promise<string | undefined> {
  return (await git(cwd, ["config", "user.name"]))?.trim() || undefined;
}

/**
 * #46: the uncommitted files in `folder`'s repository and in every project with its own git one folder down (a
 * parent folder opened in VS Code, as in hand testing: git asked only at the top saw nothing, or one folder).
 */
export async function uncommittedFilesHere(folder: string): Promise<string[]> {
  let nested: string[] = [];
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const subs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules",
    );
    const hasGit = await mapLimit(subs, INTERNAL_LIMITS.ioConcurrency, (e) =>
      fs.stat(path.join(folder, e.name, ".git")).then(
        () => true,
        () => false,
      ),
    );
    nested = subs.filter((_, i) => hasGit[i]).map((e) => path.join(folder, e.name));
  } catch {
    // an unreadable folder: only the top is asked
  }
  const lists = await mapLimit([folder, ...nested], INTERNAL_LIMITS.ioConcurrency, (f) =>
    uncommittedFiles(f),
  );
  return [...new Set(lists.flatMap((l) => l ?? []))];
}

/** #46: absolute paths of the files with uncommitted changes in the repository holding `folder` (undefined without git). */
export async function uncommittedFiles(folder: string): Promise<string[] | undefined> {
  const [top, status] = await Promise.all([
    git(folder, ["rev-parse", "--show-toplevel"]),
    git(folder, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  if (top === undefined || status === undefined) return undefined;
  // through Uri: the same drive-letter case as the rest of VS Code ("c:" — git says "C:")
  return changedPaths(status).map((p) => vscode.Uri.file(path.resolve(top.trim(), p)).fsPath);
}
