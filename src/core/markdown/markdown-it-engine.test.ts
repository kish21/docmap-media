import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMarkdownItEngine, isAllowedUrl, utf8Bytes } from "./markdown-it-engine";

const engine = createMarkdownItEngine();
const tricky = readFileSync("tests/fixtures/tricky.md", "utf8");

/** Headings without their word counts (sizes are tested on their own). */
const shape = (headings: readonly { words?: number }[]) => headings.map(({ words: _words, ...h }) => h);

function parse(text: string) {
  const result = engine.parse(text, 7);
  if (!result.ok) throw new Error(result.reason);
  return result.document;
}

describe("headings", () => {
  const doc = parse(tricky);

  it("finds every heading in order, with level, 0-based line and a GitHub id", () => {
    expect(shape(doc.headings)).toEqual([
      { id: "title", text: "Title", level: 1, line: 0 },
      { id: "setup", text: "Setup", level: 2, line: 6 },
      { id: "setup-1", text: "Setup", level: 2, line: 13 },
      {
        id: "deep-code-heading-with-emphasis-and-a-link",
        text: "Deep code heading with emphasis and a link",
        level: 3,
        line: 15,
      },
      { id: "skipped-levels", text: "Skipped levels", level: 5, line: 22 },
      { id: "setext-heading", text: "Setext Heading", level: 1, line: 24 },
    ]);
  });

  it("stamps the id and source line onto the rendered heading", () => {
    expect(doc.html).toContain('<h2 id="setup" data-line="6">');
    expect(doc.html).toContain('<h2 id="setup-1" data-line="13">');
  });

  it("carries the version it was computed from", () => {
    expect(doc.docVersion).toBe(7);
  });
});

describe("HTML in the document never renders (ADR-0002)", () => {
  const { html } = parse(tricky);

  it("escapes raw HTML blocks and tags; only the allowlisted harmless tags render (0.0.8)", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("&lt;script&gt;alert");
    expect(html).toContain("<b>bold html</b>"); // on the safe list: rendered, without attributes
  });

  it("drops HTML comments — inline, in headings and multi-line blocks", () => {
    expect(html).not.toContain("/marker");
    expect(html).not.toContain("hidden");
    expect(html).not.toContain("multi-line");
  });

  it("keeps a comment that is inside a code block (it is content, not markup)", () => {
    expect(html).toContain("&lt;!-- this comment is CODE and must stay visible --&gt;");
  });

  it("refuses javascript: links (left as plain text, never an href)", () => {
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).toContain("<p>[bad](javascript:alert(1))</p>");
  });
});

describe("comments follow CommonMark (what GitHub hides, docmap hides — no more, no less)", () => {
  it("treats <!--> and <!---> as complete (empty) comments, so the text after them stays visible", () => {
    expect(parse("<!--> shown -->\n").html).toContain("shown");
    expect(parse("a <!---> b\n").html).toContain("<p>a  b</p>");
  });
  it("keeps an unterminated inline <!-- as visible text", () => {
    expect(parse("a <!-- b\n").html).toContain("<p>a &lt;!-- b</p>");
  });
  it("keeps text after --> on a comment block's closing line", () => {
    expect(parse("<!-- x --> tail text\n").html).toContain("<p>tail text</p>");
  });
  it("does not let HTML hide the Markdown next to it", () => {
    const doc = parse("<div>\n## Visible\n</div>\n");
    expect(doc.headings.map((h) => h.text)).toEqual(["Visible"]);
  });
  it("an unterminated comment in a list item ends with the item — headings after the list stay", () => {
    expect(shape(parse("- <!-- note\n\n# Real heading\n").headings)).toEqual([
      { id: "real-heading", text: "Real heading", level: 1, line: 2 },
    ]);
    expect(parse("- <!--\n# Heading outside list\n-->\n\n## After\n").headings.map((h) => h.text)).toEqual([
      "Heading outside list",
      "After",
    ]);
  });
  it("a comment can interrupt a paragraph, so a commented-out heading stays hidden", () => {
    const doc = parse("Some text\n<!--\n\n# Hidden heading\n-->\n\n## Shown\n");
    expect(doc.headings.map((h) => h.text)).toEqual(["Shown"]);
    expect(doc.headings[0]?.line).toBe(6);
    expect(doc.html).not.toContain("&lt;!--");
  });
  it("a comment inside a blockquote ends with the blockquote", () => {
    expect(parse("> <!-- open\n\n# After quote\n").headings.map((h) => h.text)).toEqual(["After quote"]);
  });
});

