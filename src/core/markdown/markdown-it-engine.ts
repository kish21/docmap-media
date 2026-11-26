import MarkdownIt, {
  type Env,
  type RendererRule,
  type StateBlock,
  type StateInline,
  type Token,
} from "markdown-it";
import footnote from "markdown-it-footnote";
import { Slugger } from "../outline/slug";
import { type Heading, isHeadingLevel, type SourceBlock } from "../outline/types";
import type { MarkdownEngine, ParseOptions, ParseResult } from "./engine";
import { footnoteRef, footnoteTail } from "./footnote-linear";
import { callouts, flattenFootnoteHeadings, inferHeadings, sectionWords, taskLists } from "./reading-rules";
import { balanceSafeTags, safeAttrTag, safeBlockTag, safeInlineTag, safeTagRenderers } from "./safe-html";

/**
 * The markdown-it implementation of the MarkdownEngine port (ADR-0002).
 *
 * - Raw HTML is OFF: any HTML in a document is shown as text and never executes — except a short allowlist of
 *   harmless tags (`<details>`, `<kbd>`, `<br>` …), re-emitted by docmap without attributes (safe-html.ts).
 * - HTML comments are recognised by docmap's own rules below and dropped, like GitHub and VS Code hide them.
 *   The rules are linear in the document size (markdown-it's HTML scanner is not on hostile input).
 * - Links may only be http(s), mailto, same-document (#…) or relative; anything else stays plain text.
 * - Table alignment becomes a class, because the panel's CSP forbids inline styles.
 * - YAML front matter is skipped (its lines kept blank, so line numbers stay true).
 * - Reading tools, ONLY when asked for (`readingTools`, off by default): footnotes, task lists, callouts, section
 *   sizes, structure hints (reading-rules.ts). Off, the output is exactly the base parser's.
 */
