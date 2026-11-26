import * as assert from "node:assert";
import * as net from "node:net";
import * as path from "node:path";
import * as vscode from "vscode";
import type { HostToWebview } from "../../src/core/protocol/messages";
import type { DocmapApi } from "../../src/extension/extension";
import type { MapPanel } from "../../src/extension/map-panel";

const EXT_ID = "kish21.markdown-as-web-page";
const root = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

async function api(): Promise<DocmapApi> {
  const ext = vscode.extensions.getExtension<DocmapApi>(EXT_ID);
  assert.ok(ext, "extension not found");
  return ext.activate();
}

async function openMap(file: string): Promise<{ editor: vscode.TextEditor; panel: MapPanel }> {
  const doc = await vscode.workspace.openTextDocument(path.join(root(), file));
  const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand("docmap.openMap");
  const panel = (await api()).testing.panelFor(doc.uri);
  assert.ok(panel, "no map panel opened");
  return { editor, panel };
}

/** Polls until `check` returns a value (UI state settles asynchronously), or fails after `ms`. */
async function until<T>(
  what: string,
  check: () => T | undefined | false | Promise<T | undefined | false>,
  ms = 5000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Whether a tab is docmap's preview of `uri` in the file's own tab (the "docmap.page" custom editor). */
const isPageTab = (tab: vscode.Tab | undefined, uri: vscode.Uri) =>
  tab?.input instanceof vscode.TabInputCustom &&
  tab.input.viewType === "docmap.page" &&
  tab.input.uri.toString() === uri.toString();
const isSourceTab = (tab: vscode.Tab | undefined, uri: vscode.Uri) =>
  tab?.input instanceof vscode.TabInputText && tab.input.uri.toString() === uri.toString();
const closeAll = () => vscode.commands.executeCommand("workbench.action.closeAllEditors");
/** "Open in browser" saves a copy (true) instead of the live page, or back to the default (false). */
const savedCopy = (on: boolean) =>
  vscode.workspace
    .getConfiguration("docmap")
    .update("liveBrowser", on ? false : undefined, vscode.ConfigurationTarget.Global);

const activeLine = () => vscode.window.activeTextEditor?.selection.active.line;
/** The panel's latest render — but only if nothing but "you are here" updates came after it (not a state). */
const rendered = (panel: MapPanel) => {
  const last = panel.lastPosted;
  // 3.0: trust markers follow a render as an "extras" message — not a newer drawing
  if (last?.type !== "render" && last?.type !== "editorScrolled" && last?.type !== "extras") return undefined;
  return panel.lastByType.get("render") as Extract<HostToWebview, { type: "render" }> | undefined;
};

suite("docmap walking skeleton", () => {
  test("activates and opens a Map panel beside a Markdown file", async () => {
    await openMap("sample.md");
    // VS Code 1.147 lists a new panel's tab a moment after createWebviewPanel returns: wait for it
    const tabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    await until("the Preview tab", () => tabs().some((t) => t.label === "Preview: sample.md")).catch(() => {
      assert.fail(
        `tabs: ${tabs()
          .map((t) => t.label)
          .join(", ")}`,
      );
    });
  });

  test("config flows: a changed setting is read back through the typed loader", async () => {
    const docmap = await api();
    const settings = vscode.workspace.getConfiguration("docmap");
    await settings.update("staleDays", 123, vscode.ConfigurationTarget.Global);
    assert.strictEqual(docmap.config().staleDays, 123);
    await settings.update("staleDays", undefined, vscode.ConfigurationTarget.Global);
    assert.strictEqual(docmap.config().staleDays, 90);
    // #48: the typing delay is no longer a setting, so it is always the fixed value
    assert.strictEqual(docmap.config().updateDebounceMs, 300);
  });
});

suite("M1 — first map: click a heading, the editor jumps there", () => {
  // product.md is a snapshot of the real PRODUCT.md; "## Scope" is on 0-based line 135.
  const SCOPE_LINE = 135;

  test("the panel receives every heading of the real document from the host", async () => {
    const { editor, panel } = await openMap("product.md");
    const render = await until("first render", () => rendered(panel));
    assert.strictEqual(render.docVersion, editor.document.version);
    assert.strictEqual(render.headings.length, 20);
    assert.ok(render.headings.some((h) => h.line === SCOPE_LINE && h.text.startsWith("Scope")));
  });

  test("a jump from the panel moves the editor's cursor to the heading's line, on screen", async () => {
    const { editor, panel } = await openMap("product.md");
    assert.match(editor.document.lineAt(SCOPE_LINE).text, /^## Scope/);
    await panel.receive({ type: "jump", docVersion: editor.document.version, line: SCOPE_LINE });
    assert.strictEqual(activeLine(), SCOPE_LINE);
    await until("heading line scrolled into view", () =>
      vscode.window.activeTextEditor?.visibleRanges[0]?.contains(new vscode.Position(SCOPE_LINE, 0)),
    );
  });

  test("a line past the end of the document is clamped, never an error", async () => {
    const { editor, panel } = await openMap("product.md");
    await panel.receive({ type: "jump", docVersion: editor.document.version, line: 99_999 });
    assert.strictEqual(activeLine(), editor.document.lineCount - 1);
  });

  test("an edit re-renders the map, and a click from before the edit still finds its heading", async () => {
    const { editor, panel } = await openMap("product.md");
    const before = await until("first render", () => rendered(panel));
    const scope = before.headings.find((h) => h.line === SCOPE_LINE);
    assert.ok(scope);

    await editor.edit((b) => b.insert(new vscode.Position(0, 0), "## Added by the test\n\n"));
    const after = await until("re-render after edit", () => {
      const r = rendered(panel);
      return r && r.docVersion === editor.document.version ? r : undefined;
    });
    assert.strictEqual(after.headings[0]?.text, "Added by the test");

    // a click the panel computed from the old version: the host finds "Scope" by id at its new line (+2)
    await panel.receive({
      type: "jump",
      docVersion: before.docVersion,
      line: scope.line,
      headingId: scope.id,
    });
    assert.strictEqual(activeLine(), SCOPE_LINE + 2);

    // a stale click for a heading that no longer exists is dropped
    await panel.receive({ type: "jump", docVersion: before.docVersion, line: 3, headingId: "gone" });
    assert.strictEqual(activeLine(), SCOPE_LINE + 2);

    await vscode.commands.executeCommand("workbench.action.files.revert");
  });

  test("0.0.7: with two same-named headings, a click drawn before a third was added above still lands on it", async () => {
    const { editor, panel } = await openMap("duplicate-headings.md");
    const before = await until("first render", () => rendered(panel));
    const second = before.headings.find((h) => h.id === "setup-1");
    assert.ok(second);
    await editor.edit((b) => b.insert(new vscode.Position(0, 0), "## Setup\n\n"));
    await until("re-render after edit", () => {
      const r = rendered(panel);
      return r && r.docVersion === editor.document.version ? r : undefined;
    });
    // by id alone, "setup-1" would now be the FIRST original "Setup" (two lines higher than the one clicked)
    await panel.receive({
      type: "jump",
      docVersion: before.docVersion,
      line: second.line,
      headingId: second.id,
    });
    assert.strictEqual(activeLine(), second.line + 2);
    await vscode.commands.executeCommand("workbench.action.files.revert");
  });

  test("when the file's document is closed and reopened, the map stays as drawn and then follows the new one", async () => {
    const { editor: first, panel } = await openMap("sample.md");
    await until("first render", () => rendered(panel));
    const oldDocument = first.document;

    // Changing the language closes the TextDocument and opens a new one for the same file — immediately,
    // unlike closing an editor tab (VS Code disposes those documents lazily).
    await vscode.languages.setTextDocumentLanguage(oldDocument, "plaintext");
    await until("the map noticed the close", () => panel.fileClosed);
    // 0.0.11 (owner call): a closed file's map keeps showing the file — no "closed" message
    assert.ok(rendered(panel), "the map still shows the file");
    const plain = vscode.workspace.textDocuments.find((d) => d.uri.toString() === oldDocument.uri.toString());
    assert.ok(plain);
    await vscode.languages.setTextDocumentLanguage(plain, "markdown");

    const { editor, panel: again } = await openMap("sample.md");
    assert.strictEqual(again, panel, "the same map panel is reused for the same file");
    // VS Code may hand back the same TextDocument object (as it does for a language change) or a new one (a
    // real reopen); the panel re-attaches on its "closed" flag either way. A fresh render of the reopened
    // document's version proves the re-attach happened.
    await until(
      "render of the reopened document",
      () => rendered(panel)?.docVersion === editor.document.version,
    );

    await editor.edit((b) => b.insert(new vscode.Position(0, 0), "## After reopen\n\n"));
    await until("re-render after an edit to the reopened document", () => {
      const r = rendered(panel);
      return r?.docVersion === editor.document.version && r.headings[0]?.text === "After reopen";
    });
    await vscode.commands.executeCommand("workbench.action.files.revert");
  });
});

suite("M2 — daily driver", () => {
  test("scrolling the editor sends 'you are here' to the panel", async () => {
    const { editor, panel } = await openMap("product.md");
    await until("first render", () => rendered(panel));
    editor.revealRange(new vscode.Range(200, 0, 200, 0), vscode.TextEditorRevealType.AtTop);
    const scrolled = await until("editorScrolled", () => {
      const last = panel.lastByType.get("editorScrolled");
      return last?.type === "editorScrolled" && last.topLine > 150 ? last : undefined;
    });
    assert.strictEqual(scrolled.docVersion, editor.document.version);
  });

  test("0.0.13: after a click in the map, the clicked heading is 'you are here' (not the section above it)", async () => {
    const { editor, panel } = await openMap("product.md");
    const drawn = await until("render", () => {
      const r = rendered(panel);
      return r?.docVersion === editor.document.version ? r : undefined;
    });
    // a level-3 heading: VS Code's sticky headings (its parents) cover the lines just above it
    const heading = drawn.headings.find((h) => h.level === 3 && h.line > 60);
    assert.ok(heading);
    await panel.receive({
      type: "jump",
      docVersion: drawn.docVersion,
      line: heading.line,
      headingId: heading.id,
    });
    await new Promise((r) => setTimeout(r, 400)); // the scroll events of the reveal
    const last = panel.lastByType.get("editorScrolled");
    assert.ok(last?.type === "editorScrolled");
    assert.ok(
      last.topLine >= heading.line,
      `"you are here" is line ${last.topLine}, above the clicked ${heading.line}`,
    );
  });

  test("0.0.7: a link to another Markdown file opens that file's map, in this map's place, at the linked heading", async () => {
    const { panel } = await openMap("links.md");
    await until("first render", () => rendered(panel));
    const { testing } = await api();
    await panel.receive({ type: "openLink", href: "linked.md#target-section" });
    const linked = await until("linked.md's map", () =>
      testing.panelFor(vscode.Uri.file(path.join(root(), "linked.md"))),
    );
    const reveal = await until("scrolled to the heading", () => {
      const m = linked.lastByType.get("reveal");
      return m?.type === "reveal" ? m : undefined;
    });
    assert.strictEqual(reveal.headingId, "target-section");
    await until("opened where the first map is", () => linked.viewColumn === panel.viewColumn);
  });

  test("a link that climbs out of the workspace is refused — nothing opens", async () => {
    const { editor, panel } = await openMap("links.md");
    await until("first render", () => rendered(panel));
    await vscode.window.showTextDocument(editor.document, vscode.ViewColumn.One);
    await panel.receive({ type: "openLink", href: "../../package.json" });
    await new Promise((r) => setTimeout(r, 300));
    const opened = vscode.workspace.textDocuments.some((d) => d.uri.fsPath.endsWith("package.json"));
    assert.strictEqual(opened, false, "a file outside the workspace was opened");
    assert.ok(vscode.window.activeTextEditor?.document.uri.fsPath.endsWith("links.md"));
  });

  test("a relative image in the workspace is given to the panel as a panel-loadable URI; a non-image is not", async () => {
    const { panel } = await openMap("links.md");
    const render = await until("render", () => rendered(panel));
    const img = /<img src="([^"]+)" alt="a one-pixel image">/.exec(render.html);
    assert.ok(img, `no <img> for pixel.png in: ${render.html}`);
    const src = img[1] ?? "";
    assert.ok(!src.startsWith("file:"), "a raw file: URL would be blocked by the panel");
    assert.match(
      src,
      /^(https:\/\/[^/]*vscode-(cdn|resource)|vscode-webview-resource:|vscode-resource:)/,
      src,
    );
    // the panel is given the path under the folder the user opened (VS Code checks resource roots on that form)
    const fixtures = vscode.workspace.workspaceFolders?.[0]?.uri.path ?? "";
    assert.ok(decodeURIComponent(src).includes(`${fixtures}/pixel.png`), `${src} is not under ${fixtures}`);
    assert.ok(render.html.includes("[image: not an image]"), "a Markdown file must not load as an image");
  });
});