describe("hostile input stays fast (linear, not quadratic)", () => {
  it.each([
    ["repeated unterminated comment openers", `a ${"<!-- a ".repeat(40_000)}`],
    ["repeated block comment openers", "<!-- a\n\n".repeat(40_000)],
    ["comment openers each in its own blockquote, one far terminator", `${"> <!--\n\n".repeat(40_000)}-->\n`],
    ["comment openers in blockquotes with a continuation line", `${"> <!--\n>\n\n".repeat(30_000)}-->`],
    ["comment openers each in its own list item", `${"- <!--\n".repeat(40_000)}-->\n`],
    ["repeated declarations", `a ${"<!X ".repeat(40_000)}`],
    ["repeated processing instructions", `a ${"<? ".repeat(40_000)}`],
  ])("%s (~200–300 KB) parses in under 2 s (the quadratic version took 11 s)", (_name, text) => {
    const started = performance.now();
    expect(engine.parse(text, 1).ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("links", () => {
  it.each([
    ["https://example.com", true],
    ["http://example.com", true],
    ["mailto:a@b.c", true],
    ["#section", true],
    ["docs/plan.md", true],
    ["../README.md#setup", true],
    ["vscode://vscode.git/clone?url=https://evil", false],
    ["command:workbench.action.terminal.sendSequence", false],
    ["file:///etc/passwd", false],
    ["//host.example/share/x.md", false],
    ["/docs/x.md", true],
    ["JavaScript:alert(1)", false],
    ["data:text/html,<script>", false],
  ])("%s → allowed: %s", (url, allowed) => {
    expect(isAllowedUrl(url)).toBe(allowed);
    const html = parse(`[x](${url})\n`).html;
    expect(html.includes("<a href")).toBe(allowed);
  });
});

describe("network-path links (a file:// page would contact the host)", () => {
  it.each([
    "//host.example/share",
    "\\\\host.example\\share",
    "/\\host.example/share",
    "\\/host.example",
    "/\t/host.example",
  ])("%s is refused, and no rendered link starts with two slashes of either kind", (url) => {
    expect(isAllowedUrl(url)).toBe(false);
    for (const md of [`[x](${url})`, `[x](<${url}>)`, `<${url}>`, `[x][r]\n\n[r]: ${url}`]) {
      expect(parse(`${md}\n`).html).not.toMatch(/href="[\\/]{2}/);
    }
  });
});

describe("tables", () => {
  it("turns column alignment into a class (the panel's CSP forbids inline styles)", () => {
    const html = parse("| a | b |\n|:--|--:|\n| 1 | 2 |\n").html;
    expect(html).not.toContain("style=");
    expect(html).toContain('<th class="align-left">a</th>');
    expect(html).toContain('<td class="align-right">2</td>');
  });
});

describe("front matter", () => {
  it("is skipped, and line numbers after it stay true", () => {
    const doc = parse("---\ntitle: x\ntags: [a]\n---\n\n# Real\n");
    expect(shape(doc.headings)).toEqual([{ id: "real", text: "Real", level: 1, line: 5 }]);
    expect(doc.html).not.toContain("title: x");
  });
  it("a document that merely starts with a rule is left alone", () => {
    expect(parse("---\n\n# Heading\n").headings).toHaveLength(1);
    expect(parse("---\n# Doc title\n\nIntro\n\n...\n\n# Next\n").headings.map((h) => h.text)).toEqual([
      "Doc title",
      "Next",
    ]);
  });
});

describe("edge documents", () => {
  it("an empty file has no headings and one (empty) line, like VS Code", () => {
    const doc = parse("");
    expect(doc.headings).toEqual([]);
    expect(doc.lineCount).toBe(1);
    expect(doc.bytes).toBe(0);
  });

  it("a file without headings still renders", () => {
    const doc = parse("just text\n");
    expect(doc.headings).toEqual([]);
    expect(doc.html).toContain("<p>just text</p>");
  });

  it("counts lines as VS Code does, and UTF-8 bytes", () => {
    expect(parse("a\nb\nc").lineCount).toBe(3);
    expect(parse("a\n").lineCount).toBe(2);
    expect(utf8Bytes("aé€😀")).toBe(1 + 2 + 3 + 4);
  });
});

describe("1 MB guardrail benchmark (#56)", () => {
  it("parses a 1 MB Markdown fixture in under 1 second and stays within default largeFileBytes", async () => {
    const { DEFAULT_CONFIG } = await import("../config/config");
    const product = readFileSync("tests/fixtures/product.md", "utf8");
    let big = "";
    while (utf8Bytes(big) < 1024 * 1024) big += product;
    const bytes = utf8Bytes(big);
    expect(bytes).toBeGreaterThanOrEqual(1024 * 1024);
    expect(bytes).toBeLessThanOrEqual(DEFAULT_CONFIG.largeFileBytes);

    const started = performance.now();
    const result = engine.parse(big, 1);
    const elapsed = performance.now() - started;

    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("images", () => {
  const withResolver = (text: string, resolve: (src: string) => string | undefined) => {
    const result = engine.parse(text, 1, { resolveImage: resolve });
    if (!result.ok) throw new Error(result.reason);
    return result.document.html;
  };

  it("loads a relative image only through the host's resolver", () => {
    const html = withResolver("![diagram](img/d.png)\n", (src) => `vscode-resource:/ws/${src}`);
    expect(html).toContain('<img src="vscode-resource:/ws/img/d.png" alt="diagram">');
  });

  it("shows the alt text when the resolver refuses the path", () => {
    const html = withResolver("![secret](../../etc/x.png)\n", () => undefined);
    expect(html).not.toContain("<img");
    expect(html).toContain("[image: secret]");
  });

  it("never requests a remote image, and never asks the resolver about it", () => {
    const asked: string[] = [];
    const html = withResolver("![tracker](https://evil.example/pixel.gif)\n", (src) => {
      asked.push(src);
      return src;
    });
    expect(asked).toEqual([]);
    expect(html).not.toContain("<img");
    expect(html).toContain("[image: tracker]");
  });

  it("without a resolver (the default), relative images are not loaded either", () => {
    expect(parse("![x](a.png)\n").html).toContain("[image: x]");
  });

  it("escapes the alt text and the original path shown in the tooltip", () => {
    const html = withResolver('![<b>"x"</b>](a".png)\n', () => undefined);
    expect(html).not.toContain("<b>"); // alt text is text: tags inside it are dropped, never rendered
    expect(html).toContain("[image: &quot;x&quot;]");
    expect(html).toContain('title="a%22.png"');
  });
});
