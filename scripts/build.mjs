// Bundles the three runtimes (ADR-0001, ADR-0004). Usage: node scripts/build.mjs [--watch] [--tests]
import { copyFileSync, mkdirSync } from "node:fs";
import { glob } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const tests = process.argv.includes("--tests");
const mcpOnly = process.argv.includes("--mcp-only");
const common = { bundle: true, sourcemap: true, logLevel: "info", target: "es2022" };

const mcpBuilds = [
  // 3.0 AI level 2: the local MCP server agents start themselves (Node, no vscode)
  {
    ...common,
    entryPoints: ["src/mcp/server.ts"],
    outfile: "dist/mcp.js",
    platform: "node",
    format: "cjs",
  },
  // 3.3.0 standalone npx MCP binary (zero runtime deps, no sourcemaps, ESM CLI)
  {
    ...common,
    sourcemap: false,
    entryPoints: ["src/mcp/cli.ts"],
    outfile: "packages/docmap-mcp/bin/docmap-mcp.mjs",
    platform: "node",
    format: "esm",
    banner: { js: "#!/usr/bin/env node" },
  },
];

const builds = mcpOnly
  ? mcpBuilds
  : [
      // extension host: Node, CommonJS, `vscode` provided by VS Code at runtime
      {
        ...common,
        entryPoints: ["src/extension/extension.ts"],
        outfile: "dist/extension.js",
        platform: "node",
        format: "cjs",
        external: ["vscode"],
      },
      // webview: browser, one IIFE, loaded under a nonce CSP
      {
        ...common,
        entryPoints: ["src/webview/main.ts"],
        outfile: "dist/webview.js",
        platform: "browser",
        format: "iife",
      },
      // Doc Atlas graph page (owner call 2026-11-24): its own small IIFE, same nonce CSP
      {
        ...common,
        entryPoints: ["src/webview/atlas.ts"],
        outfile: "dist/atlas.js",
        platform: "browser",
        format: "iife",
      },
      // 3.3.0 interactive Plans Dashboard page: its own small IIFE, same nonce CSP
      {
        ...common,
        entryPoints: ["src/webview/plans.ts"],
        outfile: "dist/plans.js",
        platform: "browser",
        format: "iife",
      },
      ...mcpBuilds,
      // diagrams: a separate file the panel loads only for documents with a ```mermaid block (0.0.8)
      {
        ...common,
        sourcemap: false,
        minify: true,
        entryPoints: ["src/webview/mermaid-entry.ts"],
        outfile: "dist/mermaid.js",
        platform: "browser",
        format: "iife",
        legalComments: "eof",
      },
    ];
if (tests) {
  const entryPoints = [];
  for await (const f of glob("tests/integration/**/*.test.ts")) entryPoints.push(f);
  builds.push({
    ...common,
    entryPoints,
    outdir: "dist/tests",
    outbase: "tests/integration",
    platform: "node",
    format: "cjs",
    external: ["vscode", "mocha"],
  });
}

mkdirSync("dist", { recursive: true });
mkdirSync("packages/docmap-mcp/bin", { recursive: true });
if (!mcpOnly) {
  for (const css of ["tokens.css", "styles.css", "atlas.css", "plans.css"])
    copyFileSync(`src/webview/${css}`, `dist/${css}`);
}

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
