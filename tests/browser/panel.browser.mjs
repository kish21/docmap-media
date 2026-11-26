// Drives the REAL panel (panelHtml + dist/webview.js + stylesheets) in Chromium with the REAL engine output,
// and checks what a user sees and what a click sends. Run after `npm run build`: `npm run test:browser`.
// Browser: CHROMIUM_PATH, else /opt/pw-browsers/chromium, else /usr/bin/google-chrome.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";

async function load(entry, name) {
  const out = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}#${name}`
  );
}
const { panelHtml } = await load("src/extension/panel-html.ts", "html");
const { snapshotHtml } = await load("src/extension/snapshot-html.ts", "snapshot");
const { createMarkdownItEngine } = await load("src/core/markdown/markdown-it-engine.ts", "engine");
const engine = createMarkdownItEngine();
const { alignBlocks } = await load("src/core/insights/redline.ts", "redline");

const dist = pathToFileURL(resolve("dist")).href;
const pageFile = join(mkdtempSync(join(tmpdir(), "docmap-panel-")), "panel.html");
writeFileSync(
  pageFile,
  panelHtml({
    cspSource: "file:",
    nonce: "browsertest",
    title: "Map: test",
    tokensCss: `${dist}/tokens.css`,
    stylesCss: `${dist}/styles.css`,
    script: `${dist}/webview.js`,
  }),
);

const executablePath = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));
const browser = await chromium.launch({ executablePath });
let failures = 0;

async function openPanel() {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const dialogs = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  // The VS Code webview API, stubbed: records every message the panel sends to the host.
  await page.addInitScript(() => {
    window.__sent = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__sent.push(m) });
  });
  await page.goto(pathToFileURL(pageFile).href);
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "ready"));
  return { page, dialogs };
}

async function send(page, message) {
  await page.evaluate((m) => window.postMessage(m, "*"), message);
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.log(`  ✗ ${name}\n    ${String(error.message).split("\n").join("\n    ")}`);
  }
}

// ---------------------------------------------------------------------------------------------------------
// a committed snapshot of the real PRODUCT.md — rewording the live spine must not break CI
const product = readFileSync("tests/fixtures/product.md", "utf8");
const parsed = engine.parse(product, 42);
assert.ok(parsed.ok);
const { headings, html } = parsed.document;

{
  const { page } = await openPanel();
  await send(page, { type: "render", docVersion: 42, fileName: "PRODUCT.md", headings, html });
  await page.waitForSelector(".outline-link");

  await check(
    `M1 exit criterion: every heading of the real PRODUCT.md is listed, in order (${headings.length})`,
    async () => {
      const shown = await page.$$eval(".outline-link", (as) => as.map((a) => a.textContent));
      assert.deepEqual(
        shown,
        headings.map((h) => h.text),
      );
    },
  );

  await check("…each at its level (nesting depth follows the heading levels)", async () => {
    const depths = await page.$$eval(".outline-row", (rows) =>
      rows.map((r) => Number(r.style.getPropertyValue("--depth"))),
    );
    // expected depth = number of open ancestors with a smaller level (same rule as buildOutline)
    const stack = [];
    const expected = headings.map((h) => {
      while (stack.length && stack.at(-1) >= h.level) stack.pop();
      const depth = stack.length;
      stack.push(h.level);
      return depth;
    });
    assert.deepEqual(depths, expected);
  });

  await check("the real document renders in the panel", async () => {
    const text = await page.textContent(".prose");
    assert.ok(text.includes("Riskiest assumption"), "real PRODUCT.md content missing");
  });

  await check("M1 exit criterion: clicking a heading asks the editor to jump to its line", async () => {
    const target = headings.find((h) => h.text.startsWith("Scope"));
    await page.click(`.outline-link[href="#${target.id}"]`);
    const sent = await page.evaluate(() => window.__sent.filter((m) => m.type === "jump"));
    assert.deepEqual(sent.at(-1), { type: "jump", docVersion: 42, line: target.line, headingId: target.id });
  });

  await check("…and scrolls the panel's document to that heading", async () => {
    const target = headings.find((h) => h.text.startsWith("Scope"));
    const offset = await page.evaluate((id) => {
      const doc = document.querySelector(".document").getBoundingClientRect().top;
      return Math.round(document.getElementById(id).getBoundingClientRect().top - doc);
    }, target.id);
    assert.ok(Math.abs(offset) <= 40, `heading is ${offset}px from the top of the document pane`);
  });

  await check(
    "0.0.6 find: a match below the view is scrolled into view; a selection in view does not move",
    async () => {
      const result = await page.evaluate(async () => {
        const frame = () => new Promise((r) => setTimeout(r, 100));
        const doc = document.querySelector(".document");
        const select = (node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
          return range;
        };
        const inView = (range) => {
          const box = range.getBoundingClientRect();
          const view = doc.getBoundingClientRect();
          return box.bottom > view.top && box.top < view.bottom;
        };
        doc.scrollTop = 0;
        await frame();
        const first = select(document.querySelector(".prose p, .prose li")); // what a reader selects by hand: in view
        await frame();
        const stayed = doc.scrollTop === 0 && inView(first);
        // what the find bar selects: a match far below the view
        const below = [...document.querySelectorAll(".prose p, .prose li")].filter(
          (p) => p.getBoundingClientRect().top > doc.getBoundingClientRect().bottom + 200,
        );
        const far = select(below[below.length - 1]);
        const startedOut = !inView(far);
        await frame();
        const shown = startedOut && inView(far);
        getSelection().removeAllRanges();
        return { stayed, shown };
      });
      assert.deepEqual(result, { stayed: true, shown: true });
    },
  );

  await check(
    "0.0.7 reveal: the map scrolls to the heading, marks it, and reports the place to the host",
    async () => {
      const target = headings[Math.floor(headings.length * 0.6)]; // far down, but not so near the end it cannot top
      await page.evaluate(() => {
        document.querySelector(".document").scrollTop = 0;
      });
      await page.waitForTimeout(100);
      await send(page, { type: "reveal", docVersion: 42, headingId: target.id });
      await page.waitForTimeout(150);
      const result = await page.evaluate((id) => {
        const doc = document.querySelector(".document").getBoundingClientRect().top;
        const heading = document.querySelector(`.prose [id="${CSS.escape(id)}"]`);
        return {
          offset: Math.round(heading.getBoundingClientRect().top - doc),
          current: document.querySelector('.outline-link[aria-current="location"]')?.getAttribute("href"),
          place: window.__sent.filter((m) => m.type === "place").at(-1)?.headingId,
        };
      }, target.id);
      assert.ok(Math.abs(result.offset) <= 40, `heading is ${result.offset}px from the top of the pane`);
      assert.equal(result.current, `#${target.id}`);
      assert.equal(result.place, target.id);
    },
  );

  await check(
    "0.0.7 reveal: an unknown heading or an older version is ignored (the pane does not move)",
    async () => {
      const before = await page.evaluate(() => document.querySelector(".document").scrollTop);
      await send(page, { type: "reveal", docVersion: 42, headingId: "no-such-heading" });
      await send(page, { type: "reveal", docVersion: 41, headingId: headings[0].id });
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.querySelector(".document").scrollTop), before);
    },
  );

  await check(
    "0.0.7 reveal right after a re-render wins over the re-render's own scroll restore",
    async () => {
      const middle = headings[Math.floor(headings.length / 2)];
      await page.evaluate(() => {
        const doc = document.querySelector(".document");
        doc.scrollTop = doc.scrollHeight - doc.clientHeight; // the reader is at the end
      });
      await page.waitForTimeout(100);
      await send(page, { type: "render", docVersion: 42, fileName: "PRODUCT.md", headings, html });
      await send(page, { type: "reveal", docVersion: 42, headingId: middle.id });
      await page.waitForTimeout(700); // longer than a restore's settle loop
      const offset = await page.evaluate((id) => {
        const doc = document.querySelector(".document").getBoundingClientRect().top;
        return Math.round(
          document.querySelector(`.prose [id="${CSS.escape(id)}"]`).getBoundingClientRect().top - doc,
        );
      }, middle.id);
      assert.ok(Math.abs(offset) <= 40, `heading is ${offset}px from the top of the pane`);
    },
  );

  await check(
    "0.0.7 print: only the document, all of it (folded and skimmed parts too), dark on white",
    async () => {
      const probe = () =>
        page.evaluate(() => {
          const blocks = [...document.querySelectorAll(".prose > :not(h1, h2, h3, h4, h5, h6)")];
          blocks[1].setAttribute("data-collapsed-content", "");
          blocks[2].setAttribute("data-skim-hidden", "");
          const shown = (el) => getComputedStyle(el).display !== "none";
          const doc = document.querySelector(".document");
          const result = {
            outline: shown(document.querySelector(".outline")),
            folded: shown(blocks[1]),
            skimmed: shown(blocks[2]),
            clipped: doc.scrollHeight > doc.clientHeight + 1,
            text: getComputedStyle(document.querySelector(".prose")).color,
          };
          blocks[1].removeAttribute("data-collapsed-content");
          blocks[2].removeAttribute("data-skim-hidden");
          return result;
        });
      await page.emulateMedia({ media: "print", colorScheme: "dark" });
      const printed = await probe();
      await page.emulateMedia({ media: "screen", colorScheme: null });
      const screen = await probe();
      assert.deepEqual(
        { ...printed, text: undefined },
        { outline: false, folded: true, skimmed: true, clipped: false, text: undefined },
      );
      assert.equal(printed.text, "oklch(0.15 0 0)"); // dark text even when the map was dark
      assert.deepEqual(
        { outline: screen.outline, folded: screen.folded, skimmed: screen.skimmed },
        {
          outline: true,
          folded: false,
          skimmed: false,
        },
      );
    },
  );

  await check(
    "0.0.10 theme: a dark VS Code theme without sidebar colours keeps the outline readable on a light OS",
    async () => {
      // Dark+ defines no sideBar.* colours; the OS is light. The outline must follow VS Code's dark kind (body class),
      // and a theme's general --vscode-foreground before any fallback.
      await page.emulateMedia({ colorScheme: "light" });
      const read = () =>
        page.evaluate(() => {
          // real pixel values (computed colours may come back as oklch()): paint one pixel and read it
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d");
          const lum = (c) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = c;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          };
          const outline = document.querySelector(".outline");
          return {
            text: lum(getComputedStyle(outline).color),
            surface: lum(getComputedStyle(outline).backgroundColor),
          };
        });
      await page.evaluate(() => document.body.classList.add("vscode-dark"));
      const fallback = await read();
      await page.evaluate(() =>
        document.documentElement.style.setProperty("--vscode-foreground", "rgb(204, 204, 204)"),
      );
      const general = await read();
      await page.evaluate(() => {
        document.body.classList.remove("vscode-dark");
        document.documentElement.style.removeProperty("--vscode-foreground");
      });
      await page.emulateMedia({ colorScheme: null });
      assert.ok(fallback.text > 0.6 && fallback.surface < 0.3, `fallback: ${JSON.stringify(fallback)}`);
      assert.ok(general.text > 0.7, `general foreground: ${JSON.stringify(general)}`);
    },
  );

  await check("keyboard: ↓ moves focus to the next outline link", async () => {
    await page.focus(".outline-link");
    await page.keyboard.press("ArrowDown");
    const focused = await page.evaluate(() => document.activeElement.textContent);
    assert.equal(focused, headings[1].text);
  });
  await page.close();
}

{
  const tricky = engine.parse(readFileSync("tests/fixtures/tricky.md", "utf8"), 1);
  assert.ok(tricky.ok);
  const hostile = {
    ...tricky.document,
    headings: [
      ...tricky.document.headings,
      { id: "x", text: '<img src=x onerror="alert(1)">', level: 2, line: 0 },
    ],
  };
  const { page, dialogs } = await openPanel();
  await send(page, {
    type: "render",
    docVersion: 1,
    fileName: "tricky.md",
    headings: hostile.headings,
    html: hostile.html,
  });
  await page.waitForSelector(".outline-link");
  await page.waitForTimeout(200);

  await check("security: document HTML and hostile heading text never execute", async () => {
    assert.deepEqual(dialogs, [], `a dialog fired: ${dialogs}`);
    assert.equal(await page.$$eval(".prose script, .outline img", (n) => n.length), 0);
    const shown = await page.$$eval(".outline-link", (as) => as.at(-1).textContent);
    assert.equal(shown, '<img src=x onerror="alert(1)">', "heading text must be shown literally");
  });

  await check("security: a malformed host message is ignored", async () => {
    await send(page, { type: "render", html: "<p>no version</p>" });
    assert.ok(!(await page.textContent("body")).includes("no version"));
  });
  await page.close();
}

{
  const doc = engine.parse(
    "# App\n\n| n | v |\n|:--|--:|\n| a | 1 |\n\n[to app](#app)\n\n[bad %](#50%-off)\n",
    3,
  );
  assert.ok(doc.ok);
  const { page } = await openPanel();
  await send(page, { type: "render", docVersion: 3, fileName: "x.md", ...doc.document });
  await page.waitForSelector(".outline-link");
  await check("a heading whose id equals a panel element id ('app') is still found", async () => {
    await page.evaluate(() => {
      document.querySelector(".document").scrollTop = 0;
    });
    await page.click('.outline-link[href="#app"]');
    const inProse = await page.evaluate(() => document.querySelector('.prose [id="app"]') !== null);
    assert.ok(inProse);
    const sent = await page.evaluate(() => window.__sent.filter((m) => m.type === "jump"));
    assert.equal(sent.at(-1).headingId, "app");
  });
  await check("table alignment survives the strict CSP (class, not inline style)", async () => {
    const align = await page.$eval("td.align-right", (td) => getComputedStyle(td).textAlign);
    assert.equal(align, "right");
  });
  await check("a malformed #link does not break clicking", async () => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.click("text=bad %"); // markdown-it encodes it; decoding must still not throw
    await page.click('a[href="#app"]');
    assert.deepEqual(errors, []);
  });
  await page.close();
}

{
  const { page } = await openPanel();
  await send(page, { type: "state", state: "too-large", fileName: "big.md", bytes: 6 * 1024 * 1024 });
  await check("edge state: too-large explains itself and offers 'Render anyway'", async () => {
    await page.waitForSelector(".state-action");
    assert.ok((await page.textContent(".state")).includes("big.md is 6.0 MB"));
    await page.click(".state-action");
    assert.ok(await page.evaluate(() => window.__sent.some((m) => m.type === "renderAnyway")));
  });
  await send(page, {
    type: "render",
    docVersion: 2,
    fileName: "plain.md",
    headings: [],
    html: "<p>just text</p>",
  });
  await check("edge state: a file without headings says so and still shows the text", async () => {
    await page.waitForSelector(".outline-empty");
    assert.ok((await page.textContent(".prose")).includes("just text"));
  });
  await page.close();
}

