/**
 * Doc Atlas graph page (owner call 2026-11-24): pick a feature on the left; the middle shows that doc, the docs that
 * link to it (left), the docs it links to (right) and the code files it names (below). Click any box to move there.
 * Built with DOM calls only (titles are document text, never parsed as HTML); clicks go to the host as typed messages.
 */
import {
  type AtlasGraph,
  type AtlasNode,
  codeGrid,
  columnY,
  fitNeighbours,
} from "../core/insights/atlas-graph";
import type { AtlasToHost } from "../core/protocol/messages";

declare function acquireVsCodeApi(): { postMessage(message: AtlasToHost): void };
const host = acquireVsCodeApi();
const SVG = "http://www.w3.org/2000/svg";

const graph = JSON.parse(document.getElementById("atlas-data")?.textContent ?? "{}") as AtlasGraph;
const docs = graph.docs ?? [];
const byPath = new Map(docs.map((d) => [d.p, d]));
const inbound = new Map<string, string[]>();
for (const d of docs) for (const l of d.l) (inbound.get(l) ?? inbound.set(l, []).get(l))?.push(d.p);
const trail: string[] = [];

const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fileName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const folderOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "Top folder");
const open = (kind: AtlasToHost["kind"], path: string) => host.postMessage({ type: "atlasOpen", kind, path });

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// ---------- layout: list on the left, header + graph on the right ----------
const root = document.getElementById("atlas") ?? document.body;
const side = el("aside");
const main = el("main");
root.append(side, main);
side.append(el("h1", undefined, "Doc Atlas"));
const features = docs.filter((d) => d.f);
side.append(el("p", "sub", `${features.length} features · ${docs.length} docs`));
const search = el("input");
search.placeholder = "Find a feature or doc…";
search.setAttribute("aria-label", "Find a feature or doc");
const list = el("div", "list");
side.append(search, list);

const top = el("div", "top");
// opened from a doc: its map first, the feature list folded behind one button (owner report 2026-11-24)
const listToggle = el("button", "action list-toggle");
listToggle.setAttribute("aria-controls", "atlas-list");
side.id = "atlas-list";
function showList(on: boolean): void {
  root.classList.toggle("solo", !on);
  listToggle.textContent = on ? "Hide the feature list" : "☰ All features";
  listToggle.setAttribute("aria-expanded", String(on));
  const at = trail.at(-1);
  if (at) {
    trail.pop();
    focus(at); // redrawn at the new width
  }
  if (on) list.querySelector(".item.on")?.scrollIntoView({ block: "nearest" });
}
listToggle.onclick = () => showList(root.classList.contains("solo"));
const crumbs = el("nav", "crumbs");
crumbs.setAttribute("aria-label", "Where you have been");
const title = el("div", "title");
const what = el("div", "what");
const actions = el("div", "actions");
top.append(listToggle, crumbs, title, what, actions);
const svg = svgEl("svg", {
  role: "img",
  "aria-label": "The doc, the docs around it and its code",
}) as SVGSVGElement;
main.append(top, svg);
main.append(el("div", "hint", "Click any box to move there."));

function renderList(filter: string): void {
  const f = filter.trim().toLowerCase();
  // no feature docs in this project: list every doc instead
  const pool = features.length > 0 ? features : docs;
  const hits = f ? docs.filter((d) => d.t.toLowerCase().includes(f) || d.p.toLowerCase().includes(f)) : pool;
  const groups = new Map<string, AtlasNode[]>();
  for (const d of hits.slice(0, 500))
    (groups.get(folderOf(d.p)) ?? groups.set(folderOf(d.p), []).get(folderOf(d.p)))?.push(d);
  list.replaceChildren();
  for (const [g, ds] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    list.append(el("h2", undefined, g));
    for (const d of ds.sort((a, b) => a.t.localeCompare(b.t))) {
      const b = el("button", "item", d.t);
      b.title = d.w || d.p;
      b.dataset.path = d.p;
      b.classList.toggle("on", trail.at(-1) === d.p);
      b.onclick = () => {
        trail.length = 0;
        focus(d.p);
      };
      list.append(b);
    }
  }
  if (hits.length === 0) list.append(el("p", "sub", "Nothing matches."));
}

function box(
  x: number,
  y: number,
  w: number,
  label: string,
  cls: string,
  tip: string,
  onClick?: () => void,
): SVGElement {
  const g = svgEl("g", { class: `node ${cls}`, transform: `translate(${x - w / 2},${y - 20})` });
  const t = svgEl("title", {});
  t.textContent = tip;
  const text = svgEl("text", { x: w / 2, y: 25, "text-anchor": "middle" });
  text.textContent = label;
  g.append(t, svgEl("rect", { width: w, height: 40, rx: 8 }), text);
  if (onClick) {
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    g.addEventListener("click", onClick);
    g.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") onClick();
    });
  }
  return g;
}

function caption(x: number, y: number, text: string): SVGElement {
  const t = svgEl("text", { x, y, "text-anchor": "middle", class: "caption" });
  t.textContent = text;
  return t;
}

