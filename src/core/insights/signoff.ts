/**
 * 3.0 Sign-off: "I approve this version" written into the file's front matter, so it travels with the file (git,
 * reviews, teammates): `signed-off-by: Priya 2026-11-16 #k3x9a2; Sam 2026-11-17 #k3x9a2`. The #hash is of the
 * document without that line, so any later edit shows as "changed since sign-off". Pure.
 */

import { fnv1a } from "./similarity";

export interface Signoff {
  readonly who: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly hash: string;
}

export const SIGNOFF_KEY = "signed-off-by";
const LINE = /^signed-off-by:[^\n]*(?:\n|$)/m;
const FRONT = /^---\r?\n([\s\S]*?\r?\n)?---\r?\n/;
const ENTRY = /^\s*(.+?)\s+(\d{4}-\d{2}-\d{2})\s+#([a-z0-9]+)\s*$/i;
/** Sign-offs kept on the line (the oldest are dropped first). */
export const MAX_SIGNOFFS = 10;

/** The document's text as signed: front matter's sign-off line removed, line endings normalised. */
export function signedHash(text: string): string {
  const t = text.replace(/\r\n/g, "\n");
  const fm = FRONT.exec(t);
  const body = fm ? `${fm[0].replace(LINE, "")}${t.slice(fm[0].length)}` : t;
  return fnv1a(body.replace(/^---\n---\n/, "")).toString(36);
}

export function signoffs(text: string): Signoff[] {
  const fm = FRONT.exec(text.replace(/\r\n/g, "\n"));
  const line = fm ? LINE.exec(fm[1] ?? "")?.[0] : undefined;
  if (!line) return [];
  return line
    .slice(SIGNOFF_KEY.length + 1)
    .replace(/^\s*["']|["']\s*$/g, "")
    .split(";")
    .flatMap((part) => {
      const m = ENTRY.exec(part);
      return m ? [{ who: m[1] ?? "", date: m[2] ?? "", hash: (m[3] ?? "").toLowerCase() }] : [];
    });
}

/** The text with `who` signing off the current version (their earlier sign-off replaced). */
export function withSignoff(text: string, who: string, date: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const t = text.replace(/\r\n/g, "\n");
  const name = who.replace(/[;#\n\r]/g, " ").trim() || "someone";
  const entry: Signoff = { who: name, date, hash: signedHash(t) };
  const list = [...signoffs(t).filter((s) => s.who.toLowerCase() !== name.toLowerCase()), entry].slice(
    -MAX_SIGNOFFS,
  );
  const line = `${SIGNOFF_KEY}: ${list.map((s) => `${s.who} ${s.date} #${s.hash}`).join("; ")}\n`;
  const fm = FRONT.exec(t);
  const out = fm
    ? LINE.test(fm[1] ?? "")
      ? `---\n${(fm[1] ?? "").replace(LINE, line)}---\n${t.slice(fm[0].length)}`
      : `---\n${fm[1] ?? ""}${line}---\n${t.slice(fm[0].length)}`
    : `---\n${line}---\n${t}`;
  return eol === "\n" ? out : out.replace(/\n/g, eol);
}
