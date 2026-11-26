import { describe, expect, it } from "vitest";
import { createMarkdownItEngine } from "./markdown-it-engine";

const engine = createMarkdownItEngine();
function parse(text: string) {
  const result = engine.parse(text, 1);
  if (!result.ok) throw new Error(result.reason);
  return result.document;
}
const html = (text: string) => parse(text).html;

describe("safe HTML tags (ADR-0002 amendment, 0.0.8)", () => {
  it("renders the harmless inline tags READMEs use", () => {
    expect(
      html("Press <kbd>Ctrl</kbd>+<kbd>F</kbd>, x<sup>2</sup>, H<sub>2</sub>O, <mark>note</mark>\n"),
    ).toBe("<p>Press <kbd>Ctrl</kbd>+<kbd>F</kbd>, x<sup>2</sup>, H<sub>2</sub>O, <mark>note</mark></p>\n");
    expect(html("one<br>two<br/>three<br />four\n")).toBe("<p>one<br>\ntwo<br>\nthree<br>\nfour</p>\n");
  });

  it("renders a <details> block with its summary; the Markdown inside stays Markdown", () => {
    const doc = parse("<details>\n<summary>More <b>info</b></summary>\n\n## Inside\n\ntext\n\n</details>\n");
    expect(doc.html).toBe(
      '<details>\n<summary>More <b>info</b></summary>\n<h2 id="inside" data-line="3">Inside</h2>\n<p>text</p>\n</details>\n',
    );
    expect(doc.headings.map((h) => h.text)).toEqual(["Inside"]); // the heading below <details> is not swallowed
    expect(html("<details open><summary>Hi</summary>\n\nx\n\n</details>\n")).toContain(
      "<details open>\n<summary>Hi</summary>",
    );
  });

  it("never keeps an attribute: event handlers, styles and links are dropped or stay text", () => {
    for (const hostile of [
      "<details ontoggle=alert(1) open>\n",
      '<kbd onclick="alert(1)">x</kbd>\n',
      '<b style="color:red">x</b>\n',
      "<details/open/ontoggle=alert(1)>\n",
      "<summary onclick=alert(1)>x</summary>\n",
    ]) {
      const out = html(hostile);
      expect(out, hostile).not.toMatch(/<[a-z]+[^>]*\s(on\w+|style)=/i);
      expect(out, hostile).toContain("&lt;"); // shown as the text it was
    }
  });

  it("anything not on the list stays text, as before", () => {
    const out = html(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<a href="javascript:x">y</a>\n',
    );
    expect(out).not.toMatch(/<script\b|onerror=|javascript:/);
    expect(out).toContain("&lt;script&gt;");
    expect(html("<iframe>\n")).toContain("&lt;iframe&gt;");
    expect(html("<div>\n")).toContain("&lt;div&gt;");
  });

  it("unpaired tags cannot leak: they stay the text the document had", () => {
    expect(html("<b>bold without end\n\nnext paragraph\n")).toBe(
      "<p>&lt;b&gt;bold without end</p>\n<p>next paragraph</p>\n",
    );
    expect(html("end without start</b>\n")).toBe("<p>end without start&lt;/b&gt;</p>\n");
    // improper nesting: only a properly nested pair renders, the rest stays text
    expect(html("<b><i>crossed</b></i>\n")).toBe("<p>&lt;b&gt;<i>crossed&lt;/b&gt;</i></p>\n");
    expect(html("</details>\n")).toBe("<p>&lt;/details&gt;</p>\n");
    expect(html("<summary>alone</summary>\n")).toBe("<p>&lt;summary&gt;alone&lt;/summary&gt;</p>\n");
    expect(html("<details>\n\nnever closed\n")).toMatch(/<\/details>\n$/); // closed at the end of the document
  });

  it("inside code it is code", () => {
    expect(html("`<kbd>x</kbd>`\n")).toContain("<code>&lt;kbd&gt;x&lt;/kbd&gt;</code>");
    expect(html("```\n<details>\n```\n")).toContain("&lt;details&gt;");
    expect(html("    <details>\n")).toContain("<pre><code>&lt;details&gt;");
  });

  it("stays linear on hostile input (the reason html:true was reverted in M1)", () => {
    for (const hostile of [
      "<b>".repeat(100_000),
      `${"<details>\n".repeat(30_000)}`,
      `${"<b ".repeat(50_000)}x`,
      `<summary>${"<".repeat(100_000)}</summary>\n`,
    ]) {
      const started = performance.now();
      expect(engine.parse(hostile, 1).ok).toBe(true);
      expect(performance.now() - started).toBeLessThan(1500);
    }
  });
});

