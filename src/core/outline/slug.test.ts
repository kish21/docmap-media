import { describe, expect, it } from "vitest";
import { Slugger, slugify } from "./slug";

// Expected values verified against github-slugger (the reference for GitHub anchors) on 2026-09-23.
// Two deliberate differences: input is pre-trimmed by markdown-it (GitHub keeps edge hyphens), and an
// all-punctuation heading gets "section" (GitHub gives an empty, unlinkable id).
describe("slugify (GitHub-compatible)", () => {
  it.each([
    ["Getting Started", "getting-started"],
    ["What's new in v2.0?", "whats-new-in-v20"],
    ["API: `parse()` & friends", "api-parse--friends"],
    ["snake_case stays", "snake_case-stays"],
    ["Ünïcödé Heading", "ünïcödé-heading"],
    ["  padded  ", "padded"],
    ["Entry 1 — 2026-09-22 · desk check", "entry-1--2026-09-22--desk-check"],
  ])("%s → %s", (text, id) => expect(slugify(text)).toBe(id));
});

describe("Slugger", () => {
  it("numbers repeats in document order, like GitHub", () => {
    const s = new Slugger();
    expect(["Setup", "Setup", "Setup"].map((t) => s.slug(t))).toEqual(["setup", "setup-1", "setup-2"]);
  });
  it("does not collide with a heading that already looks numbered", () => {
    const s = new Slugger();
    expect(["Setup-1", "Setup", "Setup"].map((t) => s.slug(t))).toEqual(["setup-1", "setup", "setup-2"]);
  });
  it("never returns an empty id", () => {
    expect(new Slugger().slug("!!!")).toBe("section");
  });
});
