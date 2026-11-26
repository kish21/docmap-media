import { Slugger } from "../core/outline/slug";
import { type Heading, isHeadingLevel } from "../core/outline/types";

/**
 * Extracts navigable headings and section word counts from GitHub's rendered `.markdown-body`.
 * Resilient to GitHub's layout variations (`.markdown-heading` wrapper, `a.anchor`, `user-content-*` ids).
 */

export interface ExtractedHeading {
  readonly heading: Heading;
  readonly element: HTMLElement;
}

const MARKDOWN_BODY_SELECTORS = [
  "#readme article.markdown-body",
  "#readme .markdown-body",
  '[data-testid="readme"] .markdown-body',
  "article.markdown-body",
  ".markdown-body",
];

/** Finds the primary rendered Markdown container on a GitHub page, if any has headings. */
export function findGitHubMarkdownBody(root: ParentNode = document): HTMLElement | undefined {
  for (const selector of MARKDOWN_BODY_SELECTORS) {
    const candidates = root.querySelectorAll<HTMLElement>(selector);
    for (const el of candidates) {
      if (el.querySelector("h1, h2, h3, h4, h5, h6")) return el;
    }
  }
  return undefined;
}

/** Extracts ordered headings with stable ids and per-section word counts from a `.markdown-body`. */
export function extractGitHubHeadings(container: HTMLElement): ExtractedHeading[] {
  const rawHeadings = [...container.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")];
  if (rawHeadings.length === 0) return [];

  const slugger = new Slugger();
  const entries: { element: HTMLElement; text: string; level: Heading["level"]; id: string }[] = [];

  for (const el of rawHeadings) {
    const level = Number(el.tagName.slice(1));
    if (!isHeadingLevel(level)) continue;
    const text = headingVisibleText(el);
    if (!text) continue;
    const id = resolveHeadingId(el, text, slugger);
    entries.push({ element: el, text, level, id });
  }

  const wordCounts = computeSectionWords(container, entries);
  return entries.map((entry, idx) => ({
    element: entry.element,
    heading: {
      id: entry.id,
      text: entry.text,
      level: entry.level,
      line: idx,
      words: wordCounts[idx] ?? 0,
    },
  }));
}

function headingVisibleText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  for (const hidden of clone.querySelectorAll("a.anchor, .octicon, svg, [aria-hidden='true']")) {
    hidden.remove();
  }
  return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
}

function resolveHeadingId(el: HTMLElement, text: string, slugger: Slugger): string {
  if (el.id) return el.id;
  const anchor =
    el.querySelector<HTMLAnchorElement>("a.anchor[id], a[id]") ??
    el.parentElement?.querySelector<HTMLAnchorElement>(":scope > a.anchor[id]");
  if (anchor?.id) return anchor.id;
  const href =
    el.querySelector<HTMLAnchorElement>("a.anchor[href^='#']")?.getAttribute("href") ??
    el.parentElement?.querySelector<HTMLAnchorElement>(":scope > a.anchor[href^='#']")?.getAttribute("href");
  if (href && href.length > 1) return href.slice(1);
  const generated = slugger.slug(text);
  el.id = generated;
  return generated;
}

function computeSectionWords(
  container: HTMLElement,
  entries: readonly { element: HTMLElement; level: number }[],
): number[] {
  const ownWords = new Array<number>(entries.length).fill(0);
  const headingSet = new Map<HTMLElement, number>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry) headingSet.set(entry.element, i);
  }

  let current = -1;
  for (const child of container.children) {
    const asEl = child as HTMLElement;
    const directIdx = headingSet.get(asEl);
    if (directIdx !== undefined) {
      current = directIdx;
      continue;
    }
    const nestedHeading = asEl.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6");
    if (nestedHeading && headingSet.has(nestedHeading)) {
      current = headingSet.get(nestedHeading) ?? current;
      continue;
    }
    if (current >= 0) {
      ownWords[current] = (ownWords[current] ?? 0) + countWords(asEl.textContent ?? "");
    }
  }

  // Roll up sub-section words into parent headings (same rule as src/core/markdown/reading-rules.ts)
  const totals = [...ownWords];
  for (let i = 0; i < entries.length; i++) {
    const level = entries[i]?.level ?? 6;
    let sum = ownWords[i] ?? 0;
    for (let j = i + 1; j < entries.length; j++) {
      if ((entries[j]?.level ?? 6) <= level) break;
      sum += ownWords[j] ?? 0;
    }
    totals[i] = sum;
  }
  return totals;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
