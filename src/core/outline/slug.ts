/**
 * Heading anchor ids, GitHub-compatible (the scheme READMEs' `[link](#heading)` are written against):
 * lowercase; drop everything except letters, marks, numbers, connector punctuation, spaces and hyphens;
 * each space becomes "-"; repeats get "-1", "-2"… in document order.
 */
const STRIP = /[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu;

export function slugify(text: string): string {
  return text.trim().toLowerCase().replace(STRIP, "").replace(/ /g, "-");
}

/** Hands out unique ids for one document. Create one per parse. */
export class Slugger {
  private readonly seen = new Map<string, number>();

  slug(text: string): string {
    const base = slugify(text) || "section";
    let id = base;
    let n = this.seen.get(base) ?? 0;
    while (this.seen.has(id)) id = `${base}-${++n}`;
    this.seen.set(base, n);
    this.seen.set(id, this.seen.get(id) ?? 0);
    return id;
  }
}