suite("0.0.8 — folder map", () => {
  test("lists the workspace's Markdown files with their headings; a heading opens that file's map there", async () => {
    const { testing } = await api();
    const top = await testing.folderMap.getChildren();
    const linked = top.find((i) => i.kind === "file" && i.node.name === "linked.md");
    assert.ok(
      linked,
      `rows: ${top.map((i) => (i.kind === "file" || i.kind === "folder" ? i.node.name : i.kind)).join(", ")}`,
    );
    const heads = await testing.folderMap.getChildren(linked);
    const all: string[] = [];
    const walk = async (items: typeof heads) => {
      for (const i of items) {
        if (i.kind !== "heading") continue;
        all.push(i.node.heading.id);
        await walk(await testing.folderMap.getChildren(i));
      }
    };
    await walk(heads);
    assert.ok(all.includes("target-section"), `headings: ${all.join(", ")}`);
    const uri = vscode.Uri.file(path.join(root(), "linked.md"));
    await vscode.commands.executeCommand("docmap.openMapAt", uri, "target-section");
    // 0.2.0: a folder-map row opens the file as its preview, in its own tab
    const panel = await until("linked.md's page", () => testing.pageFor(uri));
    const reveal = await until("scrolled to the heading", () => {
      const m = panel.lastByType.get("reveal");
      return m?.type === "reveal" ? m : undefined;
    });
    assert.strictEqual(reveal.headingId, "target-section");
  });
});

suite("0.0.7 — the map remembers where you were", () => {
  test("closing a map and opening it again returns to the section the reader was in", async () => {
    const { panel } = await openMap("sample.md");
    const first = await until("first render", () => rendered(panel));
    const place = first.headings.at(-1);
    assert.ok(place);
    await panel.receive({ type: "place", headingId: place.id }); // what the panel sends as the reader scrolls
    const tab = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .find((t) => t.label === "Preview: sample.md");
    assert.ok(tab);
    await vscode.window.tabGroups.close(tab);
    const { testing } = await api();
    const uri = vscode.Uri.file(path.join(root(), "sample.md"));
    await until("map closed", () => !testing.panelFor(uri));
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.openMap");
    const reopened = await until("map reopened", () => testing.panelFor(uri));
    const reveal = await until("returned to the place", () => {
      const m = reopened.lastByType.get("reveal");
      return m?.type === "reveal" ? m : undefined;
    });
    assert.strictEqual(reveal.headingId, place.id);
  });
});

suite("0.0.6 — find in the map", () => {
  test("Ctrl+F in the map opens VS Code's find bar (it searches the document text, not only headings)", async () => {
    const doc = await vscode.workspace.openTextDocument(path.join(root(), "sample.md"));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.openMap");
    const { testing } = await api();
    const panel = await until("map open", () => testing.panelFor(doc.uri));
    assert.strictEqual(panel.findWidget, true);
  });
});

