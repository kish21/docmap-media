import { describe, expect, it } from "vitest";
import type { Heading } from "../core/outline/types";
import { HeadingTracker } from "./document-position";

/** A stand-in heading element that counts the reads which make a browser lay out the page. */
function fakeHeading(top: number, visible: boolean, reads: { count: number }): HTMLElement {
  return {
    get offsetParent() {
      reads.count++;
      return visible ? {} : null;
    },
    getBoundingClientRect() {
      reads.count++;
      return { top };
    },
  } as unknown as HTMLElement;
}

const headings = [{ id: "a" }, { id: "b" }, { id: "c" }] as unknown as Heading[];

describe("HeadingTracker", () => {
  it("does not measure the page when a render refreshes it (1 MB guardrail: no layout mid-render)", () => {
    const reads = { count: 0 };
    const els = new Map([
      ["a", fakeHeading(0, true, reads)],
      ["b", fakeHeading(100, true, reads)],
      ["c", fakeHeading(200, true, reads)],
    ]);
    const tracker = new HeadingTracker();
    tracker.refresh(headings, (id) => els.get(id) ?? null);
    expect(reads.count).toBe(0);
  });

  it("finds the heading the reader is in on first use, skipping hidden headings", () => {
    const reads = { count: 0 };
    const els = new Map([
      ["a", fakeHeading(0, true, reads)],
      ["b", fakeHeading(100, false, reads)],
      ["c", fakeHeading(200, true, reads)],
    ]);
    const tracker = new HeadingTracker();
    tracker.refresh(headings, (id) => els.get(id) ?? null);
    expect(tracker.currentAt(150)).toBe(0); // "b" is folded away: still in "a"
    expect(tracker.currentAt(250)).toBe(2);
    expect(tracker.currentAt(-10)).toBe(-1);
  });

  it("uses the latest refresh, not an older one", () => {
    const reads = { count: 0 };
    const first = new Map([["a", fakeHeading(0, true, reads)]]);
    const second = new Map([["c", fakeHeading(0, true, reads)]]);
    const tracker = new HeadingTracker();
    tracker.refresh(headings, (id) => first.get(id) ?? null);
    tracker.refresh(headings, (id) => second.get(id) ?? null);
    expect(tracker.currentAt(10)).toBe(2);
  });
});
