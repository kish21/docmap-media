import type { Heading } from "./types";

/**
 * The heading the reader is "in" at a given source line: the last heading at or above it.
 * `headings` must be in document order (as the engine returns them). Returns -1 above the first heading.
 * Binary search — called on every scroll event, so it must not be linear in the heading count.
 */
export function currentHeadingIndex(headings: readonly Heading[], line: number): number {
  let lo = 0;
  let hi = headings.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((headings[mid]?.line ?? Number.POSITIVE_INFINITY) <= line) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