export function createMarkdownItEngine(): MarkdownEngine {
  const base = createParser();
  let tools: Md | undefined; // built the first time reading tools are asked for — off by default

  return {
    parse(text: string, docVersion: number, options: ParseOptions = {}): ParseResult {
      try {
        const withTools = options.readingTools === true;
        if (withTools && !tools) tools = withReadingTools(createParser());
        const md = withTools && tools ? tools : base;
        // docId namespaces footnote ids ("fn-d:-1"): a heading slug never contains ":", so they cannot collide
        const env: Env = { resolveImage: options.resolveImage, docId: "d:" };
        const tokens = md.parse(blankFrontMatter(text), env);
        if (withTools) {
          flattenFootnoteHeadings(tokens);
          inferHeadings(tokens, options.inferHeadings ?? "auto");
        }
        const found = collectHeadings(tokens);
        const blocks = markBlocks(tokens, options.blockIds === true);
        let headings: Heading[] = found;
        if (withTools) {
          const words = sectionWords(
            tokens,
            found.map((h) => h.level),
          );
          headings = found.map((h, i) => ({ ...h, words: words[i] ?? 0 }));
        }
        return {
          ok: true,
          document: {
            docVersion,
            headings,
            html: md.renderer.render(tokens, md.options, env),
            lineCount: countLines(text),
            bytes: utf8Bytes(text),
            blocks,
          },
        };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

type Md = InstanceType<typeof MarkdownIt>;

/** Top-level blocks get `data-block="<index>"` and come back as line ranges (3.0 trust markers). Headings excluded. */
function markBlocks(tokens: ReturnType<Md["parse"]>, mark: boolean): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  for (const t of tokens) {
    if (t.level !== 0 || !t.map || t.nesting === -1 || t.type === "inline" || t.type.startsWith("heading"))
      continue;
    if (t.nesting === 0 && !["fence", "code_block", "hr", "html_block"].includes(t.type)) continue;
    if (t.type === "hr") continue;
    if (mark) t.attrSet("data-block", String(blocks.length));
    blocks.push({ line: t.map[0], end: t.map[1], kind: t.type.replace(/_open$/, "") });
  }
  return blocks;
}

/** The base parser (0.0.3 and the default): CommonMark + docmap's safety rules, nothing more. */
function createParser(): Md {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  md.validateLink = isAllowedUrl;
  // like CommonMark's HTML block type 2, a comment may interrupt a paragraph
  md.block.ruler.before("html_block", "docmap_comment", commentBlock, {
    alt: ["paragraph", "reference", "blockquote"],
  });
  md.inline.ruler.before("html_inline", "docmap_comment", commentInline);
  md.renderer.rules.docmap_comment = () => "";
  // safe HTML tags (ADR-0002 amendment): one allowlisted tag at a time, no attributes, balanced
  md.block.ruler.before("html_block", "docmap_safe_tag", safeBlockTag, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
  md.inline.ruler.before("html_inline", "docmap_safe_tag", safeInlineTag);
  // pictures, anchors and links keep a few checked attributes (0.0.12)
  md.inline.ruler.before("html_inline", "docmap_attr_tag", safeAttrTag);
  md.renderer.rules.docmap_media = (tokens, idx, _options, env) =>
    safeTagRenderers.docmap_media(tokens, idx, (url) => resolveImageUrl(url, env as RenderEnv));
  md.core.ruler.push("docmap_safe_balance", balanceSafeTags);
  md.renderer.rules.docmap_tag = safeTagRenderers.docmap_tag;
  md.renderer.rules.docmap_br = safeTagRenderers.docmap_br;
  md.renderer.rules.docmap_block_tag = safeTagRenderers.docmap_block_tag;
  md.renderer.rules.docmap_block_text = (tokens, idx) =>
    `<p>${md.utils.escapeHtml(tokens[idx]?.content ?? "")}</p>\n`;
  md.renderer.rules.docmap_nothing = () => "";
  md.renderer.rules.th_open = alignAsClass;
  md.renderer.rules.td_open = alignAsClass;
  md.renderer.rules.image = renderImage;
  return md;
}

/** Reading tools (setting `docmap.readingTools`, off by default): footnotes, task lists, callouts. */
function withReadingTools(md: Md): Md {
  md.use(footnote);
  // two of the plugin's rules are quadratic on crafted input: linear equivalents (footnote-linear.ts)
  md.inline.ruler.at("footnote_ref", footnoteRef);
  md.core.ruler.at("footnote_tail", footnoteTail);
  md.core.ruler.push("docmap_tasks", taskLists);
  md.core.ruler.push("docmap_callouts", callouts);
  // fixed markup only: the checkbox state and the callout title come from docmap, never from the document
  md.renderer.rules.docmap_task = (tokens, idx) => {
    const line = tokens[idx]?.meta?.line;
    const at = Number.isInteger(line) ? ` data-line="${line}"` : "";
    return `<input class="task-checkbox" type="checkbox" disabled${tokens[idx]?.meta?.checked ? " checked" : ""}${at}> `;
  };
  // table rows carry their source line, so a status label in a cell can be changed from the page
  md.core.ruler.push("docmap_row_lines", (state) => {
    for (const t of state.tokens) if (t.type === "tr_open" && t.map) t.attrSet("data-line", String(t.map[0]));
  });
  md.renderer.rules.docmap_callout_title = (tokens, idx) =>
    `<p class="callout-title">${escapeAttr(String(tokens[idx]?.meta?.title ?? "Note"))}</p>\n`;
  return md;
}

// ---------- headings ----------

/** Finds every heading, gives it a GitHub-compatible id, and stamps id + source line onto its token. */
function collectHeadings(tokens: Token[]): Heading[] {
  const found: { open: Token; text: string; level: Heading["level"]; line: number; inferred: boolean }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i];
    if (open?.type !== "heading_open") continue;
    const level = Number(open.tag.slice(1));
    const line = open.map?.[0];
    if (!isHeadingLevel(level) || line === undefined) continue;
    found.push({ open, text: plainText(tokens[i + 1]), level, line, inferred: open.meta?.inferred === true });
  }
  // Real headings are slugged first, in document order, so they keep exactly the ids GitHub gives them (and that
  // #links point at); inferred headings take what is left — a bold "Usage" line never steals "#usage".
  const slugger = new Slugger();
  const ids = new Map<Token, string>();
  for (const h of found) if (!h.inferred) ids.set(h.open, slugger.slug(h.text));
  for (const h of found) if (h.inferred) ids.set(h.open, slugger.slug(h.text));
  return found.map(({ open, text, level, line, inferred }) => {
    const id = ids.get(open) ?? "";
    open.attrSet("id", id);
    open.attrSet("data-line", String(line));
    return inferred ? { id, text, level, line, inferred: true } : { id, text, level, line };
  });
}

/** The visible text of a heading's inline token: markup and comments removed. */
function plainText(inline: Token | undefined): string {
  let text = "";
  for (const child of inline?.children ?? []) {
    if (child.type === "text" || child.type === "code_inline") text += child.content;
    else if (child.type === "softbreak" || child.type === "hardbreak") text += " ";
    else if (child.type === "image") text += plainText(child);
  }
  return text.replace(/\s+/g, " ").trim();
}

// ---------- HTML comments (CommonMark: "<!-->", "<!--->" or "<!--" … "-->") ----------

/** End offset (exclusive) of a comment starting at `start`, or -1 when it has no terminator. */
function commentEnd(src: string, start: number, noEndFrom: { value: number }): number {
  if (src.charCodeAt(start + 4) === 0x3e) return start + 5; // <!-->
  if (src.startsWith("->", start + 4)) return start + 6; // <!--->
  if (start + 4 >= noEndFrom.value) return -1; // already known: nothing after here closes a comment
  const close = src.indexOf("-->", start + 4);
  if (close === -1) {
    noEndFrom.value = start + 4; // keeps repeated unterminated openers linear, not quadratic
    return -1;
  }
  return close + 3;
}

interface CommentEnv {
  docmapInlineNoEnd?: { src: string; noEndFrom: { value: number } };
}

/**
 * A comment starting a block (CommonMark HTML block type 2): dropped through the line holding "-->", or to the
 * end of its CONTAINER (list item, blockquote) when there is none. Each line is scanned once, and only its own
 * text — never the rest of the file — so the cost is linear however many openers a document holds.
 */
function commentBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const start = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
  if ((state.sCount[startLine] ?? 0) - state.blkIndent >= 4) return false; // indented code
  if (!state.src.startsWith("<!--", start)) return false;
  if (silent) return true;

  let last = startLine;
  let end = -1; // offset just after "-->" once found
  if (state.src.charCodeAt(start + 4) === 0x3e) {
    end = start + 5; // <!-->
  } else if (state.src.startsWith("->", start + 4)) {
    end = start + 6; // <!--->
  }
  for (let line = startLine; end === -1 && line < endLine; line++) {
    if (line > startLine && (state.sCount[line] ?? 0) < state.blkIndent) break; // left the container
    last = line;
    const from = line === startLine ? start + 4 : (state.bMarks[line] ?? 0) + (state.tShift[line] ?? 0);
    const close = state.src.slice(from, state.eMarks[line]).indexOf("-->");
    if (close !== -1) end = from + close + 3;
  }
  if (end === -1) end = state.eMarks[last] ?? state.src.length;

  const comment = state.push("docmap_comment", "", 0);
  comment.map = [startLine, last + 1];
  const tail = state.src.slice(end, state.eMarks[last]).trim();
  if (tail) {
    // text after "-->" on the closing line is still visible content
    state.push("paragraph_open", "p", 1).map = [last, last + 1];
    const inline = state.push("inline", "", 0);
    inline.content = tail;
    inline.map = [last, last + 1];
    inline.children = [];
    state.push("paragraph_close", "p", -1);
  }
  state.line = last + 1;
  return true;
}

/** A comment inside a paragraph or heading. An unterminated "<!--" stays visible text, as in CommonMark. */
function commentInline(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x3c || !state.src.startsWith("<!--", start)) return false;
  const env = state.env as CommentEnv;
  if (env.docmapInlineNoEnd?.src !== state.src) {
    env.docmapInlineNoEnd = { src: state.src, noEndFrom: { value: Number.POSITIVE_INFINITY } };
  }
  const end = commentEnd(state.src, start, env.docmapInlineNoEnd.noEndFrom);
  if (end === -1) return false;
  if (!silent) state.push("docmap_comment", "", 0);
  state.pos = end;
  return true;
}

