import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, debounceForBytes, INTERNAL_LIMITS, INTERNAL_TIMINGS, resolveConfig } from "./config";

describe("resolveConfig", () => {
  it("uses defaults when nothing is set", () => {
    expect(resolveConfig({})).toEqual(DEFAULT_CONFIG);
  });
  it("agent prompts are copied by default (owner call 2026-11-16); opening Copilot Chat is opt-in", () => {
    expect(resolveConfig({}).agentTarget).toBe("clipboard");
    expect(resolveConfig({ agentTarget: "auto" }).agentTarget).toBe("auto");
  });
  it("takes valid user values", () => {
    expect(
      resolveConfig({
        updateDebounceMs: 50,
        largeFileBytes: 1024,
        readingTools: true,
        inferHeadings: "always",
        rememberPlace: false,
        diagrams: false,
        theme: "paper",
        fontScale: 1.2,
        lineWidth: "wide",
        staleDays: 30,
        agentTarget: "clipboard",
        writingHelpers: false,
        cleanView: false,
        homeOnStart: true,
        headingNumbers: true,
        myNames: [" Priya ", "@priya", 3, ""],
        codeLens: false,
        aiAnswer: true,
        aiModel: " gpt-4o ",
        aiTools: true,
        liveBrowser: false,
        skipFolders: [" archive ", "", 3, "docs/old"],
        includeFolders: [".claude"],
      }),
    ).toEqual({
      updateDebounceMs: 50,
      largeFileBytes: 1024,
      readingTools: true,
      inferHeadings: "always",
      rememberPlace: false,
      diagrams: false,
      theme: "paper",
      fontScale: 1.2,
      lineWidth: "wide",
      staleDays: 30,
      agentTarget: "clipboard",
      writingHelpers: false,
      cleanView: false,
      homeOnStart: true,
      headingNumbers: true,
      myNames: ["Priya", "@priya"],
      codeLens: false,
      aiAnswer: true,
      aiModel: "gpt-4o",
      aiTools: true,
      liveBrowser: false,
      skipFolders: ["archive", "docs/old"],
      includeFolders: [".claude"],
    });
  });
  it("rejects nonsense and falls back", () => {
    expect(
      resolveConfig({
        updateDebounceMs: -1,
        largeFileBytes: "big",
        readingTools: "yes",
        inferHeadings: "sometimes",
        rememberPlace: "no",
        diagrams: 1,
        theme: "neon",
        fontScale: 9,
        lineWidth: "huge",
        staleDays: -3,
        agentTarget: "email",
        writingHelpers: "on",
        liveBrowser: "sometimes",
      }),
    ).toEqual(DEFAULT_CONFIG);
  });

  it("#56: default largeFileBytes is lowered to 2 MB (above the 1 MB guardrail, below 5 MB)", () => {
    expect(DEFAULT_CONFIG.largeFileBytes).toBe(2 * 1024 * 1024);
  });
});

describe("debounceForBytes (#56)", () => {
  it("keeps the base debounce for small files up to the scale threshold", () => {
    expect(debounceForBytes(300, 0)).toBe(300);
    expect(debounceForBytes(300, 50 * 1024)).toBe(300);
    expect(debounceForBytes(300, INTERNAL_LIMITS.debounceScaleStartBytes)).toBe(300);
  });

  it("scales debounce up monotonically for larger files and caps at maxUpdateDebounceMs", () => {
    const mid = debounceForBytes(300, 512 * 1024);
    const oneMb = debounceForBytes(300, 1024 * 1024);
    const twoMb = debounceForBytes(300, 2 * 1024 * 1024);
    expect(mid).toBeGreaterThan(300);
    expect(mid).toBeLessThan(oneMb);
    expect(oneMb).toBe(INTERNAL_TIMINGS.maxUpdateDebounceMs);
    expect(twoMb).toBe(INTERNAL_TIMINGS.maxUpdateDebounceMs);
  });

  it("preserves explicit zero or already-larger base debounce values", () => {
    expect(debounceForBytes(0, 1024 * 1024)).toBe(0);
    expect(debounceForBytes(2500, 1024 * 1024)).toBe(2500);
  });
});