// ---------------------------------------------------------------------------------------------------------
// M2 — daily driver
{
  const { page } = await openPanel();
  await send(page, { type: "render", docVersion: 42, fileName: "PRODUCT.md", headings, html });
  await page.waitForSelector(".outline-link");
  const scope = headings.find((h) => h.text.startsWith("Scope"));
  const validation = headings.find((h) => h.text.startsWith("Validation"));
  const currentId = () =>
    page.evaluate(() => document.querySelector(".outline-row[data-current]")?.dataset.id);

  await check("M2 you-are-here: the editor's scroll position marks the section it is in", async () => {
    await send(page, { type: "editorScrolled", docVersion: 42, topLine: scope.line + 5 });
    await page.waitForFunction(
      (id) => document.querySelector(".outline-row[data-current]")?.dataset.id === id,
      scope.id,
    );
    const cur = await page.$eval(".outline-row[data-current]", (row) => ({
      aria: row.querySelector(".outline-link").getAttribute("aria-current"),
      weight: getComputedStyle(row.querySelector(".outline-link")).fontWeight,
      bar: getComputedStyle(row).borderLeftColor,
    }));
    assert.equal(cur.aria, "location");
    assert.equal(cur.weight, "600");
    assert.notEqual(cur.bar, "rgba(0, 0, 0, 0)", "the current row needs its bar, not only a background");
  });

  await check(
    "M2 you-are-here: a scroll position from an older version of the document is ignored",
    async () => {
      await send(page, { type: "editorScrolled", docVersion: 41, topLine: 0 });
      await page.waitForTimeout(50);
      assert.equal(await currentId(), scope.id);
    },
  );

  await check("M2 you-are-here: scrolling the panel's own document marks the section too", async () => {
    await page.evaluate((id) => {
      const doc = document.querySelector(".document");
      doc.scrollTop +=
        document.getElementById(id).getBoundingClientRect().top - doc.getBoundingClientRect().top;
    }, validation.id);
    await page.waitForFunction(
      (id) => document.querySelector(".outline-row[data-current]")?.dataset.id === id,
      validation.id,
    );
  });

  await check(
    "M2 collapse: folding a section hides its entries in the outline AND its text in the document",
    async () => {
      await page.click(`.outline-row[data-id="${validation.id}"] .twisty`);
      const state = await page.evaluate((id) => {
        const row = document.querySelector(`.outline-row[data-id="${id}"]`);
        const sub = row.parentElement.querySelector(":scope > ol");
        const heading = document.getElementById(id);
        return {
          expanded: row.querySelector(".twisty").getAttribute("aria-expanded"),
          subVisible: sub.offsetParent !== null,
          headingVisible: heading.offsetParent !== null,
          nextBlockVisible: heading.nextElementSibling.offsetParent !== null,
        };
      }, validation.id);
      assert.deepEqual(state, {
        expanded: "false",
        subVisible: false,
        headingVisible: true,
        nextBlockVisible: false,
      });
    },
  );

  await check("M2 collapse survives a re-render after an edit", async () => {
    await send(page, { type: "render", docVersion: 43, fileName: "PRODUCT.md", headings, html });
    await page.waitForTimeout(50);
    const expanded = await page.$eval(`.outline-row[data-id="${validation.id}"] .twisty`, (b) =>
      b.getAttribute("aria-expanded"),
    );
    assert.equal(expanded, "false");
  });

  await check("M2 keyboard: → unfolds, ← folds, ← again moves to the parent", async () => {
    await page.focus(`.outline-row[data-id="${validation.id}"] .outline-link`);
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.$eval(`.outline-row[data-id="${validation.id}"] .twisty`, (b) =>
        b.getAttribute("aria-expanded"),
      ),
      "true",
    );
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await page.$eval(`.outline-row[data-id="${validation.id}"] .twisty`, (b) =>
        b.getAttribute("aria-expanded"),
      ),
      "false",
    );
    await page.keyboard.press("ArrowLeft");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), headings[0].text);
  });

  await check("M2 keyboard: ↓ skips folded entries; End and Home reach the ends", async () => {
    await page.focus(`.outline-row[data-id="${validation.id}"] .outline-link`);
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), scope.text);
    await page.keyboard.press("End");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), headings.at(-1).text);
    await page.keyboard.press("Home");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), headings[0].text);
  });

  await check(
    "M2 filter: '/' focuses it; typing narrows the outline, announces the count, marks the match",
    async () => {
      await page.focus(".outline-link");
      await page.keyboard.press("/");
      assert.ok(await page.evaluate(() => document.activeElement.classList.contains("filter")));
      await page.keyboard.type("log");
      const visible = await page.$$eval(".outline-row", (rows) =>
        rows.filter((r) => r.offsetParent !== null).map((r) => r.querySelector(".outline-link").textContent),
      );
      assert.deepEqual(
        visible,
        headings.filter((h) => h.text.toLowerCase().includes("log")).map((h) => h.text),
      );
      assert.equal(
        await page.textContent(".filter-status"),
        `${visible.length} of ${headings.length} headings`,
      );
      assert.equal(await page.$eval(".filter-status", (s) => s.getAttribute("role")), "status");
      assert.equal(await page.$$eval(".outline-link mark", (m) => m.length), visible.length);
    },
  );

  await check("M2 filter: matches inside a folded section are still shown while filtering", async () => {
    await page.fill("input.filter", "entry");
    const shown = await page.$$eval(".outline-row", (rows) =>
      rows.filter((r) => r.offsetParent !== null).map((r) => r.dataset.id),
    );
    const expected = headings.filter((h) => h.text.toLowerCase().includes("entry")).map((h) => h.id);
    assert.deepEqual(shown, expected);
    // "Entry 1" and "Entry 2" live inside the folded Validation section
    assert.ok(
      shown.some((id) => id.startsWith("entry-1")),
      "a match inside the folded section is hidden",
    );
  });

  await check("M2 filter: typed text is only ever text (no HTML), and Esc clears it", async () => {
    await page.fill("input.filter", '<img src=x onerror="alert(1)">');
    assert.equal(await page.$$eval(".outline img", (n) => n.length), 0);
    assert.equal(await page.textContent(".filter-status"), "No headings match");
    await page.focus("input.filter");
    await page.keyboard.press("Escape");
    assert.equal(await page.inputValue("input.filter"), "");
    assert.equal(await page.textContent(".filter-status"), "");
    // and the keys go back to reading
    assert.equal(await page.evaluate(() => document.activeElement?.matches("input.filter")), false);
  });

  await check("reading keys: j moves the page to the next heading, k back to the one before", async () => {
    const where = () =>
      page.evaluate(() => {
        const hs = [...document.querySelectorAll(".prose :is(h1, h2, h3, h4, h5, h6)[id]")].filter(
          (h) => h.offsetParent !== null,
        );
        let s = hs[0]?.parentElement;
        while (s && !(/(auto|scroll)/.test(getComputedStyle(s).overflowY) && s.scrollHeight > s.clientHeight))
          s = s.parentElement;
        const top = s ? s.getBoundingClientRect().top : 0;
        const margin = (h) => Number.parseFloat(getComputedStyle(h).scrollMarginTop) || 0;
        const at = hs.findIndex((h) => Math.abs(h.getBoundingClientRect().top - top - margin(h)) < 2);
        return { scroll: s ? s.scrollTop : window.scrollY, at };
      });
    await page.evaluate(() => document.activeElement?.blur());
    const start = await where();
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    const down = await where();
    assert.ok(down.scroll > start.scroll, `scrolled from ${start.scroll} to ${down.scroll}`);
    assert.ok(down.at >= 0, "a heading sits at the top of the page");
    await page.keyboard.press("k");
    const up = await where();
    assert.ok(up.scroll < down.scroll && up.at === down.at - 1, JSON.stringify({ down, up }));
  });

  await check("M2 filter: the query survives a re-render after an edit", async () => {
    await page.fill("input.filter", "log");
    await send(page, { type: "render", docVersion: 44, fileName: "PRODUCT.md", headings, html });
    await page.waitForTimeout(50);
    assert.equal(await page.inputValue("input.filter"), "log");
    assert.equal(await page.textContent(".filter-status"), `3 of ${headings.length} headings`);
    await page.fill("input.filter", "");
  });
  await page.close();
}

{
  const doc = engine.parse(
    "# Links\n\n[plan](docs/plan.md#setup) [web](https://example.com) [here](#links)\n\n![diagram](img/d.png) ![remote](https://evil.example/p.gif)\n",
    5,
    { resolveImage: (src) => (src === "img/d.png" ? "data:image/png;base64,iVBORw0KGgo=" : undefined) },
  );
  assert.ok(doc.ok);
  const { page } = await openPanel();
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await send(page, { type: "render", docVersion: 5, fileName: "links.md", ...doc.document });
  await page.waitForSelector(".prose a");
  await check(
    "M2 links: a relative link asks the HOST to open it (the panel never opens files itself)",
    async () => {
      await page.click('.prose a[href="docs/plan.md#setup"]');
      const sent = await page.evaluate(() => window.__sent.filter((m) => m.type === "openLink"));
      assert.deepEqual(sent.at(-1), { type: "openLink", href: "docs/plan.md#setup" });
    },
  );
  await check("M2 links: web links are not sent to the host as files", async () => {
    await page.evaluate(() => {
      window.__sent.length = 0;
      document.querySelector('.prose a[href^="https:"]').addEventListener("click", (e) => e.preventDefault());
    });
    await page.click('.prose a[href^="https:"]');
    assert.equal(await page.evaluate(() => window.__sent.filter((m) => m.type === "openLink").length), 0);
  });
  await check("M2 images: an approved local image renders; a remote one is never requested", async () => {
    assert.equal(await page.$$eval(".prose img", (imgs) => imgs.length), 1);
    assert.ok((await page.textContent(".prose")).includes("[image: remote]"));
    assert.ok(!requests.some((u) => u.includes("evil.example")), requests.join(", "));
  });
  await page.close();
}

{
  // round-2: the reader's place survives a re-render when the top of the pane is a PARAGRAPH (off-screen
  // paragraphs only have estimated sizes), when text is inserted above, and with a folded section below.
  const paragraphs = (from, n) =>
    Array.from({ length: n }, (_, i) => `Para ${from + i}: ${"lorem ".repeat(8 + ((from + i) % 5) * 6)}`);
  const docOf = (lines) => engine.parse(lines.join("\n\n"), 1).document;
  const body = [
    "# Long",
    ...paragraphs(0, 120),
    "## Middle",
    ...paragraphs(120, 120),
    "## End",
    ...paragraphs(240, 60),
  ];
  const plain = docOf(body);
  const topText = (page) =>
    page.evaluate(() => {
      const d = document.querySelector(".document").getBoundingClientRect();
      const el = document.elementFromPoint(d.left + 60, d.top + 6);
      return el?.closest(".prose > *")?.textContent.slice(0, 9) ?? "";
    });
  const { page } = await openPanel();
  await send(page, { type: "render", fileName: "long.md", ...plain, docVersion: 1 });
  await page.waitForSelector(".outline-link");
  for (const y of [1500, 4000, 9000]) {
    await check(
      `M2 re-render keeps a paragraph at the top of the pane where it was (scrolled to ${y}px)`,
      async () => {
        await page.evaluate((top) => {
          document.querySelector(".document").scrollTop = top;
        }, y);
        await page.waitForTimeout(150);
        const before = await topText(page);
        await send(page, { type: "render", fileName: "long.md", ...plain, docVersion: 2 });
        await page.waitForTimeout(400);
        assert.equal(await topText(page), before);
      },
    );
  }
  await check("M2 re-render keeps the reader's paragraph when text was inserted ABOVE it", async () => {
    await page.evaluate(() => {
      document.querySelector(".document").scrollTop = 6000;
    });
    await page.waitForTimeout(150);
    const before = await topText(page);
    const edited = docOf(["# Long", "Inserted A", "Inserted B", "Inserted C", ...body.slice(1)]);
    await send(page, { type: "render", fileName: "long.md", ...edited, docVersion: 3 });
    await page.waitForTimeout(400);
    assert.equal(await topText(page), before);
  });
  await check("M2 re-render keeps the place with a folded section below the reader", async () => {
    const endId = plain.headings.find((h) => h.text === "End").id;
    await send(page, { type: "render", fileName: "long.md", ...plain, docVersion: 4 });
    await page.waitForTimeout(200);
    const hasTwisty = await page.$(`.outline-row[data-id="${endId}"] .twisty`);
    if (!hasTwisty) {
      // "End" has no child headings; fold "Middle" instead, which is below the reader at 400px
    }
    const middleId = plain.headings.find((h) => h.text === "Middle").id;
    await page.evaluate((id) => {
      document.querySelector(".document").scrollTop = 400;
      void id;
    }, middleId);
    await page.waitForTimeout(150);
    const before = await topText(page);
    const midRow = await page.$(`.outline-row[data-id="${middleId}"] .twisty`);
    if (midRow) await midRow.click();
    await send(page, { type: "render", fileName: "long.md", ...plain, docVersion: 5 });
    await page.waitForTimeout(400);
    assert.equal(await topText(page), before);
  });
  await check("M2 two re-renders two frames apart do not move 'you are here'", async () => {
    const mid = plain.headings.find((h) => h.text === "Middle");
    await send(page, { type: "editorScrolled", docVersion: 5, topLine: mid.line });
    await page.waitForFunction(
      (id) => document.querySelector(".outline-row[data-current]")?.dataset.id === id,
      mid.id,
    );
    for (let run = 0; run < 5; run++) {
      await page.evaluate(
        (m) => {
          window.postMessage(m, "*");
          requestAnimationFrame(() => requestAnimationFrame(() => window.postMessage(m, "*")));
        },
        { type: "render", fileName: "long.md", ...plain, docVersion: 5 },
      );
      await page.waitForTimeout(300);
      const cur = await page.evaluate(() => document.querySelector(".outline-row[data-current]")?.dataset.id);
      assert.equal(cur, mid.id, `run ${run}: current moved to ${cur}`);
    }
  });
  await check(
    "M2 a restore still settling after an earlier one ends does not move 'you are here'",
    async () => {
      // render A, then B two frames later; the layout above the reader keeps shifting while B settles, so B keeps
      // scrolling after A has finished — those scrolls are the panel's, not the reader's
      const mid = plain.headings.find((h) => h.text === "Middle");
      await send(page, { type: "editorScrolled", docVersion: 5, topLine: mid.line });
      await page.waitForFunction(
        (id) => document.querySelector(".outline-row[data-current]")?.dataset.id === id,
        mid.id,
      );
      await page.evaluate(() => {
        document.querySelector(".document").scrollTop = 3000; // inside "Long", not "Middle"
      });
      await page.waitForTimeout(150);
      await send(page, { type: "editorScrolled", docVersion: 5, topLine: mid.line });
      await page.waitForFunction(
        (id) => document.querySelector(".outline-row[data-current]")?.dataset.id === id,
        mid.id,
      );
      await page.evaluate(
        (m) => {
          window.postMessage(m, "*");
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              window.postMessage(m, "*");
              let n = 0;
              const grow = () => {
                const first = document.querySelector(".prose > p");
                if (first) first.style.marginTop = `${(n + 1) * 7}px`;
                if (++n < 3) requestAnimationFrame(grow); // only while B is still settling
              };
              requestAnimationFrame(grow);
            }),
          );
        },
        { type: "render", fileName: "long.md", ...plain, docVersion: 5 },
      );
      await page.waitForTimeout(500);
      const cur = await page.evaluate(() => document.querySelector(".outline-row[data-current]")?.dataset.id);
      assert.equal(cur, mid.id, `current moved to ${cur}`);
    },
  );
  await check(
    "M2 re-render with the layout above still shifting settles back onto the reader's paragraph",
    async () => {
      await page.evaluate(() => {
        document.querySelector(".document").scrollTop = 5000;
      });
      await page.waitForTimeout(150);
      const before = await topText(page);
      await page.evaluate(
        (m) => {
          window.postMessage(m, "*");
          let n = 0;
          const grow = () => {
            const first = document.querySelector(".prose > p");
            if (first) first.style.marginTop = `${(n + 1) * 40}px`;
            if (++n < 4) requestAnimationFrame(grow);
          };
          requestAnimationFrame(() => requestAnimationFrame(grow));
        },
        { type: "render", fileName: "long.md", ...plain, docVersion: 6 },
      );
      await page.waitForTimeout(500);
      assert.equal(await topText(page), before);
    },
  );
  await page.close();
}

{
  // round-1 review fixes: the reader's place survives an edit; clicks into folded sections land
  const { page } = await openPanel();
  await send(page, { type: "render", docVersion: 50, fileName: "PRODUCT.md", headings, html });
  await page.waitForSelector(".outline-link");
  await check("M2 re-render does not move 'you are here' away from where the editor put it", async () => {
    const target = headings[5];
    await send(page, { type: "editorScrolled", docVersion: 50, topLine: target.line });
    await page.waitForFunction(
      (id) => document.querySelector(".outline-row[data-current]")?.dataset.id === id,
      target.id,
    );
    await send(page, { type: "render", docVersion: 50, fileName: "PRODUCT.md", headings, html });
    await page.waitForTimeout(150);
    const cur = await page.evaluate(() => document.querySelector(".outline-row[data-current]")?.dataset.id);
    assert.equal(cur, target.id);
  });

  await check("M2 clicking a filter match inside a folded section unfolds it and scrolls there", async () => {
    const validation = headings.find((h) => h.text.startsWith("Validation"));
    const entry = headings.find((h) => h.text.startsWith("Entry 2"));
    if (
      (await page.$eval(`.outline-row[data-id="${validation.id}"] .twisty`, (b) =>
        b.getAttribute("aria-expanded"),
      )) === "true"
    ) {
      await page.click(`.outline-row[data-id="${validation.id}"] .twisty`);
    }
    await page.fill("input.filter", "entry 2");
    await page.click(`.outline-row[data-id="${entry.id}"] .outline-link`);
    await page.waitForTimeout(100);
    const state = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const d = document.querySelector(".document").getBoundingClientRect().top;
      return { visible: el.offsetParent !== null, offset: Math.round(el.getBoundingClientRect().top - d) };
    }, entry.id);
    assert.ok(state.visible, "the heading is still hidden by the fold");
    assert.ok(Math.abs(state.offset) <= 40, `heading is ${state.offset}px from the top`);
    await page.fill("input.filter", "");
  });
  await page.close();
}

