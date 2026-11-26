import { describe, expect, it } from "vitest";
import { mismatches, pathCandidates, pathIndex } from "./check";
import { claimsIn } from "./claims";

describe("false ✗ marks found by the 2026-11-22 sweep", () => {
  const index = pathIndex(["src/webview/extras.ts", "src/extension/inbox.ts", "README.md"]);
  const repo = {
    hasPath: (p: string) => index.has("docs/features", p),
    scripts: new Map([["npm", new Set(["build"])]]),
    symbols: new Set(["designCheck"]),
    envVars: new Set(["DOCMAP_TOKEN"]),
    identifiers: new Set(["designCheck", "LogOutputChannel", "INTERNAL_TIMINGS"]),
    versions: new Map([["typescript", "7.0.2"]]),
  };
  const found = (text: string) => mismatches(claimsIn(text), repo).map((m) => m.claim.value);

  it("a shortened path (`webview/extras.ts` for `src/webview/extras.ts`) is found", () => {
    expect(found("See `webview/extras.ts` and `extension/inbox.ts`.")).toEqual([]);
    expect(found("See `webview/gone.ts`.")).toEqual(["webview/gone.ts"]);
  });

  it("build output and installed packages are not checked (docmap does not read those folders)", () => {
    expect(found("Bundled to `dist/mermaid.js`; see `node_modules/x/index.js` and `build/out/`.")).toEqual(
      [],
    );
  });

  it("a name used in the code (a library type, a constant) is not 'missing'", () => {
    expect(found("Logs go to a `LogOutputChannel`; timings live in `INTERNAL_TIMINGS`.")).toEqual([]);
    expect(found("`RemovedThing` and `GONE_SETTING` are gone.")).toEqual(["RemovedThing", "GONE_SETTING"]);
  });

  it("npm's own commands and a bare `npm run` are not scripts; a missing script still is", () => {
    expect(found("Checked with `npm view`, `npm ls`, `npm run`; then `npm run build`.")).toEqual([]);
    expect(found("Run `npm run deploy`.")).toEqual(["deploy"]);
  });

  it("a year after a product name is not a version", () => {
    expect(found("A TypeScript 2026 comparison.")).toEqual([]);
    expect(found("Needs TypeScript 5.")).toEqual(["typescript"]);
  });
});

describe("pathCandidates", () => {
  it("tries the doc's folder and every folder above it, so a sub-project's `src/x.js` is found", () => {
    // a doc in sample-shop/docs/design naming `src/cart.js`, with the parent folder opened in VS Code
    expect(pathCandidates("sample-shop/docs/design", "src/cart.js")).toEqual([
      "src/cart.js",
      "sample-shop/docs/design/src/cart.js",
      "sample-shop/docs/src/cart.js",
      "sample-shop/src/cart.js",
    ]);
  });

  it("handles Windows separators, `./` and `../`, a trailing slash, and a doc at the top", () => {
    expect(pathCandidates("docs\\design", "./src/")).toContain("src");
    expect(pathCandidates("docs/design", "../api.md")).toContain("docs/api.md");
    expect(pathCandidates("", "src/cart.js")).toEqual(["src/cart.js"]);
    expect(pathCandidates("", ".github/workflows/ci.yml")).toEqual([".github/workflows/ci.yml"]);
  });
});
