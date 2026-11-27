import { filterHeadings } from "../core/outline/filter";
import type { Heading } from "../core/outline/types";

/**
 * What the reader has done to the outline — folded sections, a filter, where they are — applied to the DOM the
 * views drew. Kept by id, so it survives every re-render after an edit.
 */
export class OutlineState {
  readonly collapsed = new Set<string>();
  query = "";
  currentId: string | undefined;
  /** Skim mode: each section shows its heading and first block only. */
  skim = false;
  /** Sections opened in full while skimming (by heading id; "" = the text before the first heading). */
  readonly skimOpen = new Set<string>();
  /** Headings of the current render, by id (skim needs at least one to have sections at all). */
  private words = new Map<string, number>();

  isOpen(id: string): boolean {
    return !this.collapsed.has(id);
  }

  /** Folds or unfolds one section, in the outline and in the document. */
  toggle(id: string, open?: boolean): void {
    const shouldOpen = open ?? this.collapsed.has(id);
    if (shouldOpen) this.collapsed.delete(id);
    else this.collapsed.add(id);
  }

  /**
   * Fold to a heading level: every section at that level (or deeper, where levels skip) is folded, everything
   * above it is open — the document reads as its headings down to that level. 0 unfolds everything.
   */
  foldToLevel(level: number, headings: readonly Heading[]): void {
    this.collapsed.clear();
    if (level === 0) return;
    const open: number[] = []; // levels of the headings above the current one
    for (const h of headings) {
      while (open.length > 0 && (open[open.length - 1] ?? 0) >= h.level) open.pop();
      if (h.level >= level && open.every((l) => l < level)) this.collapsed.add(h.id);
      open.push(h.level);
    }
  }

  /** Re-applies everything to freshly drawn DOM. */
  apply(root: HTMLElement, headings: readonly Heading[]): void {
    // sizes exist only with reading tools on; without them there is nothing to skim by (skim stays off)
    this.words = new Map(headings.flatMap((h) => (h.words === undefined ? [] : [[h.id, h.words] as const])));
    this.applyFilter(root, headings);
    this.applyCollapse(root);
    this.applyCurrent(root, false);
  }

  /** Fast path for outline filter typing: updates outline rows and sub-list visibility without walking `.prose`. */
  applyOutlineFilter(root: HTMLElement, headings: readonly Heading[]): void {
    this.applyFilter(root, headings);
    this.applyOutlineCollapse(root);
  }

  applyFilter(root: HTMLElement, headings: readonly Heading[]): void {
    const { matches, total } = filterHeadings(headings, this.query);
    const filtering = this.query.trim() !== "";
    for (const row of root.querySelectorAll<HTMLElement>(".outline-row")) {
      const id = row.dataset.id ?? "";
      const match = matches.get(id);
      row.hidden = filtering && match === undefined;
      const link = row.querySelector<HTMLAnchorElement>(".outline-link");
      if (link) highlight(link, filtering ? match : undefined);
    }
    root.querySelector(".outline")?.classList.toggle("filtering", filtering);
    const status = root.querySelector(".filter-status");
    if (status) {
      status.textContent = !filtering
        ? ""
        : matches.size === 0
          ? "No headings match"
          : `${matches.size} of ${total} headings`;
    }
  }

  private applyOutlineCollapse(root: HTMLElement): void {
    // outline: a folded row hides its sub-list (ignored while filtering: every match must be reachable)
    const filtering = this.query.trim() !== "";
    for (const twisty of root.querySelectorAll<HTMLButtonElement>(".twisty")) {
      const row = twisty.closest<HTMLElement>(".outline-row");
      const id = row?.dataset.id ?? "";
      const open = !this.collapsed.has(id);
      const label = row?.querySelector(".outline-link")?.textContent ?? "";
      twisty.setAttribute("aria-expanded", String(open));
      twisty.setAttribute("aria-label", `${open ? "Collapse" : "Expand"} ${label}`);
      const sub = row?.parentElement?.querySelector<HTMLElement>(":scope > ol");
      if (sub) sub.hidden = !open && !filtering;
    }
  }