{
  const nested = engine.parse(
    "## A\n\n### A1\n\ntext a1\n\n> ## B\n> quoted\n\n### B1\n\ntext b1\n\n## C\n\ntext c\n",
    1,
  );
  assert.ok(nested.ok);
  const [a, a1, b, b1, c] = nested.document.headings;
  const { page } = await openPanel();
  await send(page, { type: "render", docVersion: 1, fileName: "nested.md", ...nested.document });
  await page.waitForSelector(".outline-link");
  const shown = () =>
    page.evaluate(
      (ids) => ids.map((id) => document.getElementById(id).offsetParent !== null),
      [a.id, a1.id, b.id, b1.id, c.id],
    );
  await check(
    "M2 folding stops at a heading nested in a quote (its row and its text stay in step)",
    async () => {
      await page.click(`.outline-row[data-id="${a.id}"] .twisty`);
      assert.deepEqual(await shown(), [true, false, true, true, true]);
      await page.click(`.outline-row[data-id="${a.id}"] .twisty`);
    },
  );
  await check(
    "M2 a list holding a folded heading and a later higher heading: the later section stays open",
    async () => {
      const mixed = engine.parse(
        "# Top\n\n- ### B\n  #### B1\n- ## C\n\nC body para\n\n#### D\n\nD body\n\n## E\n",
        2,
      );
      assert.ok(mixed.ok);
      await send(page, { type: "render", fileName: "mixed.md", ...mixed.document, docVersion: 2 });
      await page.waitForSelector(".outline-link");
      const b = mixed.document.headings.find((h) => h.text === "B");
      await page.click(`.outline-row[data-id="${b.id}"] .twisty`);
      const shown = await page.evaluate(() => {
        const p = [...document.querySelectorAll(".prose > p")].find((x) => x.textContent === "C body para");
        return { cBody: p?.offsetParent !== null, d: document.getElementById("d")?.offsetParent !== null };
      });
      assert.deepEqual(shown, { cBody: true, d: true });
      await page.click(`.outline-row[data-id="${b.id}"] .twisty`); // folds are remembered by id: leave none behind
      await send(page, { type: "render", fileName: "nested.md", ...nested.document, docVersion: 1 });
      await page.waitForSelector(".outline-link");
    },
  );
  await check("M2 folding a heading that sits inside a quote folds what follows the quote", async () => {
    await page.click(`.outline-row[data-id="${b.id}"] .twisty`);
    assert.deepEqual(await shown(), [true, true, true, false, true]);
  });
  await page.close();
}

{
  // the #Vision guardrail: a 1 MB file shows its outline in under 1 s (engine parse + panel drawing)
  let big = "";
  while (Buffer.byteLength(big) < 1024 * 1024) big += product;
  const { page } = await openPanel();
  const t0 = performance.now();
  const parsedBig = engine.parse(big, 9);
  const parseMs = performance.now() - t0;
  assert.ok(parsedBig.ok);
  const drawMs = await page.evaluate(
    (message) => {
      const start = performance.now();
      window.postMessage(message, "*");
      return new Promise((resolve) => {
        const tick = () => {
          if (document.querySelectorAll(".outline-row").length === message.headings.length) {
            resolve(performance.now() - start);
          } else requestAnimationFrame(tick);
        };
        tick();
      });
    },
    {
      type: "render",
      docVersion: 9,
      fileName: "big.md",
      headings: parsedBig.document.headings,
      html: parsedBig.document.html,
    },
  );
  const total = parseMs + drawMs;
  console.log(
    `    1 MB (${Buffer.byteLength(big)} bytes, ${parsedBig.document.headings.length} headings): parse ${Math.round(parseMs)} ms + draw ${Math.round(drawMs)} ms = ${Math.round(total)} ms`,
  );
  await check("M2 guardrail: a 1 MB Markdown file shows its outline in under 1 second", async () => {
    assert.ok(total < 1000, `took ${Math.round(total)} ms`);
  });
  // Timing alone cannot pin WHY it is fast: without off-screen layout skipping the same file measured 683–1249 ms
  // (just around the line), with it ~300 ms. So the mechanism itself is pinned too.
  await check("M2 guardrail mechanism: off-screen paragraphs skip layout; headings never do", async () => {
    const vis = await page.evaluate(() => ({
      p: getComputedStyle(document.querySelector(".prose > p")).contentVisibility,
      h: getComputedStyle(document.querySelector(".prose > h2")).contentVisibility,
    }));
    assert.deepEqual(vis, { p: "auto", h: "visible" });
  });
  await page.close();
}

{
  // a VS Code high-contrast theme: no selection background — "you are here" must still be visible
  const { page } = await openPanel();
  await page.evaluate(() => {
    const vars = {
      "--vscode-editor-background": "#000000",
      "--vscode-editor-foreground": "#ffffff",
      "--vscode-sideBar-background": "#000000",
      "--vscode-sideBar-foreground": "#ffffff",
      "--vscode-list-inactiveSelectionBackground": "transparent",
      "--vscode-list-inactiveSelectionForeground": "#ffffff",
      "--vscode-focusBorder": "#f38518",
      "--vscode-textLink-foreground": "#21a6ff",
      "--vscode-panel-border": "#6fc3df",
    };
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  });
  await send(page, { type: "render", docVersion: 42, fileName: "PRODUCT.md", headings, html });
  await page.waitForSelector(".outline-link");
  await send(page, { type: "editorScrolled", docVersion: 42, topLine: headings[3].line });
  await page.waitForSelector(".outline-row[data-current]");
  await check(
    "M2 high-contrast theme: the current section is marked by bar and weight, not colour alone",
    async () => {
      const cur = await page.$eval(".outline-row[data-current]", (row) => ({
        bg: getComputedStyle(row).backgroundColor,
        bar: getComputedStyle(row).borderLeftColor,
        weight: getComputedStyle(row.querySelector(".outline-link")).fontWeight,
        text: getComputedStyle(row).color,
      }));
      assert.equal(cur.bg, "rgba(0, 0, 0, 0)", "HC theme gives no selection background");
      assert.equal(cur.bar, "rgb(33, 166, 255)");
      assert.equal(cur.weight, "600");
      assert.equal(cur.text, "rgb(255, 255, 255)");
    },
  );
  await page.close();
}

{
  // 0.0.4 reading quality: structure hints, section sizes, fold to level, skim, GitHub extras
  const verbose = engine.parse(readFileSync("tests/fixtures/verbose.md", "utf8"), 1, { readingTools: true });
  assert.ok(verbose.ok);
  const vh = verbose.document.headings;
  const { page } = await openPanel();
  await send(page, {
    type: "render",
    fileName: "verbose.md",
    ...verbose.document,
    docVersion: 1,
    readingTools: true,
  });
  await page.waitForSelector(".outline-link");
  const shownBlocks = () =>
    page.$$eval(
      ".prose > :not(.dm-x)", // the document's own blocks (2.0's key points strip is not one)
      (bs) => bs.filter((b) => b.offsetParent !== null || b.getClientRects().length > 0).length,
    );
  const allBlocks = await page.$$eval(".prose > :not(.dm-x)", (bs) => bs.length);

  await check("0.0.4 reading tools are OFF by default: no toolbar, no sizes, 's' does nothing", async () => {
    const plain = engine.parse(readFileSync("tests/fixtures/verbose.md", "utf8"), 1);
    await send(page, { type: "render", fileName: "verbose.md", ...plain.document, docVersion: 1 });
    await page.waitForSelector(".outline-link");
    assert.equal(
      await page.$$eval(".reading-tools", (t) => t.length),
      0,
      "toolbar shown without the setting",
    );
    assert.equal(await page.$$eval(".outline-size", (s) => s.length), 0);
    assert.equal(await page.$$eval(".outline-row.inferred", (r) => r.length), 0);
    await page.focus(".outline-link");
    await page.keyboard.press("s");
    await page.keyboard.press("1");
    assert.equal(
      await page.$$eval(".prose > [data-skim-hidden], .prose > [data-collapsed-content]", (b) => b.length),
      0,
    );
    await send(page, {
      type: "render",
      fileName: "verbose.md",
      ...verbose.document,
      docVersion: 1,
      readingTools: true,
    });
    await page.waitForSelector(".reading-tools");
  });
  await check(
    "0.0.4 structure hints: bold-only and numbered lines are in the outline, marked inferred",
    async () => {
      const rows = await page.$$eval(".outline-row", (rs) =>
        rs.map((r) => ({
          text: r.querySelector(".outline-link").textContent,
          inferred: r.classList.contains("inferred"),
        })),
      );
      assert.deepEqual(rows, [
        { text: "Quarterly Report", inferred: false },
        { text: "Executive Summary", inferred: true },
        { text: "Key Metrics:", inferred: true },
        { text: "2.1 Regional breakdown", inferred: true },
        { text: "Next Steps", inferred: true },
      ]);
      const style = await page.$eval(
        ".outline-row.inferred .outline-link",
        (a) => getComputedStyle(a).fontStyle,
      );
      assert.equal(style, "italic");
    },
  );
  await check(
    "0.0.20 section size: every row shows its reading time, with the word count and time on hover",
    async () => {
      const sizes = await page.$$eval(".outline-row .outline-size", (ss) =>
        ss.map((s) => [s.textContent, s.title]),
      );
      assert.equal(sizes.length, vh.length);
      assert.deepEqual(sizes[0], ["1 min", `${vh[0].words} words · about 1 min`]);
    },
  );
  await check("0.0.4 fold to level 1 leaves only the top heading; 'All' brings everything back", async () => {
    await page.click('[data-fold-level]:not([data-fold-level="0"])');
    const visibleRows = await page.$$eval(
      ".outline-row",
      (rs) => rs.filter((r) => r.offsetParent !== null).length,
    );
    assert.equal(visibleRows, 1);
    assert.equal(await shownBlocks(), 1, "only the h1 itself should show in the document");
    await page.click('[data-fold-level="0"]');
    assert.equal(await shownBlocks(), allBlocks);
  });
  await check(
    "0.0.4 after 'fold to level 2', unfolding one section shows its sub-sections open, not still folded",
    async () => {
      await page.focus(".outline-link");
      await page.keyboard.press("2");
      await page.click('.outline-row[data-id="key-metrics"] .twisty');
      const subHidden = await page.$$eval(
        '.prose > [data-skim-section="21-regional-breakdown"]',
        (bs) => bs.filter((b) => b.hasAttribute("data-collapsed-content")).length,
      );
      assert.equal(subHidden, 0, "2.1 stayed folded inside the section just opened");
      await page.keyboard.press("0");
    },
  );
  await check("0.0.4 fold keys: '2' folds to the second level, '0' unfolds", async () => {
    await page.focus(".outline-link");
    await page.keyboard.press("2");
    const folded = await page.$$eval(".outline-row .twisty[aria-expanded=false]", (t) => t.length);
    assert.ok(folded >= 1, "no section folded");
    assert.ok((await shownBlocks()) < allBlocks);
    await page.keyboard.press("0");
    assert.equal(await shownBlocks(), allBlocks);
  });
  await check(
    "0.0.4 skim: each section keeps its heading and first block; the lead says how much is hidden",
    async () => {
      await page.click(".skim-toggle");
      assert.equal(await page.getAttribute(".skim-toggle", "aria-pressed"), "true");
      const summary = await page.evaluate(() => {
        const heading = document.getElementById("executive-summary");
        const after = [];
        for (let b = heading.nextElementSibling; b && !/^H\d$/.test(b.tagName); b = b.nextElementSibling) {
          after.push({ hidden: b.hasAttribute("data-skim-hidden"), lead: b.getAttribute("data-skim-lead") });
        }
        return after;
      });
      assert.equal(summary.length, 3);
      assert.equal(summary[0].hidden, false);
      assert.match(summary[0].lead ?? "", /^\+ 2 more blocks — click to read$/);
      assert.deepEqual(
        summary.slice(1).map((b) => b.hidden),
        [true, true],
      );
    },
  );
  await check("0.0.4 skim: clicking a section's lead opens that section only", async () => {
    await page.click("#executive-summary + p");
    await page.waitForTimeout(350); // a single click opens after the double-click window
    const hiddenUnder = await page.evaluate(
      () =>
        [...document.querySelectorAll('.prose > [data-skim-section="executive-summary"][data-skim-hidden]')]
          .length,
    );
    assert.equal(hiddenUnder, 0);
    const stillSkimmed = await page.$$eval(".prose > [data-skim-hidden]", (b) => b.length);
    assert.ok(stillSkimmed > 0, "other sections should stay skimmed");
  });
  await check("0.0.4 skim: clicking a heading in the outline opens that section in full", async () => {
    const id = "21-regional-breakdown";
    const before = await page.$$eval(
      `.prose > [data-skim-section="${id}"][data-skim-hidden]`,
      (b) => b.length,
    );
    assert.ok(before > 0, "precondition: the section should be skimmed");
    await page.click(`.outline-row[data-id="${id}"] .outline-link`);
    const after = await page.$$eval(
      `.prose > [data-skim-section="${id}"][data-skim-hidden]`,
      (b) => b.length,
    );
    assert.equal(after, 0);
  });
  await check(
    "0.0.4 skim: a footnote link into a skimmed-away block opens it and scrolls there",
    async () => {
      await page.click(".footnote-ref a");
      await page.waitForTimeout(150);
      const note = await page.evaluate(() => {
        const li = document.getElementById("fn-d:-1");
        const d = document.querySelector(".document").getBoundingClientRect();
        const r = li.getBoundingClientRect();
        return { shown: li.getClientRects().length > 0, inPane: r.top >= d.top && r.bottom <= d.bottom };
      });
      assert.ok(note.shown, "footnote still hidden");
      assert.ok(note.inPane, "footnote not scrolled into the pane"); // a short doc cannot put it at the very top
    },
  );
  await check("0.0.4 skim: finishing a text selection on a lead does not open the section", async () => {
    // fresh skim state: off (if on), then on — no section opened by the checks above
    if ((await page.getAttribute(".skim-toggle", "aria-pressed")) === "true")
      await page.click(".skim-toggle");
    await page.click(".skim-toggle");
    // what a drag-select leaves behind: a real (non-collapsed) selection when the click arrives
    await page.$eval("#executive-summary + p", (p) => {
      p.scrollIntoView({ block: "center" });
      const range = document.createRange();
      range.selectNodeContents(p.firstChild);
      document.getSelection().removeAllRanges();
      document.getSelection().addRange(range);
      p.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    await page.waitForTimeout(350);
    const stillSkimmed = await page.$$eval(
      '.prose > [data-skim-section="executive-summary"][data-skim-hidden]',
      (b) => b.length,
    );
    assert.ok(stillSkimmed > 0, "a text selection opened the section");
    await page.evaluate(() => document.getSelection().removeAllRanges()); // skim stays on for the checks below
  });
  await check(
    "0.0.4 skim: double-clicking a word in a lead selects it, without opening the section",
    async () => {
      // fresh skim state, then a real double-click on the lead
      await page.click(".skim-toggle");
      await page.click(".skim-toggle");
      await page.$eval("#executive-summary + p", (p) => p.scrollIntoView({ block: "center" }));
      await page.dblclick("#executive-summary + p");
      await page.waitForTimeout(350);
      const hidden = await page.$$eval(
        '.prose > [data-skim-section="executive-summary"][data-skim-hidden]',
        (b) => b.length,
      );
      assert.ok(hidden > 0, "the double-click opened the section");
      await page.evaluate(() => document.getSelection().removeAllRanges());
    },
  );
  await check("0.0.4 keys: a held-down 's' (key repeat) does not flicker skim", async () => {
    await page.focus(".outline-link");
    await page.evaluate(() =>
      document.activeElement.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", repeat: true, bubbles: true }),
      ),
    );
    assert.equal(await page.getAttribute(".skim-toggle", "aria-pressed"), "true");
  });
  await check("0.0.4 a footnote link into a FOLDED section unfolds it and shows the note", async () => {
    await page.focus(".outline-link");
    await page.keyboard.press("2"); // folds every h2 section, "Next Steps" (holding the notes) included
    await page.click('.outline-row[data-id="key-metrics"] .twisty'); // reopen the section with the reference
    await page.click(".footnote-ref a");
    await page.waitForTimeout(150);
    const shown = await page.$eval('[id="fn-d:-1"]', (li) => li.getClientRects().length > 0);
    assert.ok(shown, "the note stayed folded away");
    await page.keyboard.press("0");
  });
  await check("0.0.4 skim: 's' turns it off again and every block is back", async () => {
    await page.focus(".outline-link");
    await page.keyboard.press("s");
    assert.equal(await page.getAttribute(".skim-toggle", "aria-pressed"), "false");
    assert.equal(await shownBlocks(), allBlocks);
  });
  await check("0.0.4 skim and folds survive a re-render after an edit", async () => {
    await page.click(".skim-toggle");
    await send(page, {
      type: "render",
      fileName: "verbose.md",
      ...verbose.document,
      docVersion: 2,
      readingTools: true,
    });
    await page.waitForSelector(".outline-link");
    assert.equal(await page.getAttribute(".skim-toggle", "aria-pressed"), "true");
    assert.ok((await page.$$eval(".prose > [data-skim-hidden]", (b) => b.length)) > 0);
    await page.click(".skim-toggle");
  });
  await check(
    "0.0.4 GitHub extras: task checkboxes (tickable in the panel since 3.0), titled callouts in their own colours",
    async () => {
      const boxes = await page.$$eval(".task-checkbox", (bs) => bs.map((b) => [b.disabled, b.checked]));
      assert.deepEqual(boxes, [
        [false, true],
        [false, false],
      ]);
      const callouts = await page.$$eval(".callout", (cs) =>
        cs.map((c) => [c.querySelector(".callout-title").textContent, getComputedStyle(c).borderLeftColor]),
      );
      assert.deepEqual(
        callouts.map((c) => c[0]),
        ["Warning", "Note"],
      );
      assert.notEqual(
        callouts[0][1],
        callouts[1][1],
        "warning and note should differ (the title says it too)",
      );
    },
  );
  await check("0.0.4 skim: a section opening with a code block carries its hint on the heading", async () => {
    const code = engine.parse("# A\n\n```\ncode\n```\n\npara one\n\npara two\n", 3, { readingTools: true });
    await send(page, {
      type: "render",
      fileName: "c.md",
      ...code.document,
      docVersion: 3,
      readingTools: true,
    });
    await page.waitForSelector(".outline-link");
    if ((await page.getAttribute(".skim-toggle", "aria-pressed")) !== "true")
      await page.click(".skim-toggle");
    const lead = await page.$eval("#a", (h) => h.getAttribute("data-skim-lead"));
    assert.equal(lead, "+ 2 more blocks — click to read");
    assert.equal(await page.$eval(".prose pre", (p) => p.hasAttribute("data-skim-lead")), false);
  });
  await check("0.0.4 skim with no headings left (after an edit) shows the whole document", async () => {
    const none = engine.parse("one\n\ntwo\n\nthree\n", 4, { readingTools: true });
    await send(page, {
      type: "render",
      fileName: "n.md",
      ...none.document,
      docVersion: 4,
      readingTools: true,
    });
    await page.waitForSelector(".prose p");
    assert.equal(await page.$$eval(".prose > [data-skim-hidden]", (b) => b.length), 0);
  });
  await page.close();
}

{
  // M3: the browser snapshot — the REAL page docmap writes (snapshotHtml + dist bundle), opened from disk
  const fixtures = resolve("tests/fixtures");
  const pixel = pathToFileURL(join(fixtures, "pixel.png")).href;
  const source = [
    readFileSync(join(fixtures, "product.md"), "utf8"),
    '## </script><img src=x onerror="window.__pwned=1">',
    "Text with </script><script>window.__pwned=2</script> and <!-- a comment -->.",
    "![a local image](pixel.png) ![a remote one](https://example.invalid/x.png)",
    "[another file](linked.md) · [a network path](//host.example/share/x.md) · [the web](https://example.invalid/) · [🌐](linked.md#open-in-browser)",
  ].join("\n\n");
  const parsed = engine.parse(source, 3, {
    resolveImage: (src) => (src === "pixel.png" ? pixel : undefined),
  });
  assert.ok(parsed.ok);
  const read = (f) => readFileSync(join("dist", f), "utf8");
  const snapFile = join(mkdtempSync(join(tmpdir(), "docmap-snap-")), "product-abc.html");
  writeFileSync(
    snapFile,
    snapshotHtml({
      nonce: "snapnonce",
      title: "product.md — docmap snapshot",
      tokensCss: read("tokens.css"),
      stylesCss: read("styles.css"),
      script: read("webview.js"),
      render: { type: "render", fileName: "product.md", ...parsed.document, docVersion: 3 },
    }),
  );
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const violations = [];
  const requests = [];
  const dialogs = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  page.on("request", (r) => requests.push(r.url()));
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__violations = [...(window.__violations ?? []), `${e.violatedDirective} ${e.blockedURI}`];
    });
  });
  await page.goto(pathToFileURL(snapFile).href);
  await page.waitForSelector(".outline-link");

  await check("M3 snapshot: opened from disk, it shows every heading of the document", async () => {
    const count = await page.$$eval(".outline-link", (l) => l.length);
    assert.equal(count, parsed.document.headings.length);
  });
  await check("M3 snapshot: clicking a heading scrolls the document to it (no host needed)", async () => {
    const target = parsed.document.headings.find((h) => h.text.startsWith("Scope"));
    await page.click(`.outline-row[data-id="${target.id}"] .outline-link`);
    await page.waitForTimeout(200);
    const top = await page.evaluate((id) => {
      const d = document.querySelector(".document").getBoundingClientRect().top;
      return Math.round(document.getElementById(id).getBoundingClientRect().top - d);
    }, target.id);
    assert.ok(Math.abs(top) < 40, `heading is ${top}px from the top of the pane`);
  });
  await check("M3 snapshot: the filter works in the browser", async () => {
    await page.keyboard.press("/");
    await page.keyboard.type("scope");
    await page.waitForTimeout(100);
    const shown = await page.$$eval(".outline-row:not([hidden])", (r) => r.length);
    assert.ok(shown >= 1 && shown < parsed.document.headings.length, `${shown} rows shown`);
    await page.keyboard.press("Escape");
  });
  await check("M3 snapshot: document text that looks like HTML or a script end stays text", async () => {
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.deepEqual(dialogs, []);
    const shown = await page.$$eval(".outline-link", (l) => l.map((a) => a.textContent));
    // "</script>" stays text; the <img> after it is drawn under the 0.0.12 picture rules: no handler survives
    assert.ok(shown.some((t) => t.includes("</script>")));
    assert.equal(await page.$$eval("[onerror]", (e) => e.length), 0);
  });
  await check(
    "M3 snapshot: the approved local image loads; nothing is fetched from the network",
    async () => {
      const width = await page.$eval('img[alt="a local image"]', (i) => i.naturalWidth);
      assert.ok(width > 0, "local image did not load");
      assert.deepEqual(
        requests.filter((u) => !u.startsWith("file:") && !u.startsWith("data:")),
        [],
      );
    },
  );
  await check(
    "M3 snapshot: the strict CSP holds with no violations (styles and script run by nonce)",
    async () => {
      assert.deepEqual(await page.evaluate(() => window.__violations ?? []), []);
      assert.deepEqual(violations, []);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.notEqual(bg, "rgba(0, 0, 0, 0)", "styles did not apply");
    },
  );
  await check(
    "owner report 2026-11-24: in the browser, no 🌐 'open in browser' link (it can do nothing there) and no underline on inert links",
    async () => {
      assert.equal(
        await page.$('.prose a[data-href$="#open-in-browser"]'),
        null,
        "the 🌐 link is still on the page",
      );
      assert.doesNotMatch(await page.textContent(".prose"), /🌐/);
      const line = await page.$eval(
        '.prose a[data-href="linked.md"]',
        (a) => getComputedStyle(a).textDecorationLine,
      );
      assert.equal(line, "none");
    },
  );
  await check("M3 snapshot: a link to another file does nothing in the browser, and says so", async () => {
    const before = page.url();
    const pagesBefore = page.context().pages().length;
    const link = await page.$('.prose a[data-href="linked.md"]');
    assert.ok(link, "relative link not rendered");
    assert.equal(await link.getAttribute("href"), null, "an inert link keeps no href to follow or drag");
    assert.match((await link.getAttribute("title")) ?? "", /open in VS Code/);
    await link.click();
    await link.click({ button: "middle" });
    await link.click({ modifiers: ["Control"] });
    await page.waitForTimeout(200);
    assert.equal(page.url(), before);
    assert.equal(page.context().pages().length, pagesBefore, "a new tab opened");
  });
  await check("M3 snapshot: a network-path link (//host/…) is never a link at all", async () => {
    // count, not an element handle: a failing assert must not try to print a whole browser object
    const networkLinks = await page.$$eval(
      ".prose a[href]",
      (links) => links.filter((a) => /^[\\/]{2}/.test(a.getAttribute("href") ?? "")).length,
    );
    assert.equal(networkLinks, 0);
    assert.ok((await page.textContent(".prose")).includes("a network path"));
  });
  await check(
    "M3 snapshot: a message from another window is ignored (its only host is its boot script)",
    async () => {
      await page.evaluate(() => {
        const fake = {
          type: "render",
          docVersion: 99,
          fileName: "fake.md",
          headings: [],
          html: "<p>spoofed</p>",
        };
        window.dispatchEvent(new MessageEvent("message", { data: fake, source: null }));
      });
      await page.waitForTimeout(100);
      assert.ok(!(await page.textContent(".prose")).includes("spoofed"));
    },
  );
  await check(
    "M3 snapshot: follows the system's dark mode (no VS Code theme outside the editor)",
    async () => {
      const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await page.emulateMedia({ colorScheme: "dark" });
      const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.notEqual(light, dark);
      await page.emulateMedia({ colorScheme: "light" });
    },
  );
  await page.close();
}

