/**
 * 3.0 Clean view: AI-written Markdown laid out properly, on the page only — the file is never touched, and "Show as
 * written" turns it off. Runs on the engine's own HTML right after it is drawn (before skim, folds and markers), and
 * only rearranges nodes the engine made or creates elements filled through textContent — document text is never
 * parsed as HTML here.
 */
import { statusKind } from "../core/authoring/tasks";
import { cutPoint } from "../core/insights/standing";
import { highlightCode } from "./highlight";

export interface CleanOptions {
  /** Number the headings 1, 1.1, 1.2 … */
  readonly numbers: boolean;
  /** The page's own file name, for "copy link to this section". */
  readonly fileName: string;
}

export function applyClean(prose: HTMLElement, options: CleanOptions): void {
  keyValueLists(prose);
  autoCallouts(prose);
  stepParagraphs(prose);
  stepLists(prose);
  overBold(prose);
  statusChips(prose);
  checklistProgress(prose);
  tables(prose);
  shortListColumns(prose);
  textChips(prose);
  images(prose);
  longParagraphs(prose);
  for (const pre of prose.querySelectorAll<HTMLElement>("pre > code[class*='language-']")) highlightCode(pre);
  headingTools(prose, options);
}

// ---------- easy reading (2026-11-24): a long paragraph shows its first two sentences, the rest behind "more…" ----------

/** Opens a paragraph cut by `longParagraphs` (the page's click handler calls it). */
export function openMore(button: Element): void {
  const rest = button.previousElementSibling;
  if (rest instanceof HTMLElement && rest.classList.contains("dm-more")) rest.removeAttribute("hidden");
  button.remove();
}

/** Opens every folded rest that holds one of `selector` (a highlight, a comment): what the reader marked stays seen. */
export function openFoldsWith(prose: HTMLElement, selector: string): void {
  for (const rest of prose.querySelectorAll<HTMLElement>(".dm-more[hidden]")) {
    if (!rest.querySelector(selector)) continue;
    rest.removeAttribute("hidden");
    if (rest.nextElementSibling?.classList.contains("dm-more-btn")) rest.nextElementSibling.remove();
  }
}

function longParagraphs(prose: HTMLElement): void {
  for (const p of prose.querySelectorAll<HTMLParagraphElement>(":scope > p, :scope > blockquote > p")) {
    const at = cutPoint(p.textContent ?? "");
    if (at === undefined) continue;
    // find the text node holding the cut; cut there when it is the paragraph's own text, else after its inline parent
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let cut: Node | undefined;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.textContent?.length ?? 0;
      if (seen + len >= at) {
        if (n.parentNode === p) cut = (n as Text).splitText(at - seen);
        else {
          let top: Node = n;
          while (top.parentNode && top.parentNode !== p) top = top.parentNode;
          cut = top.nextSibling ?? undefined;
        }
        break;
      }
      seen += len;
    }
    if (!cut) continue;
    const rest = document.createElement("span");
    rest.className = "dm-more";
    // code review 2026-11-24: "until-found", not plain hidden — Find (Ctrl+F) still searches the folded text and the
    // browser unfolds it on a match (then "beforematch" removes the "more…" button)
    rest.setAttribute("hidden", "until-found");
    rest.addEventListener("beforematch", () => {
      if (rest.nextElementSibling?.classList.contains("dm-more-btn")) rest.nextElementSibling.remove();
    });
    for (let n: Node | null = cut; n; ) {
      const next: Node | null = n.nextSibling;
      rest.append(n);
      n = next;
    }
    const more = document.createElement("button");
    more.type = "button";
    more.className = "dm-more-btn";
    more.textContent = "more…";
    more.title = "Show the rest of this paragraph";
    p.append(rest, " ", more);
  }
}

// ---------- key–value lists: "- **Owner:** Priya" → a two-column card ----------

const LABEL = /^\s*([^:\n]{1,40}):\s*$/;

