// Automated Chromium test for the Chrome MV3 extension (`dist-chrome/`).
// Verifies:
//   1. MV3 manifest, assets, and zero `.map` files in `dist-chrome/`.
//   2. Local `.md` viewer: outline, click-to-jump, filter, fold, Quick read, Look themes,
//      XSS safety (`<script>` stays text), Copy AI prompt, and Mermaid lazy loading.
//   3. GitHub `.markdown-body` sidebar: clean injection, heading navigation, filter,
//      Copy AI prompt, and SPA re-navigation (`turbo:load` / `pjax:end`) without duplicates.
// Run after `npm run build:chrome`: `npm run test:chrome`.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const distChrome = resolve("dist-chrome");
const distUrl = pathToFileURL(distChrome).href;

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.log(`  ✗ ${name}\n    ${String(error.message).split("\n").join("\n    ")}`);
  }
}

console.log("Chrome MV3 extension tests (dist-chrome/)");

// ---------- 1. Bundle & Manifest V3 integrity ----------
await check(
  "MV3 manifest.json is valid, version 3.3.2, zero permissions, popup wired, zero .map files",
  async () => {
    const manifestPath = join(distChrome, "manifest.json");
    assert.ok(existsSync(manifestPath), "dist-chrome/manifest.json missing — run npm run build:chrome");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, "3.3.2");
    assert.ok(
      typeof manifest.description === "string" && manifest.description.length <= 132,
      `manifest.description must be <= 132 chars for Chrome Web Store (got ${manifest.description?.length})`,
    );
    assert.deepEqual(manifest.permissions, []);
    assert.equal(manifest.action?.default_popup, "popup.html");
    // Chrome MV3 requires origin-only match patterns (path must be '/*') in web_accessible_resources
    for (const entry of manifest.web_accessible_resources ?? []) {
      for (const pattern of entry.matches ?? []) {
        assert.ok(
          pattern.endsWith("/*"),
          `web_accessible_resources match pattern must end with /*: ${pattern}`,
        );
      }
    }
    const files = readdirSync(distChrome, { recursive: true, encoding: "utf8" });
    const maps = files.filter((f) => f.endsWith(".map"));
    assert.deepEqual(maps, [], `Found unexpected .map files: ${maps.join(", ")}`);
    for (const required of [
      "local.js",
      "github.js",
      "mermaid.js",
      "popup.html",
      "popup.js",
      "tokens.css",
      "styles.css",
      "chrome-local.css",
      "github.css",
      join("icons", "icon128.png"),
    ]) {
      assert.ok(existsSync(join(distChrome, required)), `Missing ${required} in dist-chrome/`);
    }
  },
);

// Launch Chromium (same discovery order as tests/browser/panel.browser.mjs)
const executablePath = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));
const browser = await chromium.launch({ executablePath });

