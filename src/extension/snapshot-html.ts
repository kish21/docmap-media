import { createHash } from "node:crypto";
import * as path from "node:path";
import type { HostToWebview } from "../core/protocol/messages";
import { escapeHtml } from "./panel-html";

/**
 * The browser snapshot page (`#Scope`: snapshot, not live). Pure: given the panel's own CSS and script and one
 * `render` message, returns ONE self-contained HTML file — the same map the panel draws, readable in any browser,
 * with nothing to fetch. Same lockdown as the panel (ADR-0002): `default-src 'none'`, scripts and styles only with
 * the nonce, images only from local files the host already approved (or data: URIs).
 *
 * The panel script talks to VS Code through `acquireVsCodeApi()`. Here a tiny boot script provides it: the panel's
 * "ready" is answered with the embedded render message; everything else (jump, open link) has no host and is
 * dropped — the page still scrolls, folds and filters on its own.
 */
export interface SnapshotParts {
  readonly nonce: string;
  readonly title: string;
  readonly tokensCss: string;
  readonly stylesCss: string;
  readonly script: string;
  readonly render: Extract<HostToWebview, { type: "render" }>;
  /** The diagram library, inlined only when the document has a ```mermaid block and diagrams are on. */
  readonly diagrams?: string;
  /** Links to other Markdown files written beside this page (0.0.13): the link's href → that page's file: URL. */
  readonly links?: Readonly<Record<string, string>>;
  /**
   * 2.0.4: the diagram library as a file beside the page (its name), instead of inlined — the browser view writes it
   * once for all its pages; an exported page stays self-contained (`diagrams`).
   */
  readonly diagramsSrc?: string;
  /** 2.0 Export PDF: the page opens the browser's print dialog once it is drawn. */
  readonly autoPrint?: boolean;
  /**
   * 3.0 live browser view: the page is served by docmap's local server (same origin) and follows the editor — it
   * listens on `events` and fetches the newest render message from `data` after each change.
   */
  readonly live?: { readonly data: string; readonly events: string };
}

export function snapshotHtml(p: SnapshotParts): string {
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // with a nonce present browsers ignore 'unsafe-inline': diagrams (mermaid's inline SVG styles) need it alone
    p.diagrams || p.diagramsSrc ? "style-src 'unsafe-inline'" : `style-src 'nonce-${p.nonce}'`,
    `script-src 'nonce-${p.nonce}'`,
    // live: images and updates come only from docmap's own local server; a file on disk: approved local files
    p.live ? "img-src 'self' data:" : "img-src file: data:",
    ...(p.live ? ["connect-src 'self'"] : []),
  ].join("; ");
  const css = `${inlineSafe(p.tokensCss, "style")}\n${inlineSafe(p.stylesCss, "style")}`;
  const script = inlineSafe(p.script.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n"), "script");
  return `<!doctype html>
<html lang="en" data-snapshot${p.autoPrint ? " data-autoprint" : ""}${p.live ? " data-live" : ""}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">${p.live ? '\n<meta name="referrer" content="no-referrer">' : ""}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(p.title)}</title>
<style nonce="${p.nonce}">
${css}
</style>
</head>
<body>
<div class="map-root" id="app"></div>
<script type="application/json" id="docmap-data">${jsonForScript(p.render)}</script>${
    p.links && Object.keys(p.links).length > 0
      ? `\n<script type="application/json" id="docmap-links">${jsonForScript(p.links)}</script>`
      : ""
  }${p.live ? `\n<script type="application/json" id="docmap-live">${jsonForScript(p.live)}</script>` : ""}
<script nonce="${p.nonce}">${BOOT}${p.live ? LIVE_BOOT : ""}</script>${
    p.diagrams
      ? `\n<script nonce="${p.nonce}">\n${inlineSafe(p.diagrams, "script")}\n</script>`
      : p.diagramsSrc
        ? `\n<script nonce="${p.nonce}" src="${escapeHtml(p.diagramsSrc)}"></script>`
        : ""
  }
<script nonce="${p.nonce}">
${script}
</script>
</body>
</html>`;
}

/** Answers the panel's "ready" with the embedded map; drops everything else (there is no host to act on it). */
const BOOT = `(function(){var data=JSON.parse(document.getElementById("docmap-data").textContent);
window.acquireVsCodeApi=function(){return{postMessage:function(m){if(m&&m.type==="ready")window.postMessage(data,"*");}};};})();`;

/**
 * Live browser view: after each "change" from docmap's server, fetch the newest render message and hand it to the
 * page as the panel's host would. One fetch at a time (a burst of edits ends in one more fetch); a dropped stream that
 * reconnects fetches once, in case an edit was missed. When VS Code closes the stream ends and the page stays as it is.
 */
const LIVE_BOOT = `
(function(){var u=JSON.parse(document.getElementById("docmap-live").textContent),busy=false,again=false,opened=0;
function pull(){if(busy){again=true;return;}busy=true;fetch(u.data,{cache:"no-store"}).then(function(r){return r.ok?r.json():null;})
.then(function(m){if(m&&typeof m==="object")window.postMessage(m,"*");}).catch(function(){})
.then(function(){busy=false;if(again){again=false;pull();}});}
var es=new EventSource(u.events);es.onmessage=pull;es.onopen=function(){if(opened++)pull();};})();`;

/**
 * JSON that cannot end its <script> element: every `<`, `>` and `&` becomes a \\u escape (still the same JSON), so
 * a heading or paragraph containing "</script>" stays data.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Our own CSS/JS inlined verbatim — refused if it could close its element early (a build change would show here). */
function inlineSafe(text: string, tag: "style" | "script"): string {
  if (new RegExp(`</${tag}`, "i").test(text))
    throw new Error(`snapshot: the bundled ${tag} contains "</${tag}"`);
  return text;
}

/** One file per document, overwritten on every press: readable name + a short hash of the full URI. */
export function snapshotPath(storageDir: string, documentUri: string, name: string): string {
  const hash = createHash("sha256").update(documentUri).digest("hex").slice(0, 10);
  const base =
    name
      .replace(/\.(md|markdown)$/i, "")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 60) || "document";
  return path.join(storageDir, "snapshots", `${base}-${hash}.html`);
}

/**
 * The links of a rendered page that point at another file (relative, not `#…`, no scheme), as the page's `href`
 * attributes read them — the keys the page looks its linked pages up by. The HTML is the engine's own output, so an
 * href is always double-quoted with `&amp;` `&quot;` `&lt;` `&gt;` escaped.
 */
export function localLinks(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/<a href="([^"]*)"/g)) {
    const href = (m[1] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    if (href && !href.startsWith("#") && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[\\/]{2}/.test(href))
      found.add(href);
  }
  return [...found];
}
