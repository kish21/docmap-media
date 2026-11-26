import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));

describe("extension manifest", () => {
  // Without this, VS Code switches docmap off in a folder opened in restricted mode ("don't trust the authors"):
  // no buttons at all — only VS Code's own preview icon is left. docmap only reads and draws Markdown (raw HTML off,
  // locked-down panel), so, like VS Code's own preview, it is safe there.
  it("runs in restricted mode (untrusted folders)", () => {
    expect(manifest.capabilities?.untrustedWorkspaces?.supported).toBe(true);
  });

  it("puts the buttons in the editor title together: side · preview/source (same slot); browser in the ⋯ menu", () => {
    const title = manifest.contributes.menus["editor/title"];
    const buttons = title.filter((m: { group: string }) => m.group.startsWith("navigation"));
    expect(buttons.map((m: { command: string }) => m.command)).toEqual([
      "docmap.openMap",
      "docmap.openMapHere",
      "docmap.showSource",
    ]);
    // one block, in this order: consecutive positions far from the ones VS Code and other extensions use (none, or
    // small numbers), so no other button can land between them (owner report: VS Code's preview button did)
    const positions = buttons.map((m: { group: string }) => Number(/^navigation@(\d+)$/.exec(m.group)?.[1]));
    expect(positions).toEqual([100, 101, 101]);
    // #48 (owner pick 2026-11-21): fewer buttons in view — the browser page moved into the tab's ⋯ menu
    const browser = title.find((m: { command: string }) => m.command === "docmap.openInBrowser");
    expect(browser.group).not.toMatch(/^navigation/);
    expect(browser.when).toContain("resourceLangId == markdown");
    // "Show Preview" and "Show Source" share a slot: the source shows one, the preview the other, never both
    const when = (id: string) => buttons.find((m: { command: string }) => m.command === id).when as string;
    expect(when("docmap.openMapHere")).toContain("activeCustomEditorId != 'docmap.page'");
    expect(when("docmap.showSource")).toBe("activeCustomEditorId == 'docmap.page'");
  });

  it("3.3.0: the Docs Inbox title bar is decluttered (Refresh + Help; workspace views live in Quick Launch)", () => {
    const titles = Object.fromEntries(
      manifest.contributes.commands.map((c: { command: string; title: string }) => [c.command, c.title]),
    );
    const inbox = manifest.contributes.menus["view/title"].filter((m: { when: string }) =>
      m.when.includes("view == docmap.inbox"),
    );
    const shown = inbox
      .filter((m: { group: string }) => m.group.startsWith("navigation"))
      .map((m: { command: string }) => titles[m.command]);
    expect(shown).toHaveLength(2);
    expect(shown.join(" | ")).toMatch(/Refresh Docs Inbox/);
    expect(shown.join(" | ")).toMatch(/Help/);
    const inMenu = inbox
      .filter((m: { group: string }) => !m.group.startsWith("navigation"))
      .map((m: { command: string }) => titles[m.command])
      .join(" | ");
    expect(inMenu).toContain("What Can docmap Do?");
  });

  it("#48: settings are grouped, rarely changed ones under Advanced; the typing delay is no longer a setting", () => {
    const sections = manifest.contributes.configuration as { title: string; properties: object }[];
    expect(sections.map((s) => s.title)).toEqual([
      "All-in-One Markdown Viewer",
      "Reading look",
      "Docs Inbox",
      "AI",
      "Advanced",
    ]);
    const keys = (title: string) => Object.keys(sections.find((s) => s.title === title)?.properties ?? {});
    expect(keys("All-in-One Markdown Viewer")).toEqual([
      "docmap.readingTools",
      "docmap.writingHelpers",
      "docmap.codeLens",
      "docmap.myNames",
    ]);
    expect(keys("Advanced")).toContain("docmap.largeFileBytes");
    const advanced = sections.find((s) => s.title === "Advanced")?.properties as Record<
      string,
      { default?: number; description?: string }
    >;
    expect(advanced["docmap.largeFileBytes"]?.default).toBe(2 * 1024 * 1024);
    expect(advanced["docmap.largeFileBytes"]?.description).toContain("2 MB");
    expect(sections.flatMap((s) => Object.keys(s.properties))).not.toContain("docmap.updateDebounceMs");
  });

  it("0.2.0: the preview can be the file's own tab — offered, never forced on every .md file", () => {
    const [editor] = manifest.contributes.customEditors;
    expect(editor.viewType).toBe("docmap.page");
    expect(editor.priority).toBe("option");
    expect(editor.selector.map((s: { filenamePattern: string }) => s.filenamePattern)).toEqual([
      "*.md",
      "*.markdown",
    ]);
  });

  it("0.2.0: the extension keeps its id, so the people who installed it get the update", () => {
    expect(`${manifest.publisher}.${manifest.name}`).toBe("kish21.markdown-as-web-page");
  });

  it("3.3.0: docmap has its own Activity Bar container (Quick Launch, Docs Inbox, Markdown Files); not duplicated in Explorer", () => {
    expect(manifest.contributes.viewsContainers.activitybar).toEqual([
      { id: "docmap", title: "docmap", icon: "media/activity-bar.svg" },
    ]);
    expect(manifest.contributes.views.explorer).toBeUndefined();
    expect(manifest.contributes.views.docmap.map((v: { id: string }) => v.id)).toEqual([
      "docmap.quickLaunch",
      "docmap.inbox",
      "docmap.folderMap",
    ]);
    expect(manifest.contributes.menus["view/title"][0].command).toBe("docmap.refreshFolderMap");
    const palette = manifest.contributes.menus.commandPalette;
    expect(palette.find((m: { command: string }) => m.command === "docmap.openMapAt")?.when).toBe("false");
  });
});

