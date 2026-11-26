/**
 * The document model docmap works on. Units are stated once, here, and used everywhere:
 *  - `line`  : 0-based source line in the document text (same as VS Code `Position.line` and markdown-it `token.map`).
 *  - `level` : Markdown heading level, 1–6 (`#` = 1).
 *  - `bytes` : UTF-8 byte length of the document text (what `docmap.largeFileBytes` is compared against).
 *  - `docVersion` : VS Code `TextDocument.version` the data was computed from; stale data is dropped by comparing it.
 */

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface Heading {
  /** Anchor id, GitHub-style slug, unique within the document ("setup", "setup-1"). Matches `#links` in the doc. */
  readonly id: string;
  /** Plain text of the heading (inline Markdown stripped, HTML comments removed). */
  readonly text: string;
  readonly level: HeadingLevel;
  /** 0-based source line of the heading. */
  readonly line: number;
  /** Words in the section, sub-sections included (what opening it means reading). Absent from older hosts. */
  readonly words?: number;
  /** Not a Markdown heading: a line that acts as one (a bold-only line, "2.1 Title") — structure hints. */
  readonly inferred?: boolean;
}

/** A heading with the headings nested under it (the outline tree the webview draws). */
export interface OutlineNode {
  readonly heading: Heading;
  readonly children: readonly OutlineNode[];
}

/** Everything the panel needs for one version of one document. */
export interface ParsedDocument {
  readonly docVersion: number;
  /** Flat, in document order. The tree is derived from it (`buildOutline`), never stored separately. */
  readonly headings: readonly Heading[];
  /** Rendered body. Produced ONLY by the MarkdownEngine (raw HTML off — ADR-0002); headings carry `id` = Heading.id. */
  readonly html: string;
  readonly lineCount: number;
  readonly bytes: number;
  /**
   * 3.0: the top-level blocks (paragraph, list, table, code, quote…) in document order, as source line ranges. In the
   * HTML each carries `data-block="<index>"` (on itself, or on the code element of a code block), so the page can put
   * a trust marker beside it and the host knows which source lines it holds.
   */
  readonly blocks?: readonly SourceBlock[];
}

export interface SourceBlock {
  /** 0-based first line and end line (exclusive). */
  readonly line: number;
  readonly end: number;
  /** markdown-it's block type without "_open": paragraph, bullet_list, ordered_list, table, fence, blockquote… */
  readonly kind: string;
}

export function isHeadingLevel(n: number): n is HeadingLevel {
  return Number.isInteger(n) && n >= 1 && n <= 6;
}
