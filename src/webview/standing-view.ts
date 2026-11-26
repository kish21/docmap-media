import type { Standing } from "../core/insights/standing";

/**
 * Easy reading (2026-11-24): the "Where this stands" box at the top of a long doc — the story in date order, its parts
 * with their state, warnings when the Status line disagrees with the sections, the Status line as written folded
 * away — and a state label beside each top section's heading. Document text goes in through textContent only.
 */

const STATE_LABEL = { built: "built", decided: "decided", draft: "draft", changed: "changed" } as const;
/** Set on the doc's own Status paragraph while the box shows it (CSS hides it; removed on every redraw). */
const MOVED = "data-dm-status-moved";

export function drawStanding(
  prose: HTMLElement,
  s: Standing | undefined,
  added: string,
  atlasButton = false,
): void {
  for (const p of prose.querySelectorAll(`[${MOVED}]`)) p.removeAttribute(MOVED);
  if (!s) return;
  // the long Status paragraph under the title: the box shows it, folded ("The Status line as written")
  if (s.status) {
    const top = [...prose.children].slice(0, 6);
    const stop = top.findIndex((e) => /^H[2-6]$/.test(e.tagName));
    const status = (stop === -1 ? top : top.slice(0, stop)).find(
      (e) => e.tagName === "P" && /^\s*status\b/i.test(e.textContent ?? ""),
    );
    status?.setAttribute(MOVED, "");
  }
  const box = el("section", `dm-standing ${added}`);
  box.setAttribute("aria-label", "Where this stands");
  const head = el("div", "dm-st-head");
  head.append(text("h2", "Where this stands", "dm-st-title"));
  if (atlasButton) {
    // the extras click handler sends it to the host (class kp-atlas), like the key points strip's button
    const b = text("button", "◈ See its docs and code in the Doc Atlas", "kp-atlas dm-st-atlas");
    b.setAttribute("type", "button");
    head.append(b);
  }
  box.append(head);

  if (s.events.length > 1) {
    const line = el("ol", "dm-st-line");
    for (const e of s.events) {
      const li = el("li", `dm-st-${e.state}`);
      li.append(
        el("span", "dm-st-dot"),
        text("span", shortDate(e.date), "dm-st-when"),
        text("strong", e.label),
      );
      li.append(link(e.what, e.headingId));
      const record = s.parts.find((p) => p.label === e.label)?.record;
      if (record) li.append(recordLink(record));
      line.append(li);
    }
    box.append(line);
  }

  if (s.parts.length > 0) {
    const table = el("table", "dm-st-parts");
    for (const p of s.parts) {
      const tr = el("tr", `dm-st-${p.state}`);
      const label = el("td", "");
      label.append(el("span", "dm-st-dot"), document.createTextNode(p.label));
      const name = el("td", "");
      name.append(link(p.name, p.headingId));
      if (p.record) name.append(" ", recordLink(p.record));
      tr.append(
        label,
        name,
        text("td", `${STATE_LABEL[p.state]}${p.date ? ` ${p.date}` : ""}`, "dm-st-meta"),
      );
      table.append(tr);
    }
    box.append(table);
  }

  for (const d of s.disagree) {
    const w = text("p", `⚠ ${d}`, "dm-st-warn");
    w.setAttribute("role", "note");
    box.append(w);
  }

  if (s.status) {
    const details = el("details", "dm-st-status");
    const words = s.status.split(/\s+/).length;
    details.append(text("summary", `The Status line as written (${words} words)`), text("p", s.status));
    box.append(details);
  }

  // first thing under the title (and the key points strip, when there is one)
  const anchor = prose.querySelector(":scope > .keypoints") ?? prose.querySelector(":scope > h1");
  if (anchor) anchor.after(box);
  else prose.prepend(box);

  for (const sec of s.sections) {
    if (!sec.state) continue;
    const h = document.getElementById(sec.headingId);
    if (!h || h.querySelector(".dm-st-chip")) continue;
    const chip = el("span", `dm-st-chip dm-st-${sec.state} ${added}`);
    chip.append(
      el("span", "dm-st-dot"),
      document.createTextNode(`${STATE_LABEL[sec.state]}${sec.date ? ` ${sec.date}` : ""}`),
    );
    h.append(chip);
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`;

/** A part's build record: a link to that doc (the host opens it, like any link in the doc). */
function recordLink(record: { readonly href: string; readonly title: string }): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "dm-st-rec";
  a.href = record.href;
  a.title = `Build record: ${record.title}`;
  // short on the page ("Record 127"); the full title when pointed at (owner report: long blue tags were hard to read)
  const num = /\d{2,}/.exec(record.title)?.[0] ?? /(\d{2,})[^/]*$/.exec(record.href)?.[1];
  a.textContent = num
    ? `Record ${num}`
    : record.title.length > 24
      ? `${record.title.slice(0, 23)}…`
      : record.title;
  return a;
}

function link(label: string, headingId: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "dm-st-go";
  a.href = `#${headingId}`;
  a.textContent = label;
  return a;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function text<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  content: string,
  className = "",
): HTMLElementTagNameMap[K] {
  const e = el(tag, className);
  e.textContent = content;
  return e;
}
