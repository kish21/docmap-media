import * as assert from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import type { DocmapApi } from "../../src/extension/extension";
import { fileAt, mainBranchOf } from "../../src/extension/git";
import { cleanUpSavedData } from "../../src/extension/saved-data";
import { findInDocs, loadDocs } from "../../src/extension/search-docs";

// Owner calls 2026-11-18 (Antigravity review): main-branch compare, rule-file pointers, search across docs, Doc Atlas.

const EXT_ID = "kish21.markdown-as-web-page";
const root = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
const at = (rel: string) => vscode.Uri.file(path.join(root(), rel));
const text = async (uri: vscode.Uri) => new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
const exists = async (uri: vscode.Uri) =>
  vscode.workspace.fs.stat(uri).then(
    () => true,
    () => false,
  );

async function api(): Promise<DocmapApi> {
  const ext = vscode.extensions.getExtension<DocmapApi>(EXT_ID);
  assert.ok(ext, "extension not found");
  return ext.activate();
}

suite("3.0 — compare with the main branch", () => {
  test("finds the repository's main branch and reads the file as it is there", async () => {
    await api();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docmap-main-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir });
    try {
      git("init", "-q");
      git("checkout", "-q", "-b", "main");
      fs.writeFileSync(path.join(dir, "plan.md"), "# Plan\n\nOn main.\n");
      git("add", "plan.md");
      git("commit", "-q", "-m", "first");
      git("checkout", "-q", "-b", "feature");
      fs.writeFileSync(path.join(dir, "plan.md"), "# Plan\n\nOn the feature branch.\n");
      git("commit", "-q", "-am", "second");
      const uri = vscode.Uri.file(path.join(dir, "plan.md"));
      const main = await mainBranchOf(uri);
      assert.strictEqual(main, "main");
      assert.strictEqual(await fileAt(uri, main ?? ""), "# Plan\n\nOn main.\n");
    } finally {
      // Windows: git's read-only object files can refuse removal for a moment; a leftover temp folder is harmless
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {}
    }
  });
});

suite("3.0 — rule-file pointers never replace a user's file", () => {
  const files = ["AGENTS.md", "CLAUDE.md", "GEMINI.md"];
  suiteSetup(async () => {
    for (const f of [...files, ".github"])
      assert.ok(!(await exists(at(f))), `${f} must not exist in the fixtures`);
  });
  teardown(async () => {
    // revert every unsaved rule file, not only the active one: a CLAUDE.md left unsaved here was read back by a
    // later suite (the doc map) when the suites ran in another order
    const paths = files.map((f) => at(f).fsPath);
    for (const doc of vscode.workspace.textDocuments.filter(
      (d) => d.isDirty && paths.includes(d.uri.fsPath),
    )) {
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    }
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    for (const f of [...files, ".github"])
      if (await exists(at(f))) await vscode.workspace.fs.delete(at(f), { recursive: true });
  });

  test("no AGENTS.md: nothing is written", async () => {
    const done = await vscode.commands.executeCommand<string[]>("docmap.addRulePointers", ["GEMINI.md"]);
    assert.deepStrictEqual(done, []);
    assert.ok(!(await exists(at("GEMINI.md"))));
  });

  test("a missing file is created; an existing one keeps its text and gets one unsaved line; a rerun skips it", async () => {
    await vscode.workspace.fs.writeFile(at("AGENTS.md"), new TextEncoder().encode("# Agents\n"));
    const mine = "# My rules\n\nUse tabs.\n";
    await vscode.workspace.fs.writeFile(at("CLAUDE.md"), new TextEncoder().encode(mine));
    const done = await vscode.commands.executeCommand<string[]>("docmap.addRulePointers", [
      "CLAUDE.md",
      "GEMINI.md",
    ]);
    assert.deepStrictEqual([...done].sort(), ["CLAUDE.md", "GEMINI.md"]);
    assert.match(await text(at("GEMINI.md")), /Read AGENTS\.md/);
    // the user's file on disk is untouched; the addition is only in the open, unsaved editor
    assert.strictEqual(await text(at("CLAUDE.md")), mine);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === at("CLAUDE.md").fsPath);
    assert.ok(doc?.isDirty, "CLAUDE.md should be open with unsaved changes");
    assert.ok(doc.getText().startsWith(mine));
    assert.ok(doc.getText().endsWith("<!-- docmap: points to AGENTS.md -->\n@AGENTS.md\n"), doc.getText());
    // both now name AGENTS.md: nothing more to do
    const again = await vscode.commands.executeCommand<string[]>("docmap.addRulePointers", [
      "CLAUDE.md",
      "GEMINI.md",
    ]);
    assert.deepStrictEqual(again, []);
  });
});