// 0.0.8 safe HTML tags: <details>, <kbd> … render; a click on a heading inside a closed <details> opens it
{
  const { page } = await openPanel();
  const text = [
    "# Guide",
    "",
    "Press <kbd>Ctrl</kbd>+<kbd>F</kbd>.",
    "",
    "<details>",
    "<summary>Advanced</summary>",
    "",
    "## Hidden section",
    "",
    "Only visible when open.",
    "",
    "</details>",
    "",
    "<script>alert(1)</script>",
  ].join("\n");
  const doc = engine.parse(text, 1);
  assert.ok(doc.ok);
  await send(page, { type: "render", docVersion: 1, fileName: "html.md", ...doc.document });
  await page.waitForSelector(".outline-link");

  await check("0.0.8 safe HTML: <kbd> and a closed <details> render; <script> stays text", async () => {
    const result = await page.evaluate(() => ({
      kbd: document.querySelectorAll(".prose kbd").length,
      details: document.querySelector(".prose details")?.open,
      summary: document.querySelector(".prose summary")?.textContent,
      scripts: document.querySelectorAll(".prose script").length,
      shown: document.querySelector(".prose").textContent.includes("<script>alert(1)</script>"),
      executed: window.__xss === true,
    }));
    assert.deepEqual(result, {
      kbd: 2,
      details: false,
      summary: "Advanced",
      scripts: 0,
      shown: true,
      executed: false,
    });
  });

  await check(
    "0.0.8 safe HTML: clicking a heading inside a closed <details> opens it and shows the heading",
    async () => {
      await page.click('.outline-link[href="#hidden-section"]');
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => {
        const heading = document.getElementById("hidden-section");
        const pane = document.querySelector(".document").getBoundingClientRect();
        const box = heading.getBoundingClientRect();
        return {
          open: document.querySelector(".prose details").open,
          visible: box.height > 0 && box.top >= pane.top - 1 && box.top < pane.bottom,
        };
      });
      assert.deepEqual(result, { open: true, visible: true });
    },
  );
  await page.close();
}

// 0.0.8 Mermaid diagrams: drawn by the library, loaded only when a document has one; labels stay text
{
  const diagramsPage = join(mkdtempSync(join(tmpdir(), "docmap-diagrams-")), "panel.html");
  writeFileSync(
    diagramsPage,
    panelHtml({
      cspSource: "file:",
      nonce: "browsertest",
      title: "Map: diagrams",
      tokensCss: `${dist}/tokens.css`,
      stylesCss: `${dist}/styles.css`,
      script: `${dist}/webview.js`,
      diagrams: `${dist}/mermaid.js`,
    }),
  );
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.__sent = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__sent.push(m) });
  });
  await page.goto(pathToFileURL(diagramsPage).href);
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "ready"));
  const renderDoc = async (text, version) => {
    const r = engine.parse(text, version);
    assert.ok(r.ok);
    await send(page, { type: "render", fileName: "d.md", ...r.document });
  };

  await check("0.0.8 diagrams: a document without a diagram never loads the library", async () => {
    await renderDoc("# Plain\n\n```js\nx\n```\n", 1);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelectorAll('script[src*="mermaid"]').length), 0);
  });

  await check(
    "0.0.8 diagrams: a ```mermaid block is drawn as an SVG (library loaded on demand)",
    async () => {
      await renderDoc("# Flow\n\n```mermaid\ngraph TD\n  A[Start] --> B[End]\n```\n", 2);
      await page.waitForSelector("pre.mermaid-diagram svg", { timeout: 15000 });
      const text = await page.textContent("pre.mermaid-diagram");
      assert.ok(text.includes("Start") && text.includes("End"), text);
    },
  );

  await check(
    "0.0.8 diagrams: a hostile label stays text (strict mode) and a broken diagram stays code",
    async () => {
      await renderDoc(
        [
          "# Hostile",
          "",
          "```mermaid",
          'graph TD\n  A["<img src=x onerror=window.__xss=1>"] --> B["<script>window.__xss=2</script>"]\n  click A href "javascript:window.__xss=3"\n  click B callback',
          "```",
          "",
          "```mermaid",
          "this is not a diagram ((",
          "```",
        ].join("\n"),
        3,
      );
      await page.waitForFunction(
        () => document.querySelectorAll("pre.mermaid-diagram, pre[data-diagram-error]").length === 2,
        null,
        { timeout: 15000 },
      );
      const result = await page.evaluate(() => ({
        xss: window.__xss ?? null,
        handlers: document.querySelectorAll(
          '.prose [onerror], .prose [onclick], .prose script, .prose [*|href^="javascript"]',
        ).length,
        broken: document.querySelector("pre[data-diagram-error] code")?.textContent,
      }));
      assert.deepEqual(result, { xss: null, handlers: 0, broken: "this is not a diagram ((\n" });
      assert.deepEqual(errors, []);
    },
  );

  await check(
    "#56 diagrams: offscreen Mermaid diagrams lazy-render only when scrolled near the viewport",
    async () => {
      const spacer = Array.from(
        { length: 120 },
        (_, i) => `Paragraph ${i + 1} filler text for scrolling.`,
      ).join("\n\n");
      await renderDoc(
        `# Top\n\n\`\`\`mermaid\ngraph TD\n  TopA --> TopB\n\`\`\`\n\n${spacer}\n\n## Bottom\n\n\`\`\`mermaid\ngraph TD\n  FarA --> FarB\n\`\`\`\n`,
        4,
      );
      await page.waitForSelector("pre.mermaid-diagram svg", { timeout: 15000 });
      await page.waitForTimeout(250);
      const beforeScroll = await page.evaluate(() => ({
        rendered: document.querySelectorAll("pre.mermaid-diagram svg").length,
        pending: document.querySelectorAll("pre > code.language-mermaid").length,
      }));
      assert.deepEqual(beforeScroll, { rendered: 1, pending: 1 });
      await page.evaluate(() => {
        const doc = document.querySelector(".document");
        if (doc) doc.scrollTop = doc.scrollHeight;
      });
      await page.waitForFunction(
        () => document.querySelectorAll("pre.mermaid-diagram svg").length === 2,
        null,
        { timeout: 15000 },
      );
      assert.deepEqual(errors, []);
    },
  );
  await page.close();

  await check("0.0.8 diagrams: the browser snapshot carries the library and draws offline", async () => {
    const r = engine.parse("# Snap\n\n```mermaid\ngraph LR\n  X --> Y\n```\n", 1);
    assert.ok(r.ok);
    const file = join(mkdtempSync(join(tmpdir(), "docmap-snap-")), "snap.html");
    writeFileSync(
      file,
      snapshotHtml({
        nonce: "snap",
        title: "snap",
        tokensCss: readFileSync("dist/tokens.css", "utf8"),
        stylesCss: readFileSync("dist/styles.css", "utf8"),
        script: readFileSync("dist/webview.js", "utf8"),
        render: { type: "render", fileName: "snap.md", ...r.document },
        diagrams: readFileSync("dist/mermaid.js", "utf8"),
      }),
    );
    const snap = await browser.newPage();
    const requests = [];
    snap.on("request", (q) => {
      if (!q.url().startsWith("file:") && !q.url().startsWith("data:")) requests.push(q.url());
    });
    await snap.goto(pathToFileURL(file).href);
    await snap.waitForSelector("pre.mermaid-diagram svg", { timeout: 15000 });
    assert.deepEqual(requests, []);
    await snap.close();
  });
}

