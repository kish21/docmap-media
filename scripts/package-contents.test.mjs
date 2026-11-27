import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The files the extension opens at run time must be inside the .vsix. CI's package step only checks that nothing
// EXTRA ships; this checks that nothing NEEDED is missing.
describe("the .vsix", () => {
  it("contains every file the extension reads at run time", () => {
    const files = execSync("npx vsce ls --no-dependencies", { encoding: "utf8", timeout: 90_000 })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const needed of ["README.md", "CHANGELOG.md", "LICENSE", "package.json"]) {
      expect(files, `${needed} is missing from the .vsix (see .vscodeignore)`).toContain(needed);
    }
    expect(files.filter((f) => f.startsWith("media/walkthrough/")).length).toBeGreaterThan(0);
    expect(files.filter((f) => f.startsWith("src/chrome/") || f.startsWith("dist-chrome/"))).toEqual([]);
  }, 120_000);
});
