import { describe, expect, it } from "vitest";
import {
  type CodeItem,
  codeItemsIn,
  featurePageMarkdown,
  firstSentence,
  isFeatureDoc,
  namedFiles,
  neighbours,
} from "./feature-atlas";

describe("which docs are features", () => {
  it("a doc in a features / specs folder, or a design or spec doc; never archived", () => {
    expect(isFeatureDoc("docs/features/url-enrichment.md", undefined)).toBe(true);
    expect(isFeatureDoc("docs/specs/login.md", undefined)).toBe(true);
    expect(isFeatureDoc("docs/auth.md", "design")).toBe(true);
    expect(isFeatureDoc("docs/markvid2.0/44-url-enrichment.md", undefined)).toBe(false);
    expect(isFeatureDoc("docs/_archive/features/old.md", "design")).toBe(false);
    expect(isFeatureDoc("README.md", undefined)).toBe(false);
  });
});

describe("a doc's one line", () => {
  it("is its summary's first sentence, cut at 160 characters", () => {
    expect(firstSentence("Reads the page. Then more.")).toBe("Reads the page.");
    expect(firstSentence("x".repeat(300)).length).toBe(160);
  });
});

describe("the code a feature doc names", () => {
  const repo = {
    hasPath: (p: string) => p === "code/app.py" || p === "code",
    findPath: (p: string) => (p === "code/app.py" || p === "code" ? p : undefined),
    symbols: new Set(["handler", "CartItem"]),
    identifiers: new Set(["handler", "CartItem", "helper"]),
  };
  const text = [
    "Entry: `handler()` in `code/app.py:1`. Also `helper()`, `legacy_pay()`, `CartItem`, `OrderLine`.",
    "Gone: `code/old.py`. Not code: `npm test`, `dist/x.js`.",
  ].join("\n");
  it("names the files it points to (found ones only)", () => {
    expect(namedFiles(text, repo)).toEqual(["code/app.py"]);
  });
  it("files and functions, each found or gone; a function's line from the files the doc names", () => {
    const items = codeItemsIn(text, repo, new Map([["code/app.py", "def handler(request):\n  pass\n"]]));
    expect(items).toContainEqual({
      name: "handler()",
      kind: "function",
      file: "code/app.py",
      line: 1,
      found: true,
    });
    expect(items).toContainEqual({
      name: "code/app.py:1",
      kind: "file",
      file: "code/app.py",
      line: 1,
      found: true,
    });
    expect(items).toContainEqual({ name: "helper()", kind: "function", found: true });
    expect(items).toContainEqual({ name: "legacy_pay()", kind: "function", found: false });
    expect(items).toContainEqual({ name: "code/old.py", kind: "file", found: false });
    expect(items).toContainEqual({ name: "CartItem", kind: "name", found: true });
    // a class-like word the code does not have is not claimed missing; build output is never checked
    expect(items.map((i) => i.name)).not.toContain("OrderLine");
    expect(items.map((i) => i.name)).not.toContain("dist/x.js");
  });
});

describe("one feature's page", () => {
  const code: CodeItem[] = [
    { name: "backend/app/enrich.py", kind: "file", file: "backend/app/enrich.py", found: true },
    { name: "extract_prices()", kind: "function", file: "backend/app/enrich.py", line: 42, found: true },
    {
      name: "frontend/src/Setup.tsx:12",
      kind: "file",
      file: "frontend/src/Setup.tsx",
      line: 12,
      found: true,
    },
    { name: "rankImages()", kind: "function", found: true },
    { name: "old_scrape()", kind: "function", found: false },
    { name: "backend/app/gone.py", kind: "file", found: false },
  ];
  const md = featurePageMarkdown({
    path: "docs/features/url-enrichment.md",
    title: "URL enrichment",
    tldr: "Reads the page.",
    linksIn: ["docs/markvid2.0/44-url-enrichment.md"],
    linksOut: ["docs/features/editor.md"],
    code,
  });
  it("shows only the docs around this one, as a small diagram and a list", () => {
    expect(md).toContain("# URL enrichment");
    expect(md).toContain("[Open the doc](docs/features/url-enrichment.md)");
    expect(md).toContain("```mermaid");
    expect(md).toContain("[44-url-enrichment.md](docs/markvid2.0/44-url-enrichment.md)");
    expect(md).toContain("[editor.md](docs/features/editor.md)");
  });
  it("groups the code it names by top folder, each linked to its line", () => {
    expect(md).toContain("### backend");
    expect(md).toContain("### frontend");
    expect(md).toContain(
      "[`extract_prices()`](backend/app/enrich.py#L42) | function in `backend/app/enrich.py`",
    );
    expect(md).toContain("[`frontend/src/Setup.tsx:12`](frontend/src/Setup.tsx#L12)");
    expect(md).toContain("`rankImages()` | function, defined elsewhere in the code");
  });
  it("lists the names the doc gives that are no longer in the code", () => {
    expect(md).toContain("## No longer in the code");
    expect(md).toContain("- `old_scrape()`");
    expect(md).toContain("- `backend/app/gone.py`");
  });
  it("caps the diagram so it stays readable", () => {
    const many = Array.from({ length: 40 }, (_, i) => `docs/x/${i}.md`);
    const { shownIn, shownOut, more } = neighbours(many, many.slice(0, 5), 12);
    expect(shownIn.length + shownOut.length).toBeLessThanOrEqual(12);
    expect(more).toBeGreaterThan(0);
  });
});
