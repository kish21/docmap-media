/**
 * The one contract between the extension host and the webview (ADR-0001).
 * Host and webview ship in the same .vsix, so there is no cross-version traffic: the protocol is internal,
 * versioned with the extension, and changed additively. Adding a message = one line in its union + its guard.
 *
 * Units: `line` 0-based source line · `docVersion` VS Code TextDocument.version · `bytes` UTF-8 length.
 */
import type { CodePeek } from "../insights/code-peek";
import type { PlanSort } from "../insights/plans";
import type { Standing } from "../insights/standing";
import type { Heading } from "../outline/types";

export type EdgeState =
  /** The document has no headings — show the rendered doc with a note, never a blank panel. */
  | "no-headings"
  /** Larger than `docmap.largeFileBytes` — ask before rendering. */
  | "too-large"
  /** The engine could not parse it. */
  | "error"
  /** The source file is gone (deleted, moved, or an unsaved file closed) — a closed tab alone is not this. */
  | "closed";

export type HostToWebview =
  | {
      readonly type: "render";
      readonly docVersion: number;
      readonly fileName: string;
      readonly headings: readonly Heading[];
      readonly html: string;
      /** Show the reading tools (skim, fold to level, sizes) — setting `docmap.readingTools`. Absent = off. */
      readonly readingTools?: boolean;
      /** How the reader last left the outline pane (0.0.20): its width and whether it was hidden. Absent = default. */
      readonly layout?: OutlineLayout;
      /** 2.0: look, key points, changed sections, review marks, highlights. Absent = none. */
      readonly extras?: PageExtras;
    }
  /** 2.0: new extras for the page as drawn (a review mark, a highlight, "mark as read") — no re-render. */
  | { readonly type: "extras"; readonly docVersion: number; readonly extras: PageExtras }
  | {
      readonly type: "state";
      readonly state: EdgeState;
      readonly fileName: string;
      readonly detail?: string;
      /** Present for "too-large". */
      readonly bytes?: number;
    }
  /** The editor scrolled: its top visible line, so the panel can mark "you are here". */
  | { readonly type: "editorScrolled"; readonly docVersion: number; readonly topLine: number }
  /**
   * Scroll the map to this heading (unfolding it): the place the reader left this file's map, or the `#heading` of a
   * link that opened it. An id the panel does not have is ignored.
   */
  | { readonly type: "reveal"; readonly docVersion: number; readonly headingId: string }
  /** #48: the reader picked "Show as slides" in the file's menu — the page starts its slides. */
  | { readonly type: "showSlides"; readonly docVersion: number }
  /** Easy reading: the code for a name or link the reader points at (absent peek: nothing to show). */
  | { readonly type: "codePeek"; readonly text: string; readonly peek?: CodePeek };

export type ReadingTheme =
  | "vscode"
  | "paper"
  | "github"
  | "github-dark"
  | "night"
  | "warm-dark"
  | "solarized-light"
  | "focus";
export type LineWidth = "narrow" | "normal" | "wide" | "full";
export type ReviewMark = "approve" | "question" | "change";

