import type { StateBlock, StateCore, StateInline, Token } from "markdown-it";

/**
 * Safe HTML tags (ADR-0002 amendment, 0.0.8): the harmless tags GitHub READMEs use render; everything else stays text.
 * markdown-it's own HTML support stays OFF. These rules recognise ONE allowlisted tag at a time, with no attributes
 * (the only one docmap writes is `open` on `<details>`), and the renderers below emit docmap's fixed strings — no
 * character of the document is ever copied into markup. Every rule reads a bounded amount of text: linear.
 *
 * 0.0.12 (owner call): pictures, anchors and links — `<img>`, `<picture>` + `<source>`, `<a href>`, `<a id>` — keep
 * a few NAMED attributes, each checked: image paths go through the same resolver as Markdown images (local files
 * in the opened folders only), links through the same URL check as Markdown links, anchor names are letters,
 * digits, `-` and `_`, sizes are numbers, alt text is escaped. Any other attribute is dropped.
 */

/** Inline tags that render (as themselves, without attributes). */
const INLINE = new Set([
  "b",
  "i",
  "em",
  "strong",
  "s",
  "u",
  "ins",
  "del",
  "mark",
  "kbd",
  "sup",
  "sub",
  "small",
  "code",
  "picture",
]);
/** `<br>`, `<br/>`, `<br />`, or an allowlisted tag with nothing inside it but its name: `<kbd>`, `</kbd>`. */
const INLINE_TAG = /<(\/?)([a-zA-Z]{1,7}) ?(\/?)>/y;

/** A tag the renderer writes out; `src` is what the document said, shown as text if the tag stays unpaired. */
interface TagMeta {
  readonly name: string;
  readonly close: boolean;
  readonly src: string;
  /** For `<a>` only: the checked attributes, already escaped (built here, never the document's text as typed). */
  readonly attrs?: string;
}

/** An `<img>` or `<source>`: its checked attributes, resolved and written out by the renderer. */
interface MediaMeta {
  readonly name: "img" | "source";
  /** img: `src` as written (resolved at render time); source: the one URL of `srcset`. */
  readonly url: string;
  readonly alt?: string;
  readonly width?: string;
  readonly height?: string;
  /** source: the colour scheme it is for — the only media query kept. */
  readonly scheme?: "dark" | "light";
}

/**
 * A tag with attributes: `<a …>`, `<img …>`, `<source …>`. Bounded: at most 12 attributes of at most 1000
 * characters each, so a failed match costs a bounded scan (the rule stays linear).
 */
const ATTR_TAG =
  /<(a|img|source)((?:\s+[a-zA-Z][a-zA-Z-]{0,19}(?:\s*=\s*(?:"[^"<>]{0,1000}"|'[^'<>]{0,1000}'|[^\s"'=<>`]{1,1000}))?){0,12})\s*\/?>/iy;
const ATTR = /([a-zA-Z][a-zA-Z-]{0,19})(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const ANCHOR_NAME = /^[A-Za-z0-9_-]{1,100}$/;
const SIZE = /^\d{1,4}$/;
const SCHEME_QUERY = /^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/i;

/** The attributes of a tag, lower-cased names, first one wins; `&amp;`, `&quot;`, `&#39;` … decoded. */
function attributesOf(text: string): Map<string, string> {
  const found = new Map<string, string>();
  ATTR.lastIndex = 0;
  for (let m = ATTR.exec(text); m; m = ATTR.exec(text)) {
    const name = (m[1] ?? "").toLowerCase();
    if (!found.has(name)) found.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ""));
  }
  return found;
}

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, e: string) =>
    e === "amp" ? "&" : e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : "'",
  );
}

export function safeAttrTag(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
  ATTR_TAG.lastIndex = state.pos;
  const m = ATTR_TAG.exec(state.src);
  if (!m) return false;
  const name = (m[1] ?? "").toLowerCase();
  const attrs = attributesOf(m[2] ?? "");
  if (!silent) {
    if (name === "a") {
      let out = "";
      const href = attrs.get("href");
      // the same check as Markdown links (the parser's validateLink); never a data: URL
      // …and normalised like a Markdown link's (percent-encoded), so both kinds reach the page in the same form
      if (href !== undefined && state.md.validateLink(href) && !/^\s*data:/i.test(href))
        out += ` href="${escapeAttr(state.md.normalizeLink(href))}"`;
      const id = [attrs.get("id"), attrs.get("name")].find((v) => v !== undefined && ANCHOR_NAME.test(v));
      if (id !== undefined) out += ` id="${id}"`;
      const token = state.push("docmap_tag", "", 0);
      token.meta = { name: "a", close: false, src: m[0], attrs: out } satisfies TagMeta;
    } else {
      const media: MediaMeta | undefined = name === "img" ? imgMeta(attrs) : sourceMeta(attrs);
      const token = state.push(media ? "docmap_media" : "docmap_nothing", "", 0);
      token.meta = (media ?? null) as unknown as Token["meta"];
    }
  }
  state.pos += m[0].length;
  return true;
}