{
  // 0.0.12: a README's <picture> — the version drawn follows VS Code's theme, not the computer's
  const svg = (fill) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${fill}"/></svg>`)}`;
  const urls = { "arch-dark.svg": svg("black"), "arch-light.svg": svg("white") };
  const r = engine.parse(
    '# Pictures\n\n[Jump](#how-it-works)\n\n<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="arch-dark.svg">\n' +
      '  <img alt="Diagram" src="arch-light.svg">\n</picture>\n\n' +
      `${"Filler paragraph.\n\n".repeat(80)}<a id="how-it-works"></a>\n\n## Target\n\n${"More text.\n\n".repeat(80)}`,
    1,
    { resolveImage: (src) => urls[src] },
  );
  assert.ok(r.ok);
  const { page } = await openPanel();
  await send(page, { type: "render", fileName: "pictures.md", ...r.document });
  await page.waitForSelector(".prose picture img");
  const drawn = () =>
    page
      .waitForFunction(() => document.querySelector(".prose picture img")?.complete)
      .then(() => page.$eval(".prose picture img", (img) => img.currentSrc));

  await check(
    "0.0.12 pictures: a dark VS Code theme on a light computer draws the dark version",
    async () => {
      await page.emulateMedia({ colorScheme: "light" });
      await page.evaluate(() => document.body.classList.add("vscode-dark"));
      await page.waitForFunction(() => document.querySelector(".prose picture source")?.media === "all");
      assert.equal(await drawn(), urls["arch-dark.svg"]);
    },
  );

  await check(
    "0.0.12 pictures: switching to a light VS Code theme (computer dark) draws the light version",
    async () => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.evaluate(() => document.body.classList.replace("vscode-dark", "vscode-light"));
      await page.waitForFunction(() => document.querySelector(".prose picture source")?.media === "not all");
      assert.equal(await drawn(), urls["arch-light.svg"]);
      await page.emulateMedia({ colorScheme: null });
    },
  );

  await check("0.0.12 anchors: a link to an <a id> jump target scrolls the map there", async () => {
    await page.click('.prose a[href="#how-it-works"]');
    await page.waitForFunction(() => {
      const target = document.querySelector('.prose [id="how-it-works"]');
      const top = target?.getBoundingClientRect().top ?? 9999;
      return top >= -2 && top < 100;
    });
  });
  await page.close();
}

{
  // 0.0.13: the browser snapshot with a linked page — a link between them opens the other page, at the heading
  const dir = mkdtempSync(join(tmpdir(), "docmap-linked-"));
  const pageOf = (name, markdown, links) => {
    const r = engine.parse(markdown, 1);
    assert.ok(r.ok);
    const file = join(dir, `${name}.html`);
    writeFileSync(
      file,
      snapshotHtml({
        nonce: `n${name}`,
        title: name,
        tokensCss: readFileSync("dist/tokens.css", "utf8"),
        stylesCss: readFileSync("dist/styles.css", "utf8"),
        script: readFileSync("dist/webview.js", "utf8"),
        render: { type: "render", fileName: `${name}.md`, ...r.document },
        links,
      }),
    );
    return pathToFileURL(file).href;
  };
  const second = pageOf(
    "second",
    `# Second\n\n${"Filler.\n\n".repeat(80)}## Part two\n\n${"More.\n\n".repeat(80)}`,
    {},
  );
  const first = pageOf("first", "# First\n\n[to part two](second.md#part-two) · [not written](third.md)\n", {
    "second.md#part-two": `${second}#part-two`,
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  await page.goto(first);
  await page.waitForSelector(".prose a");

  await check(
    "0.0.13 snapshot: a link to a linked page is a real link; one to a file not written stays inert",
    async () => {
      assert.equal(await page.getAttribute(".prose a[data-page]", "href"), `${second}#part-two`);
      assert.equal(await page.getAttribute('.prose a[data-href="third.md"]', "href"), null);
    },
  );

  await check("0.0.13 snapshot: clicking it opens the linked page at the linked heading", async () => {
    await page.click(".prose a[data-page]");
    await page.waitForURL(/second\.html#part-two$/);
    await page.waitForFunction(() => {
      const h = document.querySelector('.prose [id="part-two"]');
      const top = h?.getBoundingClientRect().top ?? 9999;
      return top >= -2 && top < 100;
    });
  });
  await page.close();
}

{
  // 0.0.14 (owner report): a table with a long path in a cell stayed wider than the text and pushed the page sideways
  const long = "templates/.github/ISSUE_TEMPLATE/feature_request_with_acceptance_criteria.md";
  const r = engine.parse(
    `# Forms\n\n| Form | File | Who | What |\n| --- | --- | --- | --- |\n| **Spine** | \`templates/PRODUCT.md\` | Every phase | ${"Vision, scope and plan. ".repeat(6)}|\n| **Ticket** | \`${long}\` | /plan | ${"The goal and the exact files. ".repeat(6)}|\n`,
    1,
  );
  assert.ok(r.ok);
  const { page } = await openPanel();
  await page.setViewportSize({ width: 1400, height: 800 });
  await send(page, { type: "render", fileName: "forms.md", ...r.document });
  await page.waitForSelector(".prose table");
  await check(
    "0.0.14 tables: a long path in a cell wraps; the table stays inside the text column",
    async () => {
      const m = await page.evaluate(() => {
        const prose = document.querySelector(".prose").getBoundingClientRect();
        const table = document.querySelector(".prose table").getBoundingClientRect();
        const page = document.scrollingElement;
        return { prose: prose.right, table: table.right, overflow: page.scrollWidth - page.clientWidth };
      });
      assert.ok(m.table <= m.prose + 1, `table ends at ${m.table}, text column at ${m.prose}`);
      assert.equal(m.overflow, 0, "the page scrolls sideways");
    },
  );
  await page.close();
}

{
  // 0.0.17: a short last section cannot scroll to the top — clicking it still marks it "you are here"
  const r = engine.parse(
    `# Guide\n\n${["One", "Two", "Three"].map((n) => `## Part ${n}\n\n${"A paragraph of text.\n\n".repeat(20)}`).join("")}## Last\n\nShort.\n`,
    1,
  );
  assert.ok(r.ok);
  const { page } = await openPanel();
  await send(page, { type: "render", fileName: "guide.md", ...r.document });
  await page.waitForSelector(".outline-link");
  const current = () =>
    page.$eval(".outline-row[data-current]", (row) => row.dataset.id).catch(() => undefined);
  await check(
    "0.0.17 you are here: clicking the short last section marks it, not the section above",
    async () => {
      await page.click('.outline-link:has-text("Last")');
      await page.waitForTimeout(300); // the scroll events of the jump
      assert.equal(await current(), "last");
    },
  );
  await check("0.0.17 you are here: scrolling it out of view hands back to the scroll position", async () => {
    await page.$eval(".document", (d) => {
      d.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    assert.equal(await current(), "guide");
  });
  await page.close();
}

{
  // 0.0.18 (owner call): on a wide monitor the document uses the width, not a narrow fixed column
  const r = engine.parse(
    `# Wide\n\n${"A long paragraph of ordinary text that should run across the page. ".repeat(12)}\n`,
    1,
  );
  assert.ok(r.ok);
  const { page } = await openPanel();
  await page.setViewportSize({ width: 1900, height: 900 });
  await send(page, { type: "render", fileName: "wide.md", ...r.document });
  await page.waitForSelector(".prose p");
  await check(
    "0.0.18 layout: on a 1900px screen the text fills most of the page beside the outline",
    async () => {
      const m = await page.evaluate(() => ({
        doc: document.querySelector(".document").getBoundingClientRect().width,
        text: document.querySelector(".prose p").getBoundingClientRect().width,
      }));
      assert.ok(m.text > m.doc * 0.8, `text ${m.text}px of ${m.doc}px`);
    },
  );
  await page.close();
}

{
  // 0.0.19 (owner call): the browser snapshot has a light / dark switch; the choice is kept
  const r = engine.parse("# Theme\n\nSome text.\n\n## Part\n\nMore text.\n", 1);
  assert.ok(r.ok);
  const file = join(mkdtempSync(join(tmpdir(), "docmap-theme-")), "theme.html");
  writeFileSync(
    file,
    snapshotHtml({
      nonce: "theme",
      title: "theme",
      tokensCss: readFileSync("dist/tokens.css", "utf8"),
      stylesCss: readFileSync("dist/styles.css", "utf8"),
      script: readFileSync("dist/webview.js", "utf8"),
      render: { type: "render", fileName: "theme.md", ...r.document },
    }),
  );
  const ctx = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(file).href);
  await page.waitForSelector(".theme-toggle");
  const surface = () =>
    page.evaluate(() => {
      const ctx2 = document.createElement("canvas").getContext("2d");
      ctx2.fillStyle = getComputedStyle(document.body).backgroundColor;
      ctx2.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx2.getImageData(0, 0, 1, 1).data;
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    });
  await check(
    "0.0.19 theme switch: a light computer shows light; the switch turns the page dark",
    async () => {
      assert.ok((await surface()) > 0.7, "starts light");
      await page.click(".theme-toggle");
      assert.ok((await surface()) < 0.3, "dark after the switch");
      assert.equal(await page.getAttribute(".theme-toggle", "aria-label"), "Switch to the light theme");
    },
  );
  await check("0.0.19 theme switch: the choice is kept when the page is opened again", async () => {
    await page.reload();
    await page.waitForSelector(".theme-toggle");
    assert.ok((await surface()) < 0.3, "still dark after reload");
  });
  await ctx.close();
}

{
  // 0.0.20 (owner call): the outline pane resizes by dragging the divider, hides and shows, and is remembered
  // long enough to scroll (#42: the Contents button must cover no text once the page is scrolled either)
  const r = engine.parse(
    `# Pane\n\n${"Text of the document. ".repeat(40)}\n\n## Part\n\n${`${"More text. ".repeat(30)}\n\n`.repeat(30)}`,
    1,
  );
  assert.ok(r.ok);
  const { page } = await openPanel();
  await page.setViewportSize({ width: 1400, height: 800 });
  await send(page, { type: "render", fileName: "pane.md", ...r.document });
  await page.waitForSelector(".outline-splitter", { state: "attached" });
  const outlineWidth = () => page.$eval(".outline", (o) => Math.round(o.getBoundingClientRect().width));
  const lastLayout = () => page.evaluate(() => window.__sent.filter((m) => m.type === "layout").at(-1));
  const drag = async (toX) => {
    const box = await page.locator(".outline-splitter").boundingBox();
    await page.mouse.move(box.x + 1, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(toX, box.y + 200, { steps: 5 });
    await page.mouse.up();
  };
  await check(
    "0.0.20 outline pane: dragging the divider resizes the outline and tells the extension",
    async () => {
      assert.equal(await outlineWidth(), 280);
      await drag(420);
      assert.ok(Math.abs((await outlineWidth()) - 420) <= 2, `outline is ${await outlineWidth()}px`);
      const saved = await lastLayout();
      assert.equal(saved?.collapsed, false);
      assert.ok(Math.abs(saved.outlineWidth - 420) <= 2);
    },
  );
  await check(
    "0.0.20 outline pane: dragging it nearly shut hides it; the show button brings it back",
    async () => {
      await drag(40);
      assert.equal(await page.$eval(".map", (m) => m.hasAttribute("data-outline-collapsed")), true);
      assert.equal(await page.isVisible(".outline-show"), true);
      assert.equal((await lastLayout())?.collapsed, true);
      // the text takes the whole width — not squeezed into the hidden outline's column
      const text = await page.$eval(".prose p", (p) => Math.round(p.getBoundingClientRect().width));
      assert.ok(text > 1000, `the text is ${text}px wide with the outline hidden`);
      // 2026-11-17 owner report: the button was a tiny "›" that got lost — it says what it is, stays in view while
      // the page scrolls, and covers no text
      // #42 (owner pick 2026-11-21): now a small list icon named "Contents", in its own left margin
      assert.equal(await page.$eval(".outline-show", (b) => b.getAttribute("aria-label")), "Contents");
      assert.match(await page.$eval(".outline-show", (b) => b.title), /Contents/);
      const clearOfText = () =>
        page.evaluate(() => {
          const b = document.querySelector(".outline-show").getBoundingClientRect();
          const covered = [...document.querySelectorAll(".prose > *")].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
          });
          return covered.map((el) => el.tagName);
        });
      assert.deepEqual(await clearOfText(), [], "the Contents button covers text at the top of the page");
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(150);
      const pinned = await page.$eval(".outline-show", (b) => {
        const r = b.getBoundingClientRect();
        const under = document.elementsFromPoint(r.left + r.width / 2, r.bottom + 2)[0];
        return { top: Math.round(r.top), firstLineBelow: !b.contains(under) };
      });
      assert.ok(pinned.top >= 0 && pinned.top < 20, `the button scrolled away (top ${pinned.top}px)`);
      assert.deepEqual(await clearOfText(), [], "the Contents button covers text once the page is scrolled");
      await page.mouse.wheel(0, -5000);
      await page.waitForTimeout(150);
      // #42: beside the text now (its own margin), not above it: still covers no line at the top
      assert.deepEqual(await clearOfText(), [], "the button covers the first line of the page");
      await page.click(".outline-show");
      assert.ok((await outlineWidth()) > 400, "back at its width");
    },
  );
  await check(
    "0.0.20 outline pane: the hide button hides it; a render carrying a saved layout applies it",
    async () => {
      await page.click(".outline-hide");
      assert.equal(await page.isVisible(".outline-show"), true);
      const fresh = await openPanel();
      await fresh.page.setViewportSize({ width: 1400, height: 800 });
      await send(fresh.page, {
        type: "render",
        fileName: "pane.md",
        ...r.document,
        layout: { outlineWidth: 360, collapsed: false },
      });
      await fresh.page.waitForSelector(".outline-splitter", { state: "attached" });
      const w = await fresh.page.$eval(".outline", (o) => Math.round(o.getBoundingClientRect().width));
      assert.equal(w, 360);
      await fresh.page.close();
    },
  );
  await page.close();
}

{
  // 0.1.0 review: a document's <a id="docmapMermaid"> is a window "named property" — it must not pose as the library
  const page0 = join(mkdtempSync(join(tmpdir(), "docmap-clobber-")), "panel.html");
  writeFileSync(
    page0,
    panelHtml({
      cspSource: "file:",
      nonce: "browsertest",
      title: "Map: clobber",
      tokensCss: `${dist}/tokens.css`,
      stylesCss: `${dist}/styles.css`,
      script: `${dist}/webview.js`,
      diagrams: `${dist}/mermaid.js`,
    }),
  );
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.addInitScript(() => {
    window.__sent = [];
    window.acquireVsCodeApi = () => ({ postMessage: (m) => window.__sent.push(m) });
  });
  await page.goto(pathToFileURL(page0).href);
  await page.waitForFunction(() => window.__sent.some((m) => m.type === "ready"));
  const renderDoc = async (text, version) => {
    const r = engine.parse(text, version);
    assert.ok(r.ok);
    await send(page, { type: "render", fileName: "c.md", ...r.document });
  };
  await check(
    '0.1.0 review: an <a id="docmapMermaid"> in the document does not stop diagrams from drawing',
    async () => {
      await renderDoc('# Doc\n\n<a id="docmapMermaid">x</a>\n', 1);
      await page.waitForSelector(".prose a#docmapMermaid");
      await renderDoc(
        '# Doc\n\n<a id="docmapMermaid">x</a>\n\n```mermaid\ngraph TD\n  A[One] --> B[Two]\n```\n',
        2,
      );
      await page.waitForSelector("pre.mermaid-diagram svg", { timeout: 15000 });
    },
  );
  await page.close();
}

{
  // 0.1.0 review: an <a id> with a heading's id must not stand in for that heading
  const r = engine.parse(
    `# Guide\n\nSee <a id="usage">here</a>.\n\n${"Filler paragraph.\n\n".repeat(60)}## Usage\n\n${"More.\n\n".repeat(60)}`,
    1,
  );
  assert.ok(r.ok);
  const { page } = await openPanel();
  await send(page, { type: "render", fileName: "g.md", ...r.document });
  await page.waitForSelector(".outline-link");
  await check(
    "0.1.0 review: clicking 'Usage' in the outline goes to the heading, not an <a id=\"usage\"> above it",
    async () => {
      await page.click('.outline-link:has-text("Usage")');
      await page.waitForTimeout(300);
      const top = await page.$eval(".prose h2#usage", (h) => h.getBoundingClientRect().top);
      assert.ok(top >= -2 && top < 100, `the heading is at ${top}px`);
    },
  );
  await page.close();
}

{
  // 0.2.1 owner report (screenshot of a narrow side preview): the outline took half the panel, the tool labels were
  // jargon, and a table cell broke "#FFFFFF" into "#FFFFF" / "F"
  const r = engine.parse(
    `# Design\n\n## Colours\n\n| Role | Token | Value | Use |\n|---|---|---|---|\n| Page background | \`--surface-0\` | \`#FFFFFF\` | app canvas |\n\n${"Filler.\n\n".repeat(40)}## Light mode\n\n${"More.\n\n".repeat(40)}`,
    1,
    { readingTools: true },
  );
  assert.ok(r.ok);
  const { page } = await openPanel();
  await page.setViewportSize({ width: 500, height: 800 });
  await send(page, { type: "render", fileName: "DESIGN.md", readingTools: true, ...r.document });
  await page.waitForSelector(".outline-link", { state: "attached" }); // folded: in the page, not on screen
  await check(
    "0.2.1: a narrow panel opens with the contents folded to one line, naming the section",
    async () => {
      const toggle = await page.$eval(".outline-toggle", (b) => ({
        expanded: b.getAttribute("aria-expanded"),
        height: b.getBoundingClientRect().height,
      }));
      assert.equal(toggle.expanded, "false");
      const outline = await page.$eval(".outline", (o) => o.getBoundingClientRect().height);
      assert.ok(outline < 60, `the folded contents bar is ${outline}px tall`);
      const colours = r.document.headings.find((h) => h.text === "Colours");
      await send(page, { type: "editorScrolled", docVersion: 1, topLine: colours.line + 1 });
      await page.waitForFunction(() => document.querySelector(".outline-current")?.textContent !== "");
      assert.equal(await page.$eval(".outline-current", (s) => s.textContent), "Colours");
      await page.click(".outline-toggle");
      assert.equal(await page.$eval(".outline-toggle", (b) => b.getAttribute("aria-expanded")), "true");
      // choosing a heading folds the list back, like a menu
      await page.click('.outline-link:has-text("Light mode")');
      assert.equal(await page.$eval(".outline-toggle", (b) => b.getAttribute("aria-expanded")), "false");
    },
  );
  await check("0.2.1: reading tools say what they do (Quick read, Levels)", async () => {
    assert.equal(await page.$eval(".skim-toggle", (b) => b.textContent), "Quick read");
    assert.equal(await page.$eval(".fold-label", (b) => b.textContent), "Levels");
  });
  await check("0.2.1: a value in a table cell stays on one line (no '#FFFFF' / 'F')", async () => {
    const lines = await page.$$eval(".prose td code", (codes) =>
      codes.map((c) => ({ text: c.textContent, rects: c.getClientRects().length })),
    );
    for (const l of lines) assert.equal(l.rects, 1, `"${l.text}" is broken over ${l.rects} lines`);
  });
  await page.close();
}

{
  // 2.0: the page extras — key points, changed sections, ⋯ menu, review marks, highlights, copy, slides, look
  const md = `# Plan\n\n## TL;DR\n\nShip it in two steps.\n\n## Tasks\n\n- [ ] one\n- [x] two\n\nDecision: use the queue.\n\n---\n\n## Rollout\n\nThe rollout starts on Monday with the beta group.\n\n\`\`\`sh\nnpm run deploy\n\`\`\`\n\n---\n\n## Done\n\nEnd.\n`;
  const r = engine.parse(md, 3, { readingTools: true });
  assert.ok(r.ok);
  const { page } = await openPanel();
  const extras = {
    look: { theme: "paper", fontScale: 1.15, lineWidth: "narrow" },
    keyPoints: { tldr: "Ship it in two steps.", tasksOpen: 1, tasksDone: 1, decisions: 1, warnings: 0 },
    changed: ["rollout"],
    reviews: [{ headingId: "tasks", mark: "question" }],
    highlights: [{ id: "h1", headingId: "rollout", text: "beta group" }],
  };
  await send(page, { type: "render", fileName: "plan.md", readingTools: true, ...r.document, extras });
  await page.waitForSelector(".keypoints");
  await check("2.0: key points strip — tasks, decisions, changed, mark as read", async () => {
    const t = await page.$eval(".keypoints", (k) => k.textContent);
    // 2026-11-17: the TL;DR paragraph is right below, so "In short" would only repeat it
    assert.ok(!t.includes("In short"), `"In short" repeats the page: "${t}"`);
    for (const want of ["1 of 2 tasks done", "1 decision", "1 section changed", "Mark as read"])
      assert.ok(t.includes(want), `missing "${want}" in "${t}"`);
    await page.click(".kp-read");
    assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "markRead" });
  });
  await check(
    "2026-11-17 / 3.3.0 layout: status first, then the quick-action controls together at the right edge, none mixed in",
    async () => {
      const parts = await page.evaluate(() => {
        const box = (s) => document.querySelector(s)?.getBoundingClientRect();
        const actions = [...document.querySelectorAll(".kp-actions > :is(.kp-look-wrap, button)")].map(
          (b) => b.className.split(" ")[0],
        );
        const mixed = document.querySelectorAll(".kp-chips :is(.kp-look, .kp-plans, .kp-menu)").length;
        return { bar: box(".kp-bar"), status: box(".kp-chips"), act: box(".kp-actions"), actions, mixed };
      });
      assert.deepEqual(parts.actions.slice(0, 3), ["kp-look-wrap", "kp-clean", "kp-plans"]);
      assert.ok(parts.actions.includes("kp-menu"), parts.actions.join(", "));
      assert.equal(parts.mixed, 0, "an action sits among the status items");
      assert.ok(Math.abs(parts.act.right - parts.bar.right) < 2, "the actions are not at the right edge");
      assert.ok(parts.act.top >= parts.status.top, "the actions come before the status");
    },
  );
  await check(
    "2026-11-17: 'In short' shows when it says something the page does not show at the top",
    async () => {
      await send(page, {
        type: "render",
        fileName: "plan.md",
        readingTools: true,
        ...r.document,
        extras: { ...extras, keyPoints: { ...extras.keyPoints, tldr: "A summary written elsewhere." } },
      });
      await page.waitForFunction(() =>
        document.querySelector(".kp-tldr")?.textContent.includes("written elsewhere"),
      );
      await send(page, { type: "render", fileName: "plan.md", readingTools: true, ...r.document, extras });
      await page.waitForFunction(() => !document.querySelector(".kp-tldr"));
    },
  );
  await check(
    "2.0: changed and reviewed sections are marked in the page and the outline (with words, not colour alone)",
    async () => {
      assert.equal(await page.$eval("#rollout .dm-changed", (b) => b.textContent), "changed");
      assert.match(await page.$eval("#tasks .dm-review", (b) => b.textContent), /Question/);
      assert.equal(
        await page.$$eval('.outline-row[data-id="rollout"] .outline-badge-changed', (b) => b.length),
        1,
      );
    },
  );
  await check("2.0: the ⋯ beside a heading asks the host for that section's menu", async () => {
    await page.hover("#rollout");
    await page.click("#rollout .section-menu");
    assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
      type: "sectionMenu",
      headingId: "rollout",
    });
  });
  await check("2.0: a saved highlight is drawn as a mark; clicking it asks to remove it", async () => {
    assert.equal(await page.$eval("mark.dm-hl", (m) => m.textContent), "beta group");
    await page.click("mark.dm-hl");
    assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "unhighlight", id: "h1" });
  });
  await check("2.0: selecting text offers 'Highlight', which sends the text and its section", async () => {
    await page.evaluate(() => {
      const p = [...document.querySelectorAll(".prose p")].find((x) =>
        x.textContent.includes("starts on Monday"),
      );
      const t = p.firstChild;
      const range = document.createRange();
      range.setStart(t, t.data.indexOf("starts"));
      range.setEnd(t, t.data.indexOf("starts") + "starts on Monday".length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.click(".dm-hl-button");
    assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
      type: "highlight",
      headingId: "rollout",
      text: "starts on Monday",
    });
  });
  await check("2.0: code blocks have a Copy button that hands the code to the host", async () => {
    await page.hover(".prose pre");
    await page.click(".dm-copy");
    assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
      type: "copy",
      text: "npm run deploy\n",
    });
  });
  await check("2.0: slides — the parts between --- lines, one at a time, ← → and Esc", async () => {
    // #48 (owner pick 2026-11-21): in VS Code no Slides button on the page; the file's ⋯ menu offers them
    assert.equal(await page.$(".kp-slides"), null, "a Slides button is still on the page");
    await page.click(".kp-menu");
    assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
      type: "sectionMenu",
      headingId: "",
      slides: true,
    });
    const version = r.document.docVersion;
    await send(page, { type: "showSlides", docVersion: version + 1 }); // an older page's request: ignored
    assert.equal(await page.$(".slide-bar"), null);
    await send(page, { type: "showSlides", docVersion: version });
    await page.waitForSelector(".slide-bar span");
    const visible = () =>
      page.$$eval(".prose > :not([data-slide-hidden]):not(.dm-x)", (els) =>
        els.map((e) => e.id || e.tagName).join(","),
      );
    assert.match(await visible(), /^plan,/);
    assert.equal(await page.$eval(".slide-bar span", (s) => s.textContent), "1 / 3");
    await page.keyboard.press("ArrowRight");
    assert.match(await visible(), /^rollout,/);
    await page.keyboard.press("Escape");
    assert.equal(await page.$$eval("[data-slide-hidden]", (e) => e.length), 0);
  });
  await check(
    "2.0: the reading look applies (theme, text size, width); new extras redraw without a re-render",
    async () => {
      assert.equal(await page.evaluate(() => document.body.dataset.readingTheme), "paper");
      assert.equal(await page.evaluate(() => document.body.dataset.lineWidth), "narrow");
      const bg = await page.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue("--background").trim(),
      );
      assert.match(bg, /oklch\(0\.975/);
      await send(page, {
        type: "extras",
        docVersion: 3,
        extras: { changed: [], reviews: [], highlights: [] },
      });
      // the page applies messages a moment later: wait for it (CI run 116 read the page too early)
      await page.waitForFunction(
        () => document.querySelectorAll(".dm-changed, .dm-review, mark.dm-hl").length === 0,
        null,
        { timeout: 5000 },
      );
    },
  );
  await page.close();
}

