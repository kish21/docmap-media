import { describe, expect, it } from "vitest";
import { agentBundle, sizeLabel, tokenEstimate } from "./context-bundle";

describe("Copy for my AI (2026-11-22 review)", () => {
  it("joins the docs, each under its path, without HTML comments (template hints)", () => {
    const out = agentBundle([
      { rel: "docs/plan.md", text: "# Plan\n<!-- hint: write the goal -->\nShip it.\n" },
      { rel: "docs/decisions/0001.md", text: "# Use JSON\n" },
    ]);
    expect(out).toBe(
      "Here are 2 docs from my project.\n\n" +
        "--- docs/plan.md ---\n# Plan\n\nShip it.\n\n" +
        "--- docs/decisions/0001.md ---\n# Use JSON\n",
    );
    expect(out).not.toContain("hint");
  });

  it("keeps code blocks as they are, even with comment-like text inside", () => {
    const out = agentBundle([{ rel: "a.md", text: "```html\n<!-- keep -->\n```\n" }]);
    expect(out).toContain("<!-- keep -->");
  });

  it("estimates the size in tokens and words people understand", () => {
    expect(tokenEstimate("a".repeat(4000))).toBe(1000);
    expect(sizeLabel("word ".repeat(3000))).toBe("about 3,000 words (about 3,800 tokens)");
  });
});
