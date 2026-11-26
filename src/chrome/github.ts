import { filterHeadings } from "../core/outline/filter";
import { buildOutline } from "../core/outline/outline";
import { describeWords, formatReadingTime } from "../core/outline/size";
import type { OutlineNode } from "../core/outline/types";
import { type ExtractedHeading, extractGitHubHeadings, findGitHubMarkdownBody } from "./github-outline";
import { createPromptMenu } from "./prompts-menu";

/**
 * Chrome MV3 content script for GitHub Markdown / README pages (`https://github.com/*`).
 * Injects a collapsible docmap outline sidebar beside GitHub's `.markdown-body` without altering GitHub's UI,
 * and tears down cleanly on GitHub SPA navigation (`turbo:load`, `pjax:end`, `popstate`, DOM swaps).
 */

const SIDEBAR_ATTR = "data-docmap-gh";
const COLLAPSED_KEY = "docmap-gh-collapsed";

let activeCleanup: (() => void) | undefined;
let lastUrl = location.href;
let lastContainer: HTMLElement | undefined;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore storage errors
  }
}

function pageTitle(): string {
  const path = location.pathname.replace(/^\/+/, "");
  return path || document.title || "README.md";
}

function highlightLink(link: HTMLAnchorElement, match: { start: number; end: number } | undefined): void {
  const text = link.title || link.textContent || "";
  if (!match || match.end <= match.start) {
    link.textContent = text;
    return;
  }
  const mark = document.createElement("mark");
  mark.textContent = text.slice(match.start, match.end);
  link.replaceChildren(text.slice(0, match.start), mark, text.slice(match.end));
}

function renderTree(
  nodes: readonly OutlineNode[],
  depth: number,
  byId: ReadonlyMap<string, ExtractedHeading>,
  onJump: (id: string) => void,
): HTMLOListElement {
  const ol = document.createElement("ol");
  for (const node of nodes) {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "dm-gh-row";
    row.style.setProperty("--depth", String(depth));
    row.dataset.id = node.heading.id;

    const link = document.createElement("a");
    link.className = "dm-gh-link";
    link.href = `#${node.heading.id}`;
    link.textContent = node.heading.text;
    link.title = node.heading.text;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      onJump(node.heading.id);
    });
    row.append(link);

    if (node.heading.words !== undefined) {
      const size = document.createElement("span");
      size.className = "dm-gh-size";
      size.textContent = formatReadingTime(node.heading.words);
      size.title = describeWords(node.heading.words);
      size.setAttribute("aria-hidden", "true");
      row.append(size);
    }

    li.append(row);
    if (node.children.length > 0) li.append(renderTree(node.children, depth + 1, byId, onJump));
    ol.append(li);
  }
  return ol;
}

export function teardownGitHubSidebar(): void {
  activeCleanup?.();
  activeCleanup = undefined;
  lastContainer = undefined;
  for (const el of document.querySelectorAll(`[${SIDEBAR_ATTR}]`)) el.remove();
}

