import { describe, expect, it } from "vitest";
import { peekAt } from "./code-peek";

const SOURCE = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
SOURCE[9] = "def build_cast(spec):";
SOURCE[19] = "class Casting:";
SOURCE[29] = "export async function pickVoice() {";
const text = SOURCE.join("\n");

describe("peekAt — the code shown when the reader points at a code name", () => {
  it("with a line: the lines around it, that line marked", () => {
    const p = peekAt(text, "app/cast.py", 12);
    expect(p.kind).toBe("at");
    expect(p.total).toBe(40);
    expect(p.rows[0]).toEqual([10, "def build_cast(spec):", false]);
    expect(p.rows.find((r) => r[2])).toEqual([12, "line 12", true]);
    expect(p.rows).toHaveLength(12);
  });

  it("without a line: the file's functions and classes, with their lines", () => {
    const p = peekAt(text, "app/cast.py", undefined);
    expect(p.kind).toBe("outline");
    expect(p.rows.map((r) => r[0])).toEqual([10, 20, 30]);
  });

  it("a line past the end shows the end of the file", () => {
    const p = peekAt(text, "app/cast.py", 400);
    expect(p.rows.at(-1)?.[0]).toBe(40);
  });

  it("cuts very long lines", () => {
    const p = peekAt(`x${"y".repeat(500)}`, "a.ts", 1);
    expect(p.rows[0]?.[1].length).toBeLessThanOrEqual(160);
  });
});
