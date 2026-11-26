/** The webview page. Pure: given resource URIs and a nonce, returns HTML under a strict CSP (ADR-0002). */
export interface PanelResources {
  readonly cspSource: string;
  readonly nonce: string;
  readonly tokensCss: string;
  readonly stylesCss: string;
  readonly script: string;
  readonly title: string;
  /** The diagram library's URI (`docmap.diagrams` on): loaded by the panel only for documents with a diagram. */
  readonly diagrams?: string;
}

export function panelHtml(r: PanelResources): string {
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // diagrams: mermaid's SVG carries <style> and style="" (ADR-0002 amendment) — styles only, scripts keep the nonce
    r.diagrams ? `style-src ${r.cspSource} 'unsafe-inline'` : `style-src ${r.cspSource}`,
    `script-src 'nonce-${r.nonce}'`,
    `img-src ${r.cspSource} data:`,
    `font-src ${r.cspSource}`,
  ].join("; ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${r.tokensCss}">
<link rel="stylesheet" href="${r.stylesCss}">
<title>${escapeHtml(r.title)}</title>
</head>
<body${r.diagrams ? ` data-diagrams="${escapeHtml(r.diagrams)}"` : ""}>
<div class="map-root" id="app"></div>
<script nonce="${r.nonce}" src="${r.script}"></script>
</body>
</html>`;
}

/**
 * The Doc Atlas graph page (owner call 2026-11-24): the same lockdown as the panel — no network, script only with the
 * nonce. The graph data rides in an inert JSON element, `<` escaped so a doc title can never end it.
 */
export function atlasHtml(r: Omit<PanelResources, "diagrams"> & { readonly data: unknown }): string {
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `style-src ${r.cspSource}`,
    `script-src 'nonce-${r.nonce}'`,
    `font-src ${r.cspSource}`,
  ].join("; ");
  const json = JSON.stringify(r.data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${r.tokensCss}">
<link rel="stylesheet" href="${r.stylesCss}">
<title>${escapeHtml(r.title)}</title>
</head>
<body>
<div id="atlas"></div>
<script type="application/json" id="atlas-data">${json}</script>
<script nonce="${r.nonce}" src="${r.script}"></script>
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
