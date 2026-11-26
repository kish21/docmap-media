/**
 * "Copy for my AI" (2026-11-22 review): this doc and the linked docs the reader picks, as one text to paste into any
 * AI chat, with a size estimate so it fits. HTML comments (template writing hints) are left out; code blocks stay
 * exactly as written. Pure — the host reads the files and writes the clipboard.
 */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** The text without `<!-- … -->` comments, except inside fenced code blocks. */
export function withoutComments(text: string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    if (prose.length) out.push(prose.join("\n").replace(/<!--[\s\S]*?-->/g, ""));
    prose = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const f = FENCE.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (f && f[0] === fence[0] && f.length >= fence.length) fence = undefined;
    } else if (f) {
      flush();
      fence = f;
      out.push(line);
    } else prose.push(line);
  }
  flush();
  return out.join("\n");
}

export interface BundleDoc {
  /** Workspace-relative path, shown as the doc's header. */
  readonly rel: string;
  readonly text: string;
}

/** One text for an AI chat: a line saying what it is, then each doc under its path. */
export function agentBundle(docs: readonly BundleDoc[]): string {
  const head =
    docs.length === 1 ? "Here is 1 doc from my project." : `Here are ${docs.length} docs from my project.`;
  return `${head}\n\n${docs.map((d) => `--- ${d.rel} ---\n${withoutComments(d.text).trimEnd()}\n`).join("\n")}`;
}

/** A rough token count (about 4 characters each), enough to tell whether it fits a chat. */
export const tokenEstimate = (text: string): number => Math.round(text.length / 4);

const round = (n: number) => (n < 100 ? n : Math.round(n / 100) * 100).toLocaleString("en-US");

/** "about 3,000 words (about 3,800 tokens)". */
export function sizeLabel(text: string): string {
  const words = text.match(/\S+/g)?.length ?? 0;
  return `about ${round(words)} words (about ${round(tokenEstimate(text))} tokens)`;
}