{
  // 2026-11-22 review: clickable code names, ▶ Terminal on shell blocks, Comment on selected text
  const md =
    "# C\n\nThe cart is in `src/cart.js`; `src/gone.js` is not.\n\nWe use SQLite here.\n\n```console\n$ npm test\n```\n\n```js\nlet x = 1;\n```\n";
  const r = engine.parse(md, 9, { readingTools: true, blockIds: true });
  assert.ok(r.ok);
  const { page } = await openPanel();
  await send(page, {
    type: "render",
    fileName: "c.md",
    readingTools: true,
    ...r.document,
    extras: { codeRefs: ["src/cart.js"] },
  });
  await page.waitForSelector("code.dm-coderef");
  await check(
    "review 2026-11-22: only the code names the host listed are clickable; a click asks to open it",
    async () => {
      const marked = await page.evaluate(() =>
        [...document.querySelectorAll("code.dm-coderef")].map((c) => c.textContent),
      );
      assert.deepEqual(marked, ["src/cart.js"]);
      await page.click("code.dm-coderef");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
        type: "openCode",
        text: "src/cart.js",
      });
    },
  );
  await check(
    "review 2026-11-22: shell blocks (only) get ▶ Terminal, which hands the block to the host",
    async () => {
      assert.equal(await page.evaluate(() => document.querySelectorAll(".dm-term").length), 1);
      await page.hover(".prose pre");
      await page.click(".dm-term");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
        type: "runInTerminal",
        text: "$ npm test\n",
      });
    },
  );
  await check("review 2026-11-22: selected text offers Comment beside Highlight", async () => {
    await page.evaluate(() => {
      const p = [...document.querySelectorAll(".prose p")].find((x) => x.textContent.includes("SQLite"));
      const t = p.firstChild;
      const range = document.createRange();
      range.setStart(t, t.data.indexOf("SQLite"));
      range.setEnd(t, t.data.indexOf("SQLite") + "SQLite".length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll(".dm-hl-bar button")].map((b) => b.textContent),
    );
    assert.deepEqual(labels, ["Highlight", "Comment"]);
    await page.click(".dm-hl-bar button:nth-child(2)");
    assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
      type: "comment",
      headingId: "c",
      text: "SQLite",
    });
  });
  await page.close();
}

{
  // 3.0 trust markers: beside their block, reasons in the hover, click → host menu, summary chips, hover dot
  const md =
    "# T\n\nFirst paragraph.\n\nSecond names `gone/file.md`.\n\nThird is verified.\n\nFourth has no mark.\n";
  const r = engine.parse(md, 7, { readingTools: true, blockIds: true });
  assert.ok(r.ok);
  const { page } = await openPanel();
  const trust = [
    { block: 1, state: "mismatch", reasons: ["✗ Mentions `gone/file.md`, which is not in the repository."] },
    { block: 2, state: "verified", reasons: ["✓ Verified 2026-11-16."] },
  ];
  await send(page, {
    type: "render",
    fileName: "t.md",
    readingTools: true,
    ...r.document,
    extras: { keyPoints: { tasksOpen: 0, tasksDone: 0, decisions: 0, warnings: 0 }, trust },
  });
  await page.waitForSelector(".dm-mark-mismatch");
  await check("3.0: a trust marker sits beside its paragraph, with the reason in its hover", async () => {
    const pos = await page.evaluate(() => {
      const m = document.querySelector(".dm-mark-mismatch");
      const p = [...document.querySelectorAll(".prose > p")].find((x) => x.textContent.includes("Second"));
      return {
        mark: m.getBoundingClientRect().top,
        para: p.getBoundingClientRect().top,
        title: m.title,
        left: m.getBoundingClientRect().right < p.getBoundingClientRect().left + 1,
      };
    });
    assert.ok(Math.abs(pos.mark - pos.para) < 12, `marker at ${pos.mark}, paragraph at ${pos.para}`);
    assert.ok(pos.left, "the marker is in the margin, left of the text");
    assert.match(pos.title, /Doesn't match the code\n✗ Mentions `gone\/file.md`/);
  });
  await check(
    "3.0: clicking a marker asks the host for that block's menu; the summary chip names the problems",
    async () => {
      await page.click(".dm-mark-mismatch");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "blockMenu", block: 1 });
      const chips = await page.$eval(".keypoints", (k) => k.textContent);
      assert.ok(chips.includes("✗ 1 doesn't match the code") && chips.includes("✓ 1 verified"), chips);
    },
  );
  await check(
    "3.0: clicking a trust count again goes to the next paragraph of that kind, then round",
    async () => {
      await send(page, {
        type: "extras",
        docVersion: 7,
        extras: {
          trust: [
            { block: 0, state: "mismatch", reasons: ["✗ one"] },
            { block: 1, state: "mismatch", reasons: ["✗ two"] },
          ],
        },
      });
      await page.waitForSelector(".kp-trust-mismatch");
      await page.evaluate(() => {
        window.__scrolled = [];
        window.__scrollIntoView = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (o) {
          window.__scrolled.push(this.textContent.replace(/^[^A-Za-z]+/, "").slice(0, 5));
          return window.__scrollIntoView.call(this, o);
        };
      });
      for (let i = 0; i < 3; i++) await page.click(".kp-trust-mismatch");
      assert.deepEqual(await page.evaluate(() => window.__scrolled), ["First", "Secon", "First"]);
      await page.evaluate(() => {
        Element.prototype.scrollIntoView = window.__scrollIntoView;
      });
      await send(page, {
        type: "extras",
        docVersion: 7,
        extras: { keyPoints: { tasksOpen: 0, tasksDone: 0, decisions: 0, warnings: 0 }, trust },
      });
    },
  );
  await check("3.0: hovering an unmarked paragraph offers the dot to verify it", async () => {
    await page.hover('.prose > p:has-text("Fourth")');
    await page.click(".dm-mark-ghost");
    assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "blockMenu", block: 3 });
  });
  await page.close();
}

