import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_ICON_PATH, buildFont, FONT_PATH, GLYPHS } from "./build-icons.mjs";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const contributed = manifest.contributes.icons ?? {};

describe("docmap's icons", () => {
  it("every editor-title button uses docmap's own icon, and each icon is in the font", () => {
    // the buttons on the toolbar itself (the "…" overflow menu shows no icons)
    const titleCommands = manifest.contributes.menus["editor/title"]
      .filter((m) => m.group.startsWith("navigation"))
      .map((m) => m.command);
    for (const id of titleCommands) {
      const command = manifest.contributes.commands.find((c) => c.command === id);
      const icon = /^\$\(([\w-]+)\)$/.exec(command?.icon ?? "")?.[1];
      expect(icon, `${id} icon`).toBeDefined();
      const entry = contributed[icon];
      expect(entry, `${icon} is contributed`).toBeDefined();
      expect(entry.default.fontPath).toBe(FONT_PATH);
      const glyph = GLYPHS.find((g) => g.id === icon);
      expect(glyph, `${icon} is built into the font`).toBeDefined();
      expect(entry.default.fontCharacter).toBe(`\\${glyph.codepoint.toString(16).toUpperCase()}`);
    }
  });

  it("the committed font is up to date with the SVG sources (run `npm run icons` after editing one)", async () => {
    expect(existsSync(FONT_PATH)).toBe(true);
    expect((await buildFont()).equals(readFileSync(FONT_PATH))).toBe(true);
  });

  it("the app icon is a 128×128 PNG", () => {
    expect(manifest.icon).toBe(APP_ICON_PATH);
    const png = readFileSync(APP_ICON_PATH);
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([128, 128]);
  });

  it("the icons ship in the .vsix (only their SVG sources stay out)", () => {
    const ignored = readFileSync(".vscodeignore", "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(ignored).toContain("media/icons/**");
    expect(ignored.some((l) => /^media\/?(\*\*)?$|^media\/\*\*?$|woff|icon\.png|\*\.png/.test(l))).toBe(
      false,
    );
  });
});