/** 2.0: everything the page shows beyond the document itself. Every field optional; the host sends what applies. */
export interface PageExtras {
  readonly look?: {
    readonly theme: ReadingTheme;
    readonly fontScale: number;
    readonly lineWidth: LineWidth;
    /** 3.0 Clean view (default on) and heading numbers (default off). Absent = on / off. */
    readonly clean?: boolean;
    readonly numbers?: boolean;
  };
  /** 3.0: the file's front matter (`title: …`, `status: …`), shown as a header card in Clean view. */
  readonly frontMatter?: readonly { readonly key: string; readonly value: string }[];
  /** 3.0 named formats: the kind of doc docmap recognised ("Decision record") and the named format it follows. */
  readonly docKind?: { readonly label: string; readonly format?: string };
  readonly keyPoints?: {
    readonly tldr?: string;
    readonly tasksOpen: number;
    readonly tasksDone: number;
    readonly decisions: number;
    readonly warnings: number;
  };
  /** Heading ids of the sections changed since the reader last read this file. */
  readonly changed?: readonly string[];
  readonly reviews?: readonly { readonly headingId: string; readonly mark: ReviewMark }[];
  readonly highlights?: readonly Highlight[];
  /** 3.0: trust markers — one per block that has something to say (blocks are the `data-block` indexes). */
  readonly trust?: readonly BlockTrust[];
  /**
   * 3.0 Rendered redline: the page compared with an older version. `oldHtml` is that version rendered by the same
   * engine (blocks carry data-block); the pairs are new / old block indexes (see core/insights/redline.ts).
   */
  readonly redline?: Redline;
  /** 3.0 outline badges: open tasks, open questions and doubtful paragraphs per section. */
  readonly badges?: readonly SectionCounts[];
  /** 3.0 sign-off: who signed which version (from the front matter); `current` = this exact text. */
  readonly signoffs?: readonly { readonly who: string; readonly date: string; readonly current: boolean }[];
  /**
   * 2026-11-22 review: the `code` spans (as written) that name a file, function or class the project has — the page
   * makes these clickable, and only these.
   */
  readonly codeRefs?: readonly string[];
  /**
   * Easy reading (2026-11-24): where a long doc stands — its parts, the story in date order, each top section's state,
   * and warnings when the Status line disagrees with the sections. Absent = nothing to show.
   */
  readonly standing?: Standing;
  /**
   * Owner report 2026-11-24: a page docmap wrote (Open questions, Home…) — no "◈ Doc Atlas" on it; and a file's page in
   * its own tab — it gets a "Show source" button. Always sent (true or false), so a later render clears them.
   */
  readonly report?: boolean;
  readonly inTab?: boolean;
}

export interface SectionCounts {
  readonly headingId: string;
  readonly tasks: number;
  readonly questions: number;
  readonly doubts: number;
}

export interface Redline {
  /** What the page is compared with, for the bar: "the version you last read", "last commit (a1b2c3d)"… */
  readonly label: string;
  readonly oldHtml: string;
  readonly added: readonly number[];
  readonly changed: readonly (readonly [number, number])[];
  readonly removed: readonly (readonly [number, number])[];
}
/** Largest older version a redline carries (a sanity bound; the host skips bigger ones). */
export const MAX_REDLINE_HTML = 20_000_000;

export type TrustMark = "mismatch" | "wrong" | "conflict" | "stale" | "superseded" | "verified";
export interface BlockTrust {
  readonly block: number;
  readonly state: TrustMark;
  /** Plain sentences for the hover (never HTML). */
  readonly reasons: readonly string[];
}

export interface Highlight {
  readonly id: string;
  readonly headingId: string;
  readonly text: string;
  /** 2026-11-22 review: a comment on the highlighted text (sent with "Send my review to my AI agent"). */
  readonly note?: string;
}
/** Longest text one highlight may hold. */
export const MAX_HIGHLIGHT_LENGTH = 500;
/** Longest comment on a highlight. */
export const MAX_COMMENT_LENGTH = 4000;
/** Longest code name the page may ask the host to open (`src/cart.js:12`, `addItem()`). */
export const MAX_CODE_REF_LENGTH = 300;
/** Longest text the page may ask the host to copy (a code block). */
export const MAX_COPY_LENGTH = 1_000_000;

/** The outline pane as the reader sized it: width in CSS pixels, and whether it is hidden. */
export interface OutlineLayout {
  readonly outlineWidth: number;
  readonly collapsed: boolean;
}
/** Widest outline pane a message may carry (a sanity bound). */
export const MAX_OUTLINE_WIDTH = 4000;

