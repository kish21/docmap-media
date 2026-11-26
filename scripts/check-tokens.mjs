// Proves the design tokens RESOLVE at runtime in the real panel page (DESIGN.md §2): renders panelHtml()
// with the built stylesheets in Chromium and reads tokens back — once with VS Code theme variables present
// (they must win), once without (the OKLCH fallbacks must apply, light and dark).
// Browser: CHROMIUM_PATH, else /opt/pw-browsers/chromium, else google-chrome on PATH.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { chromium } from "playwright-core";

const bundled = await esbuild.build({
  entryPoints: ["src/extension/panel-html.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { panelHtml } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

const dist = pathToFileURL(resolve("dist")).href;
const html = panelHtml({
  cspSource: "file:",
  nonce: "check",
  title: "Map: check.md",
  tokensCss: `${dist}/tokens.css`,
  stylesCss: `${dist}/styles.css`,
  script: `${dist}/missing.js`,
});
const file = join(mkdtempSync(join(tmpdir(), "docmap-")), "panel.html");
writeFileSync(file, html);

const executablePath = [
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));
const browser = await chromium.launch({ executablePath });
const read = async (scheme, themeVars) => {
  const page = await browser.newPage({ colorScheme: scheme });
  await page.goto(pathToFileURL(file).href);
  return page.evaluate((vars) => {
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
    const s = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return {
      primary: s.getPropertyValue("--primary").trim(),
      bodyBg: body.backgroundColor,
      font: s.getPropertyValue("--text-sm").trim(),
    };
  }, themeVars);
};
const vscodeTheme = await read("light", {
  "--vscode-textLink-foreground": "rgb(1, 2, 3)",
  "--vscode-editor-background": "rgb(9, 9, 9)",
});
const light = await read("light", {});
const dark = await read("dark", {});
await browser.close();

const checks = [
  ["VS Code theme wins: --primary", vscodeTheme.primary === "rgb(1, 2, 3)", vscodeTheme.primary],
  ["VS Code theme wins: body background", vscodeTheme.bodyBg === "rgb(9, 9, 9)", vscodeTheme.bodyBg],
  ["light fallback: --primary", light.primary === "oklch(0.5 0.16 252)", light.primary],
  ["dark fallback: --primary", dark.primary === "oklch(0.75 0.12 245)", dark.primary],
  ["type scale present: --text-sm", light.font === "0.875rem", light.font],
];
let failed = 0;
for (const [name, ok, got] of checks) {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name} = ${got}`);
  if (!ok) failed++;
}
console.log(
  failed ? `check-tokens: ${failed} failed` : "check-tokens: tokens resolve at runtime (theme, light, dark)",
);
process.exit(failed ? 1 : 0);