// ---------- links, tables, front matter ----------

const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);
const SAFE_DATA_IMAGE = /^data:image\/(?:png|gif|jpeg|webp);/;

/**
 * Only web, mail, same-document and relative links. vscode:, command:, file:, javascript:… stay text — and so does a
 * "network-path" link (`//host/…`, or with backslashes): from a page opened as a file (the browser snapshot) it
 * becomes `file://host/…`, which on Windows makes the machine connect to that host.
 */
export function isAllowedUrl(url: string): boolean {
  // browsers drop leading control characters before reading a scheme ("\x01javascript:" is javascript:): refuse
  // any control character outright rather than guess which ones a browser skips
  if (hasControlCharacter(url)) return false;
  const u = url
    .replace(/[\t\n\r]/g, "")
    .trim()
    .toLowerCase(); // browsers drop tabs/newlines inside URLs too
  if (/^[\\/]{2}/.test(u)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(u)?.[1];
  if (scheme === undefined) return true; // relative path or #fragment
  return SAFE_SCHEMES.has(scheme) || SAFE_DATA_IMAGE.test(u);
}

/** A C0 control character (other than tab / newline / carriage return, which browsers drop inside URLs) or DEL. */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) return true;
  }
  return false;
}

const alignAsClass: RendererRule = (tokens, idx, options, _env, self) => {
  const token = tokens[idx];
  const style = token?.attrGet("style");
  if (token && style) {
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== "style");
    const align = /text-align:\s*(left|right|center)/.exec(String(style))?.[1];
    if (align) token.attrJoin("class", `align-${align}`);
  }
  return self.renderToken(tokens, idx, options);
};