function keyValueLists(prose: HTMLElement): void {
  for (const ul of prose.querySelectorAll<HTMLUListElement>("ul")) {
    const items = [...ul.children] as HTMLElement[];
    if (items.length < 2 || items.some((li) => li.querySelector("ul, ol, pre, table"))) continue;
    const pairs = items.map((li) => {
      const first = li.firstElementChild;
      const lead = li.firstChild === first ? first : null;
      if (lead?.tagName !== "STRONG" || !LABEL.test(lead.textContent ?? "")) {
        // "**Owner**: Priya" — the colon after the bold
        if (lead?.tagName === "STRONG" && /^\s*:/.test(lead.nextSibling?.textContent ?? ""))
          return { li, lead, colonAfter: true };
        return undefined;
      }
      return { li, lead, colonAfter: false };
    });
    if (pairs.some((p) => !p)) continue;
    const dl = document.createElement("dl");
    dl.className = "dm-kv";
    copyBlockAttr(ul, dl);
    for (const p of pairs) {
      if (!p) continue;
      const dt = document.createElement("dt");
      dt.textContent = (p.lead.textContent ?? "").replace(/:\s*$/, "").trim();
      const dd = document.createElement("dd");
      p.lead.remove();
      if (p.colonAfter && p.li.firstChild?.nodeType === Node.TEXT_NODE)
        p.li.firstChild.textContent = (p.li.firstChild.textContent ?? "").replace(/^\s*:\s*/, "");
      dd.append(...p.li.childNodes);
      trimLeadingSpace(dd);
      dl.append(dt, dd);
    }
    ul.replaceWith(dl);
  }
}

// ---------- "Note:" / "Warning:" / "TL;DR:" paragraphs → the same boxes as > [!NOTE] ----------

const CALLOUT_WORDS: Record<string, [string, string]> = {
  note: ["note", "Note"],
  info: ["note", "Note"],
  tip: ["tip", "Tip"],
  hint: ["tip", "Tip"],
  important: ["important", "Important"],
  warning: ["warning", "Warning"],
  caution: ["caution", "Caution"],
  danger: ["caution", "Caution"],
  "tl;dr": ["tip", "TL;DR"],
  tldr: ["tip", "TL;DR"],
  summary: ["tip", "Summary"],
};

function autoCallouts(prose: HTMLElement): void {
  for (const p of [...prose.children] as HTMLElement[]) {
    if (p.tagName !== "P") continue;
    const lead = p.firstChild;
    let word: string | undefined;
    if (lead instanceof HTMLElement && lead.tagName === "STRONG") {
      word = (lead.textContent ?? "").replace(/[:\s]+$/, "").toLowerCase();
      const colon = /:\s*$/.test(lead.textContent ?? "") || /^\s*:/.test(lead.nextSibling?.textContent ?? "");
      if (!CALLOUT_WORDS[word] || !colon) continue;
      lead.remove();
      if (p.firstChild?.nodeType === Node.TEXT_NODE)
        p.firstChild.textContent = (p.firstChild.textContent ?? "").replace(/^\s*:?\s*/, "");
    } else if (lead?.nodeType === Node.TEXT_NODE) {
      const m = /^\s*(note|info|tip|hint|important|warning|caution|danger|tl;dr|tldr|summary)\s*:\s*/i.exec(
        lead.textContent ?? "",
      );
      if (!m) continue;
      word = (m[1] ?? "").toLowerCase();
      lead.textContent = (lead.textContent ?? "").slice(m[0].length);
    } else continue;
    const [kind, title] = CALLOUT_WORDS[word] ?? ["note", "Note"];
    const box = document.createElement("blockquote");
    box.className = `callout callout-${kind}`;
    copyBlockAttr(p, box);
    const t = document.createElement("p");
    t.className = "callout-title";
    t.textContent = title;
    p.replaceWith(box);
    box.append(t, p);
  }
}

// ---------- steps: "Step 1: …" paragraphs, and numbered how-to lists → a stepper ----------

const STEP = /^\s*step\s+\d+\s*[:.)\-–—]\s*/i;

function stepParagraphs(prose: HTMLElement): void {
  const kids = [...prose.children] as HTMLElement[];
  for (let i = 0; i < kids.length; i++) {
    const run: HTMLElement[] = [];
    while (kids[i + run.length]?.tagName === "P" && STEP.test(kids[i + run.length]?.textContent ?? ""))
      run.push(kids[i + run.length] as HTMLElement);
    if (run.length < 2) continue;
    const ol = document.createElement("ol");
    ol.className = "dm-steps";
    for (const p of run) {
      const li = document.createElement("li");
      // each step keeps its paragraph's block id: Compare and trust markers find an edit in any step, not just step 1
      copyBlockAttr(p, li);
      const first = p.firstChild;
      if (first?.nodeType === Node.TEXT_NODE) first.textContent = (first.textContent ?? "").replace(STEP, "");
      else if (first instanceof HTMLElement && STEP.test(first.textContent ?? "")) {
        first.textContent = (first.textContent ?? "").replace(STEP, "");
        if (first.textContent === "") first.remove();
      }
      li.append(...p.childNodes);
      ol.append(li);
    }
    run[0]?.replaceWith(ol);
    for (const p of run.slice(1)) p.remove();
    i += run.length - 1;
  }
}