function imgMeta(attrs: Map<string, string>): MediaMeta {
  const width = attrs.get("width");
  const height = attrs.get("height");
  return {
    name: "img",
    url: (attrs.get("src") ?? "").trim(),
    alt: attrs.get("alt") ?? "",
    ...(width !== undefined && SIZE.test(width) ? { width } : {}),
    ...(height !== undefined && SIZE.test(height) ? { height } : {}),
  };
}

/** A `<source>` counts only with one URL and, if any media query, a light/dark one — else it is left out. */
function sourceMeta(attrs: Map<string, string>): MediaMeta | undefined {
  const url = (attrs.get("srcset") ?? "").trim().split(/[\s,]/)[0] ?? "";
  const query = attrs.get("media");
  const scheme = query === undefined ? undefined : SCHEME_QUERY.exec(query.trim())?.[1]?.toLowerCase();
  if (!url || (query !== undefined && !scheme)) return undefined;
  return { name: "source", url, ...(scheme ? { scheme: scheme as "dark" | "light" } : {}) };
}

export function safeInlineTag(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x3c /* < */) return false;
  INLINE_TAG.lastIndex = state.pos;
  const m = INLINE_TAG.exec(state.src);
  if (!m) return false;
  const name = (m[2] ?? "").toLowerCase();
  const close = m[1] === "/";
  const selfClosing = m[3] === "/";
  const isBreak = name === "br" && !close;
  const closesLink = name === "a" && close; // `<a …>` itself is safeAttrTag's
  if (!isBreak && !closesLink && (!INLINE.has(name) || selfClosing)) return false;
  if (!silent) {
    const token = state.push(isBreak ? "docmap_br" : "docmap_tag", "", 0);
    token.meta = { name, close, src: m[0] } satisfies TagMeta;
  }
  state.pos += m[0].length;
  return true;
}

/**
 * A `<details>` line, a `</details>` line, or a `<summary>…</summary>` line (also `<details><summary>…</summary>`
 * on one line). One line only — the lines after it are Markdown as usual, so a heading below a `<details>` stays a
 * heading (the failure that got `html: true` reverted in M1).
 */
const DETAILS_OPEN = /^<details( open)?>\s*(?:<summary>(.*)<\/summary>)?$/i;
const DETAILS_CLOSE = /^<\/details>$/i;
const SUMMARY = /^<summary>(.*)<\/summary>$/i;

export function safeBlockTag(
  state: StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean {
  if ((state.sCount[startLine] ?? 0) - state.blkIndent >= 4) return false; // indented code
  const start = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
  if (state.src.charCodeAt(start) !== 0x3c /* < */) return false;
  const line = state.src.slice(start, state.eMarks[startLine]).trimEnd();
  const open = DETAILS_OPEN.exec(line);
  const close = open ? null : DETAILS_CLOSE.exec(line);
  const summary = open || close ? null : SUMMARY.exec(line);
  if (!open && !close && !summary) return false;
  if (silent) return true;

  const map: [number, number] = [startLine, startLine + 1];
  const tag = (name: string, isClose: boolean, attrs = "") => {
    const token = state.push("docmap_block_tag", "", 0);
    token.meta = { name, close: isClose, src: line, attrs };
    token.map = map;
  };
  const summaryLine = (content: string) => {
    tag("summary", false);
    const inline = state.push("inline", "", 0);
    inline.content = content.trim();
    inline.map = map;
    inline.children = [];
    tag("summary", true);
  };
  if (open) {
    tag("details", false, open[1] ? " open" : "");
    if (open[2] !== undefined) summaryLine(open[2]);
  } else if (close) {
    tag("details", true);
  } else if (summary) {
    summaryLine(summary[1] ?? "");
  }
  state.line = startLine + 1;
  return true;
}

/**
 * Pairs the tags up, so none can leak past where the document meant it to end: an inline tag without its partner in
 * the same paragraph, a `</details>` with no `<details>` open, and a `<summary>` outside a `<details>` turn back into
 * the text the document had; a `<details>` still open at the end is closed there.
 */
export function balanceSafeTags(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type === "inline" && token.children) balanceInline(token.children);
  }
  const open: Token[] = [];
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token?.type !== "docmap_block_tag") continue;
    const meta = metaOf(token);
    if (meta.name === "details") {
      if (!meta.close) open.push(token);
      else if (open.length > 0) open.pop();
      else toText(token);
    } else if (!meta.close && open.length === 0) {
      // a <summary> line outside any <details>: the whole line shows as the text it was
      toText(token);
      const inline = tokens[i + 1];
      const closing = tokens[i + 2];
      if (inline?.type === "inline") {
        inline.children = [];
        inline.content = "";
      }
      if (closing?.type === "docmap_block_tag") closing.type = "docmap_nothing";
      i += 2;
    }
  }
  for (let i = 0; i < open.length; i++) {
    const closing = new state.Token("docmap_block_tag", "", 0);
    closing.meta = { name: "details", close: true, src: "" };
    state.tokens.push(closing);
  }
}

