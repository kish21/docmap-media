import { afterEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_LIMITS, INTERNAL_TIMINGS } from "../core/config/config";
import { PlaceStore } from "./places";

/** VS Code's workspace storage, as far as PlaceStore uses it. */
function memento(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: <T>(key: string) => data.get(key) as T | undefined,
    update: (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
      return Promise.resolve();
    },
  };
}

describe("PlaceStore: the reading place, kept across restarts", () => {
  it("a new window (a fresh store over the same storage) still knows the place", () => {
    const storage = memento();
    const first = new PlaceStore(storage, () => true);
    first.set("file:///a.md", "setup");
    first.flush();
    expect(new PlaceStore(storage, () => true).get("file:///a.md")).toBe("setup");
  });

  it("with the setting off, the place lasts for the window only and nothing is written", () => {
    const storage = memento();
    const store = new PlaceStore(storage, () => false);
    store.set("file:///a.md", "setup");
    expect(store.get("file:///a.md")).toBe("setup");
    expect(storage.data.size).toBe(0);
    expect(new PlaceStore(storage, () => false).get("file:///a.md")).toBeUndefined();
  });

  it("keeps only heading ids, and at most the most recent files", () => {
    const storage = memento();
    const store = new PlaceStore(storage, () => true);
    const n = INTERNAL_LIMITS.rememberedPlaces;
    for (let i = 0; i <= n; i++) store.set(`file:///${i}.md`, `h${i}`);
    store.set("file:///1.md", "again"); // read again: now the most recent
    store.flush();
    const kept = storage.data.get("docmap.places") as Record<string, string>;
    expect(Object.keys(kept)).toHaveLength(n);
    expect(kept["file:///0.md"]).toBeUndefined(); // the least recently read was dropped
    expect(kept["file:///1.md"]).toBe("again");
    expect(Object.values(kept).every((v) => typeof v === "string")).toBe(true);
  });

  it("#41: start-up clean-up forgets places of deleted files and keeps the rest", async () => {
    const storage = memento({ "docmap.places": { "file:///gone.md": "a", "file:///here.md": "b" } });
    const store = new PlaceStore(storage, () => true);
    store.set("file:///new.md", "c"); // not yet written: must survive too
    const dropped = await store.dropMissing(async (uri) => uri !== "file:///gone.md");
    expect(dropped).toBe(1);
    expect(storage.data.get("docmap.places")).toEqual({ "file:///here.md": "b", "file:///new.md": "c" });
    expect(store.get("file:///gone.md")).toBeUndefined();
    expect(await store.dropMissing(async () => true)).toBe(0);
  });

  it("#41: 'Clear saved data' forgets every place, also the ones held in memory", async () => {
    const storage = memento({ "docmap.places": { "file:///a.md": "a" } });
    const store = new PlaceStore(storage, () => true);
    store.set("file:///b.md", "b");
    await store.clear();
    expect(store.get("file:///a.md")).toBeUndefined();
    expect(store.get("file:///b.md")).toBeUndefined();
    store.flush();
    expect(storage.data.get("docmap.places")).toBeUndefined();
  });

  it("ignores anything in storage that is not a heading id", () => {
    const storage = memento({ "docmap.places": { "file:///a.md": 42, "file:///b.md": "ok" } });
    const store = new PlaceStore(storage, () => true);
    expect(store.get("file:///a.md")).toBeUndefined();
    expect(store.get("file:///b.md")).toBe("ok");
  });

  describe("while the reader scrolls", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("writes storage at most once per interval, however often the place changes (the latest place wins)", () => {
      vi.useFakeTimers();
      const storage = memento();
      let writes = 0;
      const counted = {
        get: storage.get,
        update: (key: string, value: unknown) => {
          writes++;
          return storage.update(key, value);
        },
      };
      const store = new PlaceStore(counted, () => true);
      for (let i = 0; i < 300; i++) store.set("file:///a.md", `h${i}`); // a fast scroll through 300 headings
      expect(writes).toBe(0);
      expect(store.get("file:///a.md")).toBe("h299"); // this window already knows
      vi.advanceTimersByTime(INTERNAL_TIMINGS.placeSaveMs);
      expect(writes).toBe(1);
      expect((storage.data.get("docmap.places") as Record<string, string>)["file:///a.md"]).toBe("h299");
      vi.advanceTimersByTime(INTERNAL_TIMINGS.placeSaveMs * 5);
      expect(writes).toBe(1); // nothing new, nothing written
    });
  });
});
