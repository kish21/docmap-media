import { wordDiff } from "../core/insights/redline";
import type { Redline } from "../core/protocol/messages";
import { applyClean } from "./clean";

/**
 * 3.0 Rendered redline, on the page: added blocks get a green bar, changed blocks show their changed words (new words
 * underlined, removed words struck through, inline), removed blocks come back struck through where they were. The
 * older version arrives as HTML from the same engine (ADR-0002: html off, so it is inert markup) and is parsed in a
 * <template>, where nothing loads or runs; only removed blocks are copied into the page.
 */

const INS = "dm-ins";

/** Undo what `applyRedline` did (its added elements carry the page's "added" class and go with the rest). */
export function clearRedline(prose: HTMLElement): void {
  for (const ins of prose.querySelectorAll(`ins.${INS}`)) ins.replaceWith(...ins.childNodes);
  for (const b of prose.querySelectorAll("[data-redline]")) b.removeAttribute("data-redline");
  document.body.removeAttribute("data-redline");
}

export interface RedlineCounts {
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
}

export function applyRedline(
  prose: HTMLElement,
  r: Redline,
  addedClass: string,
  clean: { on: boolean; numbers: boolean; fileName: string },
): RedlineCounts {
  document.body.setAttribute("data-redline", "");
  const template = document.createElement("template");
  template.innerHTML = `<div>${r.oldHtml}</div>`;
  const old = template.content.firstElementChild as HTMLElement;
  if (clean.on) applyClean(old, { numbers: false, fileName: clean.fileName });
  const oldBlock = (i: number) => old.querySelector<HTMLElement>(`[data-block="${i}"]`);
  const newBlock = (i: number) => prose.querySelector<HTMLElement>(`[data-block="${i}"]`);
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const i of r.added) {
    const b = newBlock(i);
    if (!b) continue;
    b.setAttribute("data-redline", "added");
    added++;
  }
  for (const [n, o] of r.changed) {
    const b = newBlock(n);
    const before = oldBlock(o);
    if (!b || !before) continue;
    b.setAttribute("data-redline", "changed");
    markWords(b, before.textContent ?? "", addedClass);
    changed++;
  }
  // removed blocks, in order, before the new block they preceded (or at the end of the document)
  const end = prose.querySelector(":scope > .footnotes");
  for (const [beforeIndex, o] of r.removed) {
    const gone = oldBlock(o);
    if (!gone) continue;
    const copy = document.importNode(gone, true) as HTMLElement;
    copy.removeAttribute("data-block");
    for (const x of copy.querySelectorAll("[data-block], [id]")) {
      x.removeAttribute("data-block");
      x.removeAttribute("id"); // an id copied from the old version must not shadow the live heading's
    }
    copy.classList.add(addedClass, "dm-rl-removed");
    copy.setAttribute("data-redline", "removed");
    copy.setAttribute("aria-label", "Removed");
    const anchor = newBlock(beforeIndex);
    if (anchor) anchor.before(copy);
    else if (end) end.before(copy);
    else prose.append(copy);
    removed++;
  }
  return { added, changed, removed };
}

/** Wraps the words that are new in `<ins>` and puts the removed words back, struck through, where they were. */
function markWords(block: HTMLElement, before: string, addedClass: string): void {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest(`.${addedClass}`) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const after = nodes.map((n) => n.data).join("");
  const ops = wordDiff(before, after);
  // where each op lands in the new text: adds are ranges of it, dels are points in it
  const adds: [number, number][] = [];
  const dels: [number, string][] = [];
  let at = 0;
  for (const op of ops) {
    if (op.kind === "del") dels.push([at, op.text]);
    else {
      if (op.kind === "add" && op.text.trim()) adds.push([at, at + op.text.trimEnd().length]);
      at += op.text.length;
    }
  }
  // each text node is rebuilt once: its text cut at the change points, new runs in <ins>, removed runs between
  let start = 0;
  for (const [k, node] of nodes.entries()) {
    const end = start + node.data.length;
    const owns = (p: number) => (p > start && p <= end) || (p === 0 && k === 0);
    const cuts = new Set([start, end]);
    for (const [s, e] of adds) for (const c of [s, e]) if (c > start && c < end) cuts.add(c);
    for (const [p] of dels) if (owns(p)) cuts.add(p);
    const points = [...cuts].sort((x, y) => x - y);
    if (points.length === 2 && !adds.some(([s, e]) => s < end && e > start) && !dels.some(([p]) => owns(p))) {
      start = end;
      continue;
    }
    const out = document.createDocumentFragment();
    const delsAt = (p: number) => {
      for (const [q, gone] of dels)
        if (q === p && owns(q)) {
          const del = document.createElement("del");
          del.className = `dm-del ${addedClass}`;
          del.textContent = gone;
          out.append(del);
        }
    };
    if (k === 0) delsAt(0);
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i] as number;
      const b = points[i + 1] as number;
      const piece = document.createTextNode(node.data.slice(a - start, b - start));
      if (adds.some(([s, e]) => s <= a && b <= e)) {
        const ins = document.createElement("ins");
        ins.className = INS;
        ins.append(piece);
        out.append(ins);
      } else out.append(piece);
      if (b !== 0) delsAt(b);
    }
    node.replaceWith(out);
    start = end;
  }
}