suite("M3 — three ways to open the map", () => {
  // these tests are about the SAVED copy; the live page (3.0, the default) has its own suite
  suiteSetup(() => savedCopy(true));
  suiteTeardown(() => savedCopy(false));
  test("'Open Preview to the Side' opens one map beside the file", async () => {
    const { editor } = await openMap("sample.md");
    const mapTabs = () =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs.map((t) => ({ t, column: g.viewColumn })))
        .filter(({ t }) => t.label === "Preview: sample.md");
    // the tab model updates asynchronously after a move
    await until("map moved beside the file", () => mapTabs()[0]?.column !== editor.viewColumn);
    assert.strictEqual(mapTabs().length, 1, "one map per file");
  });

  test("with the file's tab closed, a click in the map opens the file again (beside the map)", async () => {
    const { editor, panel } = await openMap("product.md");
    await until("render", () => rendered(panel));
    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await until(
      "file tab closed",
      () => !vscode.window.visibleTextEditors.some((e) => e.document === editor.document),
    );
    await panel.receive({ type: "jump", docVersion: editor.document.version, line: 135 });
    await until(
      "file shown again",
      () => vscode.window.activeTextEditor?.document.uri.toString() === editor.document.uri.toString(),
    );
    assert.strictEqual(activeLine(), 135);
  });

  test("0.0.11: a click in the map of a closed file opens the file again, at the heading", async () => {
    const { editor, panel } = await openMap("product.md");
    // a drawing of the text as it is now (an earlier test's edit may have been drawn, or not yet)
    const drawn = await until("render", () => {
      const r = rendered(panel);
      return r?.docVersion === editor.document.version ? r : undefined;
    });
    const heading = drawn.headings[Math.floor(drawn.headings.length / 2)];
    assert.ok(heading);
    const uri = editor.document.uri;
    // closes the TextDocument at once (closing a tab closes it only later); keeps the text, now as plain text
    await vscode.languages.setTextDocumentLanguage(editor.document, "plaintext");
    await until("the map noticed the close", () => panel.fileClosed);
    await panel.receive({
      type: "jump",
      docVersion: drawn.docVersion,
      line: heading.line,
      headingId: heading.id,
    });
    await until(
      "file shown again",
      () => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString(),
    );
    const reopenedEditor = vscode.window.activeTextEditor;
    assert.ok(reopenedEditor);
    const lineText = reopenedEditor.document.lineAt(reopenedEditor.selection.active.line).text;
    const word = heading.text.split(" ")[0] ?? "";
    assert.ok(
      /^#+ /.test(lineText) && lineText.includes(word),
      `the cursor is on "${lineText}", not "${heading.text}"`,
    );
    assert.strictEqual(panel.fileClosed, false, "the map follows the reopened file");
    const reopened = vscode.window.activeTextEditor?.document;
    if (reopened) await vscode.languages.setTextDocumentLanguage(reopened, "markdown");
  });

  test("0.0.11: the map of a closed file that is then deleted says the file is no longer there", async () => {
    const uri = vscode.Uri.file(path.join(root(), "gone-soon.md"));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode("# Gone soon\n\nText.\n"));
    const { editor, panel } = await openMap("gone-soon.md");
    await until("render", () => rendered(panel));
    await vscode.languages.setTextDocumentLanguage(editor.document, "plaintext");
    await until("the map noticed the close", () => panel.fileClosed);
    await vscode.workspace.fs.delete(uri);
    await until(
      "gone state",
      () => panel.lastPosted?.type === "state" && panel.lastPosted.state === "closed",
    );
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });

  test("the buttons still work when the preview in the file's own tab is the active tab", async () => {
    const docmap = await api();
    const opened: vscode.Uri[] = [];
    docmap.testing.setBrowserOpener(async (uri) => {
      opened.push(uri);
      return true;
    });
    const doc = await vscode.workspace.openTextDocument(path.join(root(), "sample.md"));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.openMapHere");
    await until("page tab active", () =>
      isPageTab(vscode.window.tabGroups.activeTabGroup.activeTab, doc.uri),
    );
    // precondition: the page, not a text editor, has focus (VS Code clears the active editor a moment after the tab)
    await until("no text editor active", () => vscode.window.activeTextEditor === undefined);
    await vscode.commands.executeCommand("docmap.openInBrowser");
    assert.match(opened[0]?.fsPath ?? "", /sample-[0-9a-f]{10}\.html$/);
    await closeAll();
  });

  test("'Open Map in Browser' writes one self-contained snapshot and hands it to the browser", async () => {
    const docmap = await api();
    const opened: vscode.Uri[] = [];
    docmap.testing.setBrowserOpener(async (uri) => {
      opened.push(uri);
      return true;
    });
    const doc = await vscode.workspace.openTextDocument(path.join(root(), "links.md"));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.openInBrowser");
    await vscode.commands.executeCommand("docmap.openInBrowser"); // pressed again: overwritten, not a second file
    assert.strictEqual(opened.length, 2);
    assert.strictEqual(opened[0]?.fsPath, opened[1]?.fsPath);
    const file = opened[0]?.fsPath ?? "";
    assert.match(file, /[\\/]snapshots[\\/]links-[0-9a-f]{10}\.html$/);
    const html = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(file))).toString("utf8");
    assert.match(html, /default-src 'none'/);
    assert.ok(!/<link |<script[^>]* src=/.test(html), "the snapshot must not load anything by URL");
    assert.ok(
      html.includes("file://") && html.includes("pixel.png"),
      "the approved image is referenced as a file",
    );
    const dir = vscode.Uri.file(path.dirname(file));
    const names = (await vscode.workspace.fs.readDirectory(dir)).map(([n]) => n);
    assert.ok(!names.some((n) => n.endsWith(".tmp")), `a temporary file was left: ${names.join(", ")}`);
  });

  test("0.0.13: 'Open Map in Browser' also writes the linked Markdown file, and the link points at its page", async () => {
    const docmap = await api();
    const opened: vscode.Uri[] = [];
    docmap.testing.setBrowserOpener(async (uri) => {
      opened.push(uri);
      return true;
    });
    const doc = await vscode.workspace.openTextDocument(path.join(root(), "links.md"));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.openInBrowser");
    const file = opened[0]?.fsPath ?? "";
    const html = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(file))).toString("utf8");
    const map = /<script type="application\/json" id="docmap-links">([^<]*)<\/script>/.exec(html)?.[1];
    assert.ok(map, "the page carries its link map");
    const links = JSON.parse(map) as Record<string, string>;
    const target = links["linked.md#target-section"] ?? "";
    assert.match(target, /^file:.*[\\/]snapshots[\\/]linked-[0-9a-f]{10}\.html#target-section$/);
    assert.strictEqual(links["../../package.json"], undefined, "a file outside the workspace gets no page");
    const linked = vscode.Uri.parse(target.replace(/#.*$/, ""));
    const page = Buffer.from(await vscode.workspace.fs.readFile(linked)).toString("utf8");
    assert.ok(page.includes("Target section"), "the linked page holds the linked file's map");
  });

  suiteTeardown(async () => {
    (await api()).testing.setBrowserOpener((uri) => vscode.env.openExternal(uri));
  });
});

suite("0.0.20 — the outline pane's size is remembered for every map", () => {
  test("a layout sent by one map comes back with the next render of any map", async () => {
    const { panel } = await openMap("sample.md");
    await until("render", () => rendered(panel));
    await panel.receive({ type: "layout", outlineWidth: 333, collapsed: true });
    const { panel: other } = await openMap("product.md");
    await other.receive({ type: "ready" });
    const r = await until("render with the layout", () => {
      const last = rendered(other);
      return last?.layout?.outlineWidth === 333 ? last : undefined;
    });
    assert.deepStrictEqual(r.layout, { outlineWidth: 333, collapsed: true });
    await panel.receive({ type: "layout", outlineWidth: 280, collapsed: false }); // leave it as the next test expects
  });
});