describe("3.0 help and tour", () => {
  it("every contents link in HELP.md reaches a heading (the help page's own links work)", async () => {
    const { createMarkdownItEngine } = await import("../core/markdown/markdown-it-engine");
    const help = readFileSync("HELP.md", "utf8");
    const parsed = createMarkdownItEngine().parse(help, 0, {});
    expect(parsed.ok).toBe(true);
    const ids = new Set(parsed.ok ? parsed.document.headings.map((h) => h.id) : []);
    const links = [...help.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(10);
    for (const l of links) expect(ids, l).toContain(l);
  });

  it("the Get Started tour: each step's page exists and each button runs a real command", () => {
    const [tour] = manifest.contributes.walkthroughs;
    const commands = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));
    for (const step of tour.steps) {
      expect(() => readFileSync(step.media.markdown)).not.toThrow();
      for (const m of (step.description as string).matchAll(/\(command:([\w.]+)/g))
        if (m[1]?.startsWith("docmap.")) expect(commands, m[1]).toContain(m[1]);
    }
  });
});

describe("#57: SECURITY.md and enterprise privacy/configuration guide", () => {
  const allSettings = new Set(
    (manifest.contributes.configuration as { properties: Record<string, unknown> }[]).flatMap((s) =>
      Object.keys(s.properties),
    ),
  );

  it("exists at repo root and documents every required security, privacy, and configuration claim", () => {
    const security = readFileSync("SECURITY.md", "utf8");
    // Zero telemetry and zero external network calls
    expect(security).toMatch(/zero telemetry|no telemetry/i);
    expect(security).toMatch(/zero external network|no external network/i);
    // Exact files read and explicit .env guarantee
    expect(security).toMatch(/\.env/);
    expect(security).toMatch(/\.env\.example/);
    expect(security).toMatch(/never read/i);
    // Webview security model
    expect(security).toContain("html: false");
    expect(security).toMatch(/nonce/i);
    expect(security).toMatch(/CSP|Content-Security-Policy/i);
    // Localhost-only live server
    expect(security).toContain("127.0.0.1");
    expect(security).toMatch(/32-byte/i);
    expect(security).toMatch(/Host\b/i);
    // Optional features & exact VS Code settings to disable them
    for (const setting of [
      "docmap.liveBrowser",
      "docmap.ai.answerWithMyModel",
      "docmap.ai.tools",
      "docmap.agentTarget",
    ]) {
      expect(security, `missing setting ${setting}`).toContain(setting);
    }
    // Every docmap.* setting mentioned in SECURITY.md must exist in package.json
    const mentioned = [...security.matchAll(/`(docmap\.[a-zA-Z0-9_.]+)`/g)]
      .map((m) => m[1] ?? "")
      .filter((s) => !s.endsWith("."));
    expect(mentioned.length).toBeGreaterThanOrEqual(4);
    for (const key of mentioned) {
      expect(allSettings, `SECURITY.md references unknown setting ${key}`).toContain(key);
    }
    // Vulnerability reporting contact
    expect(security).toMatch(/vulnerabilit/i);
    expect(security).toContain("https://github.com/kish21/markdown-docmap/issues");
  });

  it("is linked prominently from README.md", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toMatch(
      /\[[^\]]*SECURITY\.md[^\]]*\]\(SECURITY\.md\)|\[[^\]]*security[^\]]*\]\(SECURITY\.md\)/i,
    );
  });
});
