import type { InferHeadings } from "../markdown/reading-rules";
import type { LineWidth, ReadingTheme } from "../protocol/messages";

export type AgentTarget = "auto" | "clipboard";

/** Typed settings for docmap. Every tunable lives here — never as a literal elsewhere. */
export interface DocmapConfig {
  /** Delay after the last edit before the map is recomputed (ms). Not a user setting since #48 (owner, 2026-11-21). */
  readonly updateDebounceMs: number;
  /** Files above this size show the "very large file" state first (bytes). Default: 2 MB (2,097,152 bytes). */
  readonly largeFileBytes: number;
  /** Reading tools: skim, section sizes, fold to level, structure hints, footnotes/tasks/callouts. Off by default. */
  readonly readingTools: boolean;
  /** Structure hints (with reading tools on): when lines that act as headings join the outline. */
  readonly inferHeadings: InferHeadings;
  /** Return to the section the reader was in when a file's map is opened again, also after a restart. */
  readonly rememberPlace: boolean;
  /** Draw ```mermaid blocks as diagrams (the drawing library loads only for documents that have one). */
  readonly diagrams: boolean;
  /** 2.0 reading look: theme, text size (1 = normal), line width. */
  readonly theme: ReadingTheme;
  readonly fontScale: number;
  readonly lineWidth: LineWidth;
  /** 2.0 Docs Inbox: a file not changed for this many days is "probably out of date" (0 = never by age). */
  readonly staleDays: number;
  /** 2.0: where agent prompts go — Copilot Chat when it is there ("auto"), else / always the clipboard. */
  readonly agentTarget: AgentTarget;
  /** 2.0 writing helpers: bold/italic keys, list continuation on Enter (off when another Markdown helper has them). */
  readonly writingHelpers: boolean;
  /** 3.0 Clean view: AI Markdown laid out properly on the page (the file is never changed). */
  readonly cleanView: boolean;
  /** 2026-11-24: open the Home page when a project with many docs opens and no tab is open. */
  readonly homeOnStart: boolean;
  /** 3.0: number headings 1, 1.1, 1.2 in the page. */
  readonly headingNumbers: boolean;
  /** 3.0 My Items and sign-off: the reader's names and @handles (empty = git's user.name). */
  readonly myNames: readonly string[];
  /** 3.0 docs ↔ code: "Mentioned in N docs" above code files that docs name. */
  readonly codeLens: boolean;
  /** 3.0 AI level 1 (off by default): answer prompts that only ask for an answer with the reader's own model. */
  readonly aiAnswer: boolean;
  /** 3.0 AI level 1: the model family to use ("" = a Copilot model, else any). */
  readonly aiModel: string;
  /** 3.0 AI level 2 (off by default): docmap's tools for agents — Copilot agent mode, and a local MCP server. */
  readonly aiTools: boolean;
  /** "Open in browser" shows a live page that follows the editor (served only to this computer); off = a saved copy. */
  readonly liveBrowser: boolean;
  /** #44: extra folders every doc list leaves out (dot-folders and build/dependency folders always are). */
  readonly skipFolders: readonly string[];
  /** #44: dot-folders every doc list keeps after all. */
  readonly includeFolders: readonly string[];
}

export const DEFAULT_CONFIG: DocmapConfig = {
  updateDebounceMs: 300,
  largeFileBytes: 2 * 1024 * 1024,
  readingTools: true,
  inferHeadings: "auto",
  rememberPlace: true,
  diagrams: true,
  theme: "vscode",
  fontScale: 1,
  lineWidth: "normal",
  staleDays: 90,
  agentTarget: "clipboard", // owner call 2026-11-16: copy, so the prompt works with any agent

  writingHelpers: true,
  cleanView: true,
  homeOnStart: false,
  headingNumbers: false,
  myNames: [],
  codeLens: true,
  aiAnswer: false,
  aiModel: "",
  aiTools: false,
  liveBrowser: true, // owner call 2026-11-17: re-pressing "Open in browser" after every edit is annoying
  skipFolders: [],
  // .github holds the project's own docs (contributing, Copilot instructions); other dot-folders are tool files (#44)
  includeFolders: [".github"],
};

