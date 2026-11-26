import { describe, expect, it } from "vitest";
import { pathIndex } from "./check";
import { codeRefs, declarationLine, parseCodeRef, replaceCodePath } from "./code-refs";

const index = pathIndex(["src/cart.js", "src/webview/extras.ts", "lib/payments/charge.ts"]);
const repo = {
  hasPath: (p: string) => index.has("", p),
  symbols: new Set(["addItem", "PaymentConsumer"]),
};

describe("clickable code names in the preview (2026-11-22 review)", () => {
  it("only names that exist become clickable: files (with or without :line), functions, classes", () => {
    const text =
      "See `src/cart.js`, `src/cart.js:12`, `webview/extras.ts`, `addItem()`, `PaymentConsumer`, " +
      "`src/gone.js`, `missingFn()`, `npm run build` and `plain words`.";
    expect(codeRefs(text, repo)).toEqual([
      "src/cart.js",
      "src/cart.js:12",
      "webview/extras.ts",
      "addItem()",
      "PaymentConsumer",
    ]);
  });

  it("finds the line where a name is defined in a code file (when VS Code's language support cannot)", () => {
    const js = "// cart\nimport x from 'y';\nexport function addItem(cart, item) {\n  return addItem;\n}\n";
    expect(declarationLine(js, "addItem")).toBe(2);
    expect(declarationLine("class PaymentConsumer:\n    pass\n", "PaymentConsumer")).toBe(0);
    expect(declarationLine("const markPaid = async () => {};\n", "markPaid")).toBe(0);
    expect(declarationLine("addItem(cart);\n", "addItem")).toBeUndefined();
  });

  it("reads what a clicked name points to", () => {
    expect(parseCodeRef("src/cart.js:12")).toEqual({ path: "src/cart.js", line: 12 });
    expect(parseCodeRef("src/cart.js")).toEqual({ path: "src/cart.js" });
    expect(parseCodeRef("Orders.markPaid()")).toEqual({ symbol: "markPaid" });
    expect(parseCodeRef("PaymentConsumer")).toEqual({ symbol: "PaymentConsumer" });
    expect(parseCodeRef("two words")).toBeUndefined();
  });
});

describe("one-click fix for a moved file", () => {
  it("finds where a missing file went: one file with that name, or the closest match", () => {
    expect(index.moved("src/charge.ts")).toBe("lib/payments/charge.ts");
    expect(index.moved("src/nothing-like-it.ts")).toBeUndefined();
    const two = pathIndex(["a/payments/charge.ts", "b/billing/charge.ts"]);
    expect(two.moved("old/payments/charge.ts")).toBe("a/payments/charge.ts");
    expect(two.moved("charge-old/charge.ts")).toBeUndefined(); // two equally good guesses: no guess
  });

  it("writes the new path the way the doc writes paths (a project inside the opened folder)", () => {
    const shop = pathIndex(["sample-shop/README.md", "sample-shop/src/shop/cart.js"]);
    expect(shop.moved("src/cart.js", "sample-shop")).toBe("src/shop/cart.js");
    expect(shop.moved("src/cart.js", "sample-shop/docs/design")).toBe("src/shop/cart.js");
    expect(shop.moved("src/cart.js")).toBe("sample-shop/src/shop/cart.js");
  });

  it("replaces the path only inside backticks on that line", () => {
    expect(replaceCodePath("See `src/charge.ts` and src/charge.ts.", "src/charge.ts", "lib/charge.ts")).toBe(
      "See `lib/charge.ts` and src/charge.ts.",
    );
    expect(replaceCodePath("At `src/charge.ts:40`.", "src/charge.ts", "lib/charge.ts")).toBe(
      "At `lib/charge.ts:40`.",
    );
    expect(replaceCodePath("Nothing here.", "src/charge.ts", "lib/charge.ts")).toBeUndefined();
  });
});