export function mountGitHubSidebar(): void {
  const container = findGitHubMarkdownBody();
  if (!container) {
    teardownGitHubSidebar();
    return;
  }

  // Already mounted for this exact live container and sidebar is still connected
  const existing = document.querySelector<HTMLElement>(`[${SIDEBAR_ATTR}]`);
  if (container === lastContainer && existing?.isConnected) return;

  teardownGitHubSidebar();

  const extracted = extractGitHubHeadings(container);
  if (extracted.length === 0) return;

  lastContainer = container;
  const headings = extracted.map((e) => e.heading);
  const byId = new Map(extracted.map((e) => [e.heading.id, e] as const));

  const sidebar = document.createElement("aside");
  sidebar.className = "dm-gh-sidebar";
  sidebar.setAttribute(SIDEBAR_ATTR, "true");
  sidebar.setAttribute("aria-label", "docmap outline");

  let collapsed = readCollapsed();
  if (collapsed) sidebar.setAttribute("data-collapsed", "");

  const header = document.createElement("div");
  header.className = "dm-gh-header";
  const title = document.createElement("p");
  title.className = "dm-gh-title";
  title.textContent = "docmap Outline";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dm-gh-toggle";
  const syncToggle = () => {
    toggle.textContent = collapsed ? "Show" : "Hide";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    sidebar.toggleAttribute("data-collapsed", collapsed);
  };
  syncToggle();
  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    saveCollapsed(collapsed);
    syncToggle();
  });
  header.append(title, toggle);

  const body = document.createElement("div");
  body.className = "dm-gh-body";

  const controls = document.createElement("div");
  controls.className = "dm-gh-controls";
  const filter = document.createElement("input");
  filter.type = "search";
  filter.className = "dm-gh-filter";
  filter.placeholder = "Filter headings…";
  filter.setAttribute("aria-label", "Filter headings");
  filter.autocomplete = "off";
  filter.spellcheck = false;

  const status = document.createElement("p");
  status.className = "dm-gh-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  controls.append(filter, status);

  let currentId: string | undefined;
  const setCurrent = (id: string | undefined) => {
    if (id === currentId) return;
    currentId = id;
    for (const r of sidebar.querySelectorAll<HTMLElement>(".dm-gh-row[data-current]")) {
      r.removeAttribute("data-current");
      r.querySelector(".dm-gh-link")?.removeAttribute("aria-current");
    }
    if (!id) return;
    const row = sidebar.querySelector<HTMLElement>(`.dm-gh-row[data-id="${CSS.escape(id)}"]`);
    if (!row) return;
    row.setAttribute("data-current", "");
    row.querySelector(".dm-gh-link")?.setAttribute("aria-current", "location");
  };

  let jumping = false;
  const onJump = (id: string) => {
    const target = byId.get(id)?.element;
    if (!target) return;
    jumping = true;
    target.scrollIntoView({ block: "start" });
    setCurrent(id);
    requestAnimationFrame(() => {
      jumping = false;
    });
  };

  const tree = document.createElement("div");
  tree.className = "dm-gh-tree";
  tree.append(renderTree(buildOutline(headings), 0, byId, onJump));

  const applyFilter = () => {
    const q = filter.value;
    const filtering = q.trim() !== "";
    const { matches, total } = filterHeadings(headings, q);
    for (const row of sidebar.querySelectorAll<HTMLElement>(".dm-gh-row")) {
      const id = row.dataset.id ?? "";
      const match = matches.get(id);
      row.hidden = filtering && match === undefined;
      const link = row.querySelector<HTMLAnchorElement>(".dm-gh-link");
      if (link) highlightLink(link, filtering ? match : undefined);
    }
    status.textContent = !filtering
      ? ""
      : matches.size === 0
        ? "No headings match"
        : `${matches.size} of ${total} headings`;
  };
  filter.addEventListener("input", applyFilter);
  filter.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      filter.value = "";
      applyFilter();
      filter.blur();
    }
  });

  const footer = document.createElement("div");
  footer.className = "dm-gh-footer";
  const promptMenu = createPromptMenu({
    fileName: pageTitle(),
    getSourceText: () => container.textContent ?? "",
    classNamePrefix: "dm-gh-ai",
  });
  footer.append(promptMenu.element);

  body.append(controls, tree, footer);
  sidebar.append(header, body);
  document.body.append(sidebar);

  // You-are-here scroll spy
  const updateCurrentFromScroll = () => {
    const threshold = 110;
    let active: string | undefined = extracted[0]?.heading.id;
    for (const item of extracted) {
      const top = item.element.getBoundingClientRect().top;
      if (top <= threshold) active = item.heading.id;
      else break;
    }
    setCurrent(active);
  };
  updateCurrentFromScroll();

  let rafId = 0;
  const onScroll = () => {
    if (jumping || rafId !== 0) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (!jumping) updateCurrentFromScroll();
    });
  };
  const onDocClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target?.closest?.(".dm-gh-ai-wrap")) promptMenu.close();
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("click", onDocClick);

  activeCleanup = () => {
    if (rafId !== 0) cancelAnimationFrame(rafId);
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("click", onDocClick);
    sidebar.remove();
  };
}

let spaBound = false;
function initGitHubSpaHooks(): void {
  if (spaBound) return;
  spaBound = true;

  let remountTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRemount = () => {
    if (remountTimer !== undefined) clearTimeout(remountTimer);
    remountTimer = setTimeout(() => {
      remountTimer = undefined;
      lastUrl = location.href;
      mountGitHubSidebar();
    }, 50);
  };

  document.addEventListener("turbo:load", scheduleRemount);
  document.addEventListener("pjax:end", scheduleRemount);
  window.addEventListener("popstate", scheduleRemount);

  // Resilient fallback for GitHub React/Turbo soft navigations that swap DOM without firing pjax:end
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl || (lastContainer && !lastContainer.isConnected)) {
      scheduleRemount();
    } else if (!lastContainer && remountTimer === undefined) {
      remountTimer = setTimeout(() => {
        remountTimer = undefined;
        if (!lastContainer && findGitHubMarkdownBody()) mountGitHubSidebar();
      }, 150);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

mountGitHubSidebar();
initGitHubSpaHooks();