try {
  const workDir = mkdtempSync(join(tmpdir(), "docmap-chrome-test-"));

  // ---------- 2. Local .md viewer in Chromium ----------
  const sampleMd = `# Architecture Guide

Intro paragraph with enough words to read comfortably in the local Chrome viewer.

## Overview

First paragraph of overview explaining the system goals and constraints.

Second paragraph of overview that should hide when Quick read is enabled.

### Security Model

Raw HTML must never execute: <script>alert('xss')</script> and <img src=x onerror="alert('xss2')"> stay harmless text.
Remote tracking pixels never load: ![tracker](https://evil.example/pixel.png).

## Architecture Diagram

\`\`\`mermaid
graph TD
  A[Markdown] --> B[Outline]
\`\`\`

## Operations

Runbook notes for day-two operations.

### Deployment

Steps to deploy cleanly with zero downtime.

${Array.from({ length: 18 }, (_, i) => `Filler line ${i + 1} so the document scrolls past the viewport.\n`).join("\n")}
`;

  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const localFixture = join(workDir, "sample-guide.md.html");
  writeFileSync(
    localFixture,
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="${distUrl}/tokens.css">
  <link rel="stylesheet" href="${distUrl}/styles.css">
  <link rel="stylesheet" href="${distUrl}/chrome-local.css">
</head>
<body data-diagrams="${distUrl}/mermaid.js"><pre>${escapeHtml(sampleMd)}</pre></body>
</html>`,
  );

  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const dialogs = [];
    const networkRequests = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    page.on("request", (req) => {
      if (!req.url().startsWith("file:")) networkRequests.push(req.url());
    });
    await page.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text) => {
            window.__copied.push(text);
          },
        },
        configurable: true,
      });
    });

    await page.goto(pathToFileURL(localFixture).href);
    await page.addScriptTag({ path: join(distChrome, "local.js") });
    await page.waitForSelector(".outline-link");

    await check("Local .md: renders outline with all headings and reading times", async () => {
      const titles = await page.$$eval(".outline-link", (as) => as.map((a) => a.textContent));
      assert.deepEqual(titles, [
        "Architecture Guide",
        "Overview",
        "Security Model",
        "Architecture Diagram",
        "Operations",
        "Deployment",
      ]);
      const sizes = await page.$$eval(".outline-size", (els) => els.length);
      assert.equal(sizes, 6);
    });

    await check("Local .md: XSS safety & zero network requests (remote images blocked)", async () => {
      assert.deepEqual(dialogs, []);
      assert.deepEqual(networkRequests, [], `Unexpected network requests: ${networkRequests.join(", ")}`);
      const scriptsInProse = await page.$$eval(".prose script", (els) => els.length);
      assert.equal(scriptsInProse, 0);
      const proseText = await page.$eval(".prose", (el) => el.textContent ?? "");
      assert.ok(proseText.includes("<script>alert('xss')</script>"));
    });

    await check("Local .md: click-to-jump updates aria-current='location'", async () => {
      await page.click('.outline-row[data-id="operations"] .outline-link');
      const current = await page.$eval('.outline-row[data-id="operations"] .outline-link', (el) =>
        el.getAttribute("aria-current"),
      );
      assert.equal(current, "location");
    });

    await check("Local .md: filter-by-typing narrows headings and clears cleanly", async () => {
      await page.fill("input.filter", "deploy");
      const visible = await page.$$eval(".outline-row:not([hidden]) .outline-link", (as) =>
        as.map((a) => a.textContent),
      );
      assert.deepEqual(visible, ["Deployment"]);
      const status = await page.$eval(".filter-status", (el) => el.textContent);
      assert.equal(status, "1 of 6 headings");
      await page.fill("input.filter", "");
      const allVisible = await page.$$eval(".outline-row:not([hidden])", (els) => els.length);
      assert.equal(allVisible, 6);
    });

    await check("Local .md: fold twisty hides sub-section content and unfolds again", async () => {
      await page.click('.outline-row[data-id="overview"] .twisty');
      const collapsedCount = await page.$$eval("[data-collapsed-content]", (els) => els.length);
      assert.ok(collapsedCount > 0, "Expected folded blocks to have data-collapsed-content");
      await page.click('.outline-row[data-id="overview"] .twisty');
      const afterUnfold = await page.$$eval("[data-collapsed-content]", (els) => els.length);
      assert.equal(afterUnfold, 0);
    });

    await check("Local .md: Quick read ('s' / button) toggles skim mode", async () => {
      await page.click(".skim-toggle");
      const pressed = await page.$eval(".skim-toggle", (el) => el.getAttribute("aria-pressed"));
      assert.equal(pressed, "true");
      const hiddenBlocks = await page.$$eval("[data-skim-hidden]", (els) => els.length);
      assert.ok(hiddenBlocks > 0, "Expected extra paragraphs to be hidden in Quick read");
      await page.click(".skim-toggle");
      const pressedOff = await page.$eval(".skim-toggle", (el) => el.getAttribute("aria-pressed"));
      assert.equal(pressedOff, "false");
    });

    await check("Local .md: Look popover switches across all 8 reading themes", async () => {
      await page.click(".kp-look");
      const swatchCount = await page.$$eval(".dm-swatch", (els) => els.length);
      assert.equal(swatchCount, 8);
      await page.click('.dm-swatch[data-theme="paper"]');
      assert.equal(await page.evaluate(() => document.body.getAttribute("data-reading-theme")), "paper");
      await page.click('.dm-swatch[data-theme="github-dark"]');
      assert.equal(
        await page.evaluate(() => document.body.getAttribute("data-reading-theme")),
        "github-dark",
      );
      await page.keyboard.press("Escape");
    });

    await check("Local .md: Copy AI prompt copies built prompt to clipboard", async () => {
      await page.click(".dm-ai-btn");
      await page.click('.dm-ai-item[data-prompt-id="summary"]');
      await page.waitForFunction(() => window.__copied.length > 0);
      const copied = await page.evaluate(() => window.__copied[0]);
      assert.ok(copied.includes("Summarise"), "Expected summary prompt text");
      assert.ok(copied.includes("Architecture Guide"), "Expected quoted document content");
    });

    await check("Local .md: Mermaid diagram lazy-loads and renders SVG", async () => {
      await page.waitForSelector(".mermaid-diagram svg", { timeout: 15_000 });
      const svgCount = await page.$$eval(".mermaid-diagram svg", (els) => els.length);
      assert.equal(svgCount, 1);
    });

    await page.close();
  }

  // ---------- 2a. Regression: heading with id='app' does not collide with #app container ----------
  {
    const clobberFixture = join(workDir, "clobber.md.html");
    writeFileSync(
      clobberFixture,
      `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${distUrl}/tokens.css"><link rel="stylesheet" href="${distUrl}/styles.css"><link rel="stylesheet" href="${distUrl}/chrome-local.css"></head><body><pre>${escapeHtml("# Top\n\nIntro\n\n## app\n\nBody under app heading.\n")}</pre></body></html>`,
    );
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(pathToFileURL(clobberFixture).href);
    await page.addScriptTag({ path: join(distChrome, "local.js") });
    await page.waitForSelector('.outline-row[data-id="app"] .outline-link');
    await check(
      "Local .md: heading id='app' jumps cleanly without colliding with #app container",
      async () => {
        await page.click('.outline-row[data-id="app"] .outline-link');
        const current = await page.$eval('.outline-row[data-id="app"] .outline-link', (el) =>
          el.getAttribute("aria-current"),
        );
        assert.equal(current, "location");
      },
    );
    await page.close();
  }

  // ---------- 2a2. Tier 1 Chrome features: local images, Where this stands, Attention drawer, Slides ----------
  {
    const tier1Md = [
      "# Launch Plan",
      "",
      "**Status:** Phase 1 is draft.",
      "",
      "![Local diagram](./diagram.png)",
      "![Traversal blocked](../outside.png)",
      "![Remote blocked](https://evil.example/pixel.png)",
      "",
      "## Phase 1 — Core API (built 2026-11-20)",
      "",
      "- [x] Ship auth endpoint",
      "- [ ] Add rate limiting",
      "",
      "Should we enable strict CORS by default?",
      "",
      "---",
      "",
      "## Phase 2 — Rollout (draft)",
      "",
      "Ready for next sprint.",
      "",
    ].join("\n");
    const tier1Fixture = join(workDir, "tier1.md.html");
    writeFileSync(
      tier1Fixture,
      `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${distUrl}/tokens.css"><link rel="stylesheet" href="${distUrl}/styles.css"><link rel="stylesheet" href="${distUrl}/chrome-local.css"></head><body><pre>${escapeHtml(tier1Md)}</pre></body></html>`,
    );
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(pathToFileURL(tier1Fixture).href);
    await page.addScriptTag({ path: join(distChrome, "local.js") });
    await page.waitForSelector(".dm-standing");

    await check(
      "Local .md Tier 1: renders local relative images, blocks traversal/remote, shows Where this stands, Attention drawer & Slides",
      async () => {
        // Local relative image renders; traversal & remote stay blocked
        const imgs = await page.$$eval(".prose img", (els) => els.map((e) => e.getAttribute("src") ?? ""));
        assert.equal(imgs.length, 1, `Expected only 1 local <img>, got ${JSON.stringify(imgs)}`);
        assert.ok(imgs[0]?.startsWith("file://") && imgs[0].endsWith("/diagram.png"));

        // Where this stands card + progress stat + attention pills + outline badge
        const statText = await page.$eval(".dm-chrome-stat", (e) => e.textContent);
        assert.equal(statText, "1/2 done");
        const attnBadge = await page.$eval(".dm-outline-attn", (e) => e.textContent);
        assert.ok(attnBadge?.includes("?1") && attnBadge.includes("☐1"));

        // Click Questions pill → drawer opens with the question
        await page.click(".dm-pill-warn");
        const qText = await page.$eval(".dm-attention-item", (e) => e.textContent);
        assert.ok(qText?.includes("Should we enable strict CORS by default?"));

        // Slides mode (2 slides separated by ---)
        const slidesBtn = await page.$("button.dm-chrome-pill:has-text('Slides (2)')");
        assert.ok(slidesBtn, "Expected Slides (2) button");
        await slidesBtn.click();
        assert.equal(await page.$eval(".dm-slides-counter", (e) => e.textContent), "Slide 1 of 2");
        await page.keyboard.press("ArrowRight");
        assert.equal(await page.$eval(".dm-slides-counter", (e) => e.textContent), "Slide 2 of 2");
        await page.keyboard.press("Escape");
        const slidesOn = await page.evaluate(() => document.body.classList.contains("dm-slides-on"));
        assert.equal(slidesOn, false);

        // Outline collapse/expand button (requires .map-root container-type: inline-size)
        await page.click(".outline-hide");
        assert.equal(
          await page.$eval(".outline", (e) => getComputedStyle(e).visibility),
          "hidden",
          "Clicking ‹ should hide the outline",
        );
        await page.click(".outline-show");
        assert.equal(
          await page.$eval(".outline", (e) => getComputedStyle(e).visibility),
          "visible",
          "Clicking Contents button should show the outline again",
        );
      },
    );
    await page.close();
  }

  // ---------- 2b. Enterprise guardrails: 1 MB < 1 s + > 2 MB too-large gate ----------
  {
    const oneMbSection =
      "## Section\n\n" +
      "A clear paragraph of technical documentation explaining architecture, trade-offs, and verification steps. ".repeat(
        20,
      ) +
      "\n\n";
    const oneMbMd = `# One MB Doc\n\n${oneMbSection.repeat(480)}`;
    const perfFixture = join(workDir, "one-mb.md.html");
    writeFileSync(
      perfFixture,
      `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${distUrl}/tokens.css"><link rel="stylesheet" href="${distUrl}/styles.css"><link rel="stylesheet" href="${distUrl}/chrome-local.css"></head><body><pre>${escapeHtml(oneMbMd)}</pre></body></html>`,
    );

    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(pathToFileURL(perfFixture).href);
    const t0 = Date.now();
    await page.addScriptTag({ path: join(distChrome, "local.js") });
    await page.waitForSelector(".outline-link");
    const elapsed = Date.now() - t0;
    await check(`Local .md guardrail: 1 MB doc renders in < 1000 ms (${elapsed} ms)`, async () => {
      assert.ok(elapsed < 1000, `Expected < 1000 ms, took ${elapsed} ms`);
    });
    await page.close();
  }

  {
    const hugeMd = `# Huge Doc\n\n${"x".repeat(2_200_000)}`;
    const hugeFixture = join(workDir, "huge.md.html");
    writeFileSync(
      hugeFixture,
      `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${distUrl}/tokens.css"><link rel="stylesheet" href="${distUrl}/styles.css"><link rel="stylesheet" href="${distUrl}/chrome-local.css"></head><body><pre>${escapeHtml(hugeMd)}</pre></body></html>`,
    );

    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(pathToFileURL(hugeFixture).href);
    await page.addScriptTag({ path: join(distChrome, "local.js") });
    await page.waitForSelector(".state-action");
    await check(
      "Local .md guardrail: > 2 MB doc shows 'Render anyway' gate and renders on click",
      async () => {
        const btnText = await page.$eval(".state-action", (el) => el.textContent ?? "");
        assert.ok(btnText.toLowerCase().includes("render"));
        await page.click(".state-action");
        await page.waitForSelector(".outline-link");
        const h1 = await page.$eval(".outline-link", (el) => el.textContent);
        assert.equal(h1, "Huge Doc");
      },
    );
    await page.close();
  }

  // ---------- 3. GitHub .markdown-body fixture + SPA navigation ----------
  const githubFixture = join(workDir, "github-readme.html");
  writeFileSync(
    githubFixture,
    `<!doctype html>
<html lang="en" data-color-mode="light">
<head>
  <meta charset="utf-8">
  <title>octocat/demo-repo</title>
  <link rel="stylesheet" href="${distUrl}/github.css">
  <style>
    body { margin: 0; padding: 24px; font-family: system-ui, sans-serif; }
    .spacer { height: 700px; }
  </style>
</head>
<body>
  <div id="readme">
    <article class="markdown-body">
      <div class="markdown-heading">
        <h1 class="heading-element">Demo Repository</h1>
        <a id="user-content-demo-repository" class="anchor" href="#demo-repository"></a>
      </div>
      <p>A sample repository README for testing docmap's GitHub sidebar.</p>
      <div class="spacer"></div>
      <div class="markdown-heading">
        <h2 class="heading-element">Installation</h2>
        <a id="user-content-installation" class="anchor" href="#installation"></a>
      </div>
      <p>Install via npm or load unpacked in Chrome.</p>
      <div class="spacer"></div>
      <div class="markdown-heading">
        <h2 class="heading-element">Usage</h2>
        <a id="user-content-usage" class="anchor" href="#usage"></a>
      </div>
      <p>Open any Markdown file or GitHub README.</p>
      <h3>Keyboard Shortcuts</h3>
      <p>Press slash to filter headings quickly.</p>
    </article>
  </div>
</body>
</html>`,
  );

  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text) => {
            window.__copied.push(text);
          },
        },
        configurable: true,
      });
    });

    await page.goto(pathToFileURL(githubFixture).href);
    await page.addScriptTag({ path: join(distChrome, "github.js") });
    await page.waitForSelector("[data-docmap-gh] .dm-gh-link");

    await check("GitHub README: injects single sidebar with all headings and reading times", async () => {
      const sidebars = await page.$$eval("[data-docmap-gh]", (els) => els.length);
      assert.equal(sidebars, 1);
      const titles = await page.$$eval(".dm-gh-link", (as) => as.map((a) => a.textContent));
      assert.deepEqual(titles, ["Demo Repository", "Installation", "Usage", "Keyboard Shortcuts"]);
      const sizes = await page.$$eval(".dm-gh-size", (els) => els.length);
      assert.equal(sizes, 4);
    });

    await check("GitHub README: click-to-jump navigates and marks current heading", async () => {
      await page.click('.dm-gh-row[data-id="user-content-usage"] .dm-gh-link');
      const current = await page.$eval('.dm-gh-row[data-id="user-content-usage"] .dm-gh-link', (el) =>
        el.getAttribute("aria-current"),
      );
      assert.equal(current, "location");
    });

    await check("GitHub README: filter narrows visible rows and shows count", async () => {
      await page.fill(".dm-gh-filter", "install");
      const visible = await page.$$eval(".dm-gh-row:not([hidden]) .dm-gh-link", (as) =>
        as.map((a) => a.textContent),
      );
      assert.deepEqual(visible, ["Installation"]);
      const status = await page.$eval(".dm-gh-status", (el) => el.textContent);
      assert.equal(status, "1 of 4 headings");
      await page.fill(".dm-gh-filter", "");
    });

    await check("GitHub README: Copy AI prompt works from GitHub sidebar", async () => {
      await page.click(".dm-gh-ai-btn");
      await page.click('.dm-gh-ai-item[data-prompt-id="summary"]');
      await page.waitForFunction(() => window.__copied.length > 0);
      const copied = await page.evaluate(() => window.__copied[0]);
      assert.ok(copied.includes("Demo Repository"));
    });

    await check(
      "GitHub SPA re-navigation: turbo:load / pjax:end updates cleanly with zero duplicates",
      async () => {
        await page.evaluate(() => {
          const readme = document.getElementById("readme");
          if (readme) {
            readme.innerHTML = `<article class="markdown-body">
            <h1 id="changelog">Changelog</h1>
            <p>Release notes for version 3.3.0.</p>
            <h2 id="chrome-extension">Chrome Extension</h2>
            <p>Read-only MV3 extension.</p>
          </article>`;
          }
          document.dispatchEvent(new Event("turbo:load"));
          document.dispatchEvent(new Event("pjax:end"));
        });
        await page.waitForFunction(() => {
          const links = [...document.querySelectorAll(".dm-gh-link")].map((a) => a.textContent);
          return links.length === 2 && links[0] === "Changelog";
        });
        const sidebars = await page.$$eval("[data-docmap-gh]", (els) => els.length);
        assert.equal(sidebars, 1, "Expected exactly 1 sidebar after SPA re-navigation");

        // Navigate to a non-Markdown GitHub tab (e.g. Issues) — sidebar should tear down cleanly
        await page.evaluate(() => {
          const readme = document.getElementById("readme");
          if (readme) readme.innerHTML = "<div class='issues-list'>No markdown here</div>";
          document.dispatchEvent(new Event("turbo:load"));
        });
        await page.waitForFunction(() => document.querySelectorAll("[data-docmap-gh]").length === 0);
      },
    );

    await page.close();
  }

  // ---------- 4. Toolbar popup (popup.html + popup.js) ----------
  {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${distUrl}/popup.html`);

    await check(
      "Toolbar popup renders file:// setup checklist, shortcuts, and copy button without errors",
      async () => {
        const text = await page.evaluate(() => document.body.innerText);
        assert.ok(text.includes("Allow access to file URLs"), "Missing file:// setup instruction");
        assert.ok(text.includes("chrome://extensions"), "Missing chrome://extensions hint");
        assert.ok(text.includes("Quick read"), "Missing shortcuts section");
        await page.click("#copy-ext-url");
        await page.waitForFunction(
          () => (document.getElementById("copy-status")?.textContent ?? "").length > 0,
        );
        const status = await page.textContent("#copy-status");
        assert.ok(status && status.length > 0, "Expected copy status feedback");
        assert.deepEqual(errors, [], `Unexpected popup errors: ${errors.join("; ")}`);
      },
    );

    await page.close();
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} Chrome extension browser test(s) failed.`);
  process.exit(1);
}
console.log("\nAll Chrome extension browser tests passed.");
