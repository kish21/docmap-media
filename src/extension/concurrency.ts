/**
 * Runs an async mapper over `items` with at most `limit` operations in flight at once, preserving input order.
 * Prevents EMFILE and subprocess storms on large repositories (#55).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const cap = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const out = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  }

  await Promise.all(Array.from({ length: cap }, () => worker()));
  return out;
}