suite("#40 — does the code still match this design?", () => {
  test("lists what the design doc names that is not in the project, and nothing for a doc that matches", async () => {
    await api();
    const doc = at("design-check-40.md");
    await vscode.workspace.fs.writeFile(
      doc,
      new TextEncoder().encode(
        "# Orders design\n\n## Data flow\n\nPages live in `code/missing-folder/orders.ts`.\n\n## Good\n\nSee `pixel.png`.\n",
      ),
    );
    try {
      const findings = (await vscode.commands.executeCommand("docmap.checkDesign", doc, false)) as
        | { line: number; section: string; mismatch: { reason: string } }[]
        | undefined;
      assert.ok(findings, "the check ran");
      assert.deepStrictEqual(
        findings.map((f) => [f.line, f.section]),
        [[4, "Data flow"]],
      );
      assert.match(
        findings[0]?.mismatch.reason ?? "",
        /code\/missing-folder\/orders\.ts`, which is not in the repository/,
      );
      // the command with its list opens without error
      await vscode.commands.executeCommand("docmap.checkDesign", doc);
      await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
    } finally {
      await vscode.workspace.fs.delete(doc);
    }
  });

  test("a sub-project's doc naming its own `src/` file is not flagged (hand test: parent folder opened)", async () => {
    await api();
    const sub = at("sub-shop-40");
    const doc = vscode.Uri.joinPath(sub, "docs", "design", "checkout.md");
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(sub, "src", "cart.js"),
      new TextEncoder().encode("//\n"),
    );
    await vscode.workspace.fs.writeFile(
      doc,
      new TextEncoder().encode("# Checkout design\n\n## Design\n\nThe cart is in `src/cart.js`.\n"),
    );
    // the file index is rebuilt 3 s after files are created (repo-facts.ts); the test above built it already
    await new Promise((resolve) => setTimeout(resolve, 3500));
    try {
      const findings = (await vscode.commands.executeCommand("docmap.checkDesign", doc, false)) as
        | unknown[]
        | undefined;
      assert.deepStrictEqual(findings, []);
    } finally {
      await vscode.workspace.fs.delete(sub, { recursive: true });
    }
  });
});

suite("#41 — clean up docmap's saved data", () => {
  test("start-up clean-up drops only places of deleted files; the command removes only what was picked", async () => {
    const { saved } = (await api()).testing;
    const here = at("sample.md").toString();
    const gone = at("deleted-long-ago-41.md").toString();
    saved.places.set(here, "intro");
    saved.places.set(gone, "intro");
    saved.notes.setReview(here, "intro", { mark: "approve", note: "kept" });
    saved.notes.setReview(gone, "intro", { mark: "question", note: "kept too" });

    assert.strictEqual(await cleanUpSavedData(saved), 1);
    assert.strictEqual(saved.places.get(gone), undefined, "place of a deleted file is dropped");
    assert.strictEqual(saved.places.get(here), "intro", "place of an existing file survives");
    assert.strictEqual(
      saved.notes.reviews(gone).intro?.note,
      "kept too",
      "notes are never removed automatically",
    );

    assert.deepStrictEqual(await vscode.commands.executeCommand("docmap.clearSavedData", ["places"]), [
      "places",
    ]);
    assert.strictEqual(saved.places.get(here), undefined);
    assert.strictEqual(saved.notes.reviews(here).intro?.note, "kept", "notes survive clearing places");

    await vscode.commands.executeCommand("docmap.clearSavedData", ["notes"]);
    assert.deepStrictEqual(saved.notes.reviews(here), {});
  });
});

suite("#47 — where do I start?", () => {
  test("lists the README first, then the design doc, and every link points at a real file", async () => {
    const { inbox } = (await api()).testing;
    const readme = at("README.md");
    const design = at("docs/design/start-47.md");
    await vscode.workspace.fs.writeFile(readme, new TextEncoder().encode("# Fixture project\n\nHello.\n"));
    await vscode.workspace.fs.writeFile(design, new TextEncoder().encode("# Start design\n\nThe plan.\n"));
    try {
      await inbox.scan(); // a scan already running (started before the files were written) …
      await inbox.scan(); // … then a fresh one that sees them
      const page = (await vscode.commands.executeCommand("docmap.whereToStart")) as string;
      const first = page.indexOf("(README.md)");
      const second = page.indexOf("(docs/design/start-47.md)");
      assert.ok(first > 0 && second > first, page);
      for (const [, href] of page.matchAll(/\]\(([^)]+)\)/g))
        assert.ok(await exists(at(decodeURI(href ?? ""))), `link works: ${href}`);
    } finally {
      await vscode.workspace.fs.delete(readme);
      await vscode.workspace.fs.delete(at("docs"), { recursive: true });
      await inbox.scan();
    }
  });
});

suite("3.0 — search across docs", () => {
  test("a match names its file and the headings above it", async () => {
    await api();
    const hits = findInDocs(await loadDocs(), "more text").filter((h) => h.rel === "sample.md");
    assert.strictEqual(hits.length, 1);
    assert.deepStrictEqual(hits[0]?.trail, ["Sample document", "First section", "A subsection"]);
    assert.strictEqual(hits[0]?.line, 10);
  });
  test("the command opens without error", async () => {
    await vscode.commands.executeCommand("docmap.searchDocs", "sample");
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
  });
});

suite("3.1.1 — Doc Atlas, per feature", () => {
  test("lists the features; a feature's page shows the docs around it and the code it names", async () => {
    await api();
    // the graph panel opens; its data: the feature, its link, the code file it names, the names gone
    const graph = (await vscode.commands.executeCommand("docmap.docAtlas")) as {
      docs: { p: string; t: string; w: string; f: boolean; l: string[]; c: string[]; g: number }[];
      start?: string;
    };
    const checkout = graph.docs.find((d) => d.p === "features/checkout.md");
    assert.ok(checkout, "the feature is not in the atlas");
    assert.strictEqual(checkout.f, true);
    assert.strictEqual(checkout.w, "Takes the order and answers the request.");
    assert.deepStrictEqual(checkout.l, ["linked.md"]);
    assert.deepStrictEqual(checkout.c, ["code/app.py"]);
    assert.strictEqual(checkout.g, 1); // legacy_pay()
    assert.strictEqual(graph.start, "features/checkout.md");
    const atlasTab = () =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .find((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith("docmap.atlas"));
    // the tab bar updates a moment after the panel is created
    for (let i = 0; i < 30 && !atlasTab(); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(atlasTab(), "no Doc Atlas panel");

    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    assert.ok(folder);
    await vscode.commands.executeCommand(
      "docmap.docAtlas",
      vscode.Uri.joinPath(folder, "features", "checkout.md"),
    );
    const page = vscode.workspace.textDocuments.find((d) => d.uri.path === "/Atlas - Checkout.md");
    assert.ok(page, "no feature page");
    const md = page.getText();
    assert.match(md, /\["linked\.md"\]/);
    assert.match(md, /\[`handler\(\)`\]\(code\/app\.py#L1\)/);
    assert.match(md, /## No longer in the code[\s\S]*`legacy_pay\(\)`/);
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });
});

suite("hand test: a project with its own git, inside the opened folder", () => {
  test("#46 lists both docs naming the changed file, and the code file counts both mentions", async () => {
    const { testing } = await api();
    const dir = path.join(root(), "sub-shop-46");
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.mkdirSync(path.join(dir, "docs", "design"), { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir });
    const cart = path.join(dir, "src", "cart.js");
    const readme = path.normalize(path.join(dir, "README.md"));
    const design = path.normalize(path.join(dir, "docs", "design", "checkout.md"));
    const gitData = fs.mkdtempSync(path.join(os.tmpdir(), "docmap-sub-git-"));
    try {
      fs.writeFileSync(cart, "export function addItem() {}\n");
      fs.writeFileSync(readme, "# Shop\n\nThe cart lives in `src/cart.js`.\n");
      fs.writeFileSync(design, "# Checkout design\n\n## Design\n\nThe cart is in `src/cart.js`.\n");
      // the git data lives outside the workspace (a `.git` file points to it): VS Code's git keeps a `.git` folder
      // open, and Windows then refuses to delete the project afterwards
      git("init", "-q", "--separate-git-dir", gitData);
      git("add", "-A");
      git("commit", "-q", "-m", "first");
      fs.appendFileSync(cart, "// test\n");
      await testing.inbox.scan();
      // the top of cart.js: "Mentioned in 2 docs"
      const mentions = testing.inbox
        .mentionsOf(vscode.Uri.file(cart))
        .map((m) => path.normalize(m.doc.fsPath));
      assert.deepStrictEqual(mentions.sort(), [design, readme].sort());
      // the status bar: "2 docs mention files you changed"
      await testing.commitHint.refresh();
      const listed = testing.commitHint.current.map((d) => d.doc);
      assert.ok(listed.includes(readme) && listed.includes(design), JSON.stringify(listed));
      // Docs Inbox: the design doc is not "Probably out of date" for naming `src/cart.js`
      const inInbox = (await testing.inbox.getChildren()).flatMap((n) => (n.kind === "group" ? n.files : []));
      const designDoc = inInbox.find((f) => path.normalize(f.uri.fsPath) === design);
      assert.ok(designDoc, "the design doc is in the Docs Inbox");
      assert.deepStrictEqual(designDoc.missing, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
      await testing.inbox.scan();
      try {
        fs.rmSync(gitData, { recursive: true, force: true, maxRetries: 5 });
      } catch {
        // a leftover temp folder is harmless (same as the main-branch test above)
      }
    }
  });
});