suite("0.0.20 — reading tools are on by default (owner call), and can be turned off", () => {
  test("by default the map has reading tools: sizes on every heading", async () => {
    assert.strictEqual(vscode.workspace.getConfiguration("docmap").get("readingTools"), true);
  });
  test("turned off, the map is the plain map: no sizes, no inferred headings, no toolbar", async () => {
    const settings = vscode.workspace.getConfiguration("docmap");
    await settings.update("readingTools", false, vscode.ConfigurationTarget.Global);
    try {
      const { panel } = await openMap("verbose.md");
      const render = await until("plain render", () => {
        const r = rendered(panel);
        return r?.readingTools === false ? r : undefined;
      });
      assert.ok(render.headings.every((h) => h.words === undefined && !h.inferred));
      assert.ok(!render.html.includes("task-checkbox") && !render.html.includes("callout"));
    } finally {
      await settings.update("readingTools", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

suite("0.0.4 — reading quality (setting on)", () => {
  suiteSetup(async () => {
    await vscode.workspace
      .getConfiguration("docmap")
      .update("readingTools", true, vscode.ConfigurationTarget.Global);
  });
  suiteTeardown(async () => {
    await vscode.workspace
      .getConfiguration("docmap")
      .update("readingTools", undefined, vscode.ConfigurationTarget.Global);
  });

  test("an inferred heading (a bold line) is in the map, and a click on it moves the editor there", async () => {
    const { editor, panel } = await openMap("verbose.md");
    const render = await until("rendered with the tools on", () => {
      const r = rendered(panel);
      return r?.readingTools === true && r;
    });
    const summary = render.headings.find((h) => h.text === "Executive Summary");
    assert.ok(summary?.inferred, `no inferred heading in: ${render.headings.map((h) => h.text).join(", ")}`);
    assert.ok((summary?.words ?? 0) > 0, "section size missing");
    // the host re-parses to find the heading by id: it must use the same structure-hints setting as the render
    await panel.receive({
      type: "jump",
      docVersion: editor.document.version,
      line: 0,
      headingId: summary?.id,
    });
    await until("editor moved", () => activeLine() === summary?.line);
  });

  test("turning structure hints off redraws the map with real headings only", async () => {
    const { panel } = await openMap("verbose.md");
    await until("render", () => rendered(panel));
    const settings = vscode.workspace.getConfiguration("docmap");
    await settings.update("inferHeadings", "off", vscode.ConfigurationTarget.Global);
    try {
      await until("re-rendered without inferred headings", () => {
        const r = rendered(panel);
        return r && r.headings.every((h) => !h.inferred) && r.headings.length === 1;
      });
    } finally {
      await settings.update("inferHeadings", undefined, vscode.ConfigurationTarget.Global);
    }
  });
});

suite("0.2.0 — the preview in the file's own tab (one tab, not two)", () => {
  // product.md: "## Scope" is on 0-based line 135 (see M1)
  const SCOPE_LINE = 135;
  /** The page's latest render, whatever came after it (a page opened at a remembered place sends a reveal next). */
  const drawn = (page: MapPanel) =>
    page.lastByType.get("render") as Extract<HostToWebview, { type: "render" }> | undefined;

  test("'Show Preview' turns the source tab into the preview, in the same group — no second tab", async () => {
    await closeAll();
    const doc = await vscode.workspace.openTextDocument(path.join(root(), "sample.md"));
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.openMapHere");
    const group = await until("page tab active", () => {
      const g = vscode.window.tabGroups.activeTabGroup;
      return isPageTab(g.activeTab, doc.uri) && g;
    });
    assert.strictEqual(group.viewColumn, editor.viewColumn, "the preview opened in another group");
    await until("the source tab is gone", () => !group.tabs.some((t) => isSourceTab(t, doc.uri)));
    const tabs = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.label.includes("sample.md"));
    assert.strictEqual(tabs.length, 1, `tabs: ${tabs.map((t) => t.label).join(", ")}`);
  });

  test("the preview draws the document and stays put when a heading is clicked", async () => {
    await closeAll();
    const doc = await vscode.workspace.openTextDocument(path.join(root(), "sample.md"));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.openMapHere");
    const { testing } = await api();
    const page = await until("page", () => testing.pageFor(doc.uri));
    const render = await until("render", () => drawn(page));
    assert.ok(render.headings.length > 0);
    await page.receive({ type: "jump", docVersion: doc.version, line: 0 });
    await new Promise((r) => setTimeout(r, 300)); // a swap to the editor would show up in the tab model by now
    assert.ok(
      isPageTab(vscode.window.tabGroups.activeTabGroup.activeTab, doc.uri),
      "the click left the page",
    );
  });

  test("it updates live as the file changes", async () => {
    await closeAll();
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: "# One\n" });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.openMapHere");
    const { testing } = await api();
    const page = await until("page", () => testing.pageFor(doc.uri));
    await until("render", () => drawn(page));
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(1, 0), "## Two\n");
    await vscode.workspace.applyEdit(edit);
    await until("re-rendered with the new heading", () =>
      rendered(page)?.headings.some((h) => h.text === "Two"),
    );
    await closeAllReverting();
  });

  test("'Show Source' swaps back in the same tab, at the section being read", async () => {
    await closeAll();
    const doc = await vscode.workspace.openTextDocument(path.join(root(), "product.md"));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.openMapHere");
    const { testing } = await api();
    const page = await until("page", () => testing.pageFor(doc.uri));
    const render = await until("render", () => drawn(page));
    const scope = render.headings.find((h) => h.line === SCOPE_LINE);
    assert.ok(scope);
    await page.receive({ type: "place", headingId: scope.id }); // what the page sends as the reader scrolls
    await vscode.commands.executeCommand("docmap.showSource");
    const group = await until("source tab active", () => {
      const g = vscode.window.tabGroups.activeTabGroup;
      return isSourceTab(g.activeTab, doc.uri) && g;
    });
    assert.strictEqual(group.viewColumn, vscode.ViewColumn.One);
    await until("the page tab is gone", () => !testing.pageFor(doc.uri));
    assert.ok(!group.tabs.some((t) => isPageTab(t, doc.uri)));
    assert.strictEqual(activeLine(), SCOPE_LINE);
  });

  test("'Show Preview' from a scrolled source opens the preview at that section", async () => {
    await closeAll();
    const doc = await vscode.workspace.openTextDocument(path.join(root(), "product.md"));
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    // a section well below "Scope" (the place the test above leaves remembered), so the remembered place can't pass
    let target = 250;
    while (!/^#{1,6} /.test(doc.lineAt(target).text)) target++;
    // VS Code restores the file's earlier scroll position a moment after it opens: scroll until it sticks
    const state = () => {
      const e = vscode.window.activeTextEditor;
      return `active=${e?.document.uri.path ?? "none"} ranges=${JSON.stringify(e?.visibleRanges.map((r) => [r.start.line, r.end.line]))} lines=${e?.document.lineCount} target=${target}`;
    };
    await until("scrolled", () => {
      const top = vscode.window.activeTextEditor?.visibleRanges[0]?.start.line ?? 0;
      // VS Code reports the line under its sticky headings as the first visible one (run 106: [269, 289] for 270)
      if (top >= target - 1) return true;
      void vscode.commands.executeCommand("revealLine", { lineNumber: target + 2, at: "top" });
      return false;
    }).catch((error: unknown) => {
      throw new Error(`${String(error)} — ${state()}`);
    });
    assert.strictEqual(vscode.window.activeTextEditor?.document, editor.document);
    await vscode.commands.executeCommand("docmap.openMapHere");
    const { testing } = await api();
    const page = await until("page", () => testing.pageFor(doc.uri));
    const reveal = await until("revealed", () => {
      const m = page.lastByType.get("reveal");
      return m?.type === "reveal" ? m : undefined;
    });
    const render = await until("render", () => drawn(page));
    const expected = render.headings.find((h) => h.line === target)?.id;
    assert.ok(expected);
    assert.strictEqual(reveal.headingId, expected);
  });

  test("0.2.3: the same button toggles — preview, source, preview — in one tab", async () => {
    await closeAll();
    const doc = await vscode.workspace.openTextDocument(path.join(root(), "sample.md"));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    const tabsOfFile = () =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter((t) => isPageTab(t, doc.uri) || isSourceTab(t, doc.uri));
    // the editor-title button passes the file's URI, as here
    for (const expected of ["page", "source", "page"] as const) {
      await vscode.commands.executeCommand("docmap.openMapHere", doc.uri);
      await until(`${expected} tab active, alone`, () => {
        const active = vscode.window.tabGroups.activeTabGroup.activeTab;
        const ok = expected === "page" ? isPageTab(active, doc.uri) : isSourceTab(active, doc.uri);
        return ok && tabsOfFile().length === 1;
      });
    }
    // and "Show Source" from the preview goes back too
    await vscode.commands.executeCommand("docmap.showSource", doc.uri);
    await until(
      "source tab active, alone",
      () =>
        isSourceTab(vscode.window.tabGroups.activeTabGroup.activeTab, doc.uri) && tabsOfFile().length === 1,
    );
  });

  test("a file with unsaved changes keeps its source tab (nothing to save or discard is asked)", async () => {
    await closeAll();
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: "# Draft\n" });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.openMapHere");
    const { testing } = await api();
    await until("page", () => testing.pageFor(doc.uri));
    const group = vscode.window.tabGroups.activeTabGroup;
    assert.ok(
      group.tabs.some((t) => isSourceTab(t, doc.uri)),
      "the unsaved source tab was closed",
    );
    await closeAllReverting();
  });
});

/** Closes every editor, discarding the untitled test files (no save prompt). */
async function closeAllReverting(): Promise<void> {
  for (let i = 0; i < 10 && vscode.window.tabGroups.all.some((g) => g.tabs.length > 0); i++) {
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }
}

suite("2.0 — Docs Inbox, writing helpers, highlights", () => {
  test("the Docs Inbox reads the workspace's Markdown and sorts it into groups", async () => {
    const { testing } = await api();
    await testing.inbox.scan(); // the first read: files already here count as known (#43)
    // #43/#44: a doc added afterwards is New; a tool file (dot-folder) is listed nowhere
    const added = vscode.Uri.file(path.join(root(), "inbox-new.md"));
    const tool = vscode.Uri.file(path.join(root(), ".agents", "tool-skill.md"));
    await vscode.workspace.fs.writeFile(added, new TextEncoder().encode("# Added later\n\nText.\n"));
    await vscode.workspace.fs.writeFile(tool, new TextEncoder().encode("# Tool skill\n\nText.\n"));
    try {
      await testing.inbox.scan();
      const groups = await testing.inbox.getChildren();
      const labels = groups.map((g) => String(testing.inbox.getTreeItem(g).label));
      const fresh = groups.find((g) =>
        /^New — last 7 days, not opened \(\d+\)$/.test(String(testing.inbox.getTreeItem(g).label)),
      );
      assert.ok(fresh, labels.join(" | "));
      // #45 quiet first run: one summary line at the top of the inbox, no pop-up
      assert.match(testing.inbox.view?.message ?? "", /^Found \d+ docs.*\. Click a doc to read it\.$/);
      const freshNames = (await testing.inbox.getChildren(fresh)).map((n) =>
        String(testing.inbox.getTreeItem(n).label),
      );
      assert.ok(freshNames.includes("inbox-new.md"), freshNames.join(" | "));
      for (const g of groups) {
        const names = (await testing.inbox.getChildren(g)).map((n) =>
          String(testing.inbox.getTreeItem(n).label),
        );
        assert.ok(
          !names.includes("tool-skill.md"),
          `tool file listed in ${testing.inbox.getTreeItem(g).label}`,
        );
      }
      assert.ok(
        labels.some((l) => l.startsWith("Plans in progress") || l.startsWith("Worth reading")),
        labels.join(" | "),
      );
    } finally {
      await vscode.workspace.fs.delete(added);
      await vscode.workspace.fs.delete(vscode.Uri.file(path.join(root(), ".agents")), { recursive: true });
    }
  });

  test("#46: changing a file a doc names shows 'N docs mention files you changed'", async () => {
    const { testing } = await api();
    await testing.inbox.scan();
    const product = path.normalize(path.join(root(), "product.md"));
    await testing.commitHint.refresh();
    assert.ok(
      !testing.commitHint.current.some((d) => d.doc === product),
      "product.md listed before anything changed",
    );
    // product.md names `docs/vision.md`; creating it is an uncommitted change to a file the doc names
    const folder = vscode.Uri.file(path.join(root(), "docs"));
    const changed = vscode.Uri.joinPath(folder, "vision.md");
    await vscode.workspace.fs.writeFile(changed, new TextEncoder().encode("# Vision\n"));
    try {
      await testing.commitHint.refresh();
      const hit = testing.commitHint.current.find((d) => d.doc === product);
      assert.ok(hit, JSON.stringify(testing.commitHint.current));
      assert.deepStrictEqual(hit.files, [path.normalize(changed.fsPath)]);
    } finally {
      await vscode.workspace.fs.delete(folder, { recursive: true });
    }
    await testing.commitHint.refresh();
    assert.ok(
      !testing.commitHint.current.some((d) => d.doc === product),
      "still listed after the change was undone",
    );
  });

  test("the decision log opens as a Markdown page", async () => {
    await vscode.commands.executeCommand("docmap.decisionLog");
    const doc = await until("decision log", () =>
      vscode.workspace.textDocuments.find((d) => d.getText().startsWith("# Decision log")),
    );
    assert.strictEqual(doc.languageId, "markdown");
    await closeAllReverting();
  });

  test("Enter continues a list, and ends it on an empty item", async () => {
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: "- first" });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 7, 0, 7);
    await vscode.commands.executeCommand("docmap.onEnter");
    assert.strictEqual(doc.getText(), "- first\n- ");
    await vscode.commands.executeCommand("docmap.onEnter");
    assert.strictEqual(doc.getText(), "- first\n");
    await closeAllReverting();
  });

  test("Format Table lines the columns up; Toggle Bold wraps and unwraps", async () => {
    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: "|a|bb|\n|-|-|\n|ccc|d|\n\nword",
    });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 1, 0, 1);
    await vscode.commands.executeCommand("docmap.formatTable");
    assert.strictEqual(doc.getText().split("\n")[0], "| a   | bb  |");
    editor.selection = new vscode.Selection(4, 0, 4, 4);
    await vscode.commands.executeCommand("docmap.bold");
    assert.strictEqual(doc.lineAt(4).text, "**word**");
    editor.selection = new vscode.Selection(4, 0, 4, 8);
    await vscode.commands.executeCommand("docmap.bold");
    assert.strictEqual(doc.lineAt(4).text, "word");
    await closeAllReverting();
  });

  test("a highlight is kept for the file and sent back to the page; mark as read clears 'changed'", async () => {
    const { panel } = await openMap("sample.md");
    const first = await until("render", () => rendered(panel));
    const heading = first.headings[0];
    assert.ok(heading);
    await panel.receive({ type: "highlight", headingId: heading.id, text: "some text" });
    const withMark = await until("extras with the highlight", () => {
      const m = panel.lastByType.get("extras");
      return m?.type === "extras" && m.extras.highlights?.some((h) => h.text === "some text") ? m : undefined;
    });
    const id = withMark.extras.highlights?.find((h) => h.text === "some text")?.id ?? "";
    await panel.receive({ type: "unhighlight", id });
    await until("highlight removed", () => {
      const m = panel.lastByType.get("extras");
      return m?.type === "extras" && !m.extras.highlights?.some((h) => h.id === id);
    });
    await panel.receive({ type: "markRead" });
    const read = await until("extras after mark as read", () => {
      const m = panel.lastByType.get("extras");
      return m?.type === "extras" ? m : undefined;
    });
    assert.deepStrictEqual(read.extras.changed, []);
    assert.strictEqual(read.extras.look?.theme, "vscode");
  });
});

