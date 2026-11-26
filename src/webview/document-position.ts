import type { Heading } from "../core/outline/types";

/**
 * Where the reader is in the document pane, kept by CONTENT, not pixels. Off-screen blocks only have estimated
 * sizes (`content-visibility: auto`, the 1 MB guardrail), so a restored pixel `scrollTop` lands somewhere else, and a
 * block index shifts when text is inserted above. The anchor is therefore: the nearest heading above the reader
 * (stable across edits elsewhere), how many visible blocks after it the reader's block is, and the pixel offset.
 */
export interface ScrollAnchor {
  /** Id of the nearest top-level heading at or above the reader's block; undefined = none above (count from start). */
  readonly headingId: string | undefined;
  /** Visible blocks between that heading (exclusive) and the reader's block. */
  readonly blocksAfter: number;
  /** How far the reader's block top sits above (negative) or below the pane's top, in px. */
  readonly offset: number;
  /** The start of the block's text — finds it again when blocks were inserted or removed above it. */
  readonly fingerprint: string;
}

/** How far from its expected position a block is looked for by its text (blocks inserted/removed above it). */
const SEARCH_RADIUS = 64;
const fingerprintOf = (el: Element): string => (el.textContent ?? "").slice(0, 120);

const HEADING_TAG = /^H[1-6]$/;

/** The top-level blocks the reader can see — folded or skimmed-away ones are `display:none` and have no position. */
function visibleBlocks(doc: HTMLElement): HTMLElement[] {
  const prose = doc.querySelector(".prose");
  if (!prose) return [];
  return [...prose.children].filter(
    (b): b is HTMLElement =>
      b instanceof HTMLElement &&
      !b.hasAttribute("data-collapsed-content") &&
      !b.hasAttribute("data-skim-hidden"),
  );
}

export function captureAnchor(doc: HTMLElement): ScrollAnchor | undefined {
  if (doc.scrollTop === 0) return undefined;
  const blocks = visibleBlocks(doc);
  const top = doc.getBoundingClientRect().top;
  // binary search over VISIBLE blocks only: the first one whose bottom is below the pane's top
  let lo = 0;
  let hi = blocks.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const rect = blocks[mid]?.getBoundingClientRect();
    if (rect && rect.bottom > top) {
      found = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  const block = blocks[found];
  if (!block) return undefined;
  let h = found;
  while (h >= 0 && !HEADING_TAG.test(blocks[h]?.tagName ?? "")) h--;
  return {
    headingId: h >= 0 ? blocks[h]?.id : undefined,
    blocksAfter: h >= 0 ? found - h : found,
    offset: block.getBoundingClientRect().top - top,
    fingerprint: fingerprintOf(block),
  };
}

/**
 * Puts the anchor block back where it was, and keeps correcting while the layout around it settles (blocks near the
 * viewport get their real sizes over the next frames). Calls `done` once it held still for two frames, or after a cap.
 */
export function restoreAnchor(
  doc: HTMLElement,
  anchor: ScrollAnchor | undefined,
  done: () => void,
  /** True once something newer moved the document on purpose (a reveal): stop correcting the scroll. */
  superseded: () => boolean = () => false,
): void {
  const block = anchor ? findBlock(doc, anchor) : undefined;
  if (!anchor || !block) {
    done();
    return;
  }
  const drift = (): number =>
    block.getBoundingClientRect().top - doc.getBoundingClientRect().top - anchor.offset;
  block.scrollIntoView({ block: "start" }); // lays the neighbourhood out for real, then lands on the block
  doc.scrollTop += drift();
  let still = 0;
  let frames = 0;
  const settle = (): void => {
    // a newer render replaced the block: this restore is over (its measurements would now be nonsense)
    if (!block.isConnected || superseded()) {
      done();
      return;
    }
    const d = drift();
    if (Math.abs(d) >= 1) {
      doc.scrollTop += d;
      still = 0;
    } else {
      still++;
    }
    if (still >= 2 || ++frames >= 30) done();
    else requestAnimationFrame(settle);
  };
  requestAnimationFrame(settle);
}

function findBlock(doc: HTMLElement, anchor: ScrollAnchor): HTMLElement | undefined {
  const blocks = visibleBlocks(doc);
  let start = -1;
  if (anchor.headingId !== undefined) {
    start = blocks.findIndex((b) => b.id === anchor.headingId);
    if (start === -1) return undefined; // the heading is gone: leave the pane where it is
  }
  const expected = Math.min(start + anchor.blocksAfter + (start === -1 ? 1 : 0), blocks.length - 1);
  // the same text nearest the expected position wins (an edit above may have shifted it); else the position
  for (let d = 0; d <= SEARCH_RADIUS; d++) {
    for (const i of d === 0 ? [expected] : [expected + d, expected - d]) {
      const b = blocks[i];
      if (b && fingerprintOf(b) === anchor.fingerprint) return b;
    }
  }
  return blocks[expected];
}

/**
 * The heading the reader is in, from the pane's own scroll position: a binary search over the VISIBLE heading
 * elements (folded ones are skipped), cached per render and per fold change — not a DOM query per heading per frame.
 * The list is built on first use, not at `refresh`: asking whether a heading is visible lays out the whole page,
 * and doing that while a render is still running made a 1 MB file lay out twice before its first paint.
 */
export class HeadingTracker {
  private elements: { index: number; el: HTMLElement }[] = [];
  private pending: { headings: readonly Heading[]; lookup: (id: string) => HTMLElement | null } | undefined;

  refresh(headings: readonly Heading[], lookup: (id: string) => HTMLElement | null): void {
    this.pending = { headings, lookup };
  }

  private build(): void {
    if (!this.pending) return;
    const { headings, lookup } = this.pending;
    this.pending = undefined;
    this.elements = [];
    for (const [index, heading] of headings.entries()) {
      const el = lookup(heading.id);
      if (el && el.offsetParent !== null) this.elements.push({ index, el });
    }
  }

  /** Index (into `headings`) of the last visible heading at or above `top` (a viewport y), or -1. */
  currentAt(top: number): number {
    this.build();
    let lo = 0;
    let hi = this.elements.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const entry = this.elements[mid];
      if (entry && entry.el.getBoundingClientRect().top <= top) {
        found = entry.index;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }
}

/** Ids of the headings that contain `index` (every earlier heading with a smaller level, nearest first). */
export function ancestorIds(headings: readonly Heading[], index: number): string[] {
  const ids: string[] = [];
  let level = headings[index]?.level ?? 0;
  for (let i = index - 1; i >= 0 && level > 1; i--) {
    const h = headings[i];
    if (h && h.level < level) {
      ids.push(h.id);
      level = h.level;
    }
  }
  return ids;
}