const THEMES: readonly ReadingTheme[] = ["vscode", "paper", "github", "night", "focus"];
const WIDTHS: readonly LineWidth[] = ["narrow", "normal", "wide", "full"];

/** Merge raw user settings over the defaults, rejecting values that make no sense. */
export function resolveConfig(raw: Partial<Record<keyof DocmapConfig, unknown>>): DocmapConfig {
  return {
    updateDebounceMs: nonNegativeInt(raw.updateDebounceMs, DEFAULT_CONFIG.updateDebounceMs),
    largeFileBytes: nonNegativeInt(raw.largeFileBytes, DEFAULT_CONFIG.largeFileBytes),
    readingTools: typeof raw.readingTools === "boolean" ? raw.readingTools : DEFAULT_CONFIG.readingTools,
    inferHeadings:
      raw.inferHeadings === "auto" || raw.inferHeadings === "always" || raw.inferHeadings === "off"
        ? raw.inferHeadings
        : DEFAULT_CONFIG.inferHeadings,
    rememberPlace: typeof raw.rememberPlace === "boolean" ? raw.rememberPlace : DEFAULT_CONFIG.rememberPlace,
    diagrams: typeof raw.diagrams === "boolean" ? raw.diagrams : DEFAULT_CONFIG.diagrams,
    theme: THEMES.includes(raw.theme as ReadingTheme) ? (raw.theme as ReadingTheme) : DEFAULT_CONFIG.theme,
    fontScale:
      typeof raw.fontScale === "number" && raw.fontScale >= 0.7 && raw.fontScale <= 2
        ? raw.fontScale
        : DEFAULT_CONFIG.fontScale,
    lineWidth: WIDTHS.includes(raw.lineWidth as LineWidth)
      ? (raw.lineWidth as LineWidth)
      : DEFAULT_CONFIG.lineWidth,
    staleDays: nonNegativeInt(raw.staleDays, DEFAULT_CONFIG.staleDays),
    agentTarget:
      raw.agentTarget === "auto" || raw.agentTarget === "clipboard"
        ? raw.agentTarget
        : DEFAULT_CONFIG.agentTarget,
    writingHelpers:
      typeof raw.writingHelpers === "boolean" ? raw.writingHelpers : DEFAULT_CONFIG.writingHelpers,
    cleanView: typeof raw.cleanView === "boolean" ? raw.cleanView : DEFAULT_CONFIG.cleanView,
    homeOnStart: typeof raw.homeOnStart === "boolean" ? raw.homeOnStart : DEFAULT_CONFIG.homeOnStart,
    headingNumbers:
      typeof raw.headingNumbers === "boolean" ? raw.headingNumbers : DEFAULT_CONFIG.headingNumbers,
    myNames: Array.isArray(raw.myNames)
      ? raw.myNames
          .filter((n): n is string => typeof n === "string" && n.trim() !== "")
          .map((n) => n.trim())
          .slice(0, 20)
      : DEFAULT_CONFIG.myNames,
    codeLens: typeof raw.codeLens === "boolean" ? raw.codeLens : DEFAULT_CONFIG.codeLens,
    aiAnswer: typeof raw.aiAnswer === "boolean" ? raw.aiAnswer : DEFAULT_CONFIG.aiAnswer,
    aiModel: typeof raw.aiModel === "string" ? raw.aiModel.trim().slice(0, 100) : DEFAULT_CONFIG.aiModel,
    aiTools: typeof raw.aiTools === "boolean" ? raw.aiTools : DEFAULT_CONFIG.aiTools,
    liveBrowser: typeof raw.liveBrowser === "boolean" ? raw.liveBrowser : DEFAULT_CONFIG.liveBrowser,
    skipFolders: folderList(raw.skipFolders, DEFAULT_CONFIG.skipFolders),
    includeFolders: folderList(raw.includeFolders, DEFAULT_CONFIG.includeFolders),
  };
}

function folderList(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((n): n is string => typeof n === "string" && n.trim() !== "")
    .map((n) => n.trim())
    .slice(0, 50);
}

function nonNegativeInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Internal timings — deliberate engineering choices, not user settings (they are not in `contributes`).
 * Kept here, with the other knobs, so no literal timing hides in the code.
 */
