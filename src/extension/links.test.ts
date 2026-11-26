import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { isCodeFile, isImageFile, openKind, resolveLocalTarget, rootContaining } from "./links";

// A throwaway tree: <tmp>/ws/{README.md, docs/plan.md, docs/img/d.png, docs/escape -> <tmp>/outside}
// Both links are folder links: on Windows a junction needs no admin rights or Developer Mode (a symlink does), and
// is followed the same way, so the escape checks below test the same thing.
const FOLDER_LINK = process.platform === "win32" ? "junction" : undefined;
let tmp: string;
let ws: string;
let docs: string;
beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "docmap-links-")));
  ws = join(tmp, "ws");
  docs = join(ws, "docs");
  mkdirSync(join(docs, "img"), { recursive: true });
  mkdirSync(join(tmp, "outside"));
  writeFileSync(join(ws, "README.md"), "# Readme\n");
  writeFileSync(join(docs, "plan.md"), "# Plan\n");
  writeFileSync(join(docs, "a b.md"), "# Spaced\n");
  writeFileSync(join(docs, "img", "d.png"), "png");
  writeFileSync(join(tmp, "outside", "secret.md"), "# Secret\n");
  writeFileSync(join(tmp, "sibling.md"), "# Sibling\n");
  symlinkSync(join(tmp, "outside"), join(docs, "escape"), FOLDER_LINK);
});

describe("resolveLocalTarget — what a document may open", () => {
  it("opens a relative file next to the document, with its #fragment", () => {
    expect(resolveLocalTarget("plan.md#setup", docs, [ws])).toEqual({
      file: join(docs, "plan.md"),
      lexical: join(docs, "plan.md"),
      fragment: "setup",
    });
  });

  it("follows ../ as long as it stays inside the workspace", () => {
    expect(resolveLocalTarget("../README.md", docs, [ws])?.file).toBe(join(ws, "README.md"));
  });

  it("treats /rooted paths as relative to the workspace root", () => {
    expect(resolveLocalTarget("/docs/plan.md", docs, [ws])?.file).toBe(join(docs, "plan.md"));
  });

  it("decodes percent-encoding (markdown-it encodes spaces)", () => {
    expect(resolveLocalTarget("a%20b.md", docs, [ws])?.file).toBe(join(docs, "a b.md"));
  });

  it("resolves images the same way", () => {
    expect(resolveLocalTarget("img/d.png", docs, [ws])?.file).toBe(join(docs, "img", "d.png"));
  });

  it.each([
    ["../../sibling.md", "climbs out of the workspace"],
    ["../../outside/secret.md", "climbs out of the workspace"],
    ["escape/secret.md", "a symlink inside the workspace pointing outside it"],
    ["%2e%2e/%2e%2e/sibling.md", "encoded ../"],
    ["missing.md", "a file that does not exist"],
    ["img", "a folder"],
    ["https://example.com/x.md", "a web URL"],
    ["file:///etc/passwd", "a file: URL"],
    ["//host/share/x.md", "a protocol-relative URL"],
    ["#setup", "a same-document fragment (handled in the panel)"],
    ["plan.md%00.png", "a NUL byte"],
    ["%E0%A4%A", "a malformed escape"],
  ])("refuses %s (%s)", (href) => {
    expect(resolveLocalTarget(href, docs, [ws])).toBeUndefined();
  });

  it("a workspace opened through a symlink: the file opened is resolved, the path given to the panel is not", () => {
    const linkedWs = join(tmp, "ws-link");
    symlinkSync(ws, linkedWs, FOLDER_LINK);
    const target = resolveLocalTarget("img/d.png", join(linkedWs, "docs"), [linkedWs]);
    expect(target?.file).toBe(join(docs, "img", "d.png"));
    expect(target?.lexical).toBe(join(linkedWs, "docs", "img", "d.png"));
  });

  it("with no workspace open, only the document's own folder tree is allowed", () => {
    expect(resolveLocalTarget("plan.md", docs, [])?.file).toBe(join(docs, "plan.md"));
    expect(resolveLocalTarget("../README.md", docs, [])).toBeUndefined();
  });
});

