/**
 * 3.3.0 interactive Plans Dashboard webview: KPI summary cards, search/filter pills, sort selector,
 * folder-grouped plan cards with progress bars, status badges, attention indicators, and collapsible drawers.
 * Built with DOM APIs only (document text is always textContent, never parsed as HTML).
 */
import { attention, type PlanRow, type PlanSort, SORT_LABELS, sortPlans } from "../core/insights/plans";
import { ago, shortDate } from "../core/insights/plans-dashboard";
import type { PlansToHost } from "../core/protocol/messages";

interface DashboardData {
  readonly rows: readonly PlanRow[];
  readonly now: number;
  readonly sort: PlanSort;
}

type FilterKey = "active" | "plans" | "in-progress" | "attention" | "coming-up" | "closed" | "all";

declare function acquireVsCodeApi(): { postMessage(message: PlansToHost): void };
const host = acquireVsCodeApi();

const data = JSON.parse(document.getElementById("plans-data")?.textContent ?? "{}") as DashboardData;
const rows = data.rows ?? [];
const now = data.now || Date.now();
let currentSort: PlanSort = data.sort ?? "attention";
let activeFilter: FilterKey = "active";
let query = "";

const DAY = 86_400_000;
const AHEAD_DAYS = 30;
const ROOT_LABEL = "Top folder";

const dayIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const folderOf = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const current = rows.filter((r) => !r.archived);
const ownersUsed =
  current.filter((r) => r.owners.length > 0).length * 2 >= current.length && current.length > 0;
const whyOf = (r: PlanRow) => attention(r, { ownersUsed });

const today = dayIso(now);
const until = dayIso(now + AHEAD_DAYS * DAY);
const isComingUp = (r: PlanRow) =>
  !r.archived &&
  r.status !== "done" &&
  Boolean(r.nextDate) &&
  !r.overdue &&
  (r.nextDate ?? "") >= today &&
  (r.nextDate ?? "") <= until;
const isClosed = (r: PlanRow) => Boolean(r.archived) || r.status === "done";
const isInProgress = (r: PlanRow) => !r.archived && r.status === "in progress";
const needsAttention = (r: PlanRow) => whyOf(r).length > 0;

const counts = {
  active: rows.filter((r) => !isClosed(r)).length,
  plans: rows.filter((r) => r.isPlan).length,
  inProgress: rows.filter(isInProgress).length,
  attention: rows.filter(needsAttention).length,
  comingUp: rows.filter(isComingUp).length,
  closed: rows.filter(isClosed).length,
  questions: current.reduce((n, r) => n + r.questions, 0),
  all: rows.length,
};

const root = document.getElementById("plans") ?? document.body;

function render(): void {
  root.replaceChildren();
  const shell = el("div", "plans-shell");
  shell.append(renderHeader());

  if (rows.length === 0) {
    shell.append(renderEmpty());
    root.append(shell);
    return;
  }

  shell.append(renderKpis(), renderToolbar(), renderGroups(), renderDrawers());
  root.append(shell);
}

function renderHeader(): HTMLElement {
  const header = el("header", "plans-header");
  const left = el("div", "plans-title-wrap");
  left.append(
    el("h1", "plans-title", "Plans Dashboard"),
    el(
      "p",
      "plans-subtitle",
      `Updated ${dayIso(now)} · ${plural(rows.length, "doc", "docs")} (${plural(counts.plans, "plan", "plans")})`,
    ),
  );

  const actions = el("div", "plans-actions");
  const addBtn = (
    label: string,
    action: Extract<PlansToHost, { type: "plansAction" }>["action"],
    primary = false,
  ) => {
    const b = el("button", primary ? "btn btn-primary" : "btn", label);
    b.type = "button";
    b.onclick = () => host.postMessage({ type: "plansAction", action });
    actions.append(b);
  };
  addBtn("↻ Refresh", "refresh");
  addBtn("✨ Ask AI", "askAgent");
  addBtn("↓ Markdown", "exportMd");
  addBtn("↓ CSV", "exportCsv");
  addBtn("+ New Plan", "newPlan", true);

  header.append(left, actions);
  return header;
}

