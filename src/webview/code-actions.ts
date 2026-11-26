import { isShellBlock } from "../core/authoring/shell";
import type { CodePeek } from "../core/insights/code-peek";
import type { WebviewToHost } from "../core/protocol/messages";

/**
 * The page's 2026-11-22 additions: code names that open the file beside the doc (only the ones the host listed), and
 * "▶ Terminal" on shell blocks. The page never opens or runs anything itself: it asks the host.
 */

const REF = "dm-coderef";

/** Makes the inline `code` names the host listed clickable (and keyboard-reachable); clears the old ones first. */
export function markCodeRefs(
  prose: HTMLElement,
  refs: readonly string[] | undefined,
  snapshot: boolean,
): void {
  for (const c of prose.querySelectorAll<HTMLElement>(`code.${REF}`)) {
    c.classList.remove(REF);
    c.removeAttribute("role");
    c.removeAttribute("tabindex");
    c.removeAttribute("title");
  }
  if (snapshot || !refs?.length) return;
  const wanted = new Set(refs);
  for (const c of prose.querySelectorAll<HTMLElement>("code")) {
    if (c.closest("pre")) continue;
    const name = c.textContent?.trim() ?? "";
    if (!wanted.has(name)) continue;
    c.classList.add(REF);
    c.setAttribute("role", "link");
    c.tabIndex = 0;
    c.title = /\(\)$|^[A-Z]/.test(name) ? `Go to ${name} in the code` : `Open ${name} beside this doc`;
  }
}

/** A clicked (or Enter-pressed) code name: ask the host to open it. True when handled. */
export function onCodeRef(target: Element | null, post: (m: WebviewToHost) => void): boolean {
  const ref = target?.closest?.<HTMLElement>(`code.${REF}`);
  if (!ref) return false;
  post({ type: "openCode", text: ref.textContent?.trim() ?? "" });
  return true;
}

// ---------- easy reading (2026-11-24): point at a code name or a code link — its code, in a small box ----------

/** A link to a code file in the doc (`backend/cart.py#L12`, `cart.ts:4`): the host still decides what it may read. */
const CODE_LINK =
  /\.(?:py|ts|tsx|js|jsx|mjs|cjs|go|rs|java|kt|cs|rb|php|swift|scala|c|cc|cpp|h|hpp|sql|sh|ps1|ya?ml|toml|json|css|html)(?:[#:].*)?$/i;
const HOVER_DELAY_MS = 300;

let peekPost: (m: WebviewToHost) => void = () => {};
let pointedAt: HTMLElement | undefined;
let pointedKey = "";
let timer: ReturnType<typeof setTimeout> | undefined;
let box: HTMLElement | undefined;

/** What the reader points at that may have code to show, and what to ask the host for. */
function peekTarget(target: Element | null): { el: HTMLElement; key: string } | undefined {
  const ref = target?.closest?.<HTMLElement>(`code.${REF}`);
  if (ref) return { el: ref, key: ref.textContent?.trim() ?? "" };
  const a = target?.closest?.<HTMLAnchorElement>(".prose a[href]");
  const href = a?.getAttribute("href") ?? "";
  if (a && href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("#") && CODE_LINK.test(href))
    return { el: a, key: href };
  return undefined;
}

export function initCodePeek(post: (m: WebviewToHost) => void, snapshot: boolean): void {
  if (snapshot) return; // the browser copy has no host to read code
  peekPost = post;
  document.addEventListener("mouseover", (e) => {
    const t = peekTarget(e.target as Element | null);
    if (!t || t.el === pointedAt) return;
    hidePeek();
    pointedAt = t.el;
    pointedKey = t.key;
    // asked every time (code review 2026-11-24): a remembered answer showed old lines after the code was edited
    timer = setTimeout(() => peekPost({ type: "peekCode", text: t.key }), HOVER_DELAY_MS);
  });
  document.addEventListener("mouseout", (e) => {
    const t = peekTarget(e.target as Element | null);
    const into = (e as MouseEvent).relatedTarget as Node | null;
    if (t && t.el === pointedAt && !(into && t.el.contains(into))) hidePeek();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hidePeek();
  });
  document.addEventListener("scroll", hidePeek, true);
}

/** The page was drawn again: a box left from before goes (what it pointed at may be gone). */
export function forgetCodePeeks(): void {
  hidePeek();
}

/** The host's answer: drawn only if the reader still points at what it was asked for. */
export function showCodePeek(text: string, peek: CodePeek | undefined): void {
  if (text === pointedKey && pointedAt) drawPeek(peek ?? null);
}

function hidePeek(): void {
  clearTimeout(timer);
  pointedAt = undefined;
  pointedKey = "";
  box?.remove();
  box = undefined;
}

function drawPeek(peek: CodePeek | null): void {
  box?.remove();
  if (!peek || !pointedAt) return;
  box = document.createElement("div");
  box.className = "dm-peek";
  box.setAttribute("role", "tooltip");
  const head = document.createElement("div");
  head.className = "dm-peek-head";
  head.textContent =
    peek.kind === "at"
      ? `${peek.path}  ·  line ${peek.line}`
      : `${peek.path}  ·  ${peek.total} lines — its functions and classes`;
  const pre = document.createElement("pre");
  for (const [n, line, named] of peek.rows) {
    const row = document.createElement("span");
    row.className = named ? "dm-peek-row dm-peek-hit" : "dm-peek-row";
    const num = document.createElement("span");
    num.className = "dm-peek-n";
    num.textContent = String(n);
    row.append(num, line);
    pre.append(row);
  }
  if (peek.rows.length === 0) pre.textContent = "(no functions or classes found)";
  const hint = document.createElement("div");
  hint.className = "dm-peek-hint";
  hint.textContent = "Click to open it beside this doc";
  box.append(head, pre, hint);
  document.body.append(box);
  const r = pointedAt.getBoundingClientRect();
  const below = r.bottom + 6 + box.offsetHeight < window.innerHeight;
  box.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8))}px`;
  box.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - box.offsetHeight - 6)}px`;
}

/** "▶ Terminal" beside "Copy" on shell blocks. */
export function terminalButton(
  pre: HTMLElement,
  make: (label: string, cls: string, title: string) => HTMLElement,
) {
  const lang = /language-([\w+#-]+)/.exec(pre.querySelector("code")?.className ?? "")?.[1] ?? "";
  if (!isShellBlock(lang)) return;
  pre.append(
    make("▶ Terminal", "dm-term", "Put these commands in the terminal (you press Enter to run them)"),
  );
}