function balanceInline(children: Token[]): void {
  const stack: Token[] = [];
  for (const token of children) {
    if (token.type !== "docmap_tag") continue;
    const meta = metaOf(token);
    if (!meta.close) stack.push(token);
    else if ((stack.at(-1) ? metaOf(stack.at(-1) as Token) : undefined)?.name === meta.name) stack.pop();
    else toText(token); // nesting must be proper: </b> only closes the innermost open <b>
  }
  for (const unclosed of stack) toText(unclosed);
}

function metaOf(token: Token): TagMeta {
  return token.meta as unknown as TagMeta;
}

/** The tag stays what the document typed: text, escaped by markdown-it's own text renderer. */
function toText(token: Token): void {
  const src = metaOf(token).src;
  if (token.type === "docmap_block_tag") {
    token.type = "docmap_block_text";
    token.content = src;
  } else {
    token.type = "text";
    token.content = src;
  }
}

/** Renderers: fixed strings only. The name comes from the allowlist above (checked again here). */
export const safeTagRenderers = {
  docmap_tag: (tokens: Token[], idx: number): string => {
    const meta = tokens[idx]?.meta as unknown as TagMeta | undefined;
    if (!meta || (!INLINE.has(meta.name) && meta.name !== "a")) return "";
    if (meta.close) return `</${meta.name}>`;
    return meta.name === "a" ? `<a${meta.attrs ?? ""}>` : `<${meta.name}>`;
  },
  /** `<img>` / `<source>`: the path loads only if the host's resolver approves it (as for Markdown images). */
  docmap_media: (tokens: Token[], idx: number, resolve: (url: string) => string | undefined): string => {
    const meta = tokens[idx]?.meta as unknown as MediaMeta | undefined;
    if (!meta) return "";
    const url = resolve(meta.url);
    if (meta.name === "source") {
      if (url === undefined) return "";
      const media = meta.scheme
        ? ` media="(prefers-color-scheme: ${meta.scheme})" data-scheme="${meta.scheme}"`
        : "";
      return `<source srcset="${escapeAttr(url)}"${media}>`;
    }
    if (url === undefined) {
      const label = meta.alt || meta.url.split(/[/?#]/).filter(Boolean).pop() || "image";
      return `<span class="image-alt" title="${escapeAttr(meta.url)}">[image: ${escapeAttr(label)}]</span>`;
    }
    const size = `${meta.width ? ` width="${meta.width}"` : ""}${meta.height ? ` height="${meta.height}"` : ""}`;
    return `<img src="${escapeAttr(url)}" alt="${escapeAttr(meta.alt ?? "")}"${size}>`;
  },
  docmap_br: (): string => "<br>\n",
  docmap_block_tag: (tokens: Token[], idx: number): string => {
    const meta = tokens[idx]?.meta as unknown as (TagMeta & { attrs?: string }) | undefined;
    if (!meta || (meta.name !== "details" && meta.name !== "summary")) return "";
    if (meta.close) return `</${meta.name}>\n`;
    if (meta.name === "summary") return "<summary>";
    return meta.attrs === " open" ? "<details open>\n" : "<details>\n";
  },
};

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