describe("pictures, anchors and links (0.0.12, owner call)", () => {
  const resolved = (text: string) => {
    const result = engine.parse(text, 1, {
      resolveImage: (src) => (src.endsWith(".svg") ? `ok:${src}` : undefined),
    });
    if (!result.ok) throw new Error(result.reason);
    return result.document.html;
  };

  it("draws a README's <picture>: the light and dark versions, each through the image resolver", () => {
    const out = resolved(
      '<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="d/arch-dark.svg">\n' +
        '  <img alt="How it works" src="d/arch-light.svg" width="600">\n</picture>\n',
    );
    expect(out).toContain("<picture>");
    expect(out).toContain(
      '<source srcset="ok:d/arch-dark.svg" media="(prefers-color-scheme: dark)" data-scheme="dark">',
    );
    expect(out).toContain('<img src="ok:d/arch-light.svg" alt="How it works" width="600">');
    expect(out).toContain("</picture>");
  });

  it("an image the resolver refuses (web, outside the folder, not an image) shows its alt text, never loads", () => {
    for (const src of ["https://example.com/a.svg", "//host/a.svg", "notes.txt", "javascript:alert(1)"]) {
      const out = resolved(`<img src="${src}" alt="Diagram">\n`);
      expect(out, src).not.toContain("<img");
      expect(out, src).toContain("[image: Diagram]");
    }
    expect(resolved('<source srcset="https://example.com/x.svg">\n')).not.toContain("<source");
  });

  it("keeps only the named attributes, each checked", () => {
    const out = resolved(
      '<img src="a.svg" alt="x&quot; onload=&quot;alert(1)" onerror="alert(1)" style="x" width="9e9" height="40">\n',
    );
    expect(out).toBe('<p><img src="ok:a.svg" alt="x&quot; onload=&quot;alert(1)" height="40"></p>\n');
    expect(resolved('<source media="print" srcset="a.svg">\n')).not.toContain("<source"); // only light/dark
  });

  it("an <a id> is a jump target; an <a href> is a link under the Markdown link rules", () => {
    expect(html('<a id="how-it-works"></a>\n')).toBe('<p><a id="how-it-works"></a></p>\n');
    expect(html('<a name="setup">Setup</a>\n')).toBe('<p><a id="setup">Setup</a></p>\n');
    expect(html('<a href="docs/a.md"><code>a.md</code></a>\n')).toBe(
      '<p><a href="docs/a.md"><code>a.md</code></a></p>\n',
    );
    for (const bad of ["javascript:alert(1)", "vscode:x", "data:text/html,x", "//host/x", "command:x"]) {
      expect(html(`<a href="${bad}">x</a>\n`), bad).toBe("<p><a>x</a></p>\n");
    }
    expect(html('<a id="x&quot; onclick=&quot;y">z</a>\n')).toBe("<p><a>z</a></p>\n"); // not a plain name
    expect(html('<a href="#s" onclick="alert(1)">x</a>\n')).toBe('<p><a href="#s">x</a></p>\n');
  });

  it("a README's source line: <sub>, <a href> and <code> together", () => {
    expect(
      html('<sub>Source: <a href="d/a.mmd"><code>d/a.mmd</code></a> (see <code>x.sh</code>).</sub>\n'),
    ).toBe('<p><sub>Source: <a href="d/a.mmd"><code>d/a.mmd</code></a> (see <code>x.sh</code>).</sub></p>\n');
  });

  it("0.1.0 review: a control character cannot hide a dangerous scheme; <a name> works when id is not a plain name", () => {
    for (const bad of ["\x01javascript:alert(1)", "\x1fcommand:x", "\x01//evil.example/share"]) {
      expect(html(`<a href="${bad}">x</a>\n`), JSON.stringify(bad)).toBe("<p><a>x</a></p>\n");
    }
    expect(html('<a id="not ok" name="setup">x</a>\n')).toBe('<p><a id="setup">x</a></p>\n');
    // normalised like a Markdown link: a space in a relative path is percent-encoded
    expect(html('<a href="my notes.md">x</a>\n')).toBe('<p><a href="my%20notes.md">x</a></p>\n');
  });

  it("an <a> without its </a> stays the text the document had", () => {
    expect(html('<a href="x.md">never closed\n')).toBe(
      "<p>&lt;a href=&quot;x.md&quot;&gt;never closed</p>\n",
    );
  });

  it("stays linear on many unfinished tags", () => {
    const text = `${'<img src="a" alt="'.repeat(20000)}\n${"<a href=x ".repeat(20000)}\n`;
    const started = performance.now();
    html(text);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
