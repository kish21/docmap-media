import * as path from "node:path";
import * as vscode from "vscode";
import { buildPrompt, docFacts, type PromptId } from "../core/agent/prompts";
import { INTERNAL_LIMITS, INTERNAL_TIMINGS } from "../core/config/config";
import { analyze, type DocFacts, openTasks } from "../core/insights/analyze";
import { type AtlasGraph, type AtlasInput, atlasGraph } from "../core/insights/atlas-graph";
import {
  codeItemsFromSpans,
  codeSpans,
  featurePageMarkdown,
  firstSentence,
  isFeatureDoc,
} from "../core/insights/feature-atlas";
import { type HomeDoc, handoverNext, hardToRead, homeMarkdown } from "../core/insights/home";
import {
  describe as describeFile,
  firstOf,
  type InboxFile,
  inboxSummary,
  isArchivedPath,
  isInstructionFile,
  isNewDoc,
  readState,
  staleReasons,
  worthScore,
} from "../core/insights/inbox";
import {
  type DocItem,
  docItems,
  type FileItems,
  myItemsReport,
  pathMentions,
  questionsReport,
} from "../core/insights/items";
import { dashboardCsv, docRow, type PlanRow, type PlanSort, SORT_LABELS } from "../core/insights/plans";
import { dashboardMarkdown } from "../core/insights/plans-dashboard";
import { readingOrder, readingOrderMarkdown } from "../core/insights/reading-order";
import {
  type DuplicateGroup,
  duplicateGroups,
  fnv1a,
  type Signature,
  signature,
} from "../core/insights/similarity";
import { kindFromPath } from "../core/insights/standards";
import { isUnchecked, mismatches, pathCandidates } from "../core/trust/check";
import { type Claim, claimsIn } from "../core/trust/claims";
import { conflictsWith, type FactsOfDoc, type KeyFact, keyFacts, relatedTo } from "../core/trust/conflicts";
import { deliverPrompt, pickAndDeliver, relativePath } from "./agent";
import { mapLimit } from "./concurrency";
import { codeItems } from "./feature-code";
import { gitUserName, lastAuthors } from "./git";
import { createPathChecker, isCodeFile } from "./links";
import { log } from "./log";
import type { NotesStore } from "./notes";
import { repoFactsFor } from "./repo-facts";
import { writeReport } from "./reports";
import { leftOut, readConfig } from "./settings";

/**
 * The Docs Inbox (2.0): every Markdown file in the workspace, sorted into what needs the reader — changed since they
 * read it, never opened, worth reading first, plans in progress, possible duplicates, probably out of date, agent
 * instruction files — plus a decision log. Everything is computed on this computer from the files themselves.
 */

const GLOB = "**/*.{md,markdown,mdc}";
/** #43: workspace-state key for when docmap first read this project (ms since epoch). */
const BASELINE_KEY = "docmap.inboxBaseline";
/** 3.3.0: compact workspaceState reload cache key (metadata only, never raw file text, bounded by entries + bytes). */
const CACHE_KEY = "docmap.inboxCache.v1";
const CACHE_VERSION = 1;

interface PersistedScanEntry {
  readonly key: string;
  readonly fsPath: string;
  readonly rel: string;
  readonly scan: CachedFileScan;
}

interface PersistedInboxCache {
  readonly v: number;
  readonly staleDays: number;
  readonly entries: readonly PersistedScanEntry[];
}

/** #53: minimal facts used for oversized / over-budget files skipped from deep scanning. */
const EMPTY_FACTS: DocFacts = {
  words: 0,
  tasksOpen: 0,
  tasksDone: 0,
  decisions: [],
  warnings: 0,
  codePaths: [],
  mdLinks: [],
};

/** #53: yield control back to the extension host event loop between files. */
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** #53: compact per-file scan result cached by (mtime, size, staleDays). Never stores raw file text. */
interface CachedFileScan {
  readonly mtime: number;
  readonly size: number;
  readonly staleDays: number;
  readonly facts: DocFacts;
  readonly hash: number;
  readonly signature: Signature | undefined;
  readonly keyFacts: readonly KeyFact[];
  readonly items: readonly DocItem[];
  readonly paths: readonly { readonly path: string; readonly line: number }[];
  readonly claims: readonly Claim[];
  readonly plan?: PlanRow;
  readonly docRow?: PlanRow;
  /** #55 Precomputed `hardToRead(text)` reason so `home()` needs no full-workspace re-reads. */
  readonly hardToRead?: string;
  /** #55 Pre-extracted code spans so `atlasGraph()` needs no full-workspace re-reads. */
  readonly codeSpans: readonly string[];
  readonly skippedLarge?: boolean;
}

interface Scanned extends InboxFile {
  readonly uri: vscode.Uri;
  readonly rel: string;
  /** 3.0: "key: value" facts (for conflicts between docs) and doubts found (don't match the code / conflict). */
  readonly keyFacts: readonly KeyFact[];
  /** The workspace docs this one links to (relative paths) — only related docs are compared for conflicts. */
  readonly links: readonly string[];
  readonly doubts?: { readonly mismatches: number; readonly conflicts: number };
  /** 3.0 Plans dashboard: the file's row, when it reads as a plan. */
  readonly plan?: PlanRow;
  /** 3.3.0: the file's status row for every Markdown doc in the workspace. */
  readonly docRow?: PlanRow;
  /** 3.0: open tasks and questions (Open Questions, My Items), and the repository files the doc names. */
  readonly items: readonly DocItem[];
  readonly paths: readonly { readonly path: string; readonly line: number }[];
  /** #55 Cached `hardToRead(text)` reason and code spans from `doScan()`. */
  readonly hardToRead?: string;
  readonly codeSpans: readonly string[];
}

/** 3.0 docs ↔ code: a doc line that names a file. */
export interface Mention {
  readonly doc: vscode.Uri;
  readonly rel: string;
  readonly title: string;
  readonly line: number;
}

type GroupKind =
  | "changed"
  | "new"
  | "worth"
  | "plans"
  | "duplicates"
  | "stale"
  | "instructions"
  | "decisions"
  | "doubtful"
  | "archived";

type Node =
  | {
      kind: "group";
      group: GroupKind;
      label: string;
      icon: string;
      files: Scanned[];
      dupes?: DuplicateGroup[];
    }
  | { kind: "dupe"; group: DuplicateGroup; files: Scanned[] }
  | { kind: "file"; file: Scanned; in: GroupKind; detail?: string; dupeOf?: Scanned }
  | { kind: "action"; label: string; command: vscode.Command; icon: string };

