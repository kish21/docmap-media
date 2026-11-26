import type * as vscode from "vscode";
import { INTERNAL_LIMITS } from "../core/config/config";
import type { Highlight, ReviewMark } from "../core/protocol/messages";

/**
 * What docmap remembers per Markdown file (2.0), in VS Code's storage for this workspace — never in the file, never
 * sent anywhere: review marks and notes, highlights, what the reader last saw (section fingerprints, for "what
 * changed"), and the file's fingerprint when last read (Docs Inbox new / changed / read).
 */
export interface Review {
  readonly mark: ReviewMark;
  readonly note: string;
}

/** 3.0: a paragraph's verdict, keyed by a hash of its text — editing the paragraph clears it. */
export interface StampNote {
  readonly verdict: "verified" | "wrong";
  readonly at: number;
  readonly note?: string;
}

interface FileNotes {
  stamps?: Record<string, StampNote>;
  reviews?: Record<string, Review>;
  highlights?: Highlight[];
  seen?: Record<string, number>;
  readHash?: number;
}

const KEY = "docmap.notes";

export class NotesStore {
  private readonly listeners: (() => void)[] = [];
  constructor(private readonly storage: Pick<vscode.Memento, "get" | "update">) {}

  /** Called after any change (the Docs Inbox redraws read / unread). */
  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private all(): Record<string, FileNotes> {
    const v = this.storage.get<unknown>(KEY);
    return typeof v === "object" && v !== null ? (v as Record<string, FileNotes>) : {};
  }
  private get(uri: string): FileNotes {
    return this.all()[uri] ?? {};
  }
  private update(uri: string, change: (n: FileNotes) => void): void {
    const all = this.all();
    const notes = { ...(all[uri] ?? {}) };
    change(notes);
    delete all[uri]; // re-inserted last: the least recently touched files come first, and are dropped first
    all[uri] = notes;
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - INTERNAL_LIMITS.notesFiles))) delete all[old];
    void this.storage.update(KEY, all).then(() => {
      for (const l of this.listeners) l();
    });
  }

  /** #41 "Clear docmap's saved data": forgets the notes of every file in this workspace. */
  async clear(): Promise<void> {
    await this.storage.update(KEY, undefined);
    for (const l of this.listeners) l();
  }

  reviews(uri: string): Record<string, Review> {
    return this.get(uri).reviews ?? {};
  }
  setReview(uri: string, headingId: string, review: Review | undefined): void {
    this.update(uri, (n) => {
      const r = { ...(n.reviews ?? {}) };
      if (review) r[headingId] = review;
      else delete r[headingId];
      n.reviews = r;
    });
  }
  clearReviews(uri: string): void {
    this.update(uri, (n) => {
      n.reviews = {};
    });
  }

  highlights(uri: string): Highlight[] {
    return this.get(uri).highlights ?? [];
  }
  addHighlight(uri: string, h: Highlight): void {
    this.update(uri, (n) => {
      n.highlights = [...(n.highlights ?? []), h].slice(-INTERNAL_LIMITS.highlightsPerFile);
    });
  }
  removeHighlight(uri: string, id: string): void {
    this.update(uri, (n) => {
      n.highlights = (n.highlights ?? []).filter((h) => h.id !== id);
    });
  }

  stamps(uri: string): Record<string, StampNote> {
    return this.get(uri).stamps ?? {};
  }
  setStamp(uri: string, blockHash: string, stamp: StampNote | undefined): void {
    this.update(uri, (n) => {
      const s = { ...(n.stamps ?? {}) };
      if (stamp) s[blockHash] = stamp;
      else delete s[blockHash];
      n.stamps = s;
    });
  }

  seen(uri: string): Record<string, number> | undefined {
    return this.get(uri).seen;
  }
  setSeen(uri: string, seen: Record<string, number>, readHash: number): void {
    this.update(uri, (n) => {
      n.seen = seen;
      n.readHash = readHash;
    });
  }
  readHash(uri: string): number | undefined {
    return this.get(uri).readHash;
  }
  setReadHash(uri: string, readHash: number): void {
    this.update(uri, (n) => {
      n.readHash = readHash;
    });
  }
}
