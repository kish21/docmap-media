import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PUBLIC_REPO_URL = "https://github.com/kish21/markdown-docmap";
const PUBLIC_ISSUES_URL = `${PUBLIC_REPO_URL}/issues`;

const FORBIDDEN_INTERNAL_PATHS = [
  "PRODUCT.md",
  "STRUCTURE.md",
  "DESIGN.md",
  "TICKETS.md",
  "STATUS.md",
  "AGENTS.md",
  "CLAUDE.md",
  "NEXT-SESSION.md",
  "docs",
  "status",
  ".claude",
  ".vscode",
  "lefthook.yml",
  "scripts/check_structure.py",
  "scripts/frontend-audit",
  "scripts/videos",
  "scripts/export-public.mjs",
];

describe("#58: public open-source repo & reproducible CI release pipeline", () => {
  it("configures package.json as public and points repository/bugs to kish21/markdown-docmap", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.private).toBe(false);
    expect(pkg.license).toBe("MIT");
    expect(pkg.repository?.url).toBe(PUBLIC_REPO_URL);
    expect(pkg.bugs?.url).toBe(PUBLIC_ISSUES_URL);
  });

  it("links README.md and SECURITY.md to the public repo and valid screenshot URL", () => {
    const readme = readFileSync("README.md", "utf8");
    const security = readFileSync("SECURITY.md", "utf8");
    expect(readme).not.toContain("demo.gif");
    expect(readme).toContain("https://raw.githubusercontent.com/kish21/markdown-docmap/main/screenshot.png");
    expect(readme).toContain(PUBLIC_ISSUES_URL);
    expect(security).toContain(PUBLIC_ISSUES_URL);
  });

  it("ships CI and reproducible release workflows that check, package, checksum, and publish .vsix", () => {
    expect(existsSync(".github/workflows/ci.yml")).toBe(true);
    expect(existsSync(".github/workflows/release.yml")).toBe(true);
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const release = readFileSync(".github/workflows/release.yml", "utf8");

    expect(ci).toContain("gitleaks");
    expect(ci).toContain("npm run test:integration");
    expect(ci).toContain("vsce package");

    expect(release).toContain("npm run check");
    expect(release).toContain("vsce package");
    expect(release).toContain("sha256sum");
    expect(release).toContain("VSCE_PAT");
    expect(release).toContain("OVSX_PAT");
  });

  it("keeps internal docs, scripts, and secrets strictly out of the public tree", async () => {
    if (existsSync("scripts/export-public.mjs")) {
      const { collectPublicFiles } = await import("./export-public.mjs");
      const files = collectPublicFiles(process.cwd());
      expect(files).toContain("package.json");
      expect(files).toContain("README.md");
      expect(files).toContain("SECURITY.md");
      expect(files).toContain("LICENSE");
      expect(files).toContain("HELP.md");
      expect(files).toContain("CHANGELOG.md");
      expect(files).toContain(".github/workflows/ci.yml");
      expect(files).toContain(".github/workflows/release.yml");
      expect(files.some((f) => f.startsWith("src/"))).toBe(true);
      expect(files.some((f) => f.startsWith("tests/"))).toBe(true);
      expect(files.some((f) => f.startsWith("media/"))).toBe(true);

      for (const forbidden of FORBIDDEN_INTERNAL_PATHS) {
        const leaked = files.filter((f) => f === forbidden || f.startsWith(`${forbidden}/`));
        expect(leaked, `internal path leaked into public export: ${forbidden}`).toEqual([]);
      }
      expect(files.filter((f) => f.endsWith(".vsix"))).toEqual([]);
      expect(files.filter((f) => f === ".env" || (f.startsWith(".env.") && f !== ".env.example"))).toEqual(
        [],
      );
    } else {
      // Running inside the public repo itself: verify none of the internal files exist on disk.
      for (const forbidden of FORBIDDEN_INTERNAL_PATHS) {
        expect(existsSync(forbidden), `internal path must not exist in public repo: ${forbidden}`).toBe(
          false,
        );
      }
      expect(existsSync("screenshot.png")).toBe(true);
    }
  });
});