suite("2.0.3 — startup survives a missing view", () => {
  test("every 2.0 command is registered (startup did not stop at the Docs Inbox view)", async () => {
    await api();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "docmap.askAgent",
      "docmap.sendReview",
      "docmap.exportHtml",
      "docmap.exportPdf",
      "docmap.chooseLook",
      "docmap.bold",
      "docmap.formatTable",
      "docmap.addPrompts",
    ])
      assert.ok(commands.includes(id), `${id} missing`);
  });
});

suite("2.0.4 — the browser view keeps one set of pages", () => {
  suiteSetup(() => savedCopy(true));
  suiteTeardown(() => savedCopy(false));
  test("opening another file in the browser replaces the previous pages", async () => {
    const docmap = await api();
    const opened: vscode.Uri[] = [];
    docmap.testing.setBrowserOpener(async (uri) => {
      opened.push(uri);
      return true;
    });
    for (const name of ["links.md", "sample.md"]) {
      const doc = await vscode.workspace.openTextDocument(path.join(root(), name));
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      await vscode.commands.executeCommand("docmap.openInBrowser");
    }
    const dir = vscode.Uri.file(path.dirname(opened[1]?.fsPath ?? ""));
    const files = (await vscode.workspace.fs.readDirectory(dir)).map(([n]) => n);
    assert.ok(
      files.some((n) => /^sample-[0-9a-f]{10}\.html$/.test(n)),
      files.join(", "),
    );
    assert.ok(!files.some((n) => n.startsWith("links-")), `old pages kept: ${files.join(", ")}`);
  });
});

suite("3.0 — trust markers", () => {
  test("a paragraph naming a file that does not exist is marked 'doesn't match the code'", async () => {
    const { panel } = await openMap("trust.md");
    const extras = await until(
      "trust markers",
      () => {
        const m = panel.lastByType.get("extras");
        return m?.type === "extras" && m.extras.trust?.length ? m.extras : undefined;
      },
      15000,
    );
    const marks = extras.trust ?? [];
    assert.strictEqual(marks.length, 1, JSON.stringify(marks));
    assert.strictEqual(marks[0]?.state, "mismatch");
    assert.match(marks[0]?.reasons[0] ?? "", /notes\/missing-plan\.md/);
  });
});

suite("3.0 — tick a task from the page", () => {
  test("ticking writes [x] on that line and saves; a stale or wrong line edits nothing", async () => {
    const { editor, panel } = await openMap("ticks.md");
    const doc = editor.document;
    const original = doc.getText();
    try {
      const line = doc.getText().split(/\r?\n/).indexOf("- [ ] Switch traffic");
      assert.ok(line > 0, "fixture changed");
      await panel.receive({ type: "setTask", docVersion: doc.version, line, checked: true });
      await until("ticked", () => doc.lineAt(line).text === "- [x] Switch traffic");
      assert.strictEqual(doc.isDirty, false, "a clean file is saved after the tick");
      const now = doc.getText();
      // not a task line (the heading): nothing changes
      await panel.receive({ type: "setTask", docVersion: doc.version, line: 0, checked: true });
      // an old version whose edits are not on record: nothing changes
      await panel.receive({ type: "setTask", docVersion: 0, line, checked: false });
      assert.strictEqual(doc.getText(), now);
    } finally {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        doc.uri,
        new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
        original,
      );
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    }
  });
});

suite("3.0 — new doc from template", () => {
  test("creates a plan at docs/plans/<title>.md, opens it, and never replaces an existing file", async () => {
    const created = await vscode.commands.executeCommand<vscode.Uri>(
      "docmap.newDocFromTemplate",
      "plan",
      "Template Check",
    );
    assert.ok(created, "no file created");
    try {
      assert.ok(created.fsPath.replace(/\\/g, "/").endsWith("docs/plans/template-check.md"), created.fsPath);
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(created));
      assert.match(
        text,
        /^---\nowner:\nstatus: draft\ncreated: \d{4}-\d{2}-\d{2}\n---\n\n# Template Check\n/,
      );
      assert.ok(text.includes("## Rollback"), text);
      assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), created.toString());
      // a second run with the same title opens the file as it is
      await vscode.workspace.fs.writeFile(created, new TextEncoder().encode("# Mine\n"));
      await vscode.commands.executeCommand("docmap.newDocFromTemplate", "plan", "Template Check");
      assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(created)), "# Mine\n");
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await vscode.workspace.fs.delete(vscode.Uri.file(path.join(root(), "docs")), { recursive: true });
    }
  });
});