function renderEmpty(): HTMLElement {
  const box = el("section", "empty-state");
  box.append(
    el("h2", undefined, "No plans found in this workspace"),
    el(
      "p",
      undefined,
      "A Markdown file counts as a plan when its filename, title, or front matter names plan, proposal, RFC, design, spec, roadmap, or migration.",
    ),
  );
  const btn = el("button", "btn btn-primary", "+ Create your first plan");
  btn.type = "button";
  btn.onclick = () => host.postMessage({ type: "plansAction", action: "newPlan" });
  box.append(btn);
  return box;
}

function renderKpis(): HTMLElement {
  const grid = el("section", "kpi-grid");
  grid.setAttribute("aria-label", "Plan summary");

  const cards: { label: string; value: number; filter: FilterKey; tone?: "warn" | "accent" | "muted" }[] = [
    { label: "Active docs", value: counts.active, filter: "active" },
    { label: "In progress", value: counts.inProgress, filter: "in-progress", tone: "accent" },
    {
      label: "Needs attention",
      value: counts.attention,
      filter: "attention",
      ...(counts.attention > 0 ? { tone: "warn" as const } : {}),
    },
    { label: "Coming up (30d)", value: counts.comingUp, filter: "coming-up" },
    { label: "Done / Archived", value: counts.closed, filter: "closed", tone: "muted" },
  ];

  for (const c of cards) {
    const card = el(
      "button",
      `kpi-card${c.tone ? ` tone-${c.tone}` : ""}${activeFilter === c.filter ? " is-active" : ""}`,
    );
    card.type = "button";
    card.setAttribute("aria-pressed", String(activeFilter === c.filter));
    card.append(el("span", "kpi-value", String(c.value)), el("span", "kpi-label", c.label));
    card.onclick = () => {
      activeFilter = activeFilter === c.filter ? "all" : c.filter;
      render();
    };
    grid.append(card);
  }
  return grid;
}

function renderToolbar(): HTMLElement {
  const bar = el("section", "toolbar");

  const search = el("input", "search-input");
  search.type = "search";
  search.placeholder = "Filter by title, folder, owner, or question…";
  search.setAttribute("aria-label", "Filter plans");
  search.value = query;
  search.oninput = () => {
    query = search.value;
    updateGroupsOnly();
  };

  const pills = el("div", "filter-pills");
  const filterDefs: { key: FilterKey; label: string; count: number }[] = [
    { key: "active", label: "Active", count: counts.active },
    { key: "plans", label: "Plans only", count: counts.plans },
    { key: "in-progress", label: "In progress", count: counts.inProgress },
    { key: "attention", label: "Needs attention", count: counts.attention },
    { key: "coming-up", label: "Coming up", count: counts.comingUp },
    { key: "closed", label: "Done / Archived", count: counts.closed },
    { key: "all", label: "All", count: counts.all },
  ];
  for (const f of filterDefs) {
    const pill = el("button", `pill${activeFilter === f.key ? " is-active" : ""}`, `${f.label} (${f.count})`);
    pill.type = "button";
    pill.setAttribute("aria-pressed", String(activeFilter === f.key));
    pill.onclick = () => {
      activeFilter = f.key;
      render();
    };
    pills.append(pill);
  }

  const sortWrap = el("label", "sort-wrap");
  sortWrap.append(el("span", "sort-label", "Sort:"));
  const select = el("select", "sort-select");
  select.setAttribute("aria-label", "Sort plans");
  for (const key of Object.keys(SORT_LABELS) as PlanSort[]) {
    const opt = el("option", undefined, SORT_LABELS[key]);
    opt.value = key;
    opt.selected = key === currentSort;
    select.append(opt);
  }
  select.onchange = () => {
    currentSort = select.value as PlanSort;
    host.postMessage({ type: "plansSort", sort: currentSort });
    updateGroupsOnly();
  };
  sortWrap.append(select);

  bar.append(search, pills, sortWrap);
  return bar;
}