export const INTERNAL_TIMINGS = {
  /** How often, at most, the editor's scroll position is sent to the panel (ms). */
  scrollSyncMs: 50,
  /** How long "✓ Updated plan.md, line 12" stays in the status bar after a tick or status change (ms). */
  updatedMessageMs: 4000,
  /** Write Doc Map: how often, and how many times, to check that VS Code's copy of a file caught up with the disk. */
  diskCatchUpPollMs: 50,
  diskCatchUpPolls: 60,
  /**
   * After a click in the map moves the editor, how long the clicked heading stays "you are here" even though VS Code's
   * sticky headings leave a few lines of the section above at the top of the editor (ms).
   */
  jumpSettleMs: 1000,
  /** Minimum gap between two link opens from one panel — held-down Enter must not open a file 30 times (ms). */
  linkOpenGapMs: 250,
  /** A click on a skimmed lead waits this long before opening the section: a double-click (select a word) wins. */
  skimClickDelayMs: 250,
  /** The reading place is written to VS Code's storage at most this often while the reader scrolls (ms). */
  placeSaveMs: 1000,
  /** Export PDF: wait this long after the page is drawn (diagrams, fonts) before the print dialog opens (ms). */
  printDelayMs: 800,
  /** A git question gives up after this long (ms): trust markers then skip "may be stale". */
  gitTimeoutMs: 5000,
  /** Docs Inbox: wait this long after the last Markdown change before scanning again (ms). */
  inboxRescanMs: 1500,
  /** "N docs mention files you changed" (#46): wait this long after a save or a git change before checking again (ms). */
  commitHintMs: 1000,
  /** Show Preview / Show Source: how often, and how many times, to look for the new tab before closing the old one. */
  swapSettleStepMs: 50,
  swapSettleTries: 40,
  /** Live browser view: an idle update stream gets a keep-alive line this often, so nothing between drops it (ms). */
  liveKeepAliveMs: 25000,
  /** #54 Repo facts: wait this long after a relevant workspace file change before dropping that folder's cache (ms). */
  repoFactsDebounceMs: 3000,
  /** #56 Maximum edit-to-render debounce for large files (ms). */
  maxUpdateDebounceMs: 1500,
} as const;