suite("3.0 — named formats: the team's format wins", () => {
  test("a new decision record follows the team's folder, numbering and template; compare names that template", async () => {
    const enc = new TextEncoder();
    const dir = vscode.Uri.file(path.join(root(), "doc", "adr"));
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(dir, "0001-first.md"),
      enc.encode("# First\n## Why\n"),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(dir, "template.md"),
      enc.encode("# {title}\n\n## Why\n\n## What we picked\n"),
    );
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(path.join(root(), ".adr-dir")),
      enc.encode("doc/adr\n"),
    );
    try {
      const created = await vscode.commands.executeCommand<vscode.Uri>(
        "docmap.newDocFromTemplate",
        "decision",
        "Pick a cache",
      );
      assert.ok(
        created?.fsPath.replace(/\\/g, "/").endsWith("doc/adr/0002-pick-a-cache.md"),
        created?.fsPath,
      );
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(created));
      assert.strictEqual(text, "# Pick a cache\n\n## Why\n\n## What we picked\n");
      const result = await vscode.commands.executeCommand<{
        format: string;
        comparison: { present: string[]; missing: string[] };
      }>("docmap.compareWithStandard", created, "Your team's format");
      assert.strictEqual(result?.format, "Your team's format");
      assert.deepStrictEqual(result?.comparison.missing, []);
      // the same record against MADR: information only, nothing in the file changes
      const madr = await vscode.commands.executeCommand<{ comparison: { missing: string[] } }>(
        "docmap.compareWithStandard",
        created,
        "MADR",
      );
      assert.ok(madr?.comparison.missing.includes("Considered Options"));
      assert.strictEqual(new TextDecoder().decode(await vscode.workspace.fs.readFile(created)), text);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await vscode.workspace.fs.delete(vscode.Uri.file(path.join(root(), "doc")), { recursive: true });
      await vscode.workspace.fs.delete(vscode.Uri.file(path.join(root(), ".adr-dir")));
    }
  });

  test("#37: New Doc with a known format writes its section headings only", async () => {
    const created = await vscode.commands.executeCommand<vscode.Uri>(
      "docmap.newDocFromTemplate",
      "nygard",
      "Use Redis",
    );
    try {
      assert.ok(created?.fsPath.replace(/\\/g, "/").endsWith("/use-redis.md"), created?.fsPath);
      assert.strictEqual(
        new TextDecoder().decode(await vscode.workspace.fs.readFile(created)),
        "# Use Redis\n\n## Status\n\n## Context\n\n## Decision\n\n## Consequences\n",
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      if (created) await vscode.workspace.fs.delete(created);
    }
  });

  test("MADR from the short list is docmap's full decision template; 'Here' saves in the clicked folder", async () => {
    const here = vscode.Uri.file(path.join(root(), "here-folder"));
    await vscode.workspace.fs.createDirectory(here);
    try {
      const created = await vscode.commands.executeCommand<vscode.Uri>(
        "docmap.newDocHere",
        here,
        "madr",
        "Use Kafka",
      );
      assert.ok(created, "no file created");
      assert.strictEqual(
        path.normalize(path.dirname(created.fsPath)).toLowerCase(),
        path.normalize(here.fsPath).toLowerCase(),
      );
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(created));
      assert.match(text, /^---\nowner:/, "the full template has front matter");
      assert.ok(text.includes("## Considered Options"), text);
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await removeWhenFree(here);
    }
  });

  /** Windows: a just-closed file can stay locked for a moment — retry the delete for up to 5 s. */
  async function removeWhenFree(uri: vscode.Uri): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const done = await vscode.workspace.fs.delete(uri, { recursive: true }).then(
        () => true,
        () => false,
      );
      if (done) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await vscode.workspace.fs.delete(uri, { recursive: true }); // the last try reports why it failed
  }

  const put = (rel: string, text: string) =>
    vscode.workspace.fs.writeFile(
      vscode.Uri.file(path.join(root(), ...rel.split("/"))),
      new TextEncoder().encode(text),
    );
  const removeDocs = () =>
    vscode.workspace.fs.delete(vscode.Uri.file(path.join(root(), "docs")), { recursive: true }).then(
      () => undefined,
      () => undefined,
    );

  test("a design doc uses the team's template at docs/templates/design.md", async () => {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(root(), "docs", "templates")));
    await put("docs/templates/design.md", "# {title}\n\n## Problem\n\n## Plan\n");
    try {
      const created = await vscode.commands.executeCommand<vscode.Uri>(
        "docmap.newDocFromTemplate",
        "design",
        "Cache layer",
      );
      assert.ok(created?.fsPath.replace(/\\/g, "/").endsWith("docs/design/cache-layer.md"), created?.fsPath);
      assert.strictEqual(
        new TextDecoder().decode(await vscode.workspace.fs.readFile(created)),
        "# Cache layer\n\n## Problem\n\n## Plan\n",
      );
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
      await removeDocs();
    }
  });

  test("the page names a recognised doc's kind and format; an ordinary doc gets no label", async () => {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(root(), "docs", "decisions")));
    await put(
      "docs/decisions/0001-db.md",
      "# Use Postgres\n\n## Context and Problem Statement\n\nx\n\n## Considered Options\n\ny\n\n## Decision Outcome\n\nz\n",
    );
    try {
      const kindOf = async (file: string) => {
        const { panel } = await openMap(file);
        const extras = await until(
          "extras",
          () => {
            const m = panel.lastByType.get("extras") ?? panel.lastByType.get("render");
            const x = m?.type === "extras" || m?.type === "render" ? m.extras : undefined;
            return x?.look ? x : undefined;
          },
          15000,
        );
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        return extras.docKind;
      };
      assert.deepStrictEqual(await kindOf("docs/decisions/0001-db.md"), {
        label: "Decision record",
        format: "MADR",
      });
      assert.strictEqual(await kindOf("sample.md"), undefined);
    } finally {
      await removeDocs();
    }
  });

  test("the doc map goes into AGENTS.md (made) and CLAUDE.md, unsaved; the team's shared shape wins", async () => {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(root(), "docs", "runbooks")));
    for (const n of ["a", "b", "c"])
      await put(`docs/runbooks/${n}.md`, `# ${n}\n\n## Steps\n\n## Rollback\n`);
    // #34: a design doc → the map tells agents to read it before building
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(root(), "docs", "design")));
    await put("docs/design/cache.md", "# Cache\n\n## Goals\n\nFast.\n");
    // CLAUDE.md is open in VS Code with older text, then changes on disk just before the command runs (what another
    // suite left behind on CI): the doc map must be built on the new text, not on VS Code's lagging copy
    await put("CLAUDE.md", "# Old notes\n\nStale.\n");
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(root(), "CLAUDE.md")));
    await put("CLAUDE.md", "# Notes\n");
    try {
      const result = await vscode.commands.executeCommand<{ files: string[]; section: string }>(
        "docmap.writeDocMap",
      );
      assert.deepStrictEqual(result?.files, ["AGENTS.md", "CLAUDE.md"]);
      assert.ok(
        result.section.includes(
          "| Runbook | `docs/runbooks/` (3 docs) | The team's format, from `3 docs in docs/runbooks`: steps · rollback |",
        ),
        result.section,
      );
      assert.ok(
        result.section.includes("| Decision record | `docs/decisions/` (suggested; none yet) | [MADR]"),
      );
      assert.ok(
        result.section.includes("**Before building:** read the design doc(s) in `docs/design/` first"),
        result.section,
      );
      const claudePath = vscode.Uri.file(path.join(root(), "CLAUDE.md")).fsPath;
      const claude = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === claudePath);
      assert.ok(claude?.isDirty, "CLAUDE.md should be left unsaved for review");
      assert.ok(claude.getText().startsWith("# Notes\n\n<!-- docmap:doc-map start -->"), claude.getText());
      // nothing saved: the file on disk is as it was
      assert.strictEqual(
        new TextDecoder().decode(
          await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(root(), "CLAUDE.md"))),
        ),
        "# Notes\n",
      );
      const agents = vscode.workspace.textDocuments.find((d) => d.uri.fsPath.endsWith("AGENTS.md"));
      assert.ok(agents?.getText().includes("## Doc map"));
    } finally {
      await vscode.commands.executeCommand("workbench.action.files.revert");
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      for (const f of ["AGENTS.md", "CLAUDE.md"])
        await vscode.workspace.fs.delete(vscode.Uri.file(path.join(root(), f))).then(
          () => undefined,
          () => undefined,
        );
      await removeDocs();
    }
  });
});

suite("3.0 — no readiness score", () => {
  test("a plan's page carries no 'Ready N/10' score (removed 2026-11-17: not an industry standard)", async () => {
    const { panel } = await openMap("readiness-plan.md");
    const extras = await until(
      "extras",
      () => {
        const m = panel.lastByType.get("extras") ?? panel.lastByType.get("render");
        const x = m?.type === "extras" || m?.type === "render" ? m.extras : undefined;
        return x?.keyPoints ? x : undefined;
      },
      15000,
    );
    assert.ok(!("readiness" in extras));
  });
});

suite("3.0 — plans dashboard", () => {
  test("lists the workspace's plans on a read-only preview page that links to each", async () => {
    await vscode.commands.executeCommand("docmap.plansDashboard");
    const uri = vscode.Uri.from({ scheme: "docmap-report", path: "/Plans dashboard.md" });
    const docmap = await api();
    const panel = await until("dashboard page", () => docmap.testing.panelFor(uri), 30000);
    await until("dashboard render", () => rendered(panel), 15000);
    const text =
      vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())?.getText() ?? "";
    assert.match(
      text,
      /\[Search revamp plan\]\(readiness-plan\.md\) \[🌐\]\(readiness-plan\.md#open-in-browser "Open this plan in the browser"\) \| 1\/2 \(50%\) \| in progress \| @priya/,
    );
    assert.doesNotMatch(text, /trust\.md/);
    // grouped by folder; the 🌐 beside a plan opens that plan in the browser
    assert.match(text, /## Plans by folder\n\n### Top folder\n/);
    const opened: vscode.Uri[] = [];
    docmap.testing.setBrowserOpener(async (u) => {
      opened.push(u);
      return true;
    });
    try {
      await panel.receive({ type: "openLink", href: "readiness-plan.md#open-in-browser" });
      await until("plan opened in the browser", () => opened[0]);
      assert.match(opened[0]?.toString(true) ?? "", /^http:\/\/127\.0\.0\.1:\d+\//);
    } finally {
      docmap.testing.setBrowserOpener((u) => vscode.env.openExternal(u));
    }
  });
});

suite("3.0 — rendered redline", () => {
  test("comparing with an older text marks added, changed and removed blocks; stopping clears it", async () => {
    const { panel } = await openMap("trust.md");
    await until("render", () => rendered(panel), 15000);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.path.endsWith("/trust.md"));
    assert.ok(doc);
    const older = `${doc.getText()}\n\nA paragraph that was removed since.\n`;
    panel.compareWith("the test version", older);
    const extras = await until("redline", () => {
      const m = panel.lastByType.get("extras");
      return m?.type === "extras" && m.extras.redline ? m.extras : undefined;
    });
    assert.strictEqual(extras.redline?.label, "the test version");
    assert.strictEqual(extras.redline?.removed.length, 1);
    assert.strictEqual(extras.redline?.added.length, 0);
    assert.match(extras.redline?.oldHtml ?? "", /A paragraph that was removed since\./);
    panel.compareWith("", undefined);
    await until("redline cleared", () => {
      const m = panel.lastByType.get("extras");
      return m?.type === "extras" && !m.extras.redline;
    });
  });
});

suite("3.0 — open questions, my items, docs ↔ code", () => {
  test("Open Questions lists each doc's questions on a read-only page", async () => {
    await vscode.commands.executeCommand("docmap.openQuestions");
    const uri = vscode.Uri.from({ scheme: "docmap-report", path: "/Open questions.md" });
    const docmap = await api();
    const panel = await until("questions page", () => docmap.testing.panelFor(uri), 30000);
    const text =
      vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())?.getText() ?? "";
    assert.match(
      text,
      /## \[Search revamp plan\]\(readiness-plan\.md\)\n\n- Do we keep the old API\? _\(\[line 5\]\(readiness-plan\.md#L5\)\)_/,
    );
    // owner report 2026-11-24: "line 5" opens the doc's text at that line…
    await until("questions render", () => rendered(panel), 15000);
    const plan = vscode.Uri.file(path.join(root(), "readiness-plan.md"));
    await panel.receive({ type: "openLink", href: "readiness-plan.md#L5" });
    const editor = await until("the plan's text", () => {
      const e = vscode.window.activeTextEditor;
      return e?.document.uri.toString() === plan.toString() ? e : undefined;
    });
    assert.strictEqual(editor.selection.active.line, 4);
    // …and the doc's title opens its preview in a tab of its own, where "Show source" goes to the text
    await closeAll();
    await vscode.commands.executeCommand("docmap.openQuestions");
    const again = await until("questions page again", () => docmap.testing.panelFor(uri), 30000);
    await until("questions render again", () => rendered(again), 15000);
    await new Promise((r) => setTimeout(r, 300)); // links are throttled per page
    await again.receive({ type: "openLink", href: "readiness-plan.md" });
    const tabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    await until("the plan's preview tab", () => tabs().some((t) => isPageTab(t, plan)), 10000);
    assert.ok(docmap.testing.panelFor(uri), "the questions page stays open");
    const page = await until("the plan's page", () => docmap.testing.pageFor(plan));
    await until("the plan's page render", () => rendered(page), 15000);
    const shown = page.lastByType.get("render");
    assert.ok(shown?.type === "render" && shown.extras?.inTab === true, "the page offers 'Show source'");
    await page.receive({ type: "showSource" });
    await until("the plan's text in that tab", () => tabs().some((t) => isSourceTab(t, plan)), 10000);
  });

  test("a code file docs name gets '📄 Mentioned in 2 docs' above it", async () => {
    // #52 lazy activation: CodeLens never triggers an eager startup scan; trigger Docs Inbox once first
    await vscode.commands.executeCommand("docmap.inbox.refresh");
    const uri = vscode.Uri.file(path.join(root(), "code", "app.py"));
    // the CodeLens query needs the document open (CI run 132: "Illegal argument" for a file never opened)
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    const lenses = await until(
      "code lens",
      async () => {
        const l = await vscode.commands.executeCommand<vscode.CodeLens[]>(
          "vscode.executeCodeLensProvider",
          uri,
        );
        return l?.some((x) => x.command?.title === "📄 Mentioned in 2 docs") ? l : undefined;
      },
      30000,
    );
    const lens = lenses.find((x) => x.command?.command === "docmap.showMentions");
    assert.match(lens?.command?.tooltip ?? "", /readiness-plan\.md:3/);
    assert.match(lens?.command?.tooltip ?? "", /features[\\/]checkout\.md:5/);
  });
});