export type WebviewToHost =
  | { readonly type: "ready" }
  /**
   * Reveal this heading's line in the editor. The host clamps the line to the document. If the document changed
   * since `docVersion`, the host finds the heading again by `headingId` in the current text (or ignores the jump).
   */
  | { readonly type: "jump"; readonly docVersion: number; readonly line: number; readonly headingId?: string }
  /** User confirmed rendering a file above the size threshold. */
  | { readonly type: "renderAnyway" }
  /** Write the current map as a self-contained HTML file and open it in the browser. */
  | { readonly type: "openInBrowser" }
  /**
   * The user clicked a relative link in the document (e.g. `docs/plan.md#setup`). The host resolves it against
   * the document's folder and opens it ONLY if it stays inside the workspace — the panel never opens files itself.
   */
  | { readonly type: "openLink"; readonly href: string }
  /** "You are here" moved to this heading — the host remembers it (in memory, this window) for the next time. */
  | { readonly type: "place"; readonly headingId: string }
  /** The reader resized or hid the outline pane — the host remembers it for every map (0.0.20). */
  | ({ readonly type: "layout" } & OutlineLayout)
  /** 2.0: the reader opened a heading's menu (review mark, ask my agent) — the host shows it. "" = the whole file. */
  | {
      readonly type: "sectionMenu";
      readonly headingId: string;
      /** #48: the page has slides (sections between --- lines): the file's menu offers "Show as slides". */
      readonly slides?: boolean;
    }
  /** 2.0: highlight this text (selected inside the section of `headingId`; "" = above the first heading). */
  | { readonly type: "highlight"; readonly headingId: string; readonly text: string }
  /** 2026-11-22 review: comment on this selected text — the host asks for the comment and keeps it like a highlight. */
  | { readonly type: "comment"; readonly headingId: string; readonly text: string }
  /** 2026-11-22 review: the reader clicked a code name the host listed in `codeRefs` — open it beside the doc. */
  | { readonly type: "openCode"; readonly text: string }
  /** Easy reading: the reader points at a code name or a link to a code file — show its code (the host decides). */
  | { readonly type: "peekCode"; readonly text: string }
  /** Easy reading: open the Doc Atlas beside this doc, centred on it. */
  | { readonly type: "openAtlas" }
  /** 3.3.0: open the workspace Plans Dashboard from the preview top bar. */
  | { readonly type: "openPlans" }
  /** 3.3.0: open the workspace Open Questions view from the preview top bar. */
  | { readonly type: "openQuestions" }
  /** Owner report 2026-11-24: "Show source" on a file's page — the file's text in this tab, at this section. */
  | { readonly type: "showSource" }
  /** 2026-11-22 review: "▶ Terminal" on a shell block — put its commands in the terminal, never press Enter. */
  | { readonly type: "runInTerminal"; readonly text: string }
  | { readonly type: "unhighlight"; readonly id: string }
  /** 2.0: the reader has read the changes — forget them. */
  | { readonly type: "markRead" }
  /** 2.0: copy this code block's text (the host writes the clipboard; a webview cannot always). */
  | { readonly type: "copy"; readonly text: string }
  /** 3.0: the reader opened a block's trust menu (verify, mark wrong, ask my agent) — `block` is its data-block. */
  | { readonly type: "blockMenu"; readonly block: number }
  /** 3.0: the reader switched Clean view on or off ("Show as written"). */
  | { readonly type: "setClean"; readonly on: boolean }
  /** 3.3: the reader picked a reading theme, text size or line width from the in-page Look popover. */
  | {
      readonly type: "setLook";
      readonly theme?: ReadingTheme;
      readonly fontScale?: number;
      readonly lineWidth?: LineWidth;
    }
  /** 3.0: the reader asked to compare with an older version (or to change / summarise the comparison). */
  | { readonly type: "redlineMenu" }
  | { readonly type: "redlineOff" }
  /** 3.0 named formats: the reader clicked the doc-kind chip — run "Compare with a Standard Format…" for this file. */
  | { readonly type: "compareFormat" }
  /** 3.0: open the version being compared and the file side by side, in VS Code's own compare view. */
  | { readonly type: "redlineSideBySide" }
  /**
   * 3.0: the reader ticked (or cleared) the task box drawn from source `line` of version `docVersion`. The host
   * edits that line only if the document is still that version and the line is still a task item.
   */
  | {
      readonly type: "setTask";
      readonly docVersion: number;
      readonly line: number;
      readonly checked: boolean;
    }
  /** 3.0: the reader clicked the status label in cell `column` of the table row at `line` — the host offers statuses. */
  | {
      readonly type: "statusMenu";
      readonly docVersion: number;
      readonly line: number;
      readonly column: number;
    };

/**
 * Doc Atlas graph page → host (owner call 2026-11-24): the reader clicked a box. `doc` opens a doc as a page,
 * `code` a code file beside it, `details` the doc's code table (functions, names gone). The host opens only paths
 * it put in the page's data.
 */
export type AtlasToHost = {
  readonly type: "atlasOpen";
  readonly kind: "doc" | "code" | "details";
  readonly path: string;
};

