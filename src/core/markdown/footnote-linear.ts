import type { StateCore, StateInline, Token } from "markdown-it";

/**
 * Two rules of markdown-it-footnote 4.0.0, replaced by linear equivalents (security review, 0.0.4). The originals
 * were quadratic on crafted input, and parsing runs on VS Code's shared extension thread:
 *  - `footnote_ref` scanned from every "[^" to the next "]", space or newline with no bound — a long line of
 *    openers cost O(n²) (47 s for 160 KB, measured);
 *  - `footnote_tail` rebuilt the whole token array once per footnote (`tokens = tokens.concat(…)`) — O(notes ×
 *    tokens) (16 s for 20 000 notes, measured).
 * Same output as the plugin for every well-formed document; the plugin still provides the block rule, the
 * inline `^[…]` rule and all renderers. One deliberate difference: a reference label may not contain "[" or run past
 * 999 characters (as in CommonMark/GFM); such a "reference" stays text.
 */

/** CommonMark's link-label limit: a label longer than this is not a label. */
const MAX_LABEL = 999;

interface FootnoteEnv {
  footnotes?: {
    refs?: Record<string, number>;
    list?: { label?: string; count: number; tokens?: Token[]; content?: string }[];
  };
}

/** `[^label]` — a reference to a defined footnote. The label scan stops at "[", and after MAX_LABEL characters. */
export function footnoteRef(state: StateInline, silent: boolean): boolean {
  const max = state.posMax;
  const start = state.pos;
  if (start + 3 > max) return false;
  const env = state.env as FootnoteEnv;
  if (!env.footnotes?.refs) return false;
  if (state.src.charCodeAt(start) !== 0x5b /* [ */ || state.src.charCodeAt(start + 1) !== 0x5e /* ^ */)
    return false;

  let pos = start + 2;
  const limit = Math.min(max, pos + MAX_LABEL + 1);
  for (; pos < limit; pos++) {
    const c = state.src.charCodeAt(pos);
    if (c === 0x20 || c === 0x0a || c === 0x5b /* [ — a label cannot contain one: stop, keep it linear */)
      return false;
    if (c === 0x5d /* ] */) break;
  }
  if (pos === start + 2 || pos >= limit || state.src.charCodeAt(pos) !== 0x5d) return false;
  const label = state.src.slice(start + 2, pos);
  pos++;
  const refs = env.footnotes.refs;
  if (refs[`:${label}`] === undefined) return false;

  if (!silent) {
    env.footnotes.list ??= [];
    const list = env.footnotes.list;
    let footnoteId = refs[`:${label}`] ?? -1;
    if (footnoteId < 0) {
      footnoteId = list.length;
      list[footnoteId] = { label, count: 0 };
      refs[`:${label}`] = footnoteId;
    }
    const entry = list[footnoteId] ?? { label, count: 0 };
    const token = state.push("footnote_ref", "", 0);
    token.meta = { id: footnoteId, subId: entry.count, label };
    entry.count++;
  }
  state.pos = pos;
  state.posMax = max;
  return true;
}

/** Moves footnote definitions out of the flow and appends the notes list at the end — in one pass. */
export function footnoteTail(state: StateCore): void {
  const env = state.env as FootnoteEnv;
  if (!env.footnotes) return;

  const refTokens: Record<string, Token[]> = {};
  const kept: Token[] = [];
  let current: Token[] | undefined;
  let currentLabel = "";
  for (const tok of state.tokens) {
    if (tok.type === "footnote_reference_open") {
      current = [];
      currentLabel = String(tok.meta?.label ?? "");
    } else if (tok.type === "footnote_reference_close") {
      // a definition nested in another one closes first: the outer close must not overwrite it with nothing
      if (current) refTokens[`:${currentLabel}`] = current; // ":" keeps labels off Object.prototype
      current = undefined;
    } else if (current) current.push(tok);
    else kept.push(tok);
  }
  state.tokens = kept;

  const list = env.footnotes.list;
  if (!list) return;
  const out = state.tokens; // appended to in place: each token is pushed once
  out.push(new state.Token("footnote_block_open", "", 1));
  list.forEach((note, i) => {
    const open = new state.Token("footnote_open", "", 1);
    open.meta = { id: i, label: note.label };
    out.push(open);

    let body: Token[] = [];
    if (note.tokens) {
      const po = new state.Token("paragraph_open", "p", 1);
      po.block = true;
      const inline = new state.Token("inline", "", 0);
      inline.children = note.tokens;
      inline.content = note.content ?? "";
      const pc = new state.Token("paragraph_close", "p", -1);
      pc.block = true;
      body = [po, inline, pc];
    } else if (note.label) {
      body = refTokens[`:${note.label}`] ?? [];
    }
    for (const t of body) out.push(t);

    const lastParagraph = out[out.length - 1]?.type === "paragraph_close" ? out.pop() : undefined;
    const anchors = note.count > 0 ? note.count : 1;
    for (let j = 0; j < anchors; j++) {
      const a = new state.Token("footnote_anchor", "", 0);
      a.meta = { id: i, subId: j, label: note.label };
      out.push(a);
    }
    if (lastParagraph) out.push(lastParagraph);
    out.push(new state.Token("footnote_close", "", -1));
  });
  out.push(new state.Token("footnote_block_close", "", -1));
}
