import { describe, expect, it } from "vitest";
import { mismatches, type RepoFacts } from "./check";
import { claimsIn } from "./claims";
import { conflictsWith, keyFacts, relatedTo } from "./conflicts";
import { STALE_AFTER_MS, trustOf } from "./trust";

describe("claims", () => {
  it("finds paths, functions, classes, commands, env vars and versions — only from code spans", () => {
    const c = claimsIn(
      "Run `npm run deploy` or `make shadow`. It calls `createOrder()` in `app/orders.py` via `PaymentConsumer` and needs `STRIPE_SECRET_KEY`. We use Node 18 and React 18.2. The word src/app.py in prose is ignored.",
    );
    expect(c).toEqual([
      { kind: "command", value: "deploy", detail: "npm" },
      { kind: "command", value: "shadow", detail: "make" },
      { kind: "symbol", value: "createOrder" },
      { kind: "path", value: "app/orders.py" },
      { kind: "symbol", value: "PaymentConsumer" },
      { kind: "env", value: "STRIPE_SECRET_KEY" },
      { kind: "version", value: "node", detail: "18" },
      { kind: "version", value: "react", detail: "18.2" },
    ]);
  });
  it("ignores built-in commands, URLs and plain words", () => {
    expect(claimsIn("`npm install` `npm test` `https://x.dev/a/b.md` `true` `id`")).toEqual([]);
  });
});

describe("mismatches against the repo", () => {
  const repo: RepoFacts = {
    hasPath: (p) => p === "app/orders.py",
    scripts: new Map([["npm", new Set(["build", "deploy:prod"])]]),
    symbols: new Set(["createOrder"]),
    envVars: new Set(["DATABASE_URL"]),
    versions: new Map([["node", ">=22"]]),
  };
  it("reports only definite contradictions, with a readable reason", () => {
    const found = mismatches(
      claimsIn(
        "`npm run deploy` `app/orders.py` `app/old.py` `createOrder()` `PaymentConsumer` `STRIPE_KEY` Node 18",
      ),
      repo,
    );
    expect(found.map((m) => m.reason)).toEqual([
      'says `npm run deploy`, but there is no "deploy" script in package.json',
      "mentions `app/old.py`, which is not in the repository",
      "mentions `PaymentConsumer`, which is not defined anywhere in the code",
      "mentions `STRIPE_KEY`, which the code and .env files never use",
      "says node 18, but the project uses >=22",
    ]);
  });
  it("makes no claim it cannot check (no scripts, no symbol index)", () => {
    expect(mismatches(claimsIn("`npm run deploy` `PaymentConsumer`"), { hasPath: () => true })).toEqual([]);
  });
});

describe("conflicts between docs", () => {
  it("finds the same key with a different value in another doc", () => {
    const mine = keyFacts("- **Timeout:** 30 s\n- Owner: Priya\nThe retry limit is 3 attempts.");
    const other = keyFacts("Timeout: 60 s\nOwner: Priya\nNote: ignore this");
    expect(
      conflictsWith(mine, [{ file: "ROLLOUT.md", facts: other }]).map((c) => [
        c.fact.key,
        c.fact.value,
        c.other.value,
      ]),
    ).toEqual([["timeout", "30 s", "60 s"]]);
  });

  it("owner report 2026-11-17: fields every doc has its own value for are never a conflict", () => {
    const mine = keyFacts("- **Owner:** Priya\n- **Deadline:** 2026-12-01\n- **Status:** in progress");
    const other = keyFacts("Owner: Sam\nDeadline: 2026-11-20\nStatus: draft\nDate: 2026-11-17");
    expect(mine).toEqual([]);
    expect(conflictsWith(mine, [{ file: "notes.md", facts: other }])).toEqual([]);
  });

  it("owner report 2026-11-17: the hover shows values as written ('2026-12-01', not '2026 12 01')", () => {
    const [c] = conflictsWith(keyFacts("Launch: 2026-12-01"), [
      { file: "plan.md", facts: keyFacts("Launch: **2026-11-20**") },
    ]);
    expect(c?.fact.shown).toBe("2026-12-01");
    expect(c?.other.value).toBe("2026-11-20");
  });

  it("owner report 2026-11-17: only related docs are compared — linked either way, or the same title", () => {
    const docs = [
      { file: "docs/plan.md", title: "Payments", links: ["docs/runbook.md"] },
      { file: "docs/runbook.md", title: "Runbook", links: [] },
      { file: "docs/notes.md", title: "Meeting notes", links: ["docs/plan.md"] },
      { file: "old/plan.md", title: "Payments", links: [] },
      { file: "docs/trip.md", title: "Lisbon trip", links: [] },
    ];
    const me = docs[0] as (typeof docs)[number];
    expect(relatedTo(me, docs).map((d) => d.file)).toEqual([
      "docs/runbook.md",
      "docs/notes.md",
      "old/plan.md",
    ]);
  });
});

describe("trust state", () => {
  const day = 86_400_000;
  it("the reader's verification turns ✗ and ⇄ into ✓ (reasons kept); stale needs code changed a day after writing", () => {
    const mismatch = {
      claim: { kind: "path" as const, value: "a.ts" },
      reason: "mentions `a.ts`, which is not in the repository",
    };
    expect(trustOf({ mismatches: [mismatch] }).state).toBe("mismatch");
    const verified = trustOf({ mismatches: [mismatch], stamp: { verdict: "verified", at: 5 } });
    expect(verified.state).toBe("verified");
    expect(verified.reasons).toEqual([
      "✗ Mentions `a.ts`, which is not in the repository.",
      "✓ Verified 1970-01-01.",
    ]);
    const conflict = {
      fact: { key: "timeout", value: "30 s", label: "Timeout", shown: "30 s" },
      other: { file: "ROLLOUT.md", value: "60 s" },
    };
    expect(trustOf({ conflicts: [conflict] }).state).toBe("conflict");
    expect(trustOf({ conflicts: [conflict], stamp: { verdict: "verified", at: 5 } }).state).toBe("verified");
    // code that changes a day after the verification ends it: the evidence counts again
    expect(
      trustOf({
        mismatches: [mismatch],
        writtenAt: 0,
        filesChangedAt: [{ path: "b.ts", at: 10 * day }],
        stamp: { verdict: "verified", at: 5 },
      }).state,
    ).toBe("mismatch");
    expect(trustOf({ writtenAt: 0, filesChangedAt: [{ path: "a.ts", at: STALE_AFTER_MS / 2 }] }).state).toBe(
      "none",
    );
    const stale = trustOf({ writtenAt: 0, filesChangedAt: [{ path: "app/orders.py", at: 10 * day }] });
    expect(stale.state).toBe("stale");
    expect(stale.reasons[0]).toBe("⚠ app/orders.py changed 10 days after this was written.");
  });
  it("a verification after the code changed clears 'stale'; marked wrong stays wrong", () => {
    expect(
      trustOf({
        writtenAt: 0,
        filesChangedAt: [{ path: "a.ts", at: 10 * day }],
        stamp: { verdict: "verified", at: 11 * day },
      }).state,
    ).toBe("verified");
    expect(trustOf({ stamp: { verdict: "wrong", at: 1, note: "rollout is 50% now" } }).reasons).toEqual([
      "✗ Marked wrong 1970-01-01: rollout is 50% now.",
    ]);
  });
});
