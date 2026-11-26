// Builds the read-only Chrome Manifest V3 extension into `dist-chrome/`.
// Usage: node scripts/build-chrome.mjs
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as esbuild from "esbuild";

const OUT = "dist-chrome";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "icons"), { recursive: true });

const common = {
  bundle: true,
  sourcemap: false,
  minify: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  logLevel: "info",
};

await Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ["src/chrome/local.ts"],
    outfile: join(OUT, "local.js"),
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/chrome/github.ts"],
    outfile: join(OUT, "github.js"),
  }),
  esbuild.build({
    ...common,
    entryPoints: ["src/webview/mermaid-entry.ts"],
    outfile: join(OUT, "mermaid.js"),
    legalComments: "eof",
  }),
]);

copyFileSync("src/chrome/manifest.json", join(OUT, "manifest.json"));
copyFileSync("src/webview/tokens.css", join(OUT, "tokens.css"));
copyFileSync("src/webview/styles.css", join(OUT, "styles.css"));
copyFileSync("src/chrome/chrome-local.css", join(OUT, "chrome-local.css"));
copyFileSync("src/chrome/github.css", join(OUT, "github.css"));
copyFileSync("media/icon.png", join(OUT, "icons", "icon128.png"));

// Guard: never ship source maps in the Chrome Web Store bundle
const files = readdirSync(OUT, { recursive: true, encoding: "utf8" });
const maps = files.filter((f) => f.endsWith(".map"));
if (maps.length > 0) {
  throw new Error(`Unexpected .map files in ${OUT}: ${maps.join(", ")}`);
}

console.log(`Built Chrome MV3 extension in ${OUT}/ (${files.length} files, 0 .map files)`);