export function isAtlasToHost(v: unknown): v is AtlasToHost {
  return (
    isRecord(v) &&
    v.type === "atlasOpen" &&
    (v.kind === "doc" || v.kind === "code" || v.kind === "details") &&
    typeof v.path === "string" &&
    v.path.length > 0 &&
    v.path.length <= MAX_LINK_LENGTH
  );
}

/**
 * 3.3.0 interactive Plans Dashboard → host: open a plan (preview or browser), change sort, or trigger an action.
 * The host opens only paths present in the dashboard's data.
 */
export type PlansToHost =
  | { readonly type: "plansOpen"; readonly kind: "doc" | "browser"; readonly file: string }
  | {
      readonly type: "plansAction";
      readonly action: "refresh" | "exportMd" | "exportCsv" | "askAgent" | "newPlan";
    }
  | { readonly type: "plansSort"; readonly sort: PlanSort };

const PLAN_SORTS = new Set<string>(["attention", "changed", "progress", "date"]);
const PLAN_ACTIONS = new Set<string>(["refresh", "exportMd", "exportCsv", "askAgent", "newPlan"]);

export function isPlansToHost(v: unknown): v is PlansToHost {
  if (!isRecord(v)) return false;
  if (v.type === "plansOpen") {
    return (
      (v.kind === "doc" || v.kind === "browser") &&
      typeof v.file === "string" &&
      v.file.length > 0 &&
      v.file.length <= MAX_LINK_LENGTH
    );
  }
  if (v.type === "plansAction") return typeof v.action === "string" && PLAN_ACTIONS.has(v.action);
  if (v.type === "plansSort") return typeof v.sort === "string" && PLAN_SORTS.has(v.sort);
  return false;
}

/** Longest link a panel may ask the host to open (a sanity bound, not a feature limit). */
export const MAX_LINK_LENGTH = 2048;
/** Longest heading id either side accepts in a message (a sanity bound: ids come from heading text). */
export const MAX_HEADING_ID_LENGTH = 2048;

// ---------- runtime guards: the webview renders untrusted documents, so its messages are validated ----------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isLine = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isVersion = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
/** A valid outline layout (from either side). */
export function isOutlineLayout(v: unknown): v is OutlineLayout {
  return (
    isRecord(v) &&
    typeof v.outlineWidth === "number" &&
    Number.isInteger(v.outlineWidth) &&
    v.outlineWidth >= 0 &&
    v.outlineWidth <= MAX_OUTLINE_WIDTH &&
    typeof v.collapsed === "boolean"
  );
}
const isHeadingId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_HEADING_ID_LENGTH;

export function isWebviewToHost(v: unknown): v is WebviewToHost {
  if (!isRecord(v)) return false;
  switch (v.type) {
    case "ready":
    case "renderAnyway":
    case "openInBrowser":
    case "markRead":
    case "redlineMenu":
    case "redlineOff":
    case "redlineSideBySide":
    case "compareFormat":
    case "openAtlas":
    case "openPlans":
    case "openQuestions":
    case "showSource":
      return true;
    case "sectionMenu":
      return (
        typeof v.headingId === "string" &&
        v.headingId.length <= MAX_HEADING_ID_LENGTH &&
        (v.slides === undefined || typeof v.slides === "boolean")
      );
    case "openCode":
      return typeof v.text === "string" && v.text.trim().length > 0 && v.text.length <= MAX_CODE_REF_LENGTH;
    case "peekCode":
      return typeof v.text === "string" && v.text.trim().length > 0 && v.text.length <= MAX_LINK_LENGTH;
    case "runInTerminal":
      return typeof v.text === "string" && v.text.trim().length > 0 && v.text.length <= MAX_COPY_LENGTH;
    case "highlight":
    case "comment":
      return (
        typeof v.headingId === "string" &&
        v.headingId.length <= MAX_HEADING_ID_LENGTH &&
        typeof v.text === "string" &&
        v.text.trim().length > 0 &&
        v.text.length <= MAX_HIGHLIGHT_LENGTH
      );
    case "unhighlight":
      return typeof v.id === "string" && v.id.length > 0 && v.id.length <= 64;
    case "copy":
      return typeof v.text === "string" && v.text.length <= MAX_COPY_LENGTH;
    case "blockMenu":
      return isLine(v.block);
    case "setTask":
      return isVersion(v.docVersion) && isLine(v.line) && typeof v.checked === "boolean";
    case "statusMenu":
      return isVersion(v.docVersion) && isLine(v.line) && isLine(v.column) && (v.column as number) <= 1000;
    case "setClean":
      return typeof v.on === "boolean";
    case "setLook": {
      const hasTheme = v.theme !== undefined;
      const hasScale = v.fontScale !== undefined;
      const hasWidth = v.lineWidth !== undefined;
      if (!hasTheme && !hasScale && !hasWidth) return false;
      if (hasTheme && (typeof v.theme !== "string" || !THEMES.includes(v.theme))) return false;
      if (
        hasScale &&
        (typeof v.fontScale !== "number" ||
          !Number.isFinite(v.fontScale) ||
          v.fontScale < 0.7 ||
          v.fontScale > 2)
      )
        return false;
      if (hasWidth && (typeof v.lineWidth !== "string" || !WIDTHS.includes(v.lineWidth))) return false;
      return true;
    }
    case "openLink":
      return typeof v.href === "string" && v.href.length > 0 && v.href.length <= MAX_LINK_LENGTH;
    case "place":
      return isHeadingId(v.headingId);
    case "layout":
      return isOutlineLayout(v);
    case "jump":
      return (
        isVersion(v.docVersion) &&
        isLine(v.line) &&
        (v.headingId === undefined || typeof v.headingId === "string")
      );
    default:
      return false;
  }
}

