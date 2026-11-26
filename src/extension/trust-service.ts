import * as path from "node:path";
import * as vscode from "vscode";
import { INTERNAL_LIMITS } from "../core/config/config";
import { fnv1a } from "../core/insights/similarity";
import type { SourceBlock } from "../core/outline/types";
import type { BlockTrust } from "../core/protocol/messages";
import { mismatches } from "../core/trust/check";
import { claimsIn } from "../core/trust/claims";
import { conflictsWith, type FactsOfDoc, keyFacts, relatedTo } from "../core/trust/conflicts";
import { trustOf } from "../core/trust/trust";
import { mapLimit } from "./concurrency";
import { lastChanged, lineTimes } from "./git";
import type { NotesStore } from "./notes";
import { repoFactsFor } from "./repo-facts";

/**
 * Trust markers for one document (3.0): gathers the evidence per block — claims checked against the repo, facts
 * that other docs state differently, git times (the paragraph vs the files it names), a newer duplicate, the
 * reader's stamp — and turns it into markers. Never throws: a missing source of evidence just means fewer markers.
 */
export interface OtherDocs {
  /** Key facts of every Markdown file in the workspace, with its title and the docs it links to. */
  readonly facts: () => Promise<readonly FactsOfDoc[]>;
  /** A newer near-duplicate of this file, if the Docs Inbox found one. */
  readonly newerDuplicate: (uri: vscode.Uri) => string | undefined;
}

/** The hash a stamp is kept under: the block's text, whitespace-normalised — editing the paragraph clears the stamp. */
export const blockHash = (text: string) => String(fnv1a(text.replace(/\s+/g, " ").trim()));

export function blockText(lines: readonly string[], b: SourceBlock): string {
  return lines.slice(b.line, b.end).join("\n");
}

export async function computeTrust(
  doc: vscode.TextDocument,
  blocks: readonly SourceBlock[],
  notes: NotesStore | undefined,
  others: OtherDocs | undefined,
): Promise<BlockTrust[]> {
  const fullText = doc.getText();
  const lines = fullText.split(/\r?\n/);
  // #55: skip expensive `git blame --line-porcelain` on huge files above the configured line/byte caps
  const skipBlame =
    doc.isDirty ||
    lines.length > INTERNAL_LIMITS.trustBlameMaxLines ||
    Buffer.byteLength(fullText, "utf8") > INTERNAL_LIMITS.trustBlameMaxBytes;
  const [repo, times, otherFacts] = await Promise.all([
    repoFactsFor(doc.uri).catch(() => undefined),
    skipBlame ? Promise.resolve(undefined) : lineTimes(doc.uri).catch(() => undefined),
    others?.facts().catch(() => []) ?? Promise.resolve([]),
  ]);
  const rel = vscode.workspace.asRelativePath(doc.uri, false);
  // only docs related to this one (links either way, or the same title) — owner report 2026-11-17
  const me = otherFacts.find((o) => o.file === rel) ?? { file: rel, links: [] };
  const elsewhere = relatedTo(me, otherFacts);
  const supersededBy = others?.newerDuplicate(doc.uri);
  const stamps = notes?.stamps(doc.uri.toString()) ?? {};
  const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;

  const prepared: {
    index: number;
    block: SourceBlock;
    text: string;
    claims: ReturnType<typeof claimsIn>;
    named: readonly string[];
  }[] = [];
  const uniquePaths = new Set<string>();
  for (const [i, b] of blocks.entries()) {
    if (b.kind === "fence" || b.kind === "code_block" || b.kind === "html_block") continue; // code is not a claim about code
    const text = blockText(lines, b);
    const claims = claimsIn(text);
    const named =
      times && root
        ? claims
            .filter((c) => c.kind === "path" && repo?.hasPath(c.value))
            .slice(0, INTERNAL_LIMITS.stalePathsPerBlock)
            .map((c) => c.value)
        : [];
    for (const p of named) uniquePaths.add(p);
    prepared.push({ index: i, block: b, text, claims, named });
  }

  // #55: resolve `git log -1` timestamps once per unique referenced path with bounded concurrency
  const pathChangedAt = new Map<string, number>();
  if (times && root && uniquePaths.size > 0) {
    const docDir = path.dirname(doc.uri.fsPath);
    const resolved = await mapLimit([...uniquePaths], INTERNAL_LIMITS.ioConcurrency, async (value) => {
      const target = path.relative(root, path.resolve(docDir, value)).replace(/\\/g, "/");
      const at =
        (await lastChanged(root, target.startsWith("..") ? value : target)) ??
        (await lastChanged(root, value));
      return [value, at] as const;
    });
    for (const [value, at] of resolved) {
      if (at !== undefined) pathChangedAt.set(value, at);
    }
  }

  const out: BlockTrust[] = [];
  for (const { index: i, block: b, text, claims, named } of prepared) {
    const found = repo ? mismatches(claims, repo) : [];
    const conflicts = conflictsWith(keyFacts(text), elsewhere);
    let writtenAt: number | undefined;
    const filesChangedAt: { path: string; at: number }[] = [];
    if (times && root) {
      writtenAt = Math.max(...times.slice(b.line, b.end).filter((t) => Number.isFinite(t)), 0) || undefined;
      for (const value of named) {
        const at = pathChangedAt.get(value);
        if (at !== undefined) filesChangedAt.push({ path: value, at });
      }
    }
    const stamp = stamps[blockHash(text)];
    const t = trustOf({
      mismatches: found,
      conflicts,
      ...(writtenAt !== undefined ? { writtenAt } : {}),
      filesChangedAt,
      ...(supersededBy && b === blocks[0] ? { supersededBy } : {}),
      ...(stamp ? { stamp } : {}),
    });
    if (t.state !== "none") out.push({ block: i, state: t.state, reasons: [...t.reasons] });
  }
  return out;
}
