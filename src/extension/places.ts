import type * as vscode from "vscode";
import { INTERNAL_LIMITS, INTERNAL_TIMINGS } from "../core/config/config";

const KEY = "docmap.places";

/**
 * Where the reader was in each file's map: a heading id per file URI. In memory for the window, and — with
 * `docmap.rememberPlace` on (the default) — in VS Code's storage for this workspace, so a map opened after a
 * restart returns there too. Only the heading id is kept, never document text; at most
 * `INTERNAL_LIMITS.rememberedPlaces` files, the least recently read dropped first. Scrolling changes the place many
 * times a second: storage is written at most once per `INTERNAL_TIMINGS.placeSaveMs` (and on `flush`).
 */
export class PlaceStore {
  private readonly memory = new Map<string, string>();
  /** Places not yet written to storage, in the order they were read. */
  private readonly unsaved = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly storage: Pick<vscode.Memento, "get" | "update">,
    /** `docmap.rememberPlace`, read on every use so a change applies at once. */
    private readonly keepAcrossRestarts: () => boolean,
  ) {}

  get(uri: string): string | undefined {
    if (!this.keepAcrossRestarts()) return this.memory.get(uri);
    return this.memory.get(uri) ?? this.stored()[uri];
  }

  set(uri: string, headingId: string): void {
    this.memory.set(uri, headingId);
    if (!this.keepAcrossRestarts()) return;
    this.unsaved.delete(uri);
    this.unsaved.set(uri, headingId);
    this.timer ??= setTimeout(() => this.flush(), INTERNAL_TIMINGS.placeSaveMs);
  }

  /** Writes the places read since the last write (one storage update for any number of them). */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.unsaved.size === 0) return;
    const places = this.stored();
    for (const [uri, headingId] of this.unsaved) {
      delete places[uri]; // re-inserted last: object keys keep insertion order, so the oldest come first
      places[uri] = headingId;
    }
    this.unsaved.clear();
    const keys = Object.keys(places);
    for (const old of keys.slice(0, Math.max(0, keys.length - INTERNAL_LIMITS.rememberedPlaces)))
      delete places[old];
    void this.storage.update(KEY, places);
  }

  /** #41: forgets the places of files that no longer exist; returns how many were dropped. */
  async dropMissing(exists: (uri: string) => Promise<boolean>): Promise<number> {
    this.flush();
    const places = this.stored();
    let dropped = 0;
    for (const uri of Object.keys(places))
      if (!(await exists(uri))) {
        delete places[uri];
        this.memory.delete(uri);
        dropped++;
      }
    if (dropped) await this.storage.update(KEY, places);
    return dropped;
  }

  /** #41 "Clear docmap's saved data": forgets every place, in memory and in storage. */
  async clear(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.memory.clear();
    this.unsaved.clear();
    await this.storage.update(KEY, undefined);
  }

  private stored(): Record<string, string> {
    const value = this.storage.get<unknown>(KEY);
    if (typeof value !== "object" || value === null) return {};
    const places: Record<string, string> = {};
    for (const [uri, id] of Object.entries(value)) if (typeof id === "string") places[uri] = id;
    return places;
  }
}
