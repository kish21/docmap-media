import { describe, expect, it } from "vitest";
import { checkNewDocPath, headingsOnly, moreDocTypes, STARTERS } from "./starters";
import { DOC_TYPES } from "./templates";

describe("New Doc: one entry per format, and the reader picks the folder (2026-11-22 review)", () => {
  it("MADR and Spec Kit make docmap's full template (front matter and hints), so 'More' leaves them out", () => {
    expect(STARTERS.find((s) => s.id === "madr")?.docType).toBe("decision");
    expect(STARTERS.find((s) => s.id === "spec-kit")?.docType).toBe("spec");
    const more = moreDocTypes().map((t) => t.id);
    expect(more).not.toContain("decision");
    expect(more).not.toContain("spec");
    expect(more).toContain("vision");
    expect(more.length).toBe(DOC_TYPES.length - 2);
  });

  it("a new doc's path must be a Markdown file inside the folder", () => {
    expect(checkNewDocPath("docs/decisions/0002-use-queues.md")).toBeUndefined();
    expect(checkNewDocPath("sample-shop/docs/plan.md")).toBeUndefined();
    expect(checkNewDocPath("")).toMatch(/name/);
    expect(checkNewDocPath("docs/plan.txt")).toMatch(/\.md/);
    expect(checkNewDocPath("../outside.md")).toMatch(/inside/);
    expect(checkNewDocPath("C:/Users/x.md")).toMatch(/inside/);
    expect(checkNewDocPath("/etc/x.md")).toMatch(/inside/);
    expect(checkNewDocPath("docs/../../x.md")).toMatch(/inside/);
  });
});

describe("New Doc starters (#37)", () => {
  it("offers a short list, each with a purpose and a read-more link", () => {
    expect(STARTERS.map((s) => s.id)).toEqual(["madr", "nygard", "rust-rfc", "spec-kit", "keep-a-changelog"]);
    for (const s of STARTERS) {
      expect(s.purpose.length).toBeGreaterThan(10);
      expect(s.source).toMatch(/^https:\/\//);
    }
  });

  it("leaves out formats we may only link to (#38: Google design doc, arc42)", () => {
    const ids = STARTERS.map((s) => s.id);
    expect(ids).not.toContain("google-design");
    expect(ids).not.toContain("arc42");
  });

  it("writes the title and section headings only", () => {
    const nygard = STARTERS.find((s) => s.id === "nygard");
    expect(nygard && headingsOnly(nygard, "Use Postgres")).toBe(
      "# Use Postgres\n\n## Status\n\n## Context\n\n## Decision\n\n## Consequences\n",
    );
    const log = STARTERS.find((s) => s.id === "keep-a-changelog");
    expect(log && headingsOnly(log, "Changelog")).toContain("## Unreleased\n\n### Added\n\n### Changed");
  });
});