/** Internal bounds (not settings): memory a panel may hold. */
export const INTERNAL_LIMITS = {
  /** Change events a map remembers, so a click drawn before them still finds its heading (one per edit). */
  editHistory: 200,
  /** Files whose reading place is kept in workspace storage (the least recently read are dropped first). */
  rememberedPlaces: 500,
  /** Markdown files the folder map lists (a huge repository shows the first ones and says so). */
  folderMapFiles: 2000,
  /** Easy reading: a code file larger than this is not read for a preview (pointing at it still names it). */
  codePeekBytes: 2 * 1024 * 1024,
  /** Easy reading: docs linking to a doc that are read to find its parts' build records (proposed). */
  recordBackLinks: 40,
  /** Home opens on its own only in a project with at least this many docs (proposed, owner may tune). */
  homeMinDocs: 30,
  /** Pages one "Open Map in Browser" writes: the file, plus the Markdown files it links to (and they link to). */
  snapshotPages: 50,
  /** Live browser view: documents it will serve (the opened ones and the Markdown files they link to). */
  livePages: 200,
  /** Live browser view: approved image files it will serve. */
  liveFiles: 2000,
  /** Live browser view: browser tabs listening for updates at once. */
  liveListeners: 50,
  /**
   * Lines at the top of the editor that VS Code's sticky headings may cover: a heading this close to the top is the
   * one being read (CI run 106: a heading scrolled to the top was reported one line below the first visible line).
   */
  stickyLines: 2,
  /** Docs Inbox: two files at least this alike (0…1, estimated shared 5-word phrases) are shown as duplicates. */
  duplicateSimilarity: 0.6,
  /** Docs Inbox: files listed under "Worth reading". */
  worthReading: 10,
  /** #43 Docs Inbox: "New" = never opened and added or changed within this many days (proposed, owner may tune). */
  inboxNewDays: 7,
  /** #43 Docs Inbox: files a group lists before a "Show all" row (proposed). */
  inboxGroupMax: 10,
  /** Docs Inbox: paths per file checked on disk for "mentions missing files". */
  pathChecksPerFile: 20,
  /** #53 Docs Inbox: files larger than this are summarized without reading full text, MinHash, or deep scans (bytes). */
  inboxMaxFileBytes: 256 * 1024,
  /** #53 Docs Inbox: total byte budget read across uncached files per scan; files beyond are summarized (bytes). */
  inboxTotalScanBytes: 10 * 1024 * 1024,
  /** Files whose notes (marks, highlights, read state) are kept; the least recently touched are dropped first. */
  notesFiles: 3000,
  /** #54 Trust markers: files the repo index lists (a bigger repo is indexed up to here; paths beyond are "unknown"). */
  repoFiles: 20_000,
  /** #54 Trust markers: code files scanned for names and env vars — more than this, and those two checks are skipped. */
  repoCodeFiles: 500,
  /** #54 Trust markers: code files larger than this are not scanned (generated or minified). */
  repoCodeFileBytes: 100_000,
  /** #54 Trust markers: total bytes of code read per scan — past this, symbol and env checks are skipped. */
  repoCodeTotalBytes: 4 * 1024 * 1024,
  /** #54 Trust markers: code files read per batch before yielding to the event loop. */
  repoCodeBatchSize: 20,
  /** #54 Trust markers: unique identifiers collected before stopping the code scan (prevents unbounded Set growth). */
  repoMaxIdentifiers: 50_000,
  /** Trust markers: files per paragraph checked for "changed since" in git. */
  stalePathsPerBlock: 5,
  /** #55 Concurrency cap for parallel file reads and git subprocesses across workspace features. */
  ioConcurrency: 6,
  /** #55 Trust markers: skip `git blame --line-porcelain` on documents above this many lines. */
  trustBlameMaxLines: 2000,
  /** #55 Trust markers: skip `git blame --line-porcelain` on documents above this byte size. */
  trustBlameMaxBytes: 256 * 1024,
  /** Redline "since I last read it": files whose last-read text is kept (the oldest are dropped first). */
  seenTexts: 500,
  /** Redline: git versions of a file offered in "Compare with a git version…". */
  gitVersions: 50,
  /** Search across docs: results listed at most (all files), and per file. */
  searchResults: 300,
  searchPerFile: 30,
  /** AI level 1: most text quoted to the reader's model beside the prompt (characters), and per file. */
  aiContextBytes: 60_000,
  aiFileBytes: 20_000,
  /** AI level 2: most rows / items a tool returns to an agent. */
  aiToolItems: 200,
  /** Highlights kept per file. */
  highlightsPerFile: 200,
  /** #56 Files above this size scale edit debounce up linearly until `debounceScaleMaxBytes` (bytes). */
  debounceScaleStartBytes: 100 * 1024,
  /** #56 File size at which edit debounce reaches `maxUpdateDebounceMs` (bytes). */
  debounceScaleMaxBytes: 1024 * 1024,
  /** #56 Viewport margin (px) around the scroll pane for lazy-rendering Mermaid diagrams. */
  diagramRootMarginPx: 300,
} as const;

/**
 * Scales the edit-to-render debounce up for larger files so typing never stutters (#56).
 * Files up to `debounceScaleStartBytes` keep `baseMs`; larger files ramp linearly up to `maxUpdateDebounceMs`
 * at `debounceScaleMaxBytes`. An explicit 0 or already-larger `baseMs` is preserved.
 */
export function debounceForBytes(baseMs: number, bytes: number): number {
  if (baseMs <= 0 || bytes <= INTERNAL_LIMITS.debounceScaleStartBytes) return Math.max(0, baseMs);
  if (baseMs >= INTERNAL_TIMINGS.maxUpdateDebounceMs) return baseMs;
  const span = INTERNAL_LIMITS.debounceScaleMaxBytes - INTERNAL_LIMITS.debounceScaleStartBytes;
  const ratio = Math.min(1, (bytes - INTERNAL_LIMITS.debounceScaleStartBytes) / span);
  return Math.round(baseMs + ratio * (INTERNAL_TIMINGS.maxUpdateDebounceMs - baseMs));
}

/** Reading speed behind "about N min" in the outline (words per minute, a common adult average for screen text). */
export const READING_WORDS_PER_MINUTE = 230;