interface RenderEnv {
  readonly resolveImage?: ((src: string) => string | undefined) | undefined;
}

/**
 * Images: a RELATIVE path is loaded only through the host's resolver (a local file it approved); anything else
 * — remote URLs, refused paths — is never requested and shows its alt text instead. (`data:image/png…` inline
 * images, already allowed by `isAllowedUrl`, render as they are.)
 */
const renderImage: RendererRule = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (!token) return "";
  const src = String(token.attrGet("src") ?? "");
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const resolved = resolveImageUrl(src, env as RenderEnv);
  if (resolved === undefined) {
    const label = alt || src.split(/[/?#]/).filter(Boolean).pop() || "image";
    return `<span class="image-alt" title="${escapeAttr(src)}">[image: ${escapeAttr(label)}]</span>`;
  }
  token.attrSet("src", resolved);
  token.attrSet("alt", alt); // renderToken does not fill alt from the children, the default image rule did
  return self.renderToken(tokens, idx, options);
};

/** A relative path through the host's resolver; an inline `data:image/…` as it is; anything else: not loaded. */
function resolveImageUrl(src: string, env: RenderEnv): string | undefined {
  const isRelative = src !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//");
  if (isRelative) return env.resolveImage?.(src);
  return SAFE_DATA_IMAGE.test(src) ? src : undefined;
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Blanks a leading YAML front-matter block, keeping every line so positions stay true. Only a block that looks
 * like YAML counts — `---`, then a `key:` line, … `---` — so a document that merely opens with a rule keeps
 * its content (a heading after a leading `---` must not vanish).
 */
function blankFrontMatter(text: string): string {
  if (!/^---\r?\n[A-Za-z0-9_"'-][^\n]*:/.test(text)) return text;
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if ((lines[i] ?? "").replace(/\r$/, "") === "---")
      return lines.map((l, n) => (n <= i ? "" : l)).join("\n");
  }
  return text; // no closing fence: not front matter
}

// ---------- measures (units: see outline/types.ts) ----------

/** Same count as VS Code's `TextDocument.lineCount`: newlines + 1. */
function countLines(text: string): number {
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** UTF-8 byte length without DOM/Node APIs (core stays runtime-neutral — ADR-0001). */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      bytes += 4; // surrogate pair = one 4-byte code point
      i++;
    } else bytes += 3;
  }
  return bytes;
}