export function isHostToWebview(v: unknown): v is HostToWebview {
  if (!isRecord(v)) return false;
  switch (v.type) {
    case "render":
      return (
        isVersion(v.docVersion) &&
        typeof v.fileName === "string" &&
        Array.isArray(v.headings) &&
        typeof v.html === "string" &&
        (v.readingTools === undefined || typeof v.readingTools === "boolean") &&
        (v.layout === undefined || isOutlineLayout(v.layout)) &&
        (v.extras === undefined || isPageExtras(v.extras))
      );
    case "extras":
      return isVersion(v.docVersion) && isPageExtras(v.extras);
    case "state":
      return (
        (v.state === "no-headings" ||
          v.state === "too-large" ||
          v.state === "error" ||
          v.state === "closed") &&
        typeof v.fileName === "string"
      );
    case "editorScrolled":
      return isVersion(v.docVersion) && isLine(v.topLine);
    case "reveal":
      return isVersion(v.docVersion) && isHeadingId(v.headingId);
    case "showSlides":
      return isVersion(v.docVersion);
    case "codePeek":
      return typeof v.text === "string" && (v.peek === undefined || isCodePeek(v.peek));
    default:
      return false;
  }
}

const isCodePeek = (v: unknown): v is CodePeek =>
  isRecord(v) &&
  typeof v.path === "string" &&
  isCount(v.total) &&
  (v.kind === "at" || v.kind === "outline") &&
  (v.line === undefined || isCount(v.line)) &&
  Array.isArray(v.rows) &&
  v.rows.length <= 50 &&
  v.rows.every(
    (r) => Array.isArray(r) && isCount(r[0]) && typeof r[1] === "string" && typeof r[2] === "boolean",
  );

/** Easy reading's "where this stands": the shape only (its text is drawn through textContent). */
const isStanding = (v: unknown): boolean =>
  isRecord(v) &&
  (v.status === undefined || typeof v.status === "string") &&
  ["parts", "events", "sections"].every((k) => Array.isArray(v[k]) && (v[k] as unknown[]).every(isRecord)) &&
  Array.isArray(v.disagree) &&
  v.disagree.every((d) => typeof d === "string");