const HOWTO =
  /\b(steps?|how to|setup|set up|install|getting started|rollout|process|procedure|instructions|quick ?start)\b/i;

function stepLists(prose: HTMLElement): void {
  for (const ol of prose.querySelectorAll<HTMLOListElement>(":scope > ol")) {
    if (ol.classList.contains("dm-steps") || ol.children.length < 3) continue;
    let prev = ol.previousElementSibling;
    while (prev && !/^H[1-6]$/.test(prev.tagName) && prev.tagName === "P") prev = prev.previousElementSibling;
    const underHowTo = prev && /^H[1-6]$/.test(prev.tagName) && HOWTO.test(prev.textContent ?? "");
    const stepWords = [...ol.children].every((li) => STEP.test(li.textContent ?? ""));
    if (underHowTo || stepWords) ol.classList.add("dm-steps");
  }
}

// ---------- too much bold: a paragraph that is mostly bold reads as normal text ----------

function overBold(prose: HTMLElement): void {
  for (const block of prose.querySelectorAll<HTMLElement>("p, li")) {
    const total = (block.textContent ?? "").trim().length;
    if (total < 40) continue;
    const bold = [...block.querySelectorAll(":scope > strong, :scope > b")].reduce(
      (n, b) => n + (b.textContent ?? "").length,
      0,
    );
    if (bold / total > 0.4) block.classList.add("dm-overbold");
  }
}

// ---------- status words and emoji → chips (the word stays: never colour alone) ----------

const statusOf = statusKind; // one list of status words for the labels and for changing them (core/authoring/tasks)

function statusChips(prose: HTMLElement): void {
  for (const cell of prose.querySelectorAll<HTMLElement>("td")) {
    if (cell.children.length > 1) continue;
    const kind = statusOf(cell.textContent ?? "");
    if (!kind) continue;
    const chip = document.createElement("span");
    chip.className = `dm-status dm-status-${kind}`;
    chip.append(...cell.childNodes);
    cell.append(chip);
  }
  // list items that open with a status emoji: ✅ Done thing / ❌ Failed thing
  for (const li of prose.querySelectorAll<HTMLElement>("li")) {
    const first = li.firstChild;
    if (first?.nodeType !== Node.TEXT_NODE) continue;
    const m = /^\s*(✅|✔️?|🚧|⚠️?|❌|⏳)\s*/u.exec(first.textContent ?? "");
    const kind = m && statusOf(m[1] ?? "");
    if (!m || !kind) continue;
    first.textContent = (first.textContent ?? "").slice(m[0].length);
    const chip = document.createElement("span");
    chip.className = `dm-status dm-status-${kind}`;
    chip.textContent =
      { done: "Done", progress: "In progress", risk: "At risk", blocked: "Blocked", todo: "To do" }[kind] ??
      "";
    li.prepend(chip, " ");
  }
}

// ---------- checklists: a progress bar on top ----------

function checklistProgress(prose: HTMLElement): void {
  for (const list of prose.querySelectorAll<HTMLElement>("ul, ol")) {
    const boxes = list.querySelectorAll<HTMLInputElement>(
      ":scope > li > input[type=checkbox], :scope > li > p > input[type=checkbox]",
    );
    if (boxes.length < 2) continue;
    const done = [...boxes].filter((b) => b.checked).length;
    const bar = document.createElement("div");
    bar.className = "dm-progressline";
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", `${done} of ${boxes.length} done`);
    const fill = document.createElement("span");
    fill.style.setProperty("--done", String(done / boxes.length));
    const label = document.createElement("small");
    label.textContent = `${done} of ${boxes.length} done`;
    bar.append(fill, label);
    list.before(bar);
  }
}

