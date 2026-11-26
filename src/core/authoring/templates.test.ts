import { describe, expect, it } from "vitest";
import { planRow } from "../insights/plans";
import { createMarkdownItEngine } from "../markdown/markdown-it-engine";
import { DOC_TYPES, docTemplate, docType, slugify } from "./templates";

describe("doc templates", () => {
  it("a fresh plan shows on the Plans dashboard, even under a name that does not say plan", () => {
    const text = docTemplate(docType("plan"), "Checkout rollout", "2026-11-16");
    const now = Date.parse("2026-11-16T12:00:00Z");
    expect(planRow(text, "checkout.md", now, now, 90)).toBeDefined();
  });

  it("every template parses with one title, its sections as ## headings, and no visible hint text", () => {
    const engine = createMarkdownItEngine();
    for (const t of DOC_TYPES) {
      const text = docTemplate(t, `My ${t.label}`, "2026-11-16");
      const r = engine.parse(text, 1, { readingTools: true });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.document.headings.map((h) => h.text)).toEqual([
        `My ${t.label}`,
        ...t.sections.map((s) => s[0]),
      ]);
      expect(r.document.html).not.toContain("&lt;!--");
      expect(text.startsWith("---\nowner:\nstatus: draft\ncreated: 2026-11-16\n---\n")).toBe(true);
    }
  });

  it("the agent guide ends with a 'Never do' section after Security", () => {
    const names = docType("agents").sections.map((s) => s[0]);
    expect(names.slice(-2)).toEqual(["Security", "Never do"]);
    expect(docTemplate(docType("agents"), "Agents", "2026-11-18")).toContain("## Never do");
  });

  it("titles become safe file names", () => {
    expect(slugify("Checkout Rollout: Phase 2!")).toBe("checkout-rollout-phase-2");
    expect(slugify("   ")).toBe("untitled");
    expect(slugify("../../etc/passwd")).toBe("etcpasswd");
  });
});