{
  // 3.0 Clean view: AI-style Markdown laid out properly (display only)
  const md = readFileSync("tests/fixtures/messy-ai.md", "utf8");
  const r = engine.parse(md, 1, { readingTools: true, blockIds: true });
  assert.ok(r.ok);
  const { page } = await openPanel();
  const extras = {
    keyPoints: { tasksOpen: 2, tasksDone: 2, decisions: 0, warnings: 0 },
    look: { theme: "vscode", fontScale: 1, lineWidth: "normal", clean: true },
    frontMatter: [
      { key: "title", value: "Payments rollout plan" },
      { key: "status", value: "In review" },
      { key: "owner", value: "Priya" },
    ],
  };
  await send(page, { type: "render", fileName: "plan.md", readingTools: true, ...r.document, extras });
  await page.waitForSelector(".dm-kv");
  await check("3.0 clean: key–value bullets become a card; front matter a header card", async () => {
    assert.deepEqual(await page.$$eval(".prose .dm-kv dt", (d) => d.map((x) => x.textContent)), [
      "Goal",
      "Owner",
      "Deadline",
    ]);
    assert.deepEqual(await page.$$eval(".prose .dm-fm dt", (d) => d.map((x) => x.textContent)), [
      "title",
      "status",
      "owner",
    ]);
  });
  await check(
    "3.0 clean: 'Note:' and 'Warning:' paragraphs become boxes; 'Step N:' paragraphs a stepper",
    async () => {
      assert.deepEqual(await page.$$eval(".prose .callout-title", (t) => t.map((x) => x.textContent)), [
        "Note",
        "Warning",
      ]);
      assert.equal(await page.$$eval(".prose ol.dm-steps > li", (l) => l.length), 3);
      assert.match(await page.$eval(".prose ol.dm-steps > li", (l) => l.textContent), /^Turn on shadow mode/);
    },
  );
  await check(
    "3.0 clean: mostly-bold paragraph toned down; status cells as chips (word kept); numbers right-aligned",
    async () => {
      assert.equal(await page.$$eval(".prose .dm-overbold", (x) => x.length), 1);
      assert.deepEqual(
        await page.$$eval(".prose .dm-status", (x) =>
          x.map((c) => `${c.className.split(" ")[1]}:${c.textContent}`),
        ),
        ["dm-status-done:done", "dm-status-progress:in progress", "dm-status-blocked:blocked"],
      );
      assert.equal(await page.$$eval(".prose td.dm-num", (x) => x.length), 3);
    },
  );
  await check(
    "3.0 clean: checklist progress, date and @person chips, syntax colours, copy-link on headings",
    async () => {
      assert.equal(await page.$eval(".dm-progressline small", (x) => x.textContent), "2 of 4 done");
      assert.deepEqual(await page.$$eval(".prose .dm-chip", (x) => x.map((c) => c.textContent)), [
        "@priya",
        "2026-12-01",
      ]);
      assert.ok(
        (await page.$$eval(".prose .tk-keyword", (x) => x.map((k) => k.textContent))).includes("def"),
      );
      assert.equal(await page.$eval(".tk-comment", (x) => x.textContent), "# never twice");
      await page.hover("h2#status");
      await page.click("h2#status .dm-hlink");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
        type: "copy",
        text: "plan.md#status",
      });
    },
  );
  await check("3.0 clean: when Clean view is off, the page is the plain render", async () => {
    await send(page, {
      type: "render",
      fileName: "plan.md",
      readingTools: true,
      ...r.document,
      extras: { ...extras, look: { ...extras.look, clean: false } },
    });
    await page.waitForFunction(() => !document.querySelector(".dm-kv"));
    assert.equal(await page.$$eval(".dm-steps, .dm-status, .dm-fm", (x) => x.length), 0);
  });
  await page.close();
}

{
  // 3.0 Rendered redline: added / changed (word by word) / removed blocks on the rendered page
  const before = "# R\n\nWe ship on **Monday** with the old queue.\n\nThis paragraph goes away.\n\nOutro.\n";
  const after = "# R\n\nBrand new paragraph.\n\nWe ship on **Friday** with the old queue.\n\nOutro.\n";
  const blocksOf = (md, r) => {
    const lines = md.split("\n");
    return r.document.blocks.map((b) => lines.slice(b.line, b.end).join("\n"));
  };
  const old = engine.parse(before, 1, { readingTools: true, blockIds: true });
  const now = engine.parse(after, 2, { readingTools: true, blockIds: true });
  const redline = {
    label: "the last commit",
    oldHtml: old.document.html,
    ...alignBlocks(blocksOf(before, old), blocksOf(after, now)),
  };
  const { page } = await openPanel();
  await send(page, {
    type: "render",
    fileName: "r.md",
    readingTools: true,
    ...now.document,
    extras: { keyPoints: { tasksOpen: 0, tasksDone: 0, decisions: 0, warnings: 0 }, redline },
  });
  await page.waitForSelector(".dm-rl-bar");
  await check(
    "3.0 redline: the bar counts the changes; added and removed blocks are marked in place",
    async () => {
      assert.match(
        await page.$eval(".dm-rl-bar", (b) => b.textContent),
        /Changes since the last commit: 1 added · 1 changed · 1 removed/,
      );
      assert.equal(await page.$eval('[data-redline="added"]', (b) => b.textContent), "Brand new paragraph.");
      const removed = await page.$eval('[data-redline="removed"]', (b) => ({
        text: b.textContent,
        next: b.nextElementSibling?.textContent,
      }));
      assert.deepEqual(removed, { text: "This paragraph goes away.", next: "Outro." });
    },
  );
  await check(
    "3.0 redline: inside a changed block, the new word is underlined and the old one struck through",
    async () => {
      const marks = await page.$eval('[data-redline="changed"]', (b) => ({
        ins: [...b.querySelectorAll("ins")].map((x) => x.textContent),
        del: [...b.querySelectorAll("del")].map((x) => x.textContent),
        strong: b.querySelector("strong")?.textContent,
      }));
      assert.deepEqual(marks.ins, ["Friday"]);
      assert.deepEqual(marks.del, ["Monday "]);
      assert.match(marks.strong, /Friday/); // formatting kept: the change is marked inside the bold
    },
  );
  await check(
    "2026-11-17: the changes bar offers 'Side by side', which asks the host for VS Code's compare",
    async () => {
      assert.equal(await page.$eval(".rl-side", (b) => b.textContent), "⇆ Side by side");
      await page.click(".rl-side");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "redlineSideBySide" });
    },
  );
  await check(
    "3.0 redline: 'Stop comparing' asks the host; without a redline the page is clean again",
    async () => {
      await page.click(".rl-off");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "redlineOff" });
      await send(page, {
        type: "extras",
        docVersion: 2,
        extras: { keyPoints: { tasksOpen: 0, tasksDone: 0, decisions: 0, warnings: 0 } },
      });
      await page.waitForFunction(() => !document.querySelector(".dm-rl-bar"));
      assert.equal(await page.$$eval("ins, del, [data-redline]", (x) => x.length), 0);
      assert.match(
        await page.$eval(".prose", (p) => p.textContent),
        /We ship on Friday with the old queue\./,
      );
      await page.click(".kp-menu");
      assert.equal(await page.evaluate(() => window.__sent.at(-1).type), "sectionMenu");
    },
  );
  await check(
    "3.0 named formats: the doc-kind chip names the kind and format (as text); a click asks the host to compare",
    async () => {
      await send(page, {
        type: "extras",
        docVersion: 2,
        extras: { docKind: { label: "Decision record", format: "<b>MADR</b>" } },
      });
      await page.waitForSelector(".kp-kind");
      assert.equal(await page.$eval(".kp-kind", (b) => b.textContent), "Decision record · <b>MADR</b>");
      assert.equal(await page.$$eval(".kp-kind b", (x) => x.length), 0); // text only, never markup
      await page.click(".kp-kind");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "compareFormat" });
    },
  );
  await page.close();
}

{
  // 3.0 redline with Clean view on: "Step 1: / Step 2:" paragraphs become one numbered list — an edit in a later
  // step must still be marked (and counted)
  const before =
    "# S\n\nStep 1: Turn on shadow mode.\n\nStep 2: Compare results for a week.\n\nStep 3: Switch.\n";
  const after =
    "# S\n\nStep 1: Turn on shadow mode.\n\nStep 2: Compare results for two weeks.\n\nStep 3: Switch.\n";
  const blocksOf = (md, r) => {
    const lines = md.split("\n");
    return r.document.blocks.map((b) => lines.slice(b.line, b.end).join("\n"));
  };
  const old = engine.parse(before, 1, { readingTools: true, blockIds: true });
  const now = engine.parse(after, 2, { readingTools: true, blockIds: true });
  const redline = {
    label: "the last commit",
    oldHtml: old.document.html,
    ...alignBlocks(blocksOf(before, old), blocksOf(after, now)),
  };
  const { page } = await openPanel();
  await send(page, {
    type: "render",
    fileName: "s.md",
    readingTools: true,
    ...now.document,
    extras: { keyPoints: { tasksOpen: 0, tasksDone: 0, decisions: 0, warnings: 0 }, redline },
  });
  await page.waitForSelector(".dm-rl-bar");
  await check(
    "3.0 redline + Clean view: an edit in step 2 of a 'Step N:' run is marked and counted",
    async () => {
      assert.equal(await page.$$eval(".prose ol.dm-steps > li", (l) => l.length), 3);
      assert.match(await page.$eval(".dm-rl-bar", (b) => b.textContent), /1 changed/);
      const changed = await page.$eval('[data-redline="changed"]', (b) => ({
        tag: b.tagName,
        text: b.textContent,
        ins: [...b.querySelectorAll("ins")].map((x) => x.textContent),
      }));
      assert.equal(changed.tag, "LI");
      assert.match(changed.text, /Compare results for/);
      assert.ok(changed.ins.join(" ").includes("two"), JSON.stringify(changed));
    },
  );
  await page.close();
}

{
  // 3.0 tick a task and change a status from the page: the page asks the host (naming the source line and the
  // version it shows) and undoes its own click — the host's re-render shows the file's real state
  const md =
    "# T\n\n| Task | Status |\n| --- | --- |\n| Load test | in progress |\n\n- [x] Adapter\n- [ ] Switch traffic\n";
  const r = engine.parse(md, 7, { readingTools: true, blockIds: true });
  const { page } = await openPanel();
  await send(page, {
    type: "render",
    fileName: "t.md",
    readingTools: true,
    ...r.document,
    docVersion: 7,
    extras: { keyPoints: { tasksOpen: 1, tasksDone: 1, decisions: 0, warnings: 0 } },
  });
  await page.waitForSelector("input.task-checkbox");
  await check(
    "3.0 tick: clicking an open task asks the host to tick source line 7, and the box waits",
    async () => {
      const boxes = await page.$$eval("input.task-checkbox", (b) =>
        b.map((x) => ({ off: x.disabled, on: x.checked })),
      );
      assert.deepEqual(boxes, [
        { off: false, on: true },
        { off: false, on: false },
      ]);
      await page.click("input.task-checkbox >> nth=1");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
        type: "setTask",
        docVersion: 7,
        line: 7,
        checked: true,
      });
      assert.equal(await page.$eval("input.task-checkbox >> nth=1", (x) => x.checked), false);
    },
  );
  await check("3.0 status: clicking a status label asks the host for row line 4, column 1", async () => {
    await page.click(".dm-status-edit");
    assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
      type: "statusMenu",
      docVersion: 7,
      line: 4,
      column: 1,
    });
  });
  await page.close();
}

{
  // 3.0 outline counts and sign-off chips
  const md = "# Plan\n\nIntro.\n\n## Steps\n\n- [ ] one\n- [ ] two\n\n## Notes\n\nText.\n";
  const r = engine.parse(md, 3, { readingTools: true, blockIds: true });
  const { page } = await openPanel();
  await send(page, {
    type: "render",
    fileName: "plan.md",
    readingTools: true,
    ...r.document,
    extras: {
      keyPoints: { tasksOpen: 2, tasksDone: 0, decisions: 0, warnings: 0 },
      badges: [{ headingId: "steps", tasks: 2, questions: 1, doubts: 1 }],
      signoffs: [
        { who: "Priya", date: "2026-11-16", current: true },
        { who: "Sam", date: "2026-11-01", current: false },
      ],
    },
  });
  await page.waitForSelector(".outline-counts");
  await check(
    "3.0: the outline shows a section's open tasks, questions and doubts, said in words for screen readers",
    async () => {
      const c = await page.$eval('.outline-row[data-id="steps"] .outline-counts', (x) => ({
        text: x.textContent,
        label: x.getAttribute("aria-label"),
      }));
      assert.deepEqual(c, { text: "☐2?1✗1", label: "2 open tasks, 1 open question, 1 paragraph to check" });
      assert.equal(await page.$$eval('.outline-row[data-id="notes"] .outline-counts', (x) => x.length), 0);
    },
  );
  await check("3.0: sign-offs show who signed, and flag a sign-off the file has changed since", async () => {
    const chips = await page.$$eval(".kp-signed, .kp-signed-stale", (x) => x.map((c) => c.textContent));
    assert.deepEqual(chips, [
      "✓ Signed off by Priya · 2026-11-16",
      "⚠ Changed since Sam signed off (2026-11-01)",
    ]);
  });
  await page.close();
}

{
  // 3.0 live browser view: the REAL local server serving the REAL page; the document changes, the open tab follows
  const { startLiveServer } = await load("src/extension/live-server.ts", "live");
  const read = (f) => readFileSync(join("dist", f), "utf8");
  let text = "# First heading\n\nOne.";
  let version = 1;
  const render = () => {
    const r = engine.parse(text, version, {});
    assert.ok(r.ok);
    return { type: "render", fileName: "live.md", ...r.document, docVersion: version };
  };
  let prefix = "";
  const server = await startLiveServer(
    {
      page: async (id) =>
        id === 0
          ? snapshotHtml({
              nonce: "livenonce",
              title: "live.md — docmap live",
              tokensCss: read("tokens.css"),
              stylesCss: read("styles.css"),
              script: read("webview.js"),
              render: render(),
              live: { data: `${prefix}/data/0`, events: `${prefix}/events/0` },
            })
          : undefined,
      data: async (id) => (id === 0 ? JSON.stringify(render()) : undefined),
      file: () => undefined,
    },
    { keepAliveMs: 60000, maxListeners: 5 },
  );
  prefix = new URL(server.base).pathname;
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__violations = [...(window.__violations ?? []), `${e.violatedDirective} ${e.blockedURI}`];
    });
  });
  await page.goto(`${server.base}/doc/0`);
  await page.waitForSelector(".outline-link");

  await check("3.0 live: an edit reaches the open tab by itself — no reload, no button", async () => {
    await page.evaluate(() => {
      window.__samePage = true; // gone if the browser reloaded the page
    });
    for (let i = 0; i < 100 && server.listeners() === 0; i++) await page.waitForTimeout(50);
    assert.equal(server.listeners(), 1, "the tab listens for updates");
    text = "# First heading\n\nOne.\n\n## Added while the tab was open\n\nTwo.";
    version = 2;
    server.notify(0);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".outline-link")].some((a) => a.textContent.includes("Added while")),
      null,
      { timeout: 5000 },
    );
    assert.equal(await page.evaluate(() => window.__samePage), true, "the page was not reloaded");
  });
  await check("3.0 live: the page's lockdown holds while it updates (no policy violations)", async () => {
    assert.deepEqual(await page.evaluate(() => window.__violations ?? []), []);
  });
  await page.close();
  await server.close();
}

