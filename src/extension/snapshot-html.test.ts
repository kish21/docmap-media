import { describe, expect, it } from "vitest";
import { jsonForScript, localLinks, snapshotHtml } from "./snapshot-html";

const render = {
  type: "render" as const,
  docVersion: 1,
  fileName: "notes.md",
  headings: [{ level: 1 as const, text: "</script><script>alert(1)</script>", id: "x", line: 0 }],
  html: "<p>&lt;/script&gt; and \u2028 line</p>",
};
const parts = {
  nonce: "n0nce",
  title: "<evil>.md — docmap snapshot",
  tokensCss: ":root{--a:1}",
  stylesCss: "body{color:red}",
  script: "console.log(1);\n//# sourceMappingURL=webview.js.map\n",
  render,
};

describe("snapshotHtml", () => {
  const html = snapshotHtml(parts);

  it("locks the page down like the panel: nothing loads unless it carries the nonce", () => {
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("form-action 'none'");
    expect(html).toContain("script-src 'nonce-n0nce'");
    expect(html).toContain("style-src 'nonce-n0nce'");
    expect(html).toContain("img-src file: data:");
    expect(html).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
  });

  it("is self-contained: the styles and the script are inside the file", () => {
    expect(html).toContain(":root{--a:1}");
    expect(html).toContain("body{color:red}");
    expect(html).toContain("console.log(1);");
    expect(html).not.toMatch(/<link |<script[^>]* src=/);
    expect(html).not.toContain("sourceMappingURL");
  });

  it("loads the tokens before the styles that use them, and the boot script before the panel script", () => {
    expect(html.indexOf("--a:1")).toBeLessThan(html.indexOf("color:red"));
    expect(html.indexOf("acquireVsCodeApi")).toBeLessThan(html.indexOf("console.log(1)"));
  });

  it("document content can never close the data element", () => {
    const scriptEnds = html.match(/<\/script>/g) ?? [];
    expect(scriptEnds).toHaveLength(3); // data, boot, panel script — none from the document
    expect(html).not.toContain("<script>alert(1)");
  });

  it("diagrams (0.0.8): the library is inlined with the nonce; styles may be inline, scripts still need the nonce", () => {
    const withDiagrams = snapshotHtml({ ...parts, diagrams: "window.docmapMermaid={};" });
    expect(withDiagrams).toContain("style-src 'unsafe-inline'");
    expect(withDiagrams).toContain("script-src 'nonce-n0nce'");
    expect(withDiagrams).toContain('<script nonce="n0nce">\nwindow.docmapMermaid={};\n</script>');
    expect(() => snapshotHtml({ ...parts, diagrams: "x='</script>'" })).toThrow(/contains/);
    expect(html).not.toContain("unsafe-inline"); // without diagrams, nothing changes
  });

  it("escapes the title", () => {
    expect(html).toContain("<title>&lt;evil&gt;.md — docmap snapshot</title>");
  });

  it("refuses a bundle that could close its own element", () => {
    expect(() => snapshotHtml({ ...parts, script: "x='</script>'" })).toThrow(/contains/);
    expect(() => snapshotHtml({ ...parts, stylesCss: "/* </STYLE> */" })).toThrow(/contains/);
  });
});

describe("live page (3.0)", () => {
  const live = snapshotHtml({
    ...parts,
    live: { data: `/${"a".repeat(64)}/data/0`, events: `/${"a".repeat(64)}/events/0` },
  });

  it("talks only to its own server: images and updates from 'self', no file: access, no referrer", () => {
    expect(live).toMatch(/<html[^>]* data-live/);
    expect(live).toContain("img-src 'self' data:");
    expect(live).toContain("connect-src 'self'");
    expect(live).not.toContain("img-src file:");
    expect(live).toContain('<meta name="referrer" content="no-referrer">');
    expect(live).toContain("default-src 'none'");
    expect(live).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it("carries where to fetch updates as data, and listens for them with the nonce'd boot script", () => {
    expect(live).toContain('<script type="application/json" id="docmap-live">');
    expect(live).toContain("new EventSource(u.events)");
    expect(live).toContain("fetch(u.data");
  });

  it("the saved copy stays as it was: no live data, no update stream, no network", () => {
    expect(html).not.toContain("docmap-live");
    expect(html).not.toContain("EventSource");
    expect(html).not.toContain("connect-src");
  });

  const html = snapshotHtml(parts);
});

describe("jsonForScript", () => {
  it("round-trips to the same value", () => {
    expect(JSON.parse(jsonForScript(render))).toEqual(render);
  });
  it("contains no raw <, > or & (so no </script> and no <!--)", () => {
    expect(jsonForScript(render)).not.toMatch(/[<>&\u2028\u2029]/);
  });
});

describe("linked pages (0.0.13)", () => {
  it("finds the links to other files, as the page's href attributes read them", () => {
    const page =
      '<p><a href="docs/a.md#setup">a</a> <a href="#here">h</a> <a href="https://x.org">w</a> ' +
      '<a href="mailto:x@y.z">m</a> <a href="b%20c.md">b</a> <a href="q.md?x=1&amp;y=2">q</a> ' +
      '<a href="docs/a.md#setup">again</a> <a href="//host/x.md">n</a></p>';
    expect(localLinks(page)).toEqual(["docs/a.md#setup", "b%20c.md", "q.md?x=1&y=2"]);
  });

  it("carries the link map as data that cannot end its element; no map, no element", () => {
    const withLinks = snapshotHtml({ ...parts, links: { "a.md": "file:///s/a-1.html#x</script>" } });
    expect(withLinks).toContain('<script type="application/json" id="docmap-links">');
    expect(withLinks).not.toContain("#x</script>");
    expect(snapshotHtml(parts)).not.toContain("docmap-links");
  });
});

describe("2.0 export", () => {
  it("Export PDF marks the page to open the print dialog; a normal snapshot does not", async () => {
    const { snapshotHtml } = await import("./snapshot-html");
    const parts = {
      nonce: "n",
      title: "t",
      tokensCss: "",
      stylesCss: "",
      script: "",
      render: { type: "render" as const, docVersion: 1, fileName: "a.md", headings: [], html: "" },
    };
    expect(snapshotHtml({ ...parts, autoPrint: true })).toContain(
      '<html lang="en" data-snapshot data-autoprint>',
    );
    expect(snapshotHtml(parts)).toContain('<html lang="en" data-snapshot>');
  });
});

describe("2.0.4 browser view cache", () => {
  it("references the shared diagram library by file instead of inlining it (and allows its inline styles)", async () => {
    const { snapshotHtml } = await import("./snapshot-html");
    const html = snapshotHtml({
      nonce: "n",
      title: "t",
      tokensCss: "",
      stylesCss: "",
      script: "",
      render: { type: "render" as const, docVersion: 1, fileName: "a.md", headings: [], html: "" },
      diagramsSrc: "docmap-mermaid.js",
    });
    expect(html).toContain('<script nonce="n" src="docmap-mermaid.js"></script>');
    expect(html).toContain("style-src 'unsafe-inline'");
  });
});
