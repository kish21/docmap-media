import type { Heading, OutlineNode } from "./types";

/**
 * Nests the flat, in-order headings into a tree: each heading owns the following headings of a deeper level.
 * Skipped levels (an h1 followed by an h3) nest directly — the tree follows the document, not the ideal.
 */
export function buildOutline(headings: readonly Heading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { level: number; children: OutlineNode[] }[] = [];
  for (const heading of headings) {
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= heading.level) stack.pop();
    const node = { heading, children: [] as OutlineNode[] };
    (stack.at(-1)?.children ?? roots).push(node);
    stack.push({ level: heading.level, children: node.children });
  }
  return roots;
}
