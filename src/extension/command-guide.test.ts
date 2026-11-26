import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMAND_GUIDE, NOT_IN_GUIDE } from "./command-guide";

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as {
  contributes: { commands: { command: string }[] };
};
const contributed = pkg.contributes.commands.map((c) => c.command);
const listed = COMMAND_GUIDE.flatMap((g) => g.entries.map((e) => e.command));

describe("What can docmap do? (2026-11-22)", () => {
  it("lists every docmap command once (except the ones that act on something clicked)", () => {
    const missing = contributed.filter((c) => !listed.includes(c) && !NOT_IN_GUIDE.includes(c));
    expect(missing).toEqual([]);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("lists only commands that exist, each with a plain line", () => {
    expect(listed.filter((c) => !contributed.includes(c))).toEqual([]);
    for (const e of COMMAND_GUIDE.flatMap((g) => g.entries)) expect(e.what.length).toBeGreaterThan(15);
  });

  it("is itself a command", () => {
    expect(contributed).toContain("docmap.whatCanItDo");
  });
});
