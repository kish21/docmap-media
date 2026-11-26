import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The /foundation walking skeleton answered "ready" with a placeholder page. A plausible placeholder is
// indistinguishable from a working feature, so its removal is pinned by its literal content.
describe("walking-skeleton stub", () => {
  it("is gone from the host", () => {
    expect(readFileSync("src/extension/map-panel.ts", "utf8")).not.toContain("docmap is running for");
  });
});
