import { describe, expect, it } from "vitest";
import { mapLimit } from "./concurrency";

describe("mapLimit", () => {
  it("preserves order while bounding in-flight concurrency", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;

    const results = await mapLimit(items, 4, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, (n % 3) * 5 + 2));
      inFlight--;
      return n * 10;
    });

    expect(results).toEqual(items.map((n) => n * 10));
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("returns an empty array for empty input", async () => {
    expect(await mapLimit([], 6, async (x) => x)).toEqual([]);
  });

  it("clamps invalid limits to at least 1", async () => {
    let maxInFlight = 0;
    let inFlight = 0;
    const results = await mapLimit([1, 2, 3], 0, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight--;
      return n + 1;
    });
    expect(results).toEqual([2, 3, 4]);
    expect(maxInFlight).toBe(1);
  });
});