function filteredRows(): PlanRow[] {
  const sorted = sortPlans(rows, currentSort);
  const q = query.trim().toLowerCase();
  return sorted.filter((r) => {
    if (activeFilter === "active" && isClosed(r)) return false;
    if (activeFilter === "plans" && !r.isPlan) return false;
    if (activeFilter === "in-progress" && !isInProgress(r)) return false;
    if (activeFilter === "attention" && !needsAttention(r)) return false;
    if (activeFilter === "coming-up" && !isComingUp(r)) return false;
    if (activeFilter === "closed" && !isClosed(r)) return false;
    if (!q) return true;
    const hay = [
      r.title,
      r.file,
      r.status,
      r.declared ?? "",
      ...r.owners,
      r.lastEditor ?? "",
      r.nextTask ?? "",
      ...r.questionList,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

function updateGroupsOnly(): void {
  const existing = root.querySelector(".groups-wrap");
  if (!existing) return;
  existing.replaceWith(renderGroups());
}

function renderGroups(): HTMLElement {
  const wrap = el("section", "groups-wrap");
  const list = filteredRows();
  if (list.length === 0) {
    const empty = el("p", "no-matches", "No plans match this filter.");
    wrap.append(empty);
    return wrap;
  }

  const byFolder = new Map<string, PlanRow[]>();
  for (const r of list) {
    const f = folderOf(r.file);
    const bucket = byFolder.get(f);
    if (bucket) bucket.push(r);
    else byFolder.set(f, [r]);
  }
  const folders = [...byFolder.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));

  for (const folder of folders) {
    const items = byFolder.get(folder) ?? [];
    const flagged = items.filter(needsAttention).length;
    const details = el("details", "folder-group");
    details.open = true;

    const sum = el("summary", "folder-summary");
    sum.append(
      el("span", "folder-name", folder || ROOT_LABEL),
      el("span", "folder-count", plural(items.length, "doc", "docs")),
    );
    if (flagged > 0) {
      sum.append(el("span", "folder-flag", `${flagged} need attention`));
    }

    const cards = el("div", "plan-list");
    for (const r of items) cards.append(renderPlanRow(r));
    details.append(sum, cards);
    wrap.append(details);
  }
  return wrap;
}

function statusClass(r: PlanRow): string {
  if (r.archived) return "status-muted";
  if (r.status === "blocked" || r.overdue) return "status-danger";
  if (r.status === "done") return "status-done";
  if (r.status === "in progress") return "status-progress";
  if (r.status === "stale") return "status-warn";
  return "status-muted";
}

function renderPlanRow(r: PlanRow): HTMLElement {
  const reasons = whyOf(r);
  const card = el("article", `plan-card${reasons.length > 0 ? " has-attention" : ""}`);

  const main = el("div", "plan-main");
  const titleRow = el("div", "plan-title-row");

  const openBtn = el("button", "plan-link", r.title);
  openBtn.type = "button";
  openBtn.title = r.file;
  openBtn.onclick = () => host.postMessage({ type: "plansOpen", kind: "doc", file: r.file });

  const statusText = r.archived
    ? "archived"
    : r.declared && r.declared.toLowerCase() !== r.status
      ? `${r.status} · ${r.declared}`
      : r.status;
  const badge = el("span", `status-pill ${statusClass(r)}`, statusText);

  const browserBtn = el("button", "icon-btn", "🌐");
  browserBtn.type = "button";
  browserBtn.title = "Open this plan in the browser";
  browserBtn.setAttribute("aria-label", `Open ${r.title} in browser`);
  browserBtn.onclick = () => host.postMessage({ type: "plansOpen", kind: "browser", file: r.file });

  titleRow.append(openBtn, badge);
  if (r.isPlan) titleRow.append(el("span", "kind-tag", "plan"));
  titleRow.append(browserBtn);
  main.append(titleRow, el("div", "plan-path", r.file));

  if (r.nextTask && !r.archived && r.status !== "done") {
    const next = el("div", "plan-next");
    next.append(el("span", "plan-next-label", "Next: "), document.createTextNode(r.nextTask));
    main.append(next);
  }

  const chips: { text: string; tone: "danger" | "warn" | "muted" }[] = [];
  if (r.overdue && r.nextDate) {
    chips.push({ text: `⚠ Overdue since ${shortDate(r.nextDate, now)}`, tone: "danger" });
  } else if (r.nextDate) {
    chips.push({ text: `Due ${shortDate(r.nextDate, now)}`, tone: "muted" });
  }
  if ((r.missing?.length ?? 0) > 0) {
    chips.push({ text: `${plural(r.missing?.length ?? 0, "missing path", "missing paths")}`, tone: "warn" });
  }
  if (r.questions > 0) {
    chips.push({ text: plural(r.questions, "open question", "open questions"), tone: "warn" });
  }
  if (r.risks > 0) {
    chips.push({ text: plural(r.risks, "risk", "risks"), tone: "muted" });
  }
  if (r.decisions > 0) {
    chips.push({ text: plural(r.decisions, "decision", "decisions"), tone: "muted" });
  }
  if (chips.length > 0) {
    const chipRow = el("div", "plan-chips");
    for (const c of chips) chipRow.append(el("span", `chip chip-${c.tone}`, c.text));
    main.append(chipRow);
  }

  const side = el("div", "plan-side");
  if (r.total > 0) {
    const pct = Math.round((r.done / r.total) * 100);
    const prog = el("div", "progress-wrap");
    const bar = el("progress", `progress-bar${r.done === r.total ? " is-done" : ""}`);
    bar.max = 100;
    bar.value = pct;
    bar.setAttribute("aria-label", `${r.done} of ${r.total} tasks done (${pct}%)`);
    prog.append(bar, el("span", "progress-label", `${r.done}/${r.total} (${pct}%)`));
    side.append(prog);
  }

  const meta = el("div", "plan-meta");
  const ownerText =
    r.owners.length > 0 ? r.owners.join(", ") : r.lastEditor ? `${r.lastEditor} (last commit)` : "";
  if (ownerText) meta.append(el("span", "meta-owner", ownerText));
  meta.append(el("span", "meta-changed", `Changed ${ago(r.modified, now)}`));
  side.append(meta);

  card.append(main, side);
  return card;
}

function renderDrawers(): HTMLElement {
  const wrap = el("section", "drawers-wrap");

  const asking = current.filter((r) => r.status !== "done" && r.questionList.length > 0);
  if (asking.length > 0) {
    const d = el("details", "drawer");
    d.append(el("summary", "drawer-summary", `Open questions (${counts.questions})`));
    const ul = el("ul", "drawer-list");
    for (const r of asking) {
      const li = el("li");
      const link = el("button", "inline-link", r.title);
      link.type = "button";
      link.onclick = () => host.postMessage({ type: "plansOpen", kind: "doc", file: r.file });
      li.append(link, document.createTextNode(`: ${r.questionList.join(" · ")}`));
      ul.append(li);
    }
    d.append(ul);
    wrap.append(d);
  }

  const outdated = current.filter((r) => (r.missing?.length ?? 0) > 0);
  if (outdated.length > 0) {
    const d = el("details", "drawer");
    d.append(el("summary", "drawer-summary", `Out of date with code (${outdated.length})`));
    const ul = el("ul", "drawer-list");
    for (const r of outdated) {
      const li = el("li");
      const link = el("button", "inline-link", r.title);
      link.type = "button";
      link.onclick = () => host.postMessage({ type: "plansOpen", kind: "doc", file: r.file });
      li.append(link, document.createTextNode(": "));
      for (const [i, p] of (r.missing ?? []).slice(0, 5).entries()) {
        if (i > 0) li.append(", ");
        li.append(el("code", "path-code", p));
      }
      ul.append(li);
    }
    d.append(ul);
    wrap.append(d);
  }

  const deciding = rows.filter((r) => r.decisionList.length > 0);
  if (deciding.length > 0) {
    const d = el("details", "drawer");
    d.append(el("summary", "drawer-summary", `Decisions (${plural(deciding.length, "plan", "plans")})`));
    const ul = el("ul", "drawer-list");
    for (const r of deciding) {
      const li = el("li");
      const link = el("button", "inline-link", r.title);
      link.type = "button";
      link.onclick = () => host.postMessage({ type: "plansOpen", kind: "doc", file: r.file });
      li.append(link, document.createTextNode(`: ${r.decisionList.join(" · ")}`));
      ul.append(li);
    }
    d.append(ul);
    wrap.append(d);
  }

  return wrap;
}

render();
