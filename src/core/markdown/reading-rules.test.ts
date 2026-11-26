import { describe, expect, it } from "vitest";
import { createMarkdownItEngine } from "./markdown-it-engine";
import type { InferHeadings } from "./reading-rules";
import { countWords } from "./reading-rules";

const engine = createMarkdownItEngine();

/** Linear work about doubles when its input doubles; quadratic work about quadruples. Between the two. */
const MAX_GROWTH = 3;

/**
 * How many times longer `run(size)` takes than `run(size / 2)`: the best of two runs each (after a small warm-up), so
 * a busy PC slows both sides alike and one slow run does not count.
 */
function growth(run: (n: number) => void, size: number): number {
  const best = (n: number) =>
    Math.min(
      ...[0, 1].map(() => {
        const started = performance.now();
        run(n);
        return performance.now() - started;
      }),
    );
  run(Math.max(1, Math.floor(size / 20)));
  const half = best(Math.floor(size / 2));
  return best(size) / Math.max(half, 1);
}
/** With reading tools ON (the setting these rules belong to). */
function parse(text: string, inferHeadings?: InferHeadings) {
  const result = engine.parse(
    text,
    1,
    inferHeadings ? { readingTools: true, inferHeadings } : { readingTools: true },
  );
  if (!result.ok) throw new Error(result.reason);
  return result.document;
}

describe("reading tools OFF (the default): exactly the plain map", () => {
  const all =
    "**Bold line**\n\n2.1 Numbered\n\n- [ ] task\n\n> [!NOTE]\n> note\n\nref[^1]\n\n[^1]: the note\n";

  it("no structure hints, no sizes, no footnotes, no checkboxes, no callouts", () => {
    const result = engine.parse(all, 1);
    if (!result.ok) throw new Error(result.reason);
    const { headings, html } = result.document;
    expect(headings).toEqual([]);
    expect(html).not.toMatch(/checkbox|callout|footnote|inferred/);
    expect(html).toContain("[ ] task");
    expect(html).toContain("[!NOTE]");
    expect(html).toContain("[^1]");
  });

  it("headings carry no size when the tools are off", () => {
    const result = engine.parse("# A\n\ntext\n", 1);
    expect(result.ok && result.document.headings[0]?.words).toBeUndefined();
  });

  it("'inferHeadings' has no effect without reading tools", () => {
    const result = engine.parse(all, 1, { inferHeadings: "always" });
    expect(result.ok && result.document.headings).toEqual([]);
  });

  it("switching the tools on and off per parse gives each its own output (one engine serves both)", () => {
    const on = engine.parse(all, 1, { readingTools: true });
    const off = engine.parse(all, 1);
    expect(on.ok && on.document.html).toContain("task-checkbox");
    expect(off.ok && off.document.html).not.toContain("task-checkbox");
  });
});

describe("structure hints: lines that act as headings join the outline", () => {
  const ai = [
    "**Overview**",
    "",
    "Some words here.",
    "",
    "**Key points:**",
    "",
    "- one",
    "- **not a heading** inside a list",
    "",
    "2.1 Numbered section",
    "",
    "A line with **bold** in the middle is a sentence.",
    "",
    "**Bold that runs",
    "over two lines**",
  ].join("\n");

  it("turns a bold-only line and a numbered line into headings, marked inferred", () => {
    const doc = parse(ai);
    expect(doc.headings.map(({ text, level, inferred }) => ({ text, level, inferred }))).toEqual([
      { text: "Overview", level: 2, inferred: true },
      { text: "Key points:", level: 2, inferred: true }, // consecutive bold lines are siblings
      { text: "2.1 Numbered section", level: 3, inferred: true },
    ]);
    expect(doc.html).toContain('<h2 class="inferred-heading" id="overview" data-line="0">');
  });

  it("leaves bold inside lists, bold mid-sentence, multi-line bold and long lines as they are", () => {
    const doc = parse(ai);
    expect(doc.headings.some((h) => h.text.includes("not a heading"))).toBe(false);
    expect(doc.headings.some((h) => h.text.includes("middle"))).toBe(false);
    expect(doc.headings.some((h) => h.text.includes("runs"))).toBe(false);
    expect(parse(`**${"x".repeat(101)}**`).headings).toEqual([]);
  });

  it("keeps real lists and years out: '1. Item' is a list, '2024 plans' is text", () => {
    expect(parse("1. Item\n2. Next\n").headings).toEqual([]);
    expect(parse("2024 plans are here\n").headings).toEqual([]);
  });

  it("'auto' leaves a document with real headings as written; 'always' and 'off' override", () => {
    const headed = "# A\n\n**Bold line**\n\n## B\n\n## C\n";
    expect(parse(headed).headings.map((h) => h.text)).toEqual(["A", "B", "C"]);
    expect(parse(headed, "always").headings.map((h) => h.text)).toEqual(["A", "Bold line", "B", "C"]);
    expect(parse(ai, "off").headings).toEqual([]);
  });

  it("bold subheads stay siblings under the last real heading, even after a numbered line", () => {
    const doc = parse("# Report\n\n**First**\n\n2.1 Numbered\n\n**Second**\n");
    expect(doc.headings.map((h) => [h.text, h.level])).toEqual([
      ["Report", 1],
      ["First", 2],
      ["2.1 Numbered", 3],
      ["Second", 2],
    ]);
  });

  it("never takes a real heading's id: '#usage' still points at '## Usage', not at a bold 'Usage' line", () => {
    const doc = parse("**Usage**\n\ntext\n\n## Usage\n\n[x](#usage)\n");
    expect(doc.headings.map((h) => [h.text, h.id, h.inferred ?? false])).toEqual([
      ["Usage", "usage-1", true],
      ["Usage", "usage", false],
    ]);
  });

  it.each([
    "3.5 hours later we left.",
    "192.168.1.1 is the router",
    "2.1 ends like a sentence!",
    "1.2 3 4 numbers only",
  ])("does not turn a sentence or number into a heading: %s", (line) => {
    expect(parse(`${line}\n`).headings).toEqual([]);
  });

  it("a numbered heading may end with a question mark", () => {
    expect(parse("1.2 Why does it fail?\n").headings.map((h) => h.text)).toEqual(["1.2 Why does it fail?"]);
  });

  it("gives the same ids on every parse (a jump re-parses and must find the heading again)", () => {
    expect(parse(ai).headings.map((h) => h.id)).toEqual(parse(ai).headings.map((h) => h.id));
  });
});