  applyCollapse(root: HTMLElement): void {
    this.applyOutlineCollapse(root);
    // document: hide everything after a folded heading until the next heading at the same or a higher level.
    // Headings can sit INSIDE a block (a blockquote, a list item): such a block counts as a heading of the
    // highest level it contains — it ends a fold, and folding a heading inside it folds what follows the block.
    root.querySelector(".skim-toggle")?.setAttribute("aria-pressed", String(this.skim));
    const prose = root.querySelector(".prose");
    if (!prose) return;
    this.applySkim(prose);
    let foldLevel = 0; // 0 = not inside a folded section
    for (const block of prose.children) {
      // walk the block's headings in document order: a heading at or above the fold level ends the fold (the block
      // is then visible), and a folded heading starts one that carries on after the block
      let visible = foldLevel === 0;
      for (const h of headingsIn(block)) {
        const level = Number(h.tagName[1]);
        if (foldLevel !== 0 && level <= foldLevel) {
          foldLevel = 0;
          visible = true;
        }
        if (foldLevel === 0 && this.collapsed.has(h.id)) foldLevel = level;
      }
      block.toggleAttribute("data-collapsed-content", !visible);
    }
  }

  /**
   * Skim: in each section (the blocks after a heading, up to the next heading) the first block stays — the "lead"
   * — and the rest is hidden until the reader opens that section. Every body block is tagged with its section, so
   * a jump or a #link into a hidden block can open the right one. Hides nothing; rewrites nothing.
   */
  private applySkim(prose: Element): void {
    let section = "";
    let body: Element[] = [];
    // no headings, no sections to skim by (and no toolbar to turn it off): show everything
    const active = this.skim && this.words.size > 0;
    let heading: Element | undefined;
    const flush = (): void => {
      const more = body.length - 1;
      // the hint needs a block that can show text under itself; a rule, code block or table cannot — then the
      // section's heading carries it. Nothing to carry it (text before the first heading opening with a rule):
      // that stretch is not skimmed at all, rather than hidden without a word.
      const lead = body[0];
      const host = lead && HINT_HOSTS.test(lead.tagName) ? lead : heading;
      const skimming = active && host !== undefined && !this.skimOpen.has(section);
      heading?.removeAttribute("data-skim-lead");
      body.forEach((block, i) => {
        block.toggleAttribute("data-skim-hidden", skimming && i > 0);
        block.removeAttribute("data-skim-lead");
      });
      if (skimming && more > 0 && host) {
        // this section's own blocks only (sub-sections have their own heading and hint)
        host.setAttribute(
          "data-skim-lead",
          `+ ${more} more ${more === 1 ? "block" : "blocks"} — click to read`,
        );
      }
    };
    for (const block of prose.children) {
      const inside = headingsIn(block);
      if (inside.length > 0) {
        flush();
        body = [];
        section = inside[inside.length - 1]?.id ?? "";
        heading = block;
        block.removeAttribute("data-skim-hidden");
        block.removeAttribute("data-skim-lead");
        block.setAttribute("data-skim-section", section);
        continue;
      }
      block.setAttribute("data-skim-section", section);
      body.push(block);
    }
    flush();
  }

  /** Marks "you are here" in the outline: bar + background + weight (DESIGN.md §8 — never colour alone). */
  applyCurrent(root: HTMLElement, reveal: boolean): void {
    for (const row of root.querySelectorAll<HTMLElement>(".outline-row[data-current]")) {
      row.removeAttribute("data-current");
      row.querySelector(".outline-link")?.removeAttribute("aria-current");
    }
    const current = root.querySelector<HTMLElement>(".outline-current");
    if (current) current.textContent = "";
    if (this.currentId === undefined) return;
    const row = root.querySelector<HTMLElement>(`.outline-row[data-id="${CSS.escape(this.currentId)}"]`);
    if (!row) return;
    // the narrow panel's one-line contents bar names the section you are in (text only: heading text is untrusted)
    if (current) current.textContent = row.querySelector<HTMLElement>(".outline-link")?.title ?? "";
    row.setAttribute("data-current", "");
    row.querySelector(".outline-link")?.setAttribute("aria-current", "location");
    if (reveal && row.offsetParent !== null) row.scrollIntoView({ block: "nearest" });
  }
}

const HEADING = /^H[1-6]$/;
/** Blocks that can show the skim hint below their own text. */
const HINT_HOSTS = /^(P|UL|OL|DL|BLOCKQUOTE|H[1-6])$/;

/** The block itself if it is a heading, else the headings inside it — in document order. */
function headingsIn(block: Element): Element[] {
  return HEADING.test(block.tagName) ? [block] : [...block.querySelectorAll("h1, h2, h3, h4, h5, h6")];
}

/** Shows the matched part of a heading in <mark>, built from text nodes — never from HTML strings. */
function highlight(link: HTMLAnchorElement, match: { start: number; end: number } | undefined): void {
  const text = link.title || link.textContent || "";
  if (!match || match.end <= match.start) {
    link.textContent = text;
    return;
  }
  const mark = document.createElement("mark");
  mark.textContent = text.slice(match.start, match.end);
  link.replaceChildren(text.slice(0, match.start), mark, text.slice(match.end));
}