// Windows, replayed on any OS: path.win32 + a file system that records every lookup. The property that matters is
// not only "refused" but "never looked up" — on Windows, looking up a \\host\share path already contacts the host.
describe("resolveLocalTarget on Windows paths", () => {
  const lookedUp: string[] = [];
  const known = new Set(["C:\\ws", "C:\\ws\\docs", "C:\\ws\\docs\\img\\d.png"]);
  const files = new Set(["C:\\ws\\docs\\img\\d.png"]);
  const win = {
    path: path.win32,
    realpath: (p: string) => {
      lookedUp.push(p);
      if (known.has(p)) return p;
      throw new Error("ENOENT");
    },
    isFile: (p: string) => files.has(p),
  };
  /** Inside the workspace means the root itself or below it — not "C:\\ws-other". */
  const outsideWs = (p: string) => p !== "C:\\ws" && !p.startsWith("C:\\ws\\");
  const docDir = "C:\\ws\\docs";

  it.each([
    "%5C%5Chost.example%5Cshare%5Cx.png",
    "%5C/host.example/share/x.png",
    "/%5C%5Chost.example%5Cshare%5Cx.png",
    "..%5C..%5Coutside%5Cx.png",
    "C%3A%5CWindows%5Cx.png",
    "notes.md%3Astream",
  ])("refuses %s without ever touching the file system", (href) => {
    lookedUp.length = 0;
    expect(resolveLocalTarget(href, docDir, ["C:\\ws"], win)).toBeUndefined();
    expect(lookedUp.filter(outsideWs)).toEqual([]);
  });

  it("a path that climbs out lexically is refused before any lookup", () => {
    lookedUp.length = 0;
    expect(resolveLocalTarget("../../other/x.png", docDir, ["C:\\ws"], win)).toBeUndefined();
    expect(lookedUp.filter(outsideWs)).toEqual([]);
  });

  it("an ordinary relative path still works; a folder or a missing file does not", () => {
    expect(resolveLocalTarget("img/d.png", docDir, ["C:\\ws"], win)?.file).toBe("C:\\ws\\docs\\img\\d.png");
    expect(resolveLocalTarget(".", docDir, ["C:\\ws"], win)).toBeUndefined();
    expect(resolveLocalTarget("img/missing.png", docDir, ["C:\\ws"], win)).toBeUndefined();
  });

  it("a sibling folder that shares the root's name prefix is outside", () => {
    lookedUp.length = 0;
    expect(resolveLocalTarget("../../ws-other/x.png", docDir, ["C:\\ws"], win)).toBeUndefined();
    expect(lookedUp.filter(outsideWs)).toEqual([]);
  });
});

describe("rootContaining across drives (Windows)", () => {
  it("a file on another drive is outside, not inside", () => {
    expect(rootContaining("C:\\Users\\x\\Downloads\\evil.md", ["D:\\proj"], path.win32)).toBeUndefined();
    expect(rootContaining("D:\\proj\\docs\\a.md", ["D:\\proj"], path.win32)).toBe("D:\\proj");
  });
});

describe("what a document may do with a resolved file", () => {
  it.each([
    ["notes.md", "text"],
    ["README.markdown", "text"],
    ["log.txt", "text"],
    ["diagram.PNG", "image"],
    ["logo.svg", "image"],
    ["payload.ipynb", undefined],
    ["tool.exe", undefined],
    ["ext.vsix", undefined],
    ["settings.json", undefined],
    ["id_rsa", undefined],
  ])("%s → %s", (file, kind) => {
    expect(openKind(file)).toBe(kind);
  });

  it("source files a report may open as text (Doc Atlas code links) — never binaries, notebooks or keys", () => {
    for (const f of ["backend/app.py", "src/Setup.tsx", "db/schema.sql"]) expect(isCodeFile(f), f).toBe(true);
    for (const f of ["tool.exe", "payload.ipynb", "id_rsa", "ext.vsix", "notes.md"])
      expect(isCodeFile(f), f).toBe(false);
  });

  it("only image files load into the panel as images", () => {
    expect(isImageFile("img/a.webp")).toBe(true);
    expect(isImageFile(".ssh/id_rsa")).toBe(false);
    expect(isImageFile("notes.md")).toBe(false);
  });
});