function focus(path: string): void {
  const d = byPath.get(path);
  if (!d) return;
  if (trail.at(-1) !== path) trail.push(path);
  for (const b of list.querySelectorAll<HTMLButtonElement>("button.item"))
    b.classList.toggle("on", b.dataset.path === path);

  crumbs.replaceChildren();
  trail.forEach((p, i) => {
    if (i > 0) crumbs.append(" › ");
    const name = short(byPath.get(p)?.t ?? p, 30);
    if (i === trail.length - 1) crumbs.append(el("span", undefined, name));
    else {
      const a = el("button", "crumb", name);
      a.onclick = () => {
        trail.length = i;
        focus(p);
      };
      crumbs.append(a);
    }
  });
  title.textContent = d.t;
  what.textContent = d.w || d.p;
  actions.replaceChildren();
  const openDoc = el("button", "action", "Open the doc");
  openDoc.onclick = () => open("doc", d.p);
  actions.append(openDoc);
  if (d.c.length > 0 || d.g > 0) {
    const details = el(
      "button",
      "action",
      d.g > 0 ? `Code details · ${d.g} gone from the code` : "Code details",
    );
    details.onclick = () => open("details", d.p);
    actions.append(details);
  }

  const W = svg.clientWidth || 900;
  const H = svg.clientHeight || 600;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const cx = W / 2;
  const cy = H * 0.4;
  const ins = (inbound.get(path) ?? []).filter((p) => p !== path);
  const left = fitNeighbours(ins);
  const right = fitNeighbours(d.l);
  const leftX = Math.max(90, W * 0.15);
  const rightX = Math.min(W - 90, W * 0.85);
  const leftY = columnY(left.length, cy, H * 0.75);
  const rightY = columnY(right.length, cy, H * 0.75);
  const code = d.c.slice(0, Math.max(1, Math.floor((W - 40) / 175)) * 2);
  const grid = codeGrid(code.length, W, cx, H * 0.8);

  const defs = svgEl("defs", {});
  const marker = svgEl("marker", {
    id: "arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: "auto",
  });
  marker.append(svgEl("path", { d: "M0,0 L10,5 L0,10 z", class: "arrowhead" }));
  defs.append(marker);
  const parts: SVGElement[] = [defs];
  const curve = (x1: number, y1: number, x2: number, y2: number) =>
    svgEl("path", {
      class: "edge",
      d: `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`,
      "marker-end": "url(#arrow)",
    });
  for (const y of leftY) parts.push(curve(leftX + 80, y, cx - 115, cy));
  for (const y of rightY) parts.push(curve(cx + 115, cy, rightX - 80, y));
  for (const p of grid)
    parts.push(svgEl("path", { class: "edge code-edge", d: `M${cx},${cy + 22} L${p.x},${p.y - 20}` }));
  const side = (items: ReturnType<typeof fitNeighbours>, x: number, ys: number[]) =>
    items.forEach((it, i) => {
      const y = ys[i] ?? cy;
      if ("more" in it)
        parts.push(
          box(x, y, 160, `+${it.more} more`, "more", `${it.more} more docs: use the search to find them`),
        );
      else {
        const n = byPath.get(it.path);
        parts.push(
          box(x, y, 160, short(n?.t ?? it.path), n?.f ? "feature" : "doc", `${n?.t ?? ""}\n${it.path}`, () =>
            focus(it.path),
          ),
        );
      }
    });
  side(left, leftX, leftY);
  side(right, rightX, rightY);
  code.forEach((c, i) => {
    const p = grid[i];
    if (p)
      parts.push(
        box(p.x, p.y, 160, short(fileName(c), 24), "code", `${c}\nClick to open the code`, () =>
          open("code", c),
        ),
      );
  });
  parts.push(
    box(cx, cy, 230, short(d.t, 32), "me", `${d.t}\n${d.p}\nClick to open the doc`, () => open("doc", d.p)),
  );
  parts.push(
    caption(leftX, 24, `Links to it (${ins.length})`),
    caption(rightX, 24, `It links to (${d.l.length})`),
  );
  if (d.c.length > 0)
    parts.push(
      caption(
        cx,
        H * 0.8 - 30,
        `Code it names (${d.c.length}${d.c.length > code.length ? `, ${code.length} shown` : ""})`,
      ),
    );
  if (ins.length + d.l.length + d.c.length === 0)
    parts.push(caption(cx, cy + 60, "No doc links to it, it links to none, and it names no code file."));
  svg.replaceChildren(...parts);
}

search.addEventListener("input", () => renderList(search.value));
renderList("");
if (graph.start) focus(graph.start);
showList(!graph.forDoc);
let resized: ReturnType<typeof setTimeout> | undefined;
addEventListener("resize", () => {
  clearTimeout(resized);
  resized = setTimeout(() => {
    const at = trail.at(-1);
    if (at) {
      trail.pop();
      focus(at);
    }
  }, 100);
});