// ---------- tables: numbers right-aligned (the rest is CSS: sticky header, zebra rows) ----------

function tables(prose: HTMLElement): void {
  for (const table of prose.querySelectorAll("table")) {
    for (const cell of table.querySelectorAll<HTMLElement>("td")) {
      if (/^\s*[-+]?[$€£¥]?\d[\d,.]*\s*(%|ms|s|kb|mb|gb|x)?\s*$/i.test(cell.textContent ?? ""))
        cell.classList.add("dm-num");
    }
  }
}

// ---------- long lists of short items: two columns ----------

function shortListColumns(prose: HTMLElement): void {
  for (const ul of prose.querySelectorAll<HTMLUListElement>(":scope > ul")) {
    const items = [...ul.children];
    if (
      items.length >= 8 &&
      items.every((li) => (li.textContent ?? "").length <= 40 && !li.querySelector("ul, ol, input"))
    )
      ul.classList.add("dm-cols");
  }
}

// ---------- dates and @people → chips (text only, outside code and links) ----------

const DATE =
  /\b(\d{4}-\d{2}-\d{2}|\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]* \d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4})\b|(^|[\s(])@([A-Za-z][\w.-]{1,38})\b/g;

function textChips(prose: HTMLElement): void {
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement?.closest("code, pre, a, .dm-status, .callout-title, dt, svg, .mermaid")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  const has = new RegExp(DATE.source); // no "g": .test keeps no state between nodes
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    if (has.test(n.textContent ?? "")) nodes.push(n as Text);
  for (const node of nodes) {
    const text = node.data;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(DATE)) {
      const at = m.index ?? 0;
      if (m[1]) {
        frag.append(text.slice(last, at));
        const chip = document.createElement("span");
        chip.className = "dm-chip dm-date";
        chip.textContent = m[1];
        frag.append(chip);
        last = at + m[0].length;
      } else if (m[3]) {
        const start = at + (m[2] ?? "").length;
        frag.append(text.slice(last, start));
        const chip = document.createElement("span");
        chip.className = "dm-chip dm-person";
        chip.textContent = `@${m[3]}`;
        frag.append(chip);
        last = start + 1 + m[3].length;
      }
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

// ---------- images: caption from the description, click to zoom ----------

function images(prose: HTMLElement): void {
  for (const img of prose.querySelectorAll<HTMLImageElement>("img[alt]")) {
    const alt = img.getAttribute("alt") ?? "";
    if (!alt || img.closest("figure, a, picture")) continue;
    const figure = document.createElement("figure");
    figure.className = "dm-figure";
    const caption = document.createElement("figcaption");
    caption.textContent = alt;
    img.replaceWith(figure);
    figure.append(img, caption);
  }
}

// ---------- headings: optional numbers, and "copy link to this section" ----------

function headingTools(prose: HTMLElement, options: CleanOptions): void {
  const counters = [0, 0, 0, 0, 0, 0];
  const headings = [...prose.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]")];
  const top = Math.min(...headings.map((h) => Number(h.tagName[1])).filter((l) => l > 1), 6);
  for (const h of headings) {
    const level = Number(h.tagName[1]);
    if (options.numbers && level >= top) {
      const depth = level - top;
      counters[depth] = (counters[depth] ?? 0) + 1;
      for (let d = depth + 1; d < counters.length; d++) counters[d] = 0;
      const num = document.createElement("span");
      num.className = "dm-hnum";
      num.textContent = `${counters.slice(0, depth + 1).join(".")} `;
      h.prepend(num);
    }
    const link = document.createElement("button");
    link.type = "button";
    link.className = "dm-hlink"; // part of the drawn page (redrawn with it), not an extra
    link.textContent = "#";
    link.title = "Copy a link to this section";
    link.dataset.link = `${options.fileName}#${h.id}`;
    h.append(link);
  }
}

// ---------- helpers ----------

function copyBlockAttr(from: Element, to: Element): void {
  const tagged = from.matches("[data-block]") ? from : from.querySelector("[data-block]");
  const v = tagged?.getAttribute("data-block");
  if (v !== null && v !== undefined) to.setAttribute("data-block", v);
}

function trimLeadingSpace(el: Element): void {
  const first = el.firstChild;
  if (first?.nodeType === Node.TEXT_NODE) first.textContent = (first.textContent ?? "").replace(/^\s+/, "");
}
