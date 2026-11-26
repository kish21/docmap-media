import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_LIMITS } from "../core/config/config";
import type { SourceBlock } from "../core/outline/types";

const mocks = vi.hoisted(() => {
  const lineTimes = vi.fn(async () => [1_700_000_000_000]);
  const lastChanged = vi.fn(async () => 1_700_000_100_000);
  const repoFactsFor = vi.fn(async () => ({
    hasPath: () => true,
    findPath: (p: string) => p,
    symbols: new Set<string>(),
    identifiers: new Set<string>(),
    envVars: new Set<string>(),
    scripts: new Set<string>(),
  }));
  const makeUri = (fsPath: string) =>
    ({
      scheme: "file",
      fsPath,
      path: fsPath.replace(/\\/g, "/"),
      toString: () => `file:///${fsPath.replace(/\\/g, "/")}`,
    }) as unknown as import("vscode").Uri;
  const folder = { uri: makeUri("C:\\repo"), name: "repo", index: 0 };
  return { lineTimes, lastChanged, repoFactsFor, makeUri, folder };
});

vi.mock("./git", () => ({
  lineTimes: mocks.lineTimes,
  lastChanged: mocks.lastChanged,
}));

vi.mock("./repo-facts", () => ({
  repoFactsFor: mocks.repoFactsFor,
}));

vi.mock("vscode", () => ({
  workspace: {
    asRelativePath: (uri: { fsPath: string }) => path.relative("C:\\repo", uri.fsPath).replace(/\\/g, "/"),
    getWorkspaceFolder: () => mocks.folder,
  },
}));

import { computeTrust } from "./trust-service";

function makeDoc(text: string, rel = "docs/guide.md", isDirty = false): import("vscode").TextDocument {
  return {
    uri: mocks.makeUri(path.join("C:\\repo", rel)),
    isDirty,
    getText: () => text,
  } as unknown as import("vscode").TextDocument;
}

describe("#55 computeTrust() git blame cap and bounded lastChanged concurrency", () => {
  beforeEach(() => {
    mocks.lineTimes.mockClear();
    mocks.lastChanged.mockClear();
    mocks.repoFactsFor.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs git blame on a normal-sized clean document", async () => {
    const doc = makeDoc("# Guide\n\nSee `src/app.ts` for details.\n");
    const blocks: SourceBlock[] = [{ kind: "paragraph", line: 2, end: 3 }];
    await computeTrust(doc, blocks, undefined, undefined);
    expect(mocks.lineTimes).toHaveBeenCalledTimes(1);
  });

  it("skips git blame when the document exceeds the configured line cap", async () => {
    const text = Array.from({ length: INTERNAL_LIMITS.trustBlameMaxLines + 5 }, (_, i) => `Line ${i}`).join(
      "\n",
    );
    const doc = makeDoc(text);
    const blocks: SourceBlock[] = [{ kind: "paragraph", line: 0, end: 1 }];

    await computeTrust(doc, blocks, undefined, undefined);

    expect(mocks.lineTimes).not.toHaveBeenCalled();
  });

  it("skips git blame when the document exceeds the configured byte cap", async () => {
    const text = `# Big\n\n${"a".repeat(INTERNAL_LIMITS.trustBlameMaxBytes + 1024)}\n`;
    const doc = makeDoc(text);
    const blocks: SourceBlock[] = [{ kind: "paragraph", line: 0, end: 1 }];

    await computeTrust(doc, blocks, undefined, undefined);

    expect(mocks.lineTimes).not.toHaveBeenCalled();
  });

  it("bounds concurrent lastChanged() calls across blocks", async () => {
    const lines: string[] = [];
    const blocks: SourceBlock[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`See \`src/file-${i}.ts\` for details.`);
      blocks.push({ kind: "paragraph", line: i, end: i + 1 });
    }
    const dayMs = 24 * 60 * 60 * 1000;
    mocks.lineTimes.mockResolvedValueOnce(Array.from({ length: 20 }, () => 1_700_000_000_000));

    let inFlight = 0;
    let maxInFlight = 0;
    mocks.lastChanged.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return 1_700_000_000_000 + 2 * dayMs;
    });

    const doc = makeDoc(lines.join("\n"));
    const result = await computeTrust(doc, blocks, undefined, undefined);

    expect(result.length).toBe(20);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(INTERNAL_LIMITS.ioConcurrency);
  });
});