// ---------------------------------------------------------------------------------------------------------
// Easy reading (2026-11-24): "Where this stands" on a long doc, state labels on its sections, long paragraphs cut
{
  const { standing } = await load("src/core/insights/standing.ts", "standing");
  const long = Array.from({ length: 90 }, (_, i) => `word${i}`).join(" ");
  const text = `# Voice casting

**Status:** **V1-a BUILT 2026-08-18** · **V1-b BUILT 2026-08-21** — the backend. **Closes at V1-c**, the screen.

First sentence of a long paragraph. Second sentence of it. ${long} END-OF-PARAGRAPH.

## 7. V1-a — the contract

Words.

## 12. V1-b — the cast reaches the audio

Words.

## 13. V1-c — the casting screen (built 2026-08-21)

Words.
`;
  const doc = engine.parse(text, 5, { readingTools: true, blockIds: true });
  const look = { theme: "vscode", fontScale: 1, lineWidth: "normal", clean: true };
  const { page } = await openPanel();
  await send(page, {
    type: "render",
    docVersion: 5,
    fileName: "voice.md",
    ...doc.document,
    extras: { look, standing: standing(text, doc.document.headings) },
  });
  await page.waitForSelector(".dm-standing");

  await check(
    "easy reading: a long doc opens with 'Where this stands' — its parts and their state",
    async () => {
      const rows = await page.$$eval(".dm-st-parts tr", (trs) => trs.map((tr) => tr.textContent));
      assert.deepEqual(rows, [
        "V1-athe contractbuilt 2026-08-18",
        "V1-bthe cast reaches the audiobuilt 2026-08-21",
        "V1-cthe casting screenbuilt 2026-08-21",
      ]);
    },
  );
  await check("easy reading: it warns when the Status line still calls a built part not done", async () => {
    const warn = await page.$eval(".dm-st-warn", (p) => p.textContent);
    assert.match(warn, /V1-c as not done, but section 13 says built 2026-08-21/);
  });
  await check("easy reading: each part's heading carries its state", async () => {
    const chip = await page.$eval("h2[id^='13-'] .dm-st-chip", (c) => c.textContent);
    assert.equal(chip, "built 2026-08-21");
  });
  await check("easy reading: a long paragraph shows two sentences; 'more…' shows the rest", async () => {
    const shown = () =>
      page.$eval("p:has(.dm-more-btn), p:has(.dm-more)", (p) => p.innerText.includes("END-OF-PARAGRAPH"));
    assert.equal(await shown(), false, "the rest starts hidden");
    await page.click(".dm-more-btn");
    assert.equal(await shown(), true, "the rest is shown");
    assert.equal(await page.$(".dm-more-btn"), null, "the button is gone");
  });
  await check("easy reading: pointing at a code link asks for its code and shows it in a box", async () => {
    const codeDoc = engine.parse(
      "# Code\n\nSee [cart.py:2](src/cart.py#L2) and [the site](https://example.com).\n",
      9,
    );
    await send(page, {
      type: "render",
      docVersion: 9,
      fileName: "c.md",
      ...codeDoc.document,
      extras: { look },
    });
    await page.waitForSelector("a[href='src/cart.py#L2']");
    await page.hover("a[href='src/cart.py#L2']");
    await page.waitForFunction(() => window.__sent.some((m) => m.type === "peekCode"));
    const asked = await page.evaluate(() =>
      window.__sent.filter((m) => m.type === "peekCode").map((m) => m.text),
    );
    assert.deepEqual(asked, ["src/cart.py#L2"]);
    const peek = {
      path: "src/cart.py",
      line: 2,
      total: 3,
      kind: "at",
      rows: [
        [1, "def add():", false],
        [2, "  return 1", true],
      ],
    };
    await send(page, { type: "codePeek", text: "src/cart.py#L2", peek });
    await page.waitForSelector(".dm-peek");
    assert.equal(await page.$eval(".dm-peek-hit", (r) => r.textContent), "2  return 1");
    await page.hover("a[href='https://example.com']");
    await page.waitForFunction(() => !document.querySelector(".dm-peek"));
    const again = await page.evaluate(() => window.__sent.filter((m) => m.type === "peekCode").length);
    assert.equal(again, 1, "a web link asks for nothing");
  });
  await check("easy reading: 'Show as written' (Clean view off) shows the doc without the box", async () => {
    await send(page, {
      type: "render",
      docVersion: 6,
      fileName: "voice.md",
      ...doc.document,
      extras: { look: { ...look, clean: false }, standing: standing(text, doc.document.headings) },
    });
    await page.waitForFunction(() => !document.querySelector(".dm-standing"));
    assert.equal(await page.$(".dm-more-btn"), null, "no paragraph is cut either");
  });
  // code review 2026-11-24: folded text must stay findable (Ctrl+F) and a highlight in it must show
  const folded = (extras) =>
    send(page, {
      type: "render",
      docVersion: 7,
      fileName: "voice.md",
      ...doc.document,
      extras: { look, standing: standing(text, doc.document.headings), ...extras },
    });
  await check("easy reading: the folded rest of a paragraph can be found by Find (Ctrl+F)", async () => {
    await folded({});
    await page.waitForSelector(".dm-more-btn");
    assert.equal(await page.$eval(".dm-more", (r) => r.getAttribute("hidden")), "until-found");
    // what the browser does when Find matches inside it: shows it, then says so
    await page.$eval(".dm-more", (r) => {
      r.removeAttribute("hidden");
      r.dispatchEvent(new Event("beforematch"));
    });
    assert.equal(await page.$(".dm-more-btn"), null, "'more…' goes once the rest is shown");
  });
  await check("easy reading: a highlight in the folded rest opens it", async () => {
    await folded({ highlights: [{ id: "h9", headingId: "", text: "END-OF-PARAGRAPH" }] });
    await page.waitForSelector("mark.dm-hl", { state: "attached" });
    assert.equal(await page.$eval("mark.dm-hl", (m) => m.closest(".dm-more")?.hasAttribute("hidden")), false);
    assert.equal(await page.$(".dm-more-btn"), null);
  });
  await check(
    "easy reading: the code preview asks again on each hover (the code may have changed)",
    async () => {
      const codeDoc = engine.parse("# Code\n\nSee [cart.py:2](src/cart.py#L2).\n", 8, {
        readingTools: true,
        blockIds: true,
      });
      const draw = (v) =>
        send(page, {
          type: "render",
          docVersion: v,
          fileName: "c.md",
          ...codeDoc.document,
          extras: { look },
        });
      const asked = () => page.evaluate(() => window.__sent.filter((m) => m.type === "peekCode").length);
      const hoverLink = async () => {
        await page.mouse.move(0, 0);
        await page.hover("a[href='src/cart.py#L2']");
        await page.waitForTimeout(450);
      };
      await draw(8);
      await page.waitForSelector("a[href='src/cart.py#L2']");
      const before = await asked();
      await hoverLink();
      assert.equal(await asked(), before + 1, "asked the first time");
      const peek = { path: "src/cart.py", line: 2, total: 2, kind: "at", rows: [[2, "old", true]] };
      await send(page, { type: "codePeek", text: "src/cart.py#L2", peek });
      await hoverLink();
      assert.equal(await asked(), before + 2, "asked again, not an old answer");
    },
  );
  await page.close();
}

// owner report 2026-11-24: the page's buttons — "Show source" on a file's own tab, "◈ Doc Atlas" styled like the
// others and never on a page docmap wrote; and the Atlas opened from a doc shows that doc's map, list folded
{
  const r = engine.parse(["# Plan", "", "- [ ] one", "- [x] two", ""].join("\n"), 1, {
    readingTools: true,
    blockIds: true,
  });
  const look = { theme: "vscode", fontScale: 1, lineWidth: "normal", clean: true };
  const keyPoints = { tasksOpen: 1, tasksDone: 1, decisions: 0, warnings: 0 };
  const { page } = await openPanel();
  const render = (extras) =>
    send(page, {
      type: "render",
      docVersion: 1,
      fileName: "plan.md",
      readingTools: true,
      ...r.document,
      extras,
    });
  await render({ look, keyPoints, report: false, inTab: true });
  await page.waitForSelector(".kp-actions");
  await check(
    "page buttons: quick-action bar sends openPlans, openAtlas, redlineMenu, openInBrowser, openQuestions",
    async () => {
      await page.click(".kp-plans");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "openPlans" });
      await page.click(".kp-atlas");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "openAtlas" });
      await page.click(".kp-compare");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "redlineMenu" });
      await page.click(".kp-browser");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "openInBrowser" });
      await page.click(".kp-questions");
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "openQuestions" });
    },
  );
  await check("page buttons: 'Look' looks like the buttons beside it", async () => {
    const look = await page.evaluate(() => {
      const css = (s) => {
        const c = getComputedStyle(document.querySelector(s));
        return [
          c.backgroundColor,
          c.borderTopWidth,
          c.borderTopStyle,
          c.paddingTop,
          c.paddingLeft,
          c.fontSize,
        ];
      };
      return { lookBtn: css(".kp-look"), menu: css(".kp-menu") };
    });
    assert.deepEqual(look.lookBtn, look.menu);
  });
  await check(
    "page buttons: a report page omits 'Atlas', while Look / Plans / Compare / More stay",
    async () => {
      await render({ look, keyPoints, report: true, inTab: false });
      await page.waitForFunction(() => !document.querySelector(".kp-atlas"));
      assert.equal(await page.$(".kp-atlas"), null);
      assert.ok(await page.$(".kp-look"), "Look button stays");
      assert.ok(await page.$(".kp-plans"), "Plans button stays");
      assert.ok(await page.$(".kp-menu"), "More button stays");
    },
  );
  await page.close();

  const { atlasHtml } = await load("src/extension/panel-html.ts", "atlas-html");
  const node = (p, t, l = [], f = true) => ({ p, t, w: "", f, l, c: [], g: 0 });
  const docs = [
    node("docs/features/ad-format.md", "Ad format"),
    node("docs/features/dialogue.md", "Dialogue & casting", ["docs/features/ad-format.md"]),
    ...Array.from({ length: 40 }, (_, i) => node(`docs/features/f${i}.md`, `Feature ${i}`)),
  ];
  const atlasFile = join(mkdtempSync(join(tmpdir(), "docmap-atlas-")), "atlas.html");
  writeFileSync(
    atlasFile,
    atlasHtml({
      cspSource: "file:",
      nonce: "browsertest",
      title: "Doc Atlas",
      tokensCss: `${dist}/tokens.css`,
      stylesCss: `${dist}/atlas.css`,
      script: `${dist}/atlas.js`,
      data: { docs, start: "docs/features/dialogue.md", forDoc: true },
    }),
  );
  const atlas = await browser.newPage({ viewport: { width: 700, height: 700 } });
  await atlas.addInitScript(() => {
    window.acquireVsCodeApi = () => ({ postMessage: () => {} });
  });
  await atlas.goto(pathToFileURL(atlasFile).href);
  await atlas.waitForSelector(".title");
  await check("Doc Atlas from a doc: that doc's map fills the panel, the feature list folded", async () => {
    assert.equal(await atlas.$eval(".title", (e) => e.textContent), "Dialogue & casting");
    assert.equal(await atlas.$eval("aside", (e) => getComputedStyle(e).display), "none");
    const width = await atlas.$eval("svg", (e) => e.getBoundingClientRect().width);
    assert.ok(width > 600, `the map is ${width}px wide`);
  });
  await check("Doc Atlas from a doc: '☰ All features' brings the list back, this doc marked", async () => {
    await atlas.click(".list-toggle");
    assert.notEqual(await atlas.$eval("aside", (e) => getComputedStyle(e).display), "none");
    assert.equal(await atlas.$eval(".item.on", (e) => e.textContent), "Dialogue & casting");
    assert.equal(await atlas.$eval(".title", (e) => e.textContent), "Dialogue & casting");
  });
  await atlas.close();
}

// ---------------------------------------------------------------------------------------------------------
// 3.3.0: 4-control top bar, 1-click Look popover (8 themes), high-contrast override, cross-polarity contrast
{
  const { page } = await openPanel();
  const sample = engine.parse(
    "# Simple Doc\n\n> A blockquote that must stay readable in light reading themes over dark VS Code.\n\nSee `backend/app/config/platform.yaml` and [`VisualThresholds`](https://example.com) and `plainCode`.\n",
    1,
    { readingTools: true },
  );
  assert.ok(sample.ok);
  await send(page, {
    type: "render",
    docVersion: 1,
    fileName: "simple.md",
    headings: sample.document.headings,
    html: sample.document.html,
    extras: {
      look: { theme: "vscode", fontScale: 1, lineWidth: "normal", clean: true },
      codeRefs: ["backend/app/config/platform.yaml"],
      inTab: true,
    },
  });
  await page.waitForSelector(".kp-look");

  await check(
    "3.3.0: quick-action top bar renders on a minimal doc (Look, Plans, Atlas, Compare, Browser, Questions, More)",
    async () => {
      const controls = await page.$$eval(".kp-actions > :is(.kp-look-wrap, button)", (els) =>
        els.map((e) => e.className.split(" ")[0]),
      );
      assert.deepEqual(controls, [
        "kp-look-wrap",
        "kp-clean",
        "kp-plans",
        "kp-atlas",
        "kp-compare",
        "kp-browser",
        "kp-questions",
        "kp-menu",
      ]);
    },
  );

  await check(
    "3.3.0: clicking Look opens popover with 8 theme swatches, 4 sizes, 4 widths; clicks send setLook and Esc closes",
    async () => {
      await page.click(".kp-look");
      assert.equal(await page.$eval("#dm-look-popover", (el) => el.hidden), false);
      assert.equal(await page.$$eval(".dm-swatch", (els) => els.length), 8);
      assert.equal(await page.$$eval(".dm-seg-btn[data-scale]", (els) => els.length), 4);
      assert.equal(await page.$$eval(".dm-seg-btn[data-width]", (els) => els.length), 4);

      assert.equal(await page.$eval(".kp-look", (el) => el.textContent), "Look: VS Code");
      await page.click('.dm-swatch[data-theme="warm-dark"]');
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
        type: "setLook",
        theme: "warm-dark",
      });
      assert.equal(await page.evaluate(() => document.body.getAttribute("data-reading-theme")), "warm-dark");
      assert.equal(await page.$eval(".kp-look", (el) => el.textContent), "Look: Warm Dark");

      await page.click('.dm-seg-btn[data-scale="1.15"]');
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), { type: "setLook", fontScale: 1.15 });

      await page.click('.dm-seg-btn[data-width="wide"]');
      assert.deepEqual(await page.evaluate(() => window.__sent.at(-1)), {
        type: "setLook",
        lineWidth: "wide",
      });
      assert.equal(await page.evaluate(() => document.body.getAttribute("data-line-width")), "wide");

      await page.keyboard.press("Escape");
      assert.equal(await page.$eval("#dm-look-popover", (el) => el.hidden), true);
    },
  );

  await check(
    "3.3.0: light reading themes stay readable even when VS Code is in a dark theme (no pale-yellow code leak)",
    async () => {
      const results = await page.evaluate(() => {
        document.body.classList.add("vscode-dark");
        document.documentElement.style.setProperty("--vscode-editor-background", "rgb(30, 30, 30)");
        document.documentElement.style.setProperty("--vscode-textPreformat-foreground", "rgb(215, 186, 125)");
        // Simulate VS Code's injected _defaultStyles dark blockquote background
        const def = document.createElement("style");
        def.textContent = "blockquote { background: rgb(34, 34, 34); }";
        document.head.prepend(def);
        const out = {};
        for (const theme of ["github", "paper", "solarized-light"]) {
          document.body.setAttribute("data-reading-theme", theme);
          const code = getComputedStyle(document.querySelector(".prose code:not(.dm-coderef)")).color;
          const ref = getComputedStyle(document.querySelector(".prose code.dm-coderef")).color;
          const linkCode = getComputedStyle(document.querySelector(".prose a code")).color;
          const quoteBg = getComputedStyle(document.querySelector(".prose blockquote")).backgroundColor;
          out[theme] = { code, ref, linkCode, quoteBg };
        }
        return out;
      });
      for (const [theme, colors] of Object.entries(results)) {
        assert.notEqual(colors.code, "rgb(215, 186, 125)", `${theme} code leaked dark VS Code pale yellow`);
        assert.notEqual(colors.ref, "rgb(215, 186, 125)", `${theme} coderef leaked dark VS Code pale yellow`);
        assert.notEqual(
          colors.linkCode,
          "rgb(215, 186, 125)",
          `${theme} link code leaked dark VS Code pale yellow`,
        );
        assert.notEqual(
          colors.quoteBg,
          "rgb(34, 34, 34)",
          `${theme} blockquote leaked dark VS Code background`,
        );
      }
    },
  );

  await check(
    "3.3.0 ADR-0003: high-contrast VS Code theme always overrides all new reading themes",
    async () => {
      const bg = await page.evaluate(() => {
        document.body.classList.remove("vscode-dark");
        document.body.classList.add("vscode-high-contrast");
        document.documentElement.style.setProperty("--vscode-editor-background", "rgb(0, 0, 0)");
        const seen = {};
        for (const theme of ["github-dark", "warm-dark", "solarized-light"]) {
          document.body.setAttribute("data-reading-theme", theme);
          seen[theme] = getComputedStyle(document.body).backgroundColor;
        }
        return seen;
      });
      assert.deepEqual(bg, {
        "github-dark": "rgb(0, 0, 0)",
        "warm-dark": "rgb(0, 0, 0)",
        "solarized-light": "rgb(0, 0, 0)",
      });
    },
  );

  await page.close();
}

await browser.close();
console.log(failures ? `panel.browser: ${failures} failed` : "panel.browser: all checks passed");
process.exit(failures ? 1 : 0);
