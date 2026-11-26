import { describe, expect, it } from "vitest";
import { isAtlasToHost, isHostToWebview, isWebviewToHost } from "./messages";

describe("isAtlasToHost (Doc Atlas graph clicks)", () => {
  it.each([
    { type: "atlasOpen", kind: "doc", path: "docs/features/a.md" },
    { type: "atlasOpen", kind: "code", path: "backend/app.py" },
    { type: "atlasOpen", kind: "details", path: "docs/features/a.md" },
  ])("accepts %j", (m) => expect(isAtlasToHost(m)).toBe(true));
  it.each([
    null,
    { type: "atlasOpen", kind: "run", path: "a.md" },
    { type: "atlasOpen", kind: "doc", path: "" },
    { type: "atlasOpen", kind: "doc", path: "x".repeat(3000) },
    { type: "atlasOpen", kind: "doc" },
    { type: "openLink", href: "a.md" },
  ])("refuses %j", (m) => expect(isAtlasToHost(m)).toBe(false));
});

describe("isWebviewToHost", () => {
  it.each([
    { type: "ready" },
    { type: "renderAnyway" },
    { type: "openInBrowser" },
    { type: "jump", docVersion: 3, line: 0 },
    { type: "jump", docVersion: 3, line: 0, headingId: "setup" },
    { type: "openLink", href: "docs/plan.md#setup" },
    { type: "place", headingId: "setup-1" },
    { type: "layout", outlineWidth: 320, collapsed: false },
    { type: "layout", outlineWidth: 0, collapsed: true },
  ])("accepts %j", (m) => expect(isWebviewToHost(m)).toBe(true));

  it.each([
    null,
    "jump",
    { type: "jump", docVersion: 3, line: -1 },
    { type: "jump", docVersion: 3, line: 1.5 },
    { type: "jump", line: 4 },
    { type: "jump", docVersion: 3, line: 0, headingId: 7 },
    { type: "exec", command: "rm -rf" },
    { type: "openLink", href: "" },
    { type: "openLink", href: 42 },
    { type: "openLink", href: "a".repeat(2049) },
    { type: "place", headingId: "" },
    { type: "place", headingId: 3 },
    { type: "place", headingId: "a".repeat(2049) },
    { type: "layout", outlineWidth: -1, collapsed: false },
    { type: "layout", outlineWidth: 12.5, collapsed: false },
    { type: "layout", outlineWidth: 5000, collapsed: false },
    { type: "layout", outlineWidth: 300, collapsed: "no" },
    { type: "layout", outlineWidth: 300 },
  ])("rejects %j", (m) => expect(isWebviewToHost(m)).toBe(false));
});

describe("isHostToWebview", () => {
  it("accepts a render and an edge state", () => {
    expect(isHostToWebview({ type: "render", docVersion: 1, fileName: "a.md", headings: [], html: "" })).toBe(
      true,
    );
    expect(isHostToWebview({ type: "state", state: "too-large", fileName: "a.md", bytes: 9 })).toBe(true);
    expect(isHostToWebview({ type: "editorScrolled", docVersion: 1, topLine: 10 })).toBe(true);
    expect(isHostToWebview({ type: "reveal", docVersion: 1, headingId: "setup" })).toBe(true);
  });
  it("rejects a reveal without a usable heading id", () => {
    expect(isHostToWebview({ type: "reveal", docVersion: 1, headingId: "" })).toBe(false);
    expect(isHostToWebview({ type: "reveal", docVersion: 1 })).toBe(false);
  });
  it("rejects an unknown edge state", () => {
    expect(isHostToWebview({ type: "state", state: "exploded", fileName: "a.md" })).toBe(false);
  });
});

