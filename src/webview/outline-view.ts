import { buildOutline } from "../core/outline/outline";
import { describeWords, formatReadingTime } from "../core/outline/size";
import type { Heading, OutlineNode } from "../core/outline/types";

/**
 * Draws the outline pane (DESIGN.md §4): the narrow-panel toggle, the file label, the heading filter with its
 * live count, and the tree as <nav> + nested <ol> of links with a fold button on rows that have children.
 * Heading text is untrusted document content: it only ever goes in through textContent — never innerHTML.
 */
export function renderOutline(
  fileName: string,
  headings: readonly Heading[],
  readingTools = false,
): HTMLElement {
  const nav = el("nav", "outline");
  nav.setAttribute("aria-label", "Document outline");

  const toggle = el("button", "outline-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "true");
  toggle.setAttribute("aria-controls", "outline-body");
  // narrow panel: one line, "Contents · <the section you are in>", so the page keeps the height (0.2.1, owner)
  toggle.append(
    chevron(),
    text("span", "Contents", "outline-toggle-label"),
    text("span", "", "outline-current"),
  );
  nav.append(toggle);

  const body = el("div", "outline-body");
  body.id = "outline-body";
  const header = el("div", "outline-header");
  const label = el("p", "outline-label");
  label.textContent = fileName;
  header.append(label);
  if (headings.length > 0) {
    const inputLabel = el("label", "visually-hidden");
    inputLabel.htmlFor = "filter";
    inputLabel.textContent = "Filter headings";
    const input = el("input", "filter");
    input.id = "filter";
    input.type = "search";
    input.placeholder = "Filter headings  ( / )";
    input.autocomplete = "off";
    input.spellcheck = false;
    const status = el("p", "filter-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    header.append(inputLabel, input, status);
    if (readingTools) header.append(readingToolbar(headings)); // setting docmap.readingTools (off by default)
  }
  body.append(header);

  const tree = el("div", "outline-tree");
  if (headings.length === 0) {
    tree.append(text("p", "No headings in this file.", "outline-empty"));
  } else {
    tree.append(renderList(buildOutline(headings), 0));
  }
  body.append(tree);
  nav.append(body);
  return nav;
}

function renderList(nodes: readonly OutlineNode[], depth: number): HTMLOListElement {
  const list = el("ol");
  for (const node of nodes) {
    const item = el("li");
    const row = el("div", "outline-row");
    row.style.setProperty("--depth", String(depth));
    row.dataset.id = node.heading.id;

    const link = el("a", "outline-link");
    link.href = `#${node.heading.id}`;
    link.textContent = node.heading.text;
    link.title = node.heading.text; // also the source text the filter highlights from: keep it the heading only
    link.dataset.line = String(node.heading.line);
    if (node.heading.inferred) {
      row.classList.add("inferred");
      row.title = "Inferred: a line that acts as a heading (docmap.inferHeadings)";
    }

    if (node.children.length > 0) {
      const twisty = el("button", "twisty");
      twisty.type = "button";
      twisty.tabIndex = -1; // reached with ←/→ on the link; one tab stop per row
      twisty.setAttribute("aria-expanded", "true");
      twisty.setAttribute("aria-label", `Collapse ${node.heading.text}`);
      twisty.append(chevron());
      row.append(twisty, link);
    } else {
      row.append(el("span", "twisty-spacer"), link);
    }
    if (node.heading.words !== undefined) {
      const size = el("span", "outline-size");
      size.textContent = formatReadingTime(node.heading.words);
      size.title = describeWords(node.heading.words);
      size.setAttribute("aria-hidden", "true"); // a visual aid; the tooltip carries it in words
      row.append(size);
    }
    item.append(row);
    if (node.children.length > 0) item.append(renderList(node.children, depth + 1));
    list.append(item);
  }
  return list;
}

/**
 * Reading tools: skim (each section's heading + first paragraph) and fold-to-level. Levels offered: only those
 * the document has, up to 3 — "1 2 3" on a document with only two levels would offer a button that does nothing.
 */
function readingToolbar(headings: readonly Heading[]): HTMLElement {
  const bar = el("div", "reading-tools");
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Reading tools");
  const skim = el("button", "skim-toggle");
  skim.type = "button";
  skim.textContent = "Quick read";
  skim.title =
    "Quick read: show only the first paragraph of each section — click one to read all of it  ( s )";
  skim.setAttribute("aria-pressed", "false");
  bar.append(skim);
  const levels = [...new Set(headings.map((h) => h.level))].sort((a, b) => a - b).slice(0, 3);
  if (levels.length > 1) {
    const fold = el("span", "fold-levels");
    fold.append(text("span", "Levels", "fold-label"));
    for (const [n, level] of levels.entries()) {
      const b = el("button", "fold-level");
      b.type = "button";
      b.dataset.foldLevel = String(level);
      b.textContent = String(n + 1);
      b.title = `Show headings down to level ${n + 1} only  ( ${n + 1} )`;
      fold.append(b);
    }
    const all = el("button", "fold-level");
    all.type = "button";
    all.dataset.foldLevel = "0";
    all.textContent = "All";
    all.title = "Show every heading  ( 0 )";
    fold.append(all);
    bar.append(fold);
  }
  return bar;
}

function chevron(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M3 5.5l5 5 5-5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  svg.append(path);
  return svg;
}

function text<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  content: string,
  className?: string,
): HTMLElement {
  const node = el(tag, className);
  node.textContent = content;
  return node;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
