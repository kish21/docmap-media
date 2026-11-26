import { describe, expect, it } from "vitest";
import { atlasHtml, panelHtml, plansHtml } from "./panel-html";

describe("Doc Atlas graph page", () => {
  const page = atlasHtml({
    cspSource: "vscode-resource:",
    nonce: "n0nce",
    tokensCss: "tokens.css",
    stylesCss: "atlas.css",
    script: "atlas.js",
    title: "Doc Atlas",
    data: { docs: [{ p: "a.md", t: "</script><script>alert(1)</script>" }] },
  });
  it("takes its colours from the project's colour list, before its own styles", () => {
    expect(page.indexOf('href="tokens.css"')).toBeGreaterThan(-1);
    expect(page.indexOf('href="tokens.css"')).toBeLessThan(page.indexOf('href="atlas.css"'));
  });
  it("is locked down like the panel: no network, script only with the nonce", () => {
    expect(page).toContain("default-src 'none'");
    expect(page).toContain("script-src 'nonce-n0nce'");
    expect(page).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
  });
  it("carries the data in an inert JSON element a doc title cannot end", () => {
    expect(page).toContain('<script type="application/json" id="atlas-data">');
    expect(page).not.toContain("</script><script>alert(1)");
    expect(page).toContain("\\u003c/script\\u003e");
  });
});

describe("Plans Dashboard interactive page", () => {
  const page = plansHtml({
    cspSource: "vscode-resource:",
    nonce: "p1ans",
    tokensCss: "tokens.css",
    stylesCss: "plans.css",
    script: "plans.js",
    title: "Plans Dashboard",
    data: { rows: [{ title: "</script><img src=x onerror=alert(1)> & \u2028\u2029" }] },
  });
  it("loads tokens.css before plans.css under strict nonce CSP", () => {
    expect(page.indexOf('href="tokens.css"')).toBeLessThan(page.indexOf('href="plans.css"'));
    expect(page).toContain("default-src 'none'");
    expect(page).toContain("script-src 'nonce-p1ans'");
    expect(page).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
  });
  it("escapes <, >, &, and line separators in the embedded JSON payload", () => {
    expect(page).toContain('<script type="application/json" id="plans-data">');
    expect(page).not.toContain("</script><img");
    expect(page).toContain("\\u003c/script\\u003e");
    expect(page).toContain("\\u0026");
    expect(page).toContain("\\u2028\\u2029");
  });
});

const html = panelHtml({
  cspSource: "vscode-resource:",
  nonce: "abc123",
  tokensCss: "t.css",
  stylesCss: "s.css",
  script: "w.js",
  title: "Map: <evil>.md",
});

describe("panelHtml", () => {
  it("locks the page down: no default sources, scripts only with the nonce", () => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(html).toContain('<script nonce="abc123" src="w.js">');
  });
  it("loads the design tokens before the styles that use them", () => {
    expect(html.indexOf("t.css")).toBeLessThan(html.indexOf("s.css"));
  });
  it("escapes the file name in the title", () => {
    expect(html).toContain("Map: &lt;evil&gt;.md");
  });
  it("diagrams on (0.0.8): inline STYLES allowed for mermaid's SVG — scripts still only with the nonce", () => {
    const withDiagrams = panelHtml({
      cspSource: "vscode-resource:",
      nonce: "abc123",
      tokensCss: "t.css",
      stylesCss: "s.css",
      script: "w.js",
      title: "Map: a.md",
      diagrams: 'm.js"><script>',
    });
    expect(withDiagrams).toContain("style-src vscode-resource: 'unsafe-inline'");
    expect(withDiagrams).toContain("script-src 'nonce-abc123';");
    expect(withDiagrams).not.toMatch(/script-src[^;]*unsafe/);
    expect(withDiagrams).toContain('data-diagrams="m.js&quot;&gt;&lt;script&gt;"'); // the URI stays an attribute
  });
});
