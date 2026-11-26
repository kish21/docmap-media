import type { ParsedDocument } from "../outline/types";
import type { InferHeadings } from "./reading-rules";

/** The port every Markdown parser sits behind (ADR-0002: markdown-it, raw HTML off, HTML comments dropped). */
export interface MarkdownEngine {
  /** Pure and total: never throws; a failure comes back as `{ ok: false }`. */
  parse(text: string, docVersion: number, options?: ParseOptions): ParseResult;
}

export interface ParseOptions {
  /**
   * Maps a RELATIVE image path from the document (`img/diagram.png`) to a URL the panel may load, or `undefined`
   * to refuse it (the image then shows its alt text). Never called for absolute URLs — those are never loaded.
   */
  readonly resolveImage?: (src: string) => string | undefined;
  /**
   * Structure hints: whether lines that act as headings (a bold-only line, "2.1 Title") join the outline.
   * "auto" (default): only in documents with too few real headings. Every caller must pass the same value for
   * one document, or heading ids differ between the render and a later jump.
   */
  readonly inferHeadings?: InferHeadings;
  /**
   * Reading tools (setting `docmap.readingTools`, off by default): footnotes, task lists, callouts, section sizes
   * and structure hints. Off — the default — parsing is exactly the base parser, as in 0.0.3; `inferHeadings`
   * then has no effect.
   */
  readonly readingTools?: boolean;
  /** 3.0: put `data-block="<index>"` on each top-level block in the HTML (the preview's trust markers need it). */
  readonly blockIds?: boolean;
}

export type ParseResult =
  | { readonly ok: true; readonly document: ParsedDocument }
  | { readonly ok: false; readonly reason: string };
