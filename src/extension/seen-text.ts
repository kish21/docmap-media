import { promises as fs } from "node:fs";
import * as path from "node:path";
import { INTERNAL_LIMITS } from "../core/config/config";
import { fnv1a } from "../core/insights/similarity";
import { mapLimit } from "./concurrency";

/**
 * 3.0 redline "since I last read it": the text of each file as the reader last saw it, kept on this computer in the
 * extension's own storage folder (never in the workspace, never sent anywhere). Oldest copies are dropped first.
 */
let dir: string | undefined;

export function initSeenTexts(storage: string): void {
  dir = path.join(storage, "seen");
}

const fileFor = (uri: string) => (dir ? path.join(dir, `${fnv1a(uri).toString(36)}.md`) : undefined);

export async function readSeenText(uri: string): Promise<string | undefined> {
  const file = fileFor(uri);
  if (!file) return undefined;
  try {
    const raw = await fs.readFile(file, "utf8");
    // first line: the URI it belongs to (two URIs can share a hash)
    const nl = raw.indexOf("\n");
    return raw.slice(0, nl) === uri ? raw.slice(nl + 1) : undefined;
  } catch {
    return undefined;
  }
}

export async function writeSeenText(uri: string, text: string, maxBytes: number): Promise<void> {
  const file = fileFor(uri);
  if (!file || !dir || Buffer.byteLength(text) > maxBytes) return;
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, `${uri}\n${text}`, "utf8");
    await prune(dir);
  } catch {
    // a copy that cannot be written only means no "since I last read it" for this file
  }
}

/** #41 "Clear docmap's saved data": removes every last-read copy. */
export async function clearSeenTexts(): Promise<void> {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
}

async function prune(folder: string): Promise<void> {
  const names = await fs.readdir(folder);
  if (names.length <= INTERNAL_LIMITS.seenTexts) return;
  const stats = await mapLimit(names, INTERNAL_LIMITS.ioConcurrency, async (n) => ({
    n,
    t: (await fs.stat(path.join(folder, n)).catch(() => undefined))?.mtimeMs ?? 0,
  }));
  stats.sort((a, b) => a.t - b.t);
  for (const s of stats.slice(0, names.length - INTERNAL_LIMITS.seenTexts))
    await fs.rm(path.join(folder, s.n), { force: true });
}
