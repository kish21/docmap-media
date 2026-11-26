// Builds docmap's icons from the SVG sources in media/icons/ (`npm run icons`):
//  - media/docmap-icons.woff: the editor-title button icons as an icon font. A font glyph takes the theme's
//    colour, so the buttons follow light, dark and high-contrast themes like VS Code's own icons (ADR-0003).
//  - media/icon.png: the 128 px app icon for the Extensions view and the Marketplace.
// The outputs are committed; the unit test beside this file fails if they no longer match the sources.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import svg2ttf from "svg2ttf";
import { SVGIcons2SVGFontStream } from "svgicons2svgfont";
import ttf2woff from "ttf2woff";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FONT_PATH = "media/docmap-icons.woff";
export const APP_ICON_PATH = "media/icon.png";

/** Every button icon: its id in package.json (`$(id)`), its source, and its code point in the font. */
export const GLYPHS = [
  { id: "docmap-map-side", file: "media/icons/map-side.svg", codepoint: 0xe001 },
  { id: "docmap-map-here", file: "media/icons/map-here.svg", codepoint: 0xe002 },
  { id: "docmap-map-browser", file: "media/icons/map-browser.svg", codepoint: 0xe003 },
  { id: "docmap-show-source", file: "media/icons/show-source.svg", codepoint: 0xe004 },
];

/** The icon font, byte for byte the same on every run (fixed timestamp), so the committed file can be checked. */
export async function buildFont() {
  const fontStream = new SVGIcons2SVGFontStream({
    fontName: "docmap-icons",
    fontHeight: 1000,
    normalize: true,
    log: () => {},
  });
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    fontStream.on("data", (chunk) => chunks.push(String(chunk)));
    fontStream.on("end", resolve);
    fontStream.on("error", reject);
  });
  for (const glyph of GLYPHS) {
    const source = Readable.from([readFileSync(path.join(root, glyph.file))]);
    source.metadata = { name: glyph.id, unicode: [String.fromCodePoint(glyph.codepoint)] };
    fontStream.write(source);
  }
  fontStream.end();
  await done;
  const ttf = svg2ttf(chunks.join(""), { ts: 0, version: "1.0" });
  return Buffer.from(ttf2woff(new Uint8Array(ttf.buffer)).buffer);
}

/** The app icon: the SVG source drawn at 128×128 by the Chromium the browser tests already use. */
async function buildAppIcon() {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  });
  try {
    const page = await browser.newPage({ viewport: { width: 128, height: 128 } });
    const svg = readFileSync(path.join(root, "media/icons/app.svg"), "utf8");
    await page.setContent(
      `<body style="margin:0">${svg.replace("<svg ", '<svg width="128" height="128" ')}</body>`,
    );
    await page.screenshot({ path: path.join(root, APP_ICON_PATH), omitBackground: true });
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(path.join(root, FONT_PATH), await buildFont());
  await buildAppIcon();
  console.log(`icons: wrote ${FONT_PATH} and ${APP_ICON_PATH}`);
}