describe("section size", () => {
  it("counts each section's words, sub-sections included; text before the first heading counts for none", () => {
    const doc = parse(
      "intro words here\n\n# A\n\none two three\n\n## B\n\nfour five\n\n```\ncode line\n```\n\n# C\n\nsix\n",
    );
    expect(doc.headings.map((h) => [h.text, h.words])).toEqual([
      ["A", 3 + 2 + 2], // its own 3, plus B's 2 words and 2 code words
      ["B", 4],
      ["C", 1],
    ]);
  });

  it("counts what a reader sees: not task or callout markers, not the footnotes at the end", () => {
    const doc = parse(
      "# A\n\n- [ ] one two\n\n> [!NOTE]\n> three\n\nfour[^1]\n\n[^1]: many note words here\n",
    );
    expect(doc.headings[0]?.words).toBe(4);
  });

  it("counts words as runs of non-space characters", () => {
    expect(countWords("  one\ttwo\nthree  ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});

describe("task lists", () => {
  it("renders the marker as a disabled checkbox, checked or not, carrying its source line", () => {
    const html = parse("- [ ] todo\n- [x] done\n").html;
    expect(html).toContain(
      '<li class="task-list-item"><input class="task-checkbox" type="checkbox" disabled data-line="0"> todo',
    );
    expect(html).toContain(
      '<input class="task-checkbox" type="checkbox" disabled checked data-line="1"> done',
    );
  });

  it("table rows carry their source line (for changing a status from the page)", () => {
    const html = parse("intro\n\n| Task | Status |\n| --- | --- |\n| Load test | done |\n").html;
    expect(html).toContain('<tr data-line="2">');
    expect(html).toContain('<tr data-line="4">');
  });

  it("leaves '[ ]' outside a list item as text, and item text stays text", () => {
    expect(parse("[ ] not a task\n").html).not.toContain("checkbox");
    expect(parse("- [x] <script>alert(1)</script>\n").html).toContain("&lt;script&gt;");
  });
});

describe("callouts (GitHub alerts)", () => {
  it.each([
    ["NOTE", "Note"],
    ["tip", "Tip"],
    ["IMPORTANT", "Important"],
    ["WARNING", "Warning"],
    ["CAUTION", "Caution"],
  ])("> [!%s] becomes a titled callout", (marker, title) => {
    const html = parse(`> [!${marker}]\n> Read this.\n`).html;
    expect(html).toContain(`<blockquote class="callout callout-${marker.toLowerCase()}">`);
    expect(html).toContain(`<p class="callout-title">${title}</p>`);
    expect(html).toContain("Read this.");
    expect(html).not.toContain("[!");
  });

  it("leaves unknown markers and ordinary quotes alone; callout text stays text", () => {
    expect(parse("> [!FOO]\n> x\n").html).not.toContain("callout");
    expect(parse("> plain\n").html).not.toContain("callout");
    expect(parse("> [!NOTE]\n> <img src=x onerror=alert(1)>\n").html).not.toContain("onerror");
  });
});

describe("footnotes", () => {
  it("renders references and the notes, with ids that cannot collide with heading slugs", () => {
    const html = parse("Text[^1].\n\n[^1]: The note.\n").html;
    expect(html).toContain('<a href="#fn-d:-1" id="fnref-d:-1">[1]</a>');
    expect(html).toContain('<li id="fn-d:-1" class="footnote-item">');
    expect(html).toContain("The note.");
  });

  it("note text stays text and its links follow the same allowlist", () => {
    const html = parse(
      "A[^x]\n\n[^x]: <img src=x onerror=alert(1)> [bad](javascript:alert(1)) [ok](https://example.com)\n",
    ).html;
    expect(html).not.toContain("onerror");
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('href="https://example.com"');
  });

  it("several references to one note, inline notes, and order: as the footnote plugin renders them", () => {
    const html = parse("A[^n] B[^n] C^[inline note]\n\n[^n]: Shared.\n").html;
    expect(html).toContain('<a href="#fn-d:-1" id="fnref-d:-1">[1]</a>');
    expect(html).toContain('<a href="#fn-d:-1" id="fnref-d:-1:1">[1:1]</a>');
    expect(html).toContain('<a href="#fn-d:-2" id="fnref-d:-2">[2]</a>');
    expect(html).toMatch(
      /<li id="fn-d:-1" class="footnote-item"><p>Shared\. <a href="#fnref-d:-1" class="footnote-backref">.*<a href="#fnref-d:-1:1"/,
    );
    expect(html).toContain('<li id="fn-d:-2" class="footnote-item"><p>inline note');
    expect(html).not.toContain("[^n]:");
  });

  it("a footnote defined inside another one keeps its text", () => {
    const html = parse("A[^o] B[^i]\n\n[^o]: outer\n\n    [^i]: inner text\n").html;
    expect(html).toContain("inner text");
  });

  it("a heading inside a footnote stays in the note, out of the outline (headings stay in line order)", () => {
    const doc = parse("# A\n\ntext[^1]\n\n[^1]: note\n\n    # inside\n\n## B\n");
    expect(doc.headings.map((h) => [h.text, h.line])).toEqual([
      ["A", 0],
      ["B", 8],
    ]);
    expect(doc.html).toContain('<p class="footnote-heading">inside</p>');
  });

  it("a footnote id can never equal a heading id (slugs never contain ':')", () => {
    const doc = parse("## fn-d-1\n\n## fn d 1\n\nx[^1]\n\n[^1]: n\n");
    const ids = doc.headings.map((h) => h.id);
    expect(ids.some((id) => doc.html.includes(`<li id="${id}"`))).toBe(false);
  });

  // 2026-11-24 (owner call): checked by how the time GROWS, not by a fixed time. A fixed 1500 ms limit failed whenever
  // the PC was busy (the commit check runs lint alongside); doubling linear work about doubles its time on any PC,
  // while the quadratic bug this guards against makes it about four times longer.
  it("the plugin's quadratic cases stay linear (security review): long label scans, many notes", () => {
    const cases: [string, (n: number) => string, number][] = [
      // a defined footnote switches the reference scan on; then a long line of openers without spaces
      ["openers", (n) => `[^a]\n\n[^a]: x\n\n${"[^".repeat(n)}`, 80_000],
      ["labels", (n) => `[^a]\n\n[^a]: x\n\n${"[^aaaa".repeat(n)}`, 30_000],
      // many notes: the notes list used to be re-copied once per note
      [
        "notes",
        (n) =>
          `${Array.from({ length: n }, (_, i) => `r[^n${i}]`).join(" ")}\n\n${Array.from(
            { length: n },
            (_, i) => `[^n${i}]: note ${i}`,
          ).join("\n\n")}\n`,
        20_000,
      ],
    ];
    for (const [name, hostile, size] of cases) {
      expect(engine.parse(hostile(size), 1, { readingTools: true }).ok).toBe(true);
      const g = growth((n) => engine.parse(hostile(n), 1, { readingTools: true }), size);
      expect(g, `${name}: doubling the input made it ${g.toFixed(1)}× slower`).toBeLessThan(MAX_GROWTH);
    }
  }, 60_000);

  it("the growth check catches quadratic work (so the test above can fail)", () => {
    let sink = 0;
    const quadratic = (n: number) => {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sink += i ^ j;
    };
    expect(growth(quadratic, 6_000)).toBeGreaterThan(MAX_GROWTH);
    expect(sink).not.toBe(0.5); // keeps the loop from being optimised away
  });

  it("hostile footnote-shaped input still parses quickly", () => {
    for (const hostile of ["[^".repeat(20000), "^[".repeat(20000), `${"[^a]".repeat(5000)}\n\n[^a]: x\n`]) {
      const started = performance.now();
      expect(engine.parse(hostile, 1, { readingTools: true }).ok).toBe(true);
      expect(performance.now() - started).toBeLessThan(2000);
    }
  });
});