describe("2.0 messages", () => {
  it("accepts the new page-to-host messages and refuses malformed ones", async () => {
    const { isWebviewToHost } = await import("./messages");
    expect(isWebviewToHost({ type: "sectionMenu", headingId: "setup" })).toBe(true);
    // #48: the file's menu learns the page has slides; the host answers with "showSlides"
    expect(isWebviewToHost({ type: "sectionMenu", headingId: "", slides: true })).toBe(true);
    expect(isWebviewToHost({ type: "sectionMenu", headingId: "", slides: "yes" })).toBe(false);
    const { isHostToWebview } = await import("./messages");
    expect(isHostToWebview({ type: "showSlides", docVersion: 2 })).toBe(true);
    expect(isHostToWebview({ type: "showSlides" })).toBe(false);
    expect(isWebviewToHost({ type: "highlight", headingId: "a", text: "key line" })).toBe(true);
    expect(isWebviewToHost({ type: "highlight", headingId: "a", text: "   " })).toBe(false);
    expect(isWebviewToHost({ type: "highlight", headingId: "a", text: "x".repeat(501) })).toBe(false);
    expect(isWebviewToHost({ type: "unhighlight", id: "" })).toBe(false);
    expect(isWebviewToHost({ type: "markRead" })).toBe(true);
    expect(isWebviewToHost({ type: "copy", text: 3 })).toBe(false);
  });
  it("2026-11-22 review: comment, open a code name, run in terminal; well-formed only", async () => {
    const { isWebviewToHost, isPageExtras } = await import("./messages");
    expect(isWebviewToHost({ type: "comment", headingId: "a", text: "use Postgres" })).toBe(true);
    expect(isWebviewToHost({ type: "comment", headingId: "a", text: " " })).toBe(false);
    expect(isWebviewToHost({ type: "openCode", text: "src/cart.js:12" })).toBe(true);
    expect(isWebviewToHost({ type: "openCode", text: "" })).toBe(false);
    expect(isWebviewToHost({ type: "openCode", text: "x".repeat(301) })).toBe(false);
    expect(isWebviewToHost({ type: "runInTerminal", text: "npm test" })).toBe(true);
    expect(isWebviewToHost({ type: "runInTerminal", text: "" })).toBe(false);
    expect(isPageExtras({ codeRefs: ["src/cart.js", "addItem()"] })).toBe(true);
    expect(isPageExtras({ codeRefs: [3] })).toBe(false);
    expect(isPageExtras({ highlights: [{ id: "h1", headingId: "a", text: "t", note: "why?" }] })).toBe(true);
    expect(isPageExtras({ highlights: [{ id: "h1", headingId: "a", text: "t", note: 5 }] })).toBe(false);
  });
  it("3.0 tick and status: well-formed only", async () => {
    const { isWebviewToHost } = await import("./messages");
    expect(isWebviewToHost({ type: "setTask", docVersion: 2, line: 7, checked: true })).toBe(true);
    expect(isWebviewToHost({ type: "setTask", docVersion: 2, line: -1, checked: true })).toBe(false);
    expect(isWebviewToHost({ type: "setTask", docVersion: 2, line: 7, checked: "yes" })).toBe(false);
    expect(isWebviewToHost({ type: "statusMenu", docVersion: 2, line: 4, column: 1 })).toBe(true);
    expect(isWebviewToHost({ type: "statusMenu", docVersion: 2, line: 4, column: 1.5 })).toBe(false);
    expect(isWebviewToHost({ type: "statusMenu", docVersion: 2, line: 4 })).toBe(false);
  });
  it("validates page extras", async () => {
    const { isPageExtras } = await import("./messages");
    expect(
      isPageExtras({ look: { theme: "paper", fontScale: 1.1, lineWidth: "wide" }, changed: ["a"] }),
    ).toBe(true);
    expect(isPageExtras({ look: { theme: "neon", fontScale: 1, lineWidth: "wide" } })).toBe(false);
    expect(isPageExtras({ reviews: [{ headingId: "a", mark: "maybe" }] })).toBe(false);
    expect(isPageExtras({ keyPoints: { tasksOpen: -1, tasksDone: 0, decisions: 0, warnings: 0 } })).toBe(
      false,
    );
  });
  it("3.0 named formats: the doc-kind chip and its click, well-formed only", async () => {
    const { isPageExtras } = await import("./messages");
    expect(isPageExtras({ docKind: { label: "Decision record", format: "MADR" } })).toBe(true);
    expect(isPageExtras({ docKind: { label: "Runbook" } })).toBe(true);
    expect(isPageExtras({ docKind: { label: 3 } })).toBe(false);
    expect(isPageExtras({ docKind: { label: "x".repeat(61) } })).toBe(false);
    expect(isWebviewToHost({ type: "compareFormat" })).toBe(true);
  });
});

describe("easy reading messages (2026-11-24): well-formed only", () => {
  it("peekCode asks with a code name or link", () => {
    expect(isWebviewToHost({ type: "peekCode", text: "backend/app/cast.py#L12" })).toBe(true);
    expect(isWebviewToHost({ type: "peekCode", text: " " })).toBe(false);
    expect(isWebviewToHost({ type: "peekCode", text: 5 })).toBe(false);
  });
  it("codePeek carries rows of [line, text, named]", () => {
    const peek = { path: "a.py", line: 3, total: 9, kind: "at", rows: [[3, "x = 1", true]] };
    expect(isHostToWebview({ type: "codePeek", text: "a.py:3", peek })).toBe(true);
    expect(isHostToWebview({ type: "codePeek", text: "a.py:3" })).toBe(true);
    const badRow = { ...peek, rows: [[3, 4, true]] };
    expect(isHostToWebview({ type: "codePeek", text: "a", peek: badRow })).toBe(false);
    expect(isHostToWebview({ type: "codePeek", text: "a", peek: { ...peek, kind: "run" } })).toBe(false);
  });
  it("standing in the page extras: the right shape only", async () => {
    const { isPageExtras } = await import("./messages");
    const standing = { parts: [], events: [], sections: [], disagree: ["x"] };
    expect(isPageExtras({ standing })).toBe(true);
    expect(isPageExtras({ standing: { ...standing, disagree: [1] } })).toBe(false);
    expect(isPageExtras({ standing: { ...standing, parts: "no" } })).toBe(false);
  });
});