export class DocsInbox implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private files: Scanned[] = [];
  private dupes: DuplicateGroup[] = [];
  private scanning: Promise<void> | undefined;
  /** 3.3.0: monotonic counter so a stale background enrichment pass never overwrites a newer scan. */
  private scanGen = 0;
  private stale = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  view: vscode.TreeView<Node> | undefined;
  /** #43: groups the reader asked to see in full ("Show all"), for this window. */
  private readonly showAll = new Set<GroupKind>();
  /** #53: per-file scan cache keyed by uri string, validated by (mtime, size, staleDays). */
  private readonly scanCache = new Map<string, CachedFileScan>();
  /** 3.3.0: true when initial state was hydrated from workspaceState and needs one background refresh. */
  private hydratedFromCache = false;

  /** `memory` (workspace state) keeps when docmap first read this project: files older than that are not "New". */
  constructor(
    private readonly notes: NotesStore,
    private readonly memory?: vscode.Memento,
  ) {
    this.hydrateFromCache();
    const watcher = vscode.workspace.createFileSystemWatcher(GLOB);
    const later = () => {
      clearTimeout(this.timer);
      // a closed inbox does not read the workspace after every save: it is marked stale and reads when opened
      if (!this.view?.visible) {
        this.stale = true;
        return;
      }
      this.timer = setTimeout(() => void this.scan(), INTERNAL_TIMINGS.inboxRescanMs);
    };
    this.disposables.push(
      watcher,
      watcher.onDidChange(later),
      watcher.onDidCreate(later),
      watcher.onDidDelete(later),
    );
    notes.onChange(() => this.redraw());
  }

  /** The view was shown: read the workspace if files changed while it was closed. */
  shown(): void {
    if (this.stale) void this.scan();
  }

  dispose(): void {
    this.scanGen++;
    this.scannedEvents.dispose();
    clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
    this.changed.dispose();
  }

  /** Fast path: reuse already-scanned files when fresh; scan only on first open or after file changes. */
  private async ensureScanned(): Promise<void> {
    if (this.hydratedFromCache && this.files.length > 0) {
      this.hydratedFromCache = false;
      void this.scan();
      return;
    }
    if (this.files.length === 0 || this.stale) await this.scan();
  }

  /** 3.3.0: drops the persisted workspaceState reload cache (called by Clear Saved Data). */
  async clearCache(): Promise<void> {
    this.scanCache.clear();
    this.hydratedFromCache = false;
    await this.memory?.update(CACHE_KEY, undefined);
  }

  /** 3.3.0: hydrates scanCache and UI state synchronously from workspaceState so reload paints immediately. */
  private hydrateFromCache(): void {
    const saved = this.memory?.get<PersistedInboxCache>(CACHE_KEY);
    if (!saved || saved.v !== CACHE_VERSION || !Array.isArray(saved.entries) || saved.entries.length === 0)
      return;
    if (saved.staleDays !== readConfig().staleDays) return;
    const entries: { uri: vscode.Uri; rel: string; normPath: string; scan: CachedFileScan }[] = [];
    for (const item of saved.entries.slice(0, INTERNAL_LIMITS.inboxCacheMaxEntries)) {
      if (!item || typeof item.key !== "string" || typeof item.fsPath !== "string" || !item.scan) continue;
      const uri = vscode.Uri.file(item.fsPath);
      this.scanCache.set(item.key, item.scan);
      entries.push({ uri, rel: item.rel, normPath: path.normalize(item.fsPath), scan: item.scan });
    }
    if (entries.length === 0) return;
    this.applyEntries(entries);
    this.hydratedFromCache = true;
    this.stale = true;
  }

  /** 3.3.0: persists compact scan metadata to workspaceState within strict entry and byte caps. */
  private persistCache(
    entries: readonly { uri: vscode.Uri; rel: string; scan: CachedFileScan }[],
    staleDays: number,
  ): void {
    if (!this.memory) return;
    const sorted = [...entries]
      .filter((e) => e.uri.scheme === "file")
      .sort((a, b) => b.scan.mtime - a.scan.mtime)
      .slice(0, INTERNAL_LIMITS.inboxCacheMaxEntries);
    const kept: PersistedScanEntry[] = [];
    let bytes = 64;
    for (const e of sorted) {
      const entry: PersistedScanEntry = {
        key: e.uri.toString(),
        fsPath: e.uri.fsPath,
        rel: e.rel,
        scan: e.scan,
      };
      const size = Buffer.byteLength(JSON.stringify(entry), "utf8") + 1;
      if (bytes + size > INTERNAL_LIMITS.inboxCacheMaxBytes) break;
      bytes += size;
      kept.push(entry);
    }
    const payload: PersistedInboxCache = { v: CACHE_VERSION, staleDays, entries: kept };
    void Promise.resolve(this.memory.update(CACHE_KEY, payload)).catch(() => undefined);
  }

  /** Computes in-memory links, mentions, Scanned files, and duplicate groups from scan entries. */
  private applyEntries(
    entries: readonly { uri: vscode.Uri; rel: string; normPath: string; scan: CachedFileScan }[],
  ): void {
    const byPath = new Map(entries.map((e) => [e.normPath, e]));
    const inbound = new Map<string, number>();
    const missingOf = new Map<string, string[]>();
    const linksOf = new Map<string, string[]>();
    for (const e of entries) {
      if (e.uri.scheme !== "file") continue;
      const dir = path.dirname(e.uri.fsPath);
      for (const link of e.scan.facts.mdLinks) {
        const target = path.normalize(path.resolve(dir, link.replace(/#.*$/, "")));
        const targetEntry = byPath.get(target);
        if (targetEntry) {
          inbound.set(target, (inbound.get(target) ?? 0) + 1);
          const links = linksOf.get(e.uri.fsPath) ?? [];
          links.push(targetEntry.rel);
          linksOf.set(e.uri.fsPath, links);
        } else {
          const missing = missingOf.get(e.uri.fsPath) ?? [];
          missing.push(link);
          missingOf.set(e.uri.fsPath, missing);
        }
      }
    }
    this.files = entries.map((e) => {
      const key = e.uri.toString();
      const readHash = this.notes.readHash(key);
      return {
        id: key,
        uri: e.uri,
        rel: e.rel,
        facts: e.scan.facts,
        modified: e.scan.mtime,
        hash: e.scan.hash,
        ...(readHash !== undefined ? { readHash } : {}),
        missing: missingOf.get(e.uri.fsPath) ?? [],
        inbound: inbound.get(e.normPath) ?? 0,
        instructions: isInstructionFile(e.rel),
        keyFacts: e.scan.keyFacts,
        links: linksOf.get(e.uri.fsPath) ?? [],
        items: e.scan.items,
        paths: e.scan.paths,
        codeSpans: e.scan.codeSpans,
        ...(e.scan.hardToRead ? { hardToRead: e.scan.hardToRead } : {}),
        ...(e.scan.docRow ? { docRow: e.scan.docRow } : {}),
        ...(e.scan.plan ? { plan: e.scan.plan } : {}),
      };
    });
    const mentions = new Map<string, Mention[]>();
    for (const f of this.files) {
      if (f.uri.scheme !== "file") continue;
      const dir = path.dirname(f.uri.fsPath);
      const root = vscode.workspace.getWorkspaceFolder(f.uri)?.uri.fsPath ?? dir;
      const docDir = path.relative(root, dir);
      for (const p of f.paths) {
        const at = { doc: f.uri, rel: f.rel, title: f.facts.title ?? path.basename(f.rel), line: p.line };
        const targets = [
          ...pathCandidates(docDir, p.path).map((c) => path.resolve(root, c)),
          path.resolve(dir, p.path),
        ];
        for (const target of new Set(targets)) {
          const key = path.normalize(target);
          const list = mentions.get(key) ?? [];
          if (!list.some((m) => m.doc.toString() === at.doc.toString())) list.push(at);
          mentions.set(key, list);
        }
      }
    }
    this.mentions = mentions;
    this.dupes = duplicateGroups(
      entries.map((e) => ({ id: e.uri.toString(), signature: e.scan.signature })),
      INTERNAL_LIMITS.duplicateSimilarity,
    );
  }

  /** Reads every Markdown file again (on demand, and a moment after files change). */
  scan(): Promise<void> {
    this.scanning ??= this.doScan().finally(() => {
      this.scanning = undefined;
    });
    return this.scanning;
  }

  private async doScan(): Promise<void> {
    const started = Date.now();
    const config = readConfig();
    // files.exclude applies (undefined); dependency, build and tool (dot-)folders are left out everywhere (#44)
    const found = (await vscode.workspace.findFiles(GLOB, undefined, INTERNAL_LIMITS.folderMapFiles)).filter(
      (u) => !leftOut(u, config),
    );
    this.stale = false;
    // #43: the first time docmap reads this project, the files already there count as known (not "New")
    if (this.memory && this.memory.get<number>(BASELINE_KEY) === undefined)
      await this.memory.update(BASELINE_KEY, started);

    // #53: stream one file at a time, cap per-file and total bytes, reuse (mtime, size) cache, and yield between files
    const maxFileBytes = Math.min(config.largeFileBytes, INTERNAL_LIMITS.inboxMaxFileBytes);
    const decoder = new TextDecoder();
    const entries: { uri: vscode.Uri; rel: string; normPath: string; scan: CachedFileScan }[] = [];
    const activeKeys = new Set<string>();
    let bytesScanned = 0;
    let cachedCount = 0;
    let skippedLargeCount = 0;

    for (const uri of found) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        const key = uri.toString();
        const rel = relativePath(uri);
        activeKeys.add(key);

        let scan = this.scanCache.get(key);
        if (
          scan &&
          scan.mtime === stat.mtime &&
          scan.size === stat.size &&
          scan.staleDays === config.staleDays
        ) {
          cachedCount++;
        } else {
          const oversized = stat.size > maxFileBytes;
          const overBudget = !oversized && bytesScanned + stat.size > INTERNAL_LIMITS.inboxTotalScanBytes;
          if (oversized || overBudget) {
            skippedLargeCount++;
            scan = {
              mtime: stat.mtime,
              size: stat.size,
              staleDays: config.staleDays,
              facts: EMPTY_FACTS,
              hash: fnv1a(`${stat.mtime}:${stat.size}`),
              signature: undefined,
              keyFacts: [],
              items: [],
              paths: [],
              claims: [],
              codeSpans: [],
              skippedLarge: true,
            };
            if (oversized) this.scanCache.set(key, scan);
          } else {
            bytesScanned += stat.size;
            const text = decoder.decode(await vscode.workspace.fs.readFile(uri));
            const doc = docRow(text, rel, stat.mtime, started, config.staleDays);
            const hardReason = hardToRead(text);
            scan = {
              mtime: stat.mtime,
              size: stat.size,
              staleDays: config.staleDays,
              facts: analyze(text),
              hash: fnv1a(text),
              signature: signature(text),
              keyFacts: keyFacts(text),
              items: docItems(text),
              paths: pathMentions(text),
              claims: claimsIn(text),
              codeSpans: codeSpans(text),
              ...(hardReason ? { hardToRead: hardReason } : {}),
              docRow: doc,
              ...(doc.isPlan ? { plan: doc } : {}),
            };
            this.scanCache.set(key, scan);
          }
        }
        entries.push({ uri, rel, normPath: path.normalize(uri.fsPath), scan });
      } catch {
        // file disappeared or unreadable
      }
      await yieldToEventLoop();
    }

    for (const key of this.scanCache.keys()) {
      if (!activeKeys.has(key)) this.scanCache.delete(key);
    }

    const gen = ++this.scanGen;
    this.hydratedFromCache = false;
    // Phase 1 (fast): in-memory .md link counts, mentions, and duplicate groups (no disk/repo-code scan yet)
    this.applyEntries(entries);
    this.everScanned = true;
    this.scannedEvents.fire();
    this.persistCache(entries, config.staleDays);
    log().info(
      `docs inbox: ${this.files.length} files (${cachedCount} cached, ${skippedLargeCount} oversized/over-budget skipped), ${this.dupes.length} duplicate groups, ${Date.now() - started} ms`,
    );
    this.redraw();

    // Phase 2 (background): disk code-path checks + repo-wide trust/conflict analysis without blocking first paint
    void this.enrichInBackground(entries, gen).catch((err) => {
      log().warn(`docs inbox background enrichment failed: ${String(err)}`);
    });
  }

  /** Phase 2 background enrichment: checks missing code paths & trust doubts, then redraws if still current. */
  private async enrichInBackground(
    entries: readonly { uri: vscode.Uri; rel: string; normPath: string; scan: CachedFileScan }[],
    gen: number,
  ): Promise<void> {
    if (gen !== this.scanGen) return;
    const extraMissing = new Map<string, string[]>();
    const checkers = new Map<string, (candidate: string) => boolean>();
    for (const e of entries) {
      if (gen !== this.scanGen) return;
      if (e.uri.scheme !== "file") continue;
      const dir = path.dirname(e.uri.fsPath);
      const root = vscode.workspace.getWorkspaceFolder(e.uri)?.uri.fsPath ?? dir;
      let existsInRoot = checkers.get(root);
      if (!existsInRoot) {
        existsInRoot = createPathChecker(root);
        checkers.set(root, existsInRoot);
      }
      const repo = await repoFactsFor(e.uri).catch(() => undefined);
      for (const p of e.scan.facts.codePaths.slice(0, INTERNAL_LIMITS.pathChecksPerFile)) {
        if (gen !== this.scanGen) return;
        const exists =
          isUnchecked(p) ||
          // fast in-memory check first before touching disk
          (repo?.hasPath(p) ?? false) ||
          [
            ...pathCandidates(path.relative(root, dir), p).map((c) => path.resolve(root, c)),
            path.resolve(dir, p),
          ].some(existsInRoot);
        if (!exists) {
          const list = extraMissing.get(e.uri.fsPath) ?? [];
          list.push(p);
          extraMissing.set(e.uri.fsPath, list);
        }
      }
      await yieldToEventLoop();
    }
    if (gen !== this.scanGen) return;

    const allFacts = this.docRefs();
    const withDoubts: Scanned[] = [];
    let changedAny = false;
    for (const [i, f] of this.files.entries()) {
      if (gen !== this.scanGen) return;
      const e = entries[i];
      const addedMissing = extraMissing.get(f.uri.fsPath);
      const missing = addedMissing ? [...new Set([...f.missing, ...addedMissing])] : f.missing;
      const claims = e?.scan.claims ?? [];
      const repo = claims.length > 0 ? await repoFactsFor(f.uri).catch(() => undefined) : undefined;
      const mism = repo ? mismatches(claims, repo).length : 0;
      const me = allFacts[i];
      const conf =
        me && f.keyFacts.length > 0 ? conflictsWith(f.keyFacts, relatedTo(me, allFacts)).length : 0;
      const hasDoubts = mism + conf > 0;
      if (addedMissing || hasDoubts) changedAny = true;
      withDoubts.push({
        ...f,
        missing,
        ...(hasDoubts ? { doubts: { mismatches: mism, conflicts: conf } } : {}),
      });
      if ((i & 15) === 15) await yieldToEventLoop();
    }
    if (gen !== this.scanGen) return;
    if (changedAny) {
      this.files = withDoubts;
      this.redraw();
    }
  }

  /** Read / unread changed (notes): redraw without reading the files again. */
  private redraw(): void {
    this.files = this.files.map((f) => {
      const readHash = this.notes.readHash(f.id);
      const { readHash: _old, ...rest } = f;
      return readHash !== undefined ? { ...rest, readHash } : rest;
    });
    // #45 quiet first run: the badge counts what the New and Changed groups list, not every never-opened file
    const now = Date.now();
    const baseline = this.memory?.get<number>(BASELINE_KEY);
    const unread = this.files.filter(
      (f) =>
        readState(f) === "changed" ||
        (!isArchivedPath(f.rel) && isNewDoc(f, now, INTERNAL_LIMITS.inboxNewDays, baseline)),
    ).length;
    if (this.view) {
      this.view.badge =
        unread > 0
          ? { value: unread, tooltip: `${unread} Markdown files new or changed since you read them` }
          : undefined;
      // #45: one line at the top instead of pop-ups — what was found, and the one thing to do
      this.view.message = inboxSummary(
        this.files.map((f) => f.rel),
        this.files.filter((f) => f.facts.tasksOpen > 0).length,
      );
    }
    this.changed.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case "group": {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.contextValue = `inboxGroup.${node.group}`;
        if (node.group === "changed" || node.group === "new")
          item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        return item;
      }
      case "dupe": {
        const item = new vscode.TreeItem(
          `${node.files.length} files · ${Math.round(node.group.similarity * 100)}% alike`,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.iconPath = new vscode.ThemeIcon("files");
        item.contextValue = "inboxDupe";
        return item;
      }
      case "file": {
        const f = node.file;
        const item = new vscode.TreeItem(path.basename(f.rel), vscode.TreeItemCollapsibleState.None);
        item.description =
          node.detail ??
          `${path.dirname(f.rel) === "." ? "" : `${path.dirname(f.rel)} · `}${describeFile(f, Date.now())}`;
        const tip = new vscode.MarkdownString(undefined, true);
        tip.appendMarkdown(`**${f.facts.title ?? f.rel}**  \n`);
        tip.appendText(f.rel);
        if (f.facts.tldr) tip.appendMarkdown("\n\n").appendText(f.facts.tldr);
        item.tooltip = tip;
        item.resourceUri = f.uri;
        item.contextValue = node.dupeOf ? "inboxFile.dupe" : "inboxFile";
        // #43: one obvious click per group — a duplicate opens the side-by-side compare, an out-of-date doc says why
        // and offers the fix; everything else opens the preview (a changed doc there shows what changed)
        item.command =
          node.in === "duplicates" && node.dupeOf
            ? { command: "docmap.inbox.compare", title: "Compare", arguments: [node] }
            : node.in === "stale"
              ? { command: "docmap.inbox.whyStale", title: "Why out of date", arguments: [node] }
              : { command: "docmap.openMapAt", title: "Open preview", arguments: [f.uri] };
        const state = readState(f);
        item.iconPath = new vscode.ThemeIcon(
          state === "changed" ? "diff-modified" : state === "new" ? "circle-filled" : "markdown",
        );
        return item;
      }
      case "action": {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.command = node.command;
        item.iconPath = new vscode.ThemeIcon(node.icon);
        return item;
      }
    }
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      if (this.hydratedFromCache && this.files.length > 0) {
        this.hydratedFromCache = false;
        void this.scan();
        return this.groups();
      }
      if (this.files.length === 0) await this.scan();
      return this.groups();
    }
    if (node.kind === "group") {
      if (node.group === "duplicates")
        return (node.dupes ?? []).map((g) => ({
          kind: "dupe",
          group: g,
          files: g.ids.flatMap((id) => this.byId(id)),
        }));
      if (node.group === "decisions")
        return [
          {
            kind: "action",
            label: "Open the decision log",
            icon: "list-ordered",
            command: { command: "docmap.decisionLog", title: "Open the decision log" },
          },
        ];
      const now = Date.now();
      const stale = readConfig().staleDays;
      const { shown, hidden } = this.showAll.has(node.group)
        ? { shown: node.files, hidden: 0 }
        : firstOf(node.files, INTERNAL_LIMITS.inboxGroupMax);
      const head: Node[] =
        node.group === "plans"
          ? [
              {
                kind: "action",
                label: "Open the Plans dashboard",
                icon: "checklist",
                command: { command: "docmap.plansDashboard", title: "Open the Plans dashboard" },
              },
            ]
          : [];
      const tail: Node[] =
        hidden > 0
          ? [
              {
                kind: "action",
                label: `Show all ${node.files.length}`,
                icon: "ellipsis",
                command: { command: "docmap.inbox.showAll", title: "Show all", arguments: [node.group] },
              },
            ]
          : [];
      const files: Node[] = shown.map((file) => ({
        kind: "file",
        file,
        in: node.group,
        ...(node.group === "stale" ? { detail: staleReasons(file, now, stale).join(" · ") } : {}),
        ...(node.group === "doubtful" && file.doubts
          ? {
              detail: [
                file.doubts.mismatches ? `${file.doubts.mismatches} don't match the code` : "",
                file.doubts.conflicts ? `${file.doubts.conflicts} conflict with other docs` : "",
              ]
                .filter(Boolean)
                .join(" · "),
            }
          : {}),
      }));
      return [...head, ...files, ...tail];
    }
    if (node.kind === "dupe") {
      // #43: every file in the group opens the compare at once (the first one against the second)
      const files: Node[] = node.files.map((file, i) => {
        const other = i > 0 ? node.files[0] : node.files[1];
        return { kind: "file", file, in: "duplicates", ...(other ? { dupeOf: other } : {}) };
      });
      const ask = (id: PromptId, label: string, icon: string): Node => ({
        kind: "action",
        label,
        icon,
        command: { command: "docmap.inbox.askDupes", title: label, arguments: [node, id] },
      });
      return [
        ...files,
        ask("checkDuplicates", "Are these really duplicates? (ask your AI)", "question"),
        ask("mergeDuplicates", "Merge them into one (ask your AI)", "merge"),
      ];
    }
    return [];
  }

  private byId(id: string): Scanned[] {
    const f = this.files.find((x) => x.id === id);
    return f ? [f] : [];
  }

  private groups(): Node[] {
    const now = Date.now();
    const config = readConfig();
    const byNewest = (a: Scanned, b: Scanned) => b.modified - a.modified;
    const changed = this.files.filter((f) => readState(f) === "changed").sort(byNewest);
    // archived docs: only in their own group (and Changed, when one you read was edited) — never mixed with current ones
    const archived = this.files.filter((f) => isArchivedPath(f.rel)).sort(byNewest);
    const current = this.files.filter((f) => !isArchivedPath(f.rel));
    const baseline = this.memory?.get<number>(BASELINE_KEY);
    const fresh = current
      .filter((f) => isNewDoc(f, now, INTERNAL_LIMITS.inboxNewDays, baseline))
      .sort(byNewest);
    const worth = current
      .filter((f) => worthScore(f) > 0)
      .sort((a, b) => worthScore(b) - worthScore(a))
      .slice(0, INTERNAL_LIMITS.worthReading);
    const plans = current
      .filter((f) => f.facts.tasksOpen > 0)
      .sort((a, b) => b.facts.tasksOpen - a.facts.tasksOpen);
    const stale = current.filter((f) => staleReasons(f, now, config.staleDays).length > 0).sort(byNewest);
    const instructions = this.files.filter((f) => f.instructions);
    const doubtful = current
      .filter((f) => f.doubts)
      .sort(
        (a, b) =>
          (b.doubts?.mismatches ?? 0) +
          (b.doubts?.conflicts ?? 0) -
          (a.doubts?.mismatches ?? 0) -
          (a.doubts?.conflicts ?? 0),
      );
    const decisions = this.files.reduce((n, f) => n + f.facts.decisions.length, 0);
    const out: Node[] = [];
    const add = (group: GroupKind, label: string, icon: string, files: Scanned[], count = files.length) => {
      if (count > 0) out.push({ kind: "group", group, label: `${label} (${count})`, icon, files });
    };
    add("changed", "Changed since you read", "diff-modified", changed);
    add("new", `New — last ${INTERNAL_LIMITS.inboxNewDays} days, not opened`, "circle-filled", fresh);
    add("worth", "Worth reading first", "star-full", worth);
    add("plans", "Plans in progress", "checklist", plans);
    if (this.dupes.length > 0)
      out.push({
        kind: "group",
        group: "duplicates",
        label: `Possible duplicates (${this.dupes.length})`,
        icon: "copy",
        files: [],
        dupes: this.dupes,
      });
    add("stale", "Probably out of date", "history", stale);
    add("instructions", "Agent instructions", "hubot", instructions);
    add("doubtful", "Doubtful — check before you trust", "warning", doubtful);
    add("decisions", "Decisions", "law", [], decisions);
    add("archived", "Archived — kept for the record", "archive", archived);
    return out;
  }

  /** 3.0: other docs' "key: value" facts (reads the workspace first if it has not yet). */
  async allKeyFacts(): Promise<FactsOfDoc[]> {
    if (this.files.length === 0) await this.scan();
    return this.docRefs();
  }

  /** Each doc's facts with what the conflict check needs to tell related docs apart (links, title). */
  private docRefs(): FactsOfDoc[] {
    return this.files.map((f) => ({ file: f.rel, facts: f.keyFacts, title: f.facts.title, links: f.links }));
  }

  /** 3.0: a newer near-duplicate of this file, if any (its relative path). */
  newerDuplicate(uri: vscode.Uri): string | undefined {
    const me = this.files.find((f) => f.id === uri.toString());
    if (!me) return undefined;
    const group = this.dupes.find((g) => g.ids.includes(me.id));
    const newer = group?.ids
      .map((id) => this.files.find((f) => f.id === id))
      .filter((f): f is Scanned => !!f && f.id !== me.id && f.modified > me.modified)
      .sort((a, b) => b.modified - a.modified)[0];
    return newer?.rel;
  }

  // ---------- actions ----------

  markRead(node: Node | undefined): void {
    const files = node?.kind === "file" ? [node.file] : node?.kind === "group" ? node.files : [];
    for (const f of files) this.notes.setReadHash(f.id, f.hash);
  }

  async askAgent(node: Node | undefined): Promise<void> {
    if (!node) return;
    if (node.kind === "file") {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(node.file.uri));
      await pickAndDeliver(
        ["file"],
        {
          file: node.file.rel,
          openTasks: openTasks(text),
          missing: node.file.missing,
          ...docFacts(node.file.rel, text),
        },
        path.basename(node.file.rel),
      );
      return;
    }
    const files =
      node.kind === "dupe"
        ? node.files
        : node.kind === "group"
          ? node.group === "duplicates"
            ? (node.dupes ?? []).flatMap((g) => g.ids.flatMap((id) => this.byId(id)))
            : node.files
          : [];
    const paths = files.map((f) => f.rel);
    const direct: Partial<Record<GroupKind | "dupe", PromptId>> = {
      dupe: "mergeDuplicates",
      instructions: "instructionConflicts",
      plans: "openItems",
    };
    const id = node.kind === "dupe" ? direct.dupe : node.kind === "group" ? direct[node.group] : undefined;
    if (id) await deliverPrompt(buildPrompt(id, { files: paths }));
    else await pickAndDeliver(["files"], { files: paths }, `${paths.length} files`);
  }

  async archive(node: Node | undefined): Promise<void> {
    if (node?.kind !== "file") return;
    const f = node.file;
    const folder = vscode.workspace.getWorkspaceFolder(f.uri);
    if (!folder) return;
    const target = vscode.Uri.joinPath(folder.uri, "archive", path.relative(folder.uri.fsPath, f.uri.fsPath));
    const go = await vscode.window.showWarningMessage(
      `Move ${f.rel} to archive/${path.relative(folder.uri.fsPath, f.uri.fsPath)}? Nothing is deleted.`,
      { modal: true },
      "Move to archive",
    );
    if (go !== "Move to archive") return;
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, ".."));
      await vscode.workspace.fs.rename(f.uri, target, { overwrite: false });
      void this.scan();
    } catch (error) {
      void vscode.window.showErrorMessage(`Couldn't move it: ${String(error)}`);
    }
  }

  /** #43 "Show all": the group lists every file (until the window closes). */
  expand(group: GroupKind): void {
    this.showAll.add(group);
    this.changed.fire();
  }

  /** #43: a duplicate group's own prompts — "are these really duplicates?" first, then "merge". */
  async askDupes(node: Node | undefined, id: PromptId): Promise<void> {
    if (node?.kind !== "dupe") return;
    await deliverPrompt(buildPrompt(id, { files: node.files.map((f) => f.rel) }));
  }

  /** #43: clicking an out-of-date doc opens it, says why, and offers the fix. */
  async whyStale(node: Node | undefined): Promise<void> {
    if (node?.kind !== "file") return;
    const f = node.file;
    await vscode.commands.executeCommand("docmap.openMapAt", f.uri);
    const why = staleReasons(f, Date.now(), readConfig().staleDays).join("; ");
    const fix = "Update this doc to match the code";
    if (
      (await vscode.window.showInformationMessage(`${f.rel} is probably out of date: ${why}.`, fix)) === fix
    )
      await deliverPrompt(buildPrompt("updateDrift", { file: f.rel, missing: f.missing }));
  }

  async compare(node: Node | undefined): Promise<void> {
    if (node?.kind !== "file" || !node.dupeOf) return;
    await vscode.commands.executeCommand(
      "vscode.diff",
      node.dupeOf.uri,
      node.file.uri,
      `${path.basename(node.dupeOf.rel)} ↔ ${path.basename(node.file.rel)}`,
    );
  }

  private mentions = new Map<string, Mention[]>();
  private readonly scannedEvents = new vscode.EventEmitter<void>();
  /** Fires after every scan (CodeLens "mentioned in docs" refreshes on it). */
  readonly onScanned = this.scannedEvents.event;
  private everScanned = false;

  /** Whether the inbox has scanned the workspace at least once (CommitHint and DocLinks stay lazy until then). */
  get hasScanned(): boolean {
    return this.everScanned;
  }

  /** 3.0 docs ↔ code: the docs that name this file (reads cached scan results; never triggers a scan on its own). */
  mentionsOf(file: vscode.Uri): readonly Mention[] {
    return this.mentions.get(path.normalize(file.fsPath)) ?? [];
  }

  /** 3.0 Open Questions: every open question in the workspace's docs, by file — a read-only preview page. */
  async openQuestions(open: (doc: vscode.TextDocument) => void): Promise<void> {
    await this.ensureScanned();
    open(await writeReport("Open questions", questionsReport(this.fileItems(), today())));
  }

  /** 3.0 My Items: open tasks and questions that name me (docmap.myNames, else git's user.name). */
  async myItems(open: (doc: vscode.TextDocument) => void): Promise<void> {
    await this.ensureScanned();
    open(await writeReport("My items", myItemsReport(this.fileItems(), await this.myNames(), today())));
  }

  /** The reader's names: docmap.myNames, else git's user.name (and its @handle). */
  private async myNames(): Promise<string[]> {
    const names = readConfig().myNames;
    if (names.length > 0) return [...names];
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const fromGit = folder ? await gitUserName(folder) : undefined;
    return fromGit ? [fromGit, `@${fromGit.split(/\s+/)[0]?.toLowerCase() ?? ""}`] : [];
  }

  /** 3.0 agent tools: every scanned doc's text, bounded by per-file and total byte caps. */
  async toolDocs(): Promise<{ file: string; text: string; modified: number }[]> {
    if (this.files.length === 0) await this.scan();
    const maxFileBytes = Math.min(readConfig().largeFileBytes, INTERNAL_LIMITS.inboxMaxFileBytes);
    const decoder = new TextDecoder();
    let totalBytes = 0;
    const out: { file: string; text: string; modified: number }[] = [];
    for (const f of this.files) {
      if (totalBytes >= INTERNAL_LIMITS.inboxTotalScanBytes) break;
      try {
        const stat = await vscode.workspace.fs.stat(f.uri);
        if (stat.size > maxFileBytes || totalBytes + stat.size > INTERNAL_LIMITS.inboxTotalScanBytes)
          continue;
        totalBytes += stat.size;
        out.push({
          file: f.rel,
          text: decoder.decode(await vscode.workspace.fs.readFile(f.uri)),
          modified: f.modified,
        });
      } catch {
        // gone since the scan
      }
    }
    return out;
  }

  private fileItems(): FileItems[] {
    return [...this.files]
      .sort((a, b) => b.modified - a.modified)
      .map((f) => ({ file: f.rel, title: f.facts.title ?? path.basename(f.rel), items: f.items }));
  }

  /**
   * The project's home page (owner call 2026-11-24): what is being worked on and what is next, hard-to-read docs,
   * docs naming code that is gone, and the features. A read-only preview page; nothing is written to the project.
   */
  async home(
    open: (doc: vscode.TextDocument) => void,
    options?: { readonly skipScan?: boolean },
  ): Promise<void> {
    if (!options?.skipScan) await this.ensureScanned();
    const files = this.files.slice(0, INTERNAL_LIMITS.folderMapFiles);
    // #55: reuse cached `hardToRead` from `doScan()` instead of re-reading every Markdown file in parallel
    const docs: HomeDoc[] = files.map((f) => ({
      path: f.rel,
      title: f.facts.title ?? path.basename(f.rel),
      modified: f.modified,
      archived: isArchivedPath(f.rel),
      feature: isFeatureDoc(f.rel, kindFromPath(f.rel)),
      missingCode: f.missing.filter((m) => isCodeFile(m)),
      ...(f.plan
        ? {
            plan: {
              done: f.plan.done,
              total: f.plan.total,
              status: f.plan.status,
              ...(f.plan.nextTask ? { nextTask: f.plan.nextTask } : {}),
            },
          }
        : {}),
      hardToReadReason: f.hardToRead ?? null,
      items: f.items,
    }));
    // the newest handover note: a NEXT-SESSION.md / HANDOVER.md / HANDOFF.md, the one nearest the top folder first
    const handover = files
      .filter((f) => /^(next-session|handover|handoff)\.md$/i.test(path.basename(f.rel)))
      .sort((a, b) => a.rel.split("/").length - b.rel.split("/").length)[0];
    const handoverText = handover
      ? await vscode.workspace.fs.readFile(handover.uri).then(
          (b) => new TextDecoder().decode(b),
          () => "",
        )
      : undefined;
    const project = vscode.workspace.workspaceFolders?.[0]?.name ?? "This project";
    const page = homeMarkdown({
      project,
      docs,
      names: await this.myNames(),
      ...(handover && handoverText
        ? { handover: { file: handover.rel, ...handoverNext(handoverText) } }
        : {}),
      now: Date.now(),
    });
    open(await writeReport(`Home - ${project}`, page));
  }

  /** Home on start: only in a project with many docs, and only when the window has no tab open. */
  async homeOnStart(open: (doc: vscode.TextDocument) => void): Promise<void> {
    if (!readConfig().homeOnStart || vscode.window.tabGroups.all.some((g) => g.tabs.length > 0)) return;
    await this.scan();
    const live = this.files.filter((f) => !isArchivedPath(f.rel)).length;
    // the reader may have opened something while the project was read: then leave the window as it is
    if (live < INTERNAL_LIMITS.homeMinDocs || vscode.window.tabGroups.all.some((g) => g.tabs.length > 0))
      return;
    await this.home(open, { skipScan: true });
  }

  /** 3.0: how the Plans dashboard is sorted (this window). */
  private planSort: PlanSort = "attention";

  /** 3.0 Plans dashboard: every plan as one row, with totals and what needs attention — a read-only preview page. */
  async plansDashboard(open: (doc: vscode.TextDocument) => void): Promise<void> {
    await this.scan();
    const rows = await this.planRows();
    open(
      await writeReport(
        "Plans dashboard",
        dashboardMarkdown(rows, Date.now(), this.planSort, { browserLinks: true }),
      ),
    );
  }

  /** 3.3.0: structured data for the interactive Plans Dashboard webview (all workspace Markdown docs + statuses). */
  async plansData(rescan = false): Promise<{ rows: PlanRow[]; now: number; sort: PlanSort }> {
    if (rescan) await this.scan();
    else await this.ensureScanned();
    return { rows: await this.allDocRows(), now: Date.now(), sort: this.planSort };
  }

  /** Every Markdown doc's dashboard row enriched with missing paths and last git author (1 batch git call). */
  private async allDocRows(): Promise<PlanRow[]> {
    const docs = this.files.filter((f) => f.docRow).slice(0, INTERNAL_LIMITS.folderMapFiles);
    const roots = new Set<string>();
    for (const f of docs) {
      const root = vscode.workspace.getWorkspaceFolder(f.uri)?.uri.fsPath;
      if (root) roots.add(root);
    }
    const authorsByRoot = new Map<string, Map<string, string>>();
    await Promise.all(
      [...roots].map(async (root) => {
        authorsByRoot.set(root, await lastAuthors(root));
      }),
    );
    return docs.map((f) => {
      const row = f.docRow as PlanRow;
      const root = vscode.workspace.getWorkspaceFolder(f.uri)?.uri.fsPath;
      const rel = root ? path.relative(root, f.uri.fsPath).replace(/\\/g, "/") : "";
      const lastEditor = root ? authorsByRoot.get(root)?.get(rel) : undefined;
      return {
        ...row,
        ...(f.missing.length > 0 ? { missing: f.missing } : {}),
        ...(lastEditor ? { lastEditor } : {}),
      };
    });
  }

  /** 3.3.0: update the current sort order for the Plans Dashboard. */
  setPlanSort(sort: PlanSort): void {
    this.planSort = sort;
  }

  /** 3.3.0: export the Plans Dashboard as Markdown or CSV. */
  async exportPlans(csv: boolean): Promise<void> {
    if (this.files.length === 0) await this.scan();
    const rows = await this.planRows();
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const target = await vscode.window.showSaveDialog({
      ...(folder
        ? { defaultUri: vscode.Uri.joinPath(folder, csv ? "plans.csv" : "plans-dashboard.md") }
        : {}),
      filters: csv ? { CSV: ["csv"] } : { Markdown: ["md"] },
    });
    if (!target) return;
    const text = csv ? dashboardCsv(rows, this.planSort) : dashboardMarkdown(rows, Date.now(), this.planSort);
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
    void vscode.window.showInformationMessage(
      `Saved ${rows.length} plans to ${path.basename(target.fsPath)}.`,
    );
  }

  /** 3.3.0: hand every plan to the reader's own AI agent for a status report. */
  async askPlansAgent(): Promise<void> {
    if (this.files.length === 0) await this.scan();
    const rows = await this.planRows();
    await deliverPrompt(buildPrompt("openItems", { files: rows.map((r) => r.file) }));
  }

  /** Each plan's row plus what only the extension knows: paths it names that are gone, and its last git author (1 batch git call). */
  private async planRows(): Promise<PlanRow[]> {
    const plans = this.files.filter((f) => f.plan).slice(0, INTERNAL_LIMITS.folderMapFiles);
    const roots = new Set<string>();
    for (const f of plans) {
      const root = vscode.workspace.getWorkspaceFolder(f.uri)?.uri.fsPath;
      if (root) roots.add(root);
    }
    const authorsByRoot = new Map<string, Map<string, string>>();
    await Promise.all(
      [...roots].map(async (root) => {
        authorsByRoot.set(root, await lastAuthors(root));
      }),
    );
    return plans.map((f) => {
      const plan = f.plan as PlanRow;
      const root = vscode.workspace.getWorkspaceFolder(f.uri)?.uri.fsPath;
      const rel = root ? path.relative(root, f.uri.fsPath).replace(/\\/g, "/") : "";
      const lastEditor = root ? authorsByRoot.get(root)?.get(rel) : undefined;
      return {
        ...plan,
        ...(f.missing.length > 0 ? { missing: f.missing } : {}),
        ...(lastEditor ? { lastEditor } : {}),
      };
    });
  }

  /** 3.0: sort the dashboard, export it (Markdown / CSV), or hand every plan to my AI agent for a status report. */
  async plansMenu(open: (doc: vscode.TextDocument) => void): Promise<void> {
    if (this.files.length === 0) await this.scan();
    const planRows = await this.planRows();
    const rows = () => planRows;
    type Item = vscode.QuickPickItem & { run: () => Promise<unknown> | unknown };
    const sorts = (Object.keys(SORT_LABELS) as PlanSort[]).map(
      (s): Item => ({
        label: `${s === this.planSort ? "$(check)" : "$(blank)"} Sort: ${SORT_LABELS[s]}`,
        run: () => {
          this.planSort = s;
          return this.plansDashboard(open);
        },
      }),
    );
    const save = async (csv: boolean) => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      const target = await vscode.window.showSaveDialog({
        ...(folder
          ? { defaultUri: vscode.Uri.joinPath(folder, csv ? "plans.csv" : "plans-dashboard.md") }
          : {}),
        filters: csv ? { CSV: ["csv"] } : { Markdown: ["md"] },
      });
      if (!target) return;
      const text = csv
        ? dashboardCsv(rows(), this.planSort)
        : dashboardMarkdown(rows(), Date.now(), this.planSort);
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
      void vscode.window.showInformationMessage(
        `Saved ${rows().length} plans to ${path.basename(target.fsPath)}.`,
      );
    };
    const items: Item[] = [
      { label: "Sort", kind: vscode.QuickPickItemKind.Separator, run: () => undefined },
      ...sorts,
      { label: "Export", kind: vscode.QuickPickItemKind.Separator, run: () => undefined },
      { label: "$(markdown) Save as Markdown…", run: () => save(false) },
      { label: "$(table) Save as CSV (spreadsheet)…", run: () => save(true) },
      { label: "Ask my AI agent", kind: vscode.QuickPickItemKind.Separator, run: () => undefined },
      {
        label: "$(sparkle) Status report of every plan",
        detail: "Which are finished, in progress (with the open items) or abandoned — as one table",
        run: () => deliverPrompt(buildPrompt("openItems", { files: rows().map((r) => r.file) })),
      },
    ];
    const pick = await vscode.window.showQuickPick(items, {
      title: `Plans dashboard — ${rows().length} plans`,
    });
    await pick?.run();
  }

  /** Every decision across the docs, newest file first, as a Markdown page with links to where each was made. */
  /**
   * Doc Atlas graph data (owner call 2026-11-24): every doc with its links, the code files it names and how many names
   * it gives that the code no longer has. Reads workspace files only. `fresh`: read the project again first (a doc
   * written since the last read is missing otherwise — code review 2026-11-24); also when files changed meanwhile.
   */
  async atlasGraph(fresh = false): Promise<AtlasGraph> {
    if (fresh || this.stale || this.files.length === 0) await this.scan();
    // #55: reuse cached code spans from `doScan()` instead of re-reading every Markdown file from disk
    const input: AtlasInput[] = await mapLimit(this.files, INTERNAL_LIMITS.ioConcurrency, async (f) => {
      const repo = f.codeSpans.length > 0 ? await repoFactsFor(f.uri).catch(() => undefined) : undefined;
      const items = repo ? codeItemsFromSpans(f.codeSpans, repo, new Map()) : [];
      return {
        path: f.rel,
        title: f.facts.title ?? path.basename(f.rel),
        ...(f.facts.tldr ? { what: firstSentence(f.facts.tldr) } : {}),
        links: f.links,
        code: items.filter((c) => c.kind === "file" && c.found && c.file).map((c) => c.file ?? ""),
        gone: items.filter((c) => !c.found).length,
        feature: isFeatureDoc(f.rel, kindFromPath(f.rel)),
      };
    });
    return atlasGraph(input);
  }

  /**
   * One doc's code details for the Doc Atlas (owner call 2026-11-23): the docs around it, the files and functions it
   * names linked to the line, and the names no longer in the code. A read-only report page; nothing is written.
   */
  async docAtlas(open: (doc: vscode.TextDocument) => void, feature: vscode.Uri): Promise<void> {
    if (this.files.length === 0) await this.scan();
    const me = this.files.find((f) => f.uri.toString() === feature.toString());
    if (!me) return;
    const known = new Set(this.files.map((f) => f.rel));
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(me.uri));
    const page = featurePageMarkdown({
      path: me.rel,
      title: me.facts.title ?? path.basename(me.rel),
      ...(me.facts.tldr ? { tldr: me.facts.tldr } : {}),
      linksIn: this.files.filter((f) => f.rel !== me.rel && f.links.includes(me.rel)).map((f) => f.rel),
      linksOut: me.links.filter((l) => known.has(l)),
      code: await codeItems(me.uri, text),
    });
    const name = (me.facts.title ?? path.basename(me.rel, ".md")).replace(/[\\/:*?"<>|#]+/g, " ").trim();
    open(await writeReport(`Atlas - ${name}`, page));
  }

  /** #47 "Where do I start?": a reading order for someone new to the project, as a page of links. */
  async whereToStart(open: (doc: vscode.TextDocument) => void): Promise<string> {
    if (this.files.length === 0) await this.scan();
    const docs = this.files
      .filter((f) => !f.instructions) // AGENTS.md and the like are for AI agents, not a new developer
      .map((f) => ({
        rel: f.rel,
        title: f.facts.title,
        kind: kindFromPath(f.rel),
        openPlanItems: f.plan && f.plan.status !== "done" ? f.plan.total - f.plan.done : undefined,
        inbound: f.inbound,
        modified: f.modified,
      }));
    const page = readingOrderMarkdown(readingOrder(docs));
    open(await writeReport("Where do I start", page));
    return page;
  }

  async decisionLog(open: (doc: vscode.TextDocument) => void): Promise<void> {
    if (this.files.length === 0) await this.scan();
    const withDecisions = this.files
      .filter((f) => f.facts.decisions.length > 0)
      .sort((a, b) => b.modified - a.modified);
    const lines = [
      "# Decision log",
      "",
      `_${withDecisions.reduce((n, f) => n + f.facts.decisions.length, 0)} decisions in ${withDecisions.length} files, newest file first. Built from lines that start with "Decision:", "We chose", "Decided"…_`,
      "",
    ];
    for (const f of withDecisions) {
      lines.push(`## ${f.facts.title ?? f.rel}`, "", `\`${f.rel}\``, "");
      for (const d of f.facts.decisions) lines.push(`- ${d.text} _(line ${d.line + 1})_`);
      lines.push("");
    }
    open(await writeReport("Decision log", lines.join("\n")));
  }
}

const today = () => new Date().toISOString().slice(0, 10);