const THEMES: readonly string[] = [
  "vscode",
  "paper",
  "github",
  "github-dark",
  "night",
  "warm-dark",
  "solarized-light",
  "focus",
];
const WIDTHS: readonly string[] = ["narrow", "normal", "wide", "full"];
const MARKS: readonly string[] = ["approve", "question", "change"];
const TRUST: readonly string[] = ["mismatch", "wrong", "conflict", "stale", "superseded", "verified"];
const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A valid PageExtras: every present field well-formed. */
export function isPageExtras(v: unknown): v is PageExtras {
  if (!isRecord(v)) return false;
  const { look, keyPoints, changed, reviews, highlights, trust, redline, badges, signoffs } = v;
  if (
    badges !== undefined &&
    !(
      Array.isArray(badges) &&
      badges.every(
        (b) =>
          isRecord(b) &&
          isHeadingId(b.headingId) &&
          isCount(b.tasks) &&
          isCount(b.questions) &&
          isCount(b.doubts),
      )
    )
  )
    return false;
  if (
    signoffs !== undefined &&
    !(
      Array.isArray(signoffs) &&
      signoffs.length <= 20 &&
      signoffs.every(
        (s) =>
          isRecord(s) &&
          typeof s.who === "string" &&
          s.who.length <= 200 &&
          typeof s.date === "string" &&
          s.date.length <= 20 &&
          typeof s.current === "boolean",
      )
    )
  )
    return false;
  const isPair = (p: unknown) => Array.isArray(p) && p.length === 2 && isLine(p[0]) && isLine(p[1]);
  if (
    redline !== undefined &&
    !(
      isRecord(redline) &&
      typeof redline.label === "string" &&
      redline.label.length <= 200 &&
      typeof redline.oldHtml === "string" &&
      redline.oldHtml.length <= MAX_REDLINE_HTML &&
      Array.isArray(redline.added) &&
      redline.added.every(isLine) &&
      Array.isArray(redline.changed) &&
      redline.changed.every(isPair) &&
      Array.isArray(redline.removed) &&
      redline.removed.every(isPair)
    )
  )
    return false;
  if (
    trust !== undefined &&
    !(
      Array.isArray(trust) &&
      trust.every(
        (t) =>
          isRecord(t) &&
          isLine(t.block) &&
          TRUST.includes(t.state as string) &&
          Array.isArray(t.reasons) &&
          t.reasons.every((r: unknown) => typeof r === "string"),
      )
    )
  )
    return false;
  if (
    look !== undefined &&
    !(
      isRecord(look) &&
      THEMES.includes(look.theme as string) &&
      WIDTHS.includes(look.lineWidth as string) &&
      typeof look.fontScale === "number" &&
      look.fontScale >= 0.5 &&
      look.fontScale <= 3 &&
      (look.clean === undefined || typeof look.clean === "boolean") &&
      (look.numbers === undefined || typeof look.numbers === "boolean")
    )
  )
    return false;
  const dk = v.docKind;
  if (
    dk !== undefined &&
    !(
      isRecord(dk) &&
      typeof dk.label === "string" &&
      dk.label.length <= 60 &&
      (dk.format === undefined || (typeof dk.format === "string" && dk.format.length <= 60))
    )
  )
    return false;
  const fm = v.frontMatter;
  if (
    fm !== undefined &&
    !(
      Array.isArray(fm) &&
      fm.length <= 40 &&
      fm.every(
        (f) =>
          isRecord(f) && typeof f.key === "string" && typeof f.value === "string" && f.value.length <= 500,
      )
    )
  )
    return false;
  if (
    keyPoints !== undefined &&
    !(
      isRecord(keyPoints) &&
      (keyPoints.tldr === undefined || typeof keyPoints.tldr === "string") &&
      isCount(keyPoints.tasksOpen) &&
      isCount(keyPoints.tasksDone) &&
      isCount(keyPoints.decisions) &&
      isCount(keyPoints.warnings)
    )
  )
    return false;
  if (changed !== undefined && !(Array.isArray(changed) && changed.every(isHeadingId))) return false;
  if (
    reviews !== undefined &&
    !(
      Array.isArray(reviews) &&
      reviews.every((r) => isRecord(r) && typeof r.headingId === "string" && MARKS.includes(r.mark as string))
    )
  )
    return false;
  if (
    highlights !== undefined &&
    !(
      Array.isArray(highlights) &&
      highlights.every(
        (h) =>
          isRecord(h) &&
          typeof h.id === "string" &&
          typeof h.headingId === "string" &&
          typeof h.text === "string" &&
          h.text.length <= MAX_HIGHLIGHT_LENGTH &&
          (h.note === undefined || (typeof h.note === "string" && h.note.length <= MAX_COMMENT_LENGTH)),
      )
    )
  )
    return false;
  const { codeRefs } = v;
  if (
    codeRefs !== undefined &&
    !(
      Array.isArray(codeRefs) &&
      codeRefs.length <= 2000 &&
      codeRefs.every((c) => typeof c === "string" && c.length <= MAX_CODE_REF_LENGTH)
    )
  )
    return false;
  if (v.standing !== undefined && !isStanding(v.standing)) return false;
  return true;
}
