import { describe, expect, it } from "vitest";
import { POINTER_TARGETS, pointerSteps } from "./rule-pointers";

describe("rule-file pointers", () => {
  it("missing files are created with the pointer", () => {
    const steps = pointerSteps(() => undefined);
    expect(steps.map((s) => s.kind)).toEqual(["create", "create", "create"]);
    const claude = steps[0];
    expect(claude?.kind === "create" && claude.text).toContain("@AGENTS.md");
  });

  it("an existing file is never replaced: one marked line is added at the end, text kept", () => {
    const mine = "# My rules\n\nUse tabs.";
    const steps = pointerSteps((p) => (p === "CLAUDE.md" ? mine : undefined));
    const step = steps[0];
    expect(step?.kind).toBe("append");
    if (step?.kind !== "append") return;
    expect(step.text.startsWith("\n\n<!-- docmap: points to AGENTS.md -->\n@AGENTS.md\n")).toBe(true);
    // the result is the user's text followed by the addition, unchanged
    expect((mine + step.text).startsWith(mine)).toBe(true);
  });

  it("a file that already names AGENTS.md is left alone", () => {
    const steps = pointerSteps((p) => (p === "GEMINI.md" ? "See agents.md for rules.\n" : undefined));
    expect(steps.find((s) => s.target.path === "GEMINI.md")?.kind).toBe("skip");
  });

  it("an empty existing file gets the line without leading blank lines", () => {
    const step = pointerSteps((p) => (p === "CLAUDE.md" ? "" : undefined))[0];
    expect(step?.kind === "append" && step.text.startsWith("<!--")).toBe(true);
  });

  it("targets are relative paths inside the folder", () => {
    for (const t of POINTER_TARGETS) expect(t.path).not.toMatch(/^\/|\.\./);
  });
});