suite("3.0 — help", () => {
  test("Help (All Features) opens every feature on a read-only page", async () => {
    await vscode.commands.executeCommand("docmap.help");
    const uri = vscode.Uri.from({ scheme: "docmap-report", path: "/Help.md" });
    const docmap = await api();
    const panel = await until("help page", () => docmap.testing.panelFor(uri), 15000);
    const r = await until("help render", () => rendered(panel), 15000);
    const ids = r.headings.map((h) => h.id);
    for (const id of [
      "3-trust-markers",
      "5-plans-dashboard",
      "7-compare-what-changed-on-the-page",
      "13-tools-for-your-ai-agents",
    ])
      assert.ok(ids.includes(id), `missing section ${id}: ${ids.join(", ")}`);
  });
});

/**
 * A raw HTTP GET over a plain socket, as a browser sends it. Not node:http: inside the extension host VS Code
 * reroutes node:http requests through its proxy support, and they never reach a server in the same process.
 */
function request(url: string, host?: string) {
  const u = new URL(url);
  const socket = net.connect(Number(u.port), u.hostname);
  socket.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${host ?? u.host}\r\n\r\n`);
  return socket;
}

/** One reply, complete once its Content-Length bytes are in (a browser keeps the connection; so does this). */
function get(url: string, host?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let raw = Buffer.alloc(0);
    const socket = request(url, host);
    socket.on("data", (c: Buffer) => {
      raw = Buffer.concat([raw, c]);
      const end = raw.indexOf("\r\n\r\n");
      if (end === -1) return;
      const head = raw.subarray(0, end).toString("latin1");
      const length = Number(/\r\ncontent-length: (\d+)/i.exec(head)?.[1] ?? Number.NaN);
      if (!(raw.length - end - 4 >= length)) return;
      socket.destroy();
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1] ?? 0);
      resolve({ status, body: raw.subarray(end + 4, end + 4 + length).toString("utf8") });
    });
    socket.on("error", reject);
    socket.setTimeout(10000, () => socket.destroy(new Error(`no complete answer from ${url}`)));
  });
}

/** An update stream left open, collecting what the server pushes. */
function listen(url: string) {
  const got = { text: "", socket: request(url) };
  got.socket.setEncoding("utf8");
  got.socket.on("data", (c: string) => {
    got.text += c;
  });
  got.socket.on("error", () => undefined);
  return got;
}

suite("3.0 — live browser view: the page follows the editor", () => {
  let opened: vscode.Uri[] = [];
  suiteSetup(async () => {
    (await api()).testing.setBrowserOpener(async (uri) => {
      opened.push(uri);
      return true;
    });
  });
  setup(() => {
    opened = [];
  });
  suiteTeardown(async () => {
    (await api()).testing.setBrowserOpener((uri) => vscode.env.openExternal(uri));
    await closeAll();
  });

  const openLive = async (file: string) => {
    const doc = await vscode.workspace.openTextDocument(path.join(root(), file));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.openInBrowser");
    const url = opened[0]?.toString(true) ?? "";
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{64}\/doc\/\d+$/);
    return { doc, url };
  };

  test("'Open in browser' opens a local page with the map, locked down, images by private link", async () => {
    const { url } = await openLive("links.md");
    const page = await get(url);
    assert.strictEqual(page.status, 200);
    assert.match(page.body, /<html[^>]* data-live/);
    assert.match(page.body, /default-src 'none'/);
    assert.match(page.body, /connect-src 'self'/);
    assert.match(page.body, /img-src 'self' data:/);
    const image = /\/[0-9a-f]{64}\/file\/[0-9a-f]{24}/.exec(page.body)?.[0];
    assert.ok(image, "the approved image is served by a private key, not its path");
    const served = await get(new URL(image, url).toString());
    assert.strictEqual(served.status, 200, "the image itself loads from the live server");
  });

  test("nobody without the private link, or from another site's name, gets anything", async () => {
    const { url } = await openLive("sample.md");
    const wrongToken = url.replace(/\/[0-9a-f]{64}\//, `/${"0".repeat(64)}/`);
    assert.strictEqual((await get(wrongToken)).status, 404);
    assert.strictEqual((await get(url.replace(/\/doc\/\d+$/, "/"))).status, 404);
    const port = new URL(url).port;
    assert.strictEqual((await get(url, `evil.example:${port}`)).status, 403);
  });

  test("an edit in VS Code reaches the open page without pressing the button again", async () => {
    const { doc, url } = await openLive("sample.md");
    const events = url.replace(/\/doc\/(\d+)$/, "/events/$1");
    const data = url.replace(/\/doc\/(\d+)$/, "/data/$1");
    const stream = listen(events);
    try {
      await until("listening", () => stream.text.includes("docmap live"));
      const edit = new vscode.WorkspaceEdit();
      edit.insert(doc.uri, new vscode.Position(0, 0), "# Typed just now\n\n");
      await vscode.workspace.applyEdit(edit);
      await until("change pushed", () => stream.text.includes("data: change"));
      const latest = await get(data);
      assert.strictEqual(latest.status, 200);
      const render = JSON.parse(latest.body) as Extract<HostToWebview, { type: "render" }>;
      assert.strictEqual(render.type, "render");
      assert.ok(render.headings.some((h) => h.text === "Typed just now"));
    } finally {
      stream.socket.destroy();
      await vscode.commands.executeCommand("workbench.action.files.revert");
    }
  });

  test("a link to another Markdown file opens that file's live page", async () => {
    const { url } = await openLive("links.md");
    const page = await get(url);
    const map = /<script type="application\/json" id="docmap-links">([^<]*)<\/script>/.exec(page.body)?.[1];
    assert.ok(map, "the page carries its link map");
    const links = JSON.parse(map) as Record<string, string>;
    const target = links["linked.md#target-section"] ?? "";
    assert.match(target, /^\/[0-9a-f]{64}\/doc\/\d+#target-section$/);
    assert.strictEqual(links["../../package.json"], undefined, "a file outside the workspace gets no page");
    const linked = await get(new URL(target.replace(/#.*$/, ""), url).toString());
    assert.strictEqual(linked.status, 200);
    assert.ok(linked.body.includes("Target section"), "the linked page holds the linked file's map");
  });
});

suite("3.0 — Compare side by side (VS Code's compare view)", () => {
  test("the older version opens on the left, the file itself on the right, with the older text in it", async () => {
    const { editor, panel } = await openMap("sample.md");
    await until("render", () => rendered(panel));
    const older = "# An older title\n\nOld text.\n";
    panel.compareWith("a week ago", older);
    await panel.receive({ type: "redlineSideBySide" });
    const tab = await until("compare tab", () =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .find((t) => t.input instanceof vscode.TabInputTextDiff),
    );
    const input = tab.input as vscode.TabInputTextDiff;
    assert.strictEqual(input.original.scheme, "docmap-version");
    assert.strictEqual(input.modified.toString(), editor.document.uri.toString());
    assert.match(tab.label, /a week ago/);
    const left = await vscode.workspace.openTextDocument(input.original);
    assert.strictEqual(left.getText(), older);
    await closeAll();
  });

  test("without a version chosen, nothing opens", async () => {
    const { panel } = await openMap("sample.md");
    await until("render", () => rendered(panel));
    panel.compareWith("none", undefined);
    await panel.receive({ type: "redlineSideBySide" });
    const diffs = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.input instanceof vscode.TabInputTextDiff);
    assert.strictEqual(diffs.length, 0);
    await closeAll();
  });
});

suite("2026-11-22 review — the page's new actions", () => {
  // one file per test: VS Code may keep a deleted file's text in memory, and a re-made file would show it
  let file = "";
  const write = (name: string, text: string) => {
    file = name;
    return vscode.workspace.fs.writeFile(
      vscode.Uri.file(path.join(root(), file)),
      new TextEncoder().encode(text),
    );
  };
  const refsOf = (panel: MapPanel) => (panel as unknown as { codeRefs: string[] }).codeRefs;

  test("a code name the project has opens beside the doc; a missing one is not clickable", async () => {
    await write("page-actions-a.md", "# Actions\n\nThe app is `code/app.py`; `code/gone.py` is not.\n");
    try {
      const { panel } = await openMap(file);
      const refs = await until("code names", () => (refsOf(panel).length ? refsOf(panel) : undefined), 15000);
      assert.deepStrictEqual(refs, ["code/app.py"]);
      await panel.receive({ type: "openCode", text: "code/app.py" });
      await until("app.py opened", () =>
        vscode.window.visibleTextEditors.some((e) => e.document.uri.path.endsWith("/code/app.py")),
      );
    } finally {
      await closeAll();
      await vscode.workspace.fs.delete(vscode.Uri.file(path.join(root(), file)));
    }
  });

  test("▶ Terminal puts the command in a terminal; Copy for my AI copies the doc with its path", async () => {
    await write("page-actions-b.md", "# Run\n\n```console\n$ npm test\n```\n");
    try {
      const { panel, editor } = await openMap(file);
      const before = vscode.window.terminals.length;
      await panel.receive({ type: "runInTerminal", text: "$ npm test\n" });
      await until(
        "a terminal",
        () => vscode.window.terminals.length > before || vscode.window.activeTerminal,
      );
      const { copyForAgent } = await import("../../src/extension/page-actions");
      await copyForAgent(editor.document);
      const copied = await vscode.env.clipboard.readText();
      assert.ok(
        copied.startsWith("Here is 1 doc from my project.\n\n--- page-actions-b.md ---\n# Run"),
        copied,
      );
    } finally {
      for (const t of vscode.window.terminals) if (t.name === "docmap") t.dispose();
      await closeAll();
      await vscode.workspace.fs.delete(vscode.Uri.file(path.join(root(), file)));
    }
  });

  test("a moved file: the ✗ menu offers the new path, and Update changes that one line", async () => {
    await write("page-actions-c.md", "# Moved\n\nThe app lives in `old/where/app.py`.\n");
    try {
      const doc = await vscode.workspace.openTextDocument(path.join(root(), file));
      const { movedFixes, applyMovedFix } = await import("../../src/extension/page-actions");
      const fixes = await movedFixes(doc, 0, doc.lineCount);
      assert.deepStrictEqual(
        fixes.map((f) => [f.old, f.next, f.line]),
        [["old/where/app.py", "code/app.py", 2]],
      );
      assert.ok(fixes[0] && (await applyMovedFix(doc, fixes[0])));
      assert.strictEqual(doc.lineAt(2).text, "The app lives in `code/app.py`.");
    } finally {
      await closeAll();
      await vscode.workspace.fs.delete(vscode.Uri.file(path.join(root(), file)));
    }
  });

  test("'What can docmap do?' is a command", async () => {
    await api();
    assert.ok((await vscode.commands.getCommands(true)).includes("docmap.whatCanItDo"));
  });
});

suite("Easy reading — where a long doc stands", () => {
  test("a doc with parts opens with its parts, their state and the Status-line warning", async () => {
    await closeAll();
    const { panel } = await openMap("features/voice-casting.md");
    const render = await until("a render with 'where this stands'", () => {
      const r = rendered(panel);
      return r?.extras?.standing ? r : undefined;
    });
    const s = render.extras?.standing;
    assert.deepStrictEqual(
      s?.parts.map((p) => `${p.label}=${p.state}`),
      ["V1-a=built", "V1-b=built", "V1-c=built"],
    );
    assert.strictEqual(s?.disagree.length, 1);
    assert.match(s?.disagree[0] ?? "", /V1-c as not done, but section 13/);
    assert.deepStrictEqual(
      s?.events.map((e) => e.label),
      ["Decided", "V1-a", "V1-b", "V1-c"],
    );
  });

  test("each part links to its build record: a record that links back and names that part", async () => {
    const { panel } = await openMap("features/voice-casting.md");
    const parts = await until(
      "parts with records",
      () => {
        const m = panel.lastByType.get("extras") ?? rendered(panel);
        const p = m && "extras" in m ? m.extras?.standing?.parts : undefined;
        return p?.some((x) => x.record) ? p : undefined;
      },
      15000,
    );
    const records = Object.fromEntries(parts.map((p) => [p.label, p.record?.href]));
    assert.deepStrictEqual(records, {
      "V1-a": "../records/127-who-speaks.md",
      "V1-b": undefined,
      "V1-c": "../records/142-the-cast-reaches-the-user.md",
    });
  });

  test("pointing at a code link shows that code; a link outside the project shows nothing", async () => {
    const { panel } = await openMap("features/voice-casting.md");
    await until("first render", () => rendered(panel));
    await panel.receive({ type: "peekCode", text: "../code/cast.py#L2" });
    const reply = await until("the code peek", () => {
      const m = panel.lastByType.get("codePeek");
      return m?.type === "codePeek" && m.text === "../code/cast.py#L2" ? m : undefined;
    });
    assert.strictEqual(reply.peek?.path, "code/cast.py");
    assert.deepStrictEqual(
      reply.peek?.rows.find((r) => r[2]),
      [2, '    return {line.speaker: "default" for line in script}', true],
    );
    await panel.receive({ type: "peekCode", text: "../../../src/extension/links.ts" });
    const outside = await until("the refusal", () => {
      const m = panel.lastByType.get("codePeek");
      return m?.type === "codePeek" && m.text === "../../../src/extension/links.ts" ? m : undefined;
    });
    assert.strictEqual(outside.peek, undefined);
  });

  test("clicking a code link in a doc opens that code file at its line", async () => {
    await closeAll();
    const { panel } = await openMap("features/voice-casting.md");
    await until("first render", () => rendered(panel));
    await panel.receive({ type: "openLink", href: "../code/cast.py#L2" });
    const editor = await until("cast.py open", () => {
      const e = vscode.window.activeTextEditor;
      return e?.document.uri.fsPath.endsWith(path.join("code", "cast.py")) ? e : undefined;
    });
    assert.strictEqual(editor.selection.active.line, 1);
  });

  test("'◈ Doc Atlas' on a doc opens the graph beside it, centred on that doc", async () => {
    await closeAll();
    const { panel } = await openMap("features/voice-casting.md");
    await until("first render", () => rendered(panel));
    const uri = vscode.Uri.file(path.join(root(), "features", "voice-casting.md"));
    const graph = await vscode.commands.executeCommand<{
      start?: string;
      docs: { p: string; l: string[] }[];
    }>("docmap.docAtlas", { atlasFor: uri });
    assert.strictEqual(graph?.start, "features/voice-casting.md");
    // owner report 2026-11-24: opened from the doc, its own map first (the feature list folded)
    assert.strictEqual((graph as { forDoc?: boolean } | undefined)?.forDoc, true);
    // the records that link to it are its neighbours in the graph
    const linkers = graph?.docs.filter((d) => d.l.includes("features/voice-casting.md")).map((d) => d.p);
    assert.deepStrictEqual(linkers?.sort(), [
      "records/127-who-speaks.md",
      "records/142-the-cast-reaches-the-user.md",
    ]);
    await panel.receive({ type: "openAtlas" });
    const tabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    await until("the Doc Atlas tab", () => tabs().some((t) => t.label === "Doc Atlas"));
  });

  // code review 2026-11-24: a doc written after docmap read the project was missing, and the Atlas silently showed
  // the first feature instead
  test("'◈ Doc Atlas' on a doc written since the project was read still centres on that doc", async () => {
    await closeAll();
    await vscode.commands.executeCommand("docmap.docAtlas"); // the project is read now
    const uri = vscode.Uri.file(path.join(root(), "features", "brand-new-feature.md"));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode("# Brand new feature\n\nWords.\n"));
    try {
      const graph = await vscode.commands.executeCommand<{ start?: string; forDoc?: boolean }>(
        "docmap.docAtlas",
        { atlasFor: uri },
      );
      assert.strictEqual(graph?.start, "features/brand-new-feature.md");
      assert.strictEqual(graph?.forDoc, true);
    } finally {
      await vscode.workspace.fs.delete(uri);
    }
  });

  // code review 2026-11-24: an Atlas already open over the doc stayed there instead of moving beside it
  test("'◈ Doc Atlas' moves an Atlas that covers the doc to beside it", async () => {
    await closeAll();
    const doc = await vscode.workspace.openTextDocument(path.join(root(), "features", "voice-casting.md"));
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.docAtlas"); // opens in the doc's own group
    const atlasGroup = () =>
      vscode.window.tabGroups.all.find((g) => g.tabs.some((t) => t.label === "Doc Atlas"))?.viewColumn;
    await until("the Atlas in the doc's group", () => atlasGroup() === vscode.ViewColumn.One);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("docmap.docAtlas", { atlasFor: doc.uri });
    await until("the Atlas beside the doc", () => {
      const g = atlasGroup();
      return g !== undefined && g !== vscode.ViewColumn.One;
    });
  });

  test("Home: one page with what is next, hard-to-read docs, docs out of date and every feature", async () => {
    await closeAll();
    await vscode.commands.executeCommand("docmap.home");
    const home = await until("the Home page", () =>
      vscode.workspace.textDocuments.find((d) => path.basename(d.fileName).startsWith("Home - ")),
    );
    const text = home.getText();
    for (const heading of [
      "## What's being worked on, and what's next",
      "## Docs that are hard to read",
      "## Docs out of date with the code",
      "## Find the doc for a feature",
    ])
      assert.ok(text.includes(heading), heading);
    const features = text.slice(text.indexOf("## Find the doc for a feature"));
    assert.ok(features.includes("(features/voice-casting.md)"), "a feature doc is listed");
    assert.ok(features.includes("(features/checkout.md)"), "the other feature doc is listed");
  });

  test("an ordinary doc sends nothing for it", async () => {
    const { panel } = await openMap("sample.md");
    const render = await until("first render", () => rendered(panel));
    assert.strictEqual(render.extras?.standing, undefined);
  });
});
