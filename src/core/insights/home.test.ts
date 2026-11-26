import { describe, expect, it } from "vitest";
import { type HomeDoc, handoverNext, hardToRead, homeMarkdown } from "./home";

const NOW = Date.parse("2026-11-24T12:00:00Z");
const DAY = 86_400_000;
const doc = (over: Partial<HomeDoc> & { path: string }): HomeDoc => ({
  title: over.path.split("/").pop() ?? over.path,
  modified: NOW - DAY,
  archived: false,
  feature: false,
  missingCode: [],
  text: "# T\n\nShort.\n",
  ...over,
});

const HANDOVER = `# Handover — 2026-11-24 (#957 built, reviewed, pushing; next = PR)

**Goal:** something.

**Next:**
1. Confirm the push passed.
2. Security review: the diff touches a migration.
3. Open the PR.

<!-- End of the newest handover. Older notes below: do not read further unless asked. -->

# Handover — 2026-11-23

**Next:** old.
`;

describe("handoverNext — what the newest handover says comes next", () => {
  it("reads the newest handover's title and its Next list, not older ones", () => {
    expect(handoverNext(HANDOVER)).toEqual({
      now: "Handover — 2026-11-24 (#957 built, reviewed, pushing; next = PR)",
      next: ["Confirm the push passed.", "Security review: the diff touches a migration.", "Open the PR."],
    });
  });
  it("joins an item that runs onto the next line, then keeps its first sentence", () => {
    const text =
      "# H\n\n**Next:**\n1. Security review: the diff touches a migration and a column →\n   ask the owner first. Then more.\n2. Open the PR.\n";
    expect(handoverNext(text).next).toEqual([
      "Security review: the diff touches a migration and a column → ask the owner first.",
      "Open the PR.",
    ]);
  });
  it("reads a one-line '**Next:**', and stops at the next handover when there is no end marker", () => {
    const text =
      "# Handover — today\n\n**Next:** owner picks #991 in a new chat.\n\n# Handover — before\n\n**Next:**\n1. Old.\n";
    expect(handoverNext(text)).toEqual({
      now: "Handover — today",
      next: ["owner picks #991 in a new chat."],
    });
  });
  it("also reads a '## What is next' heading with a bulleted list", () => {
    const text = "# Notes\n\n## What is next\n\n- Ship it\n- Tell people\n";
    expect(handoverNext(text).next).toEqual(["Ship it", "Tell people"]);
  });
  it("has no next steps when the file names none", () => {
    expect(handoverNext("# Just notes\n\nNothing here.").next).toEqual([]);
  });
});

describe("hardToRead — why a doc is hard to read, in plain words", () => {
  it("a Status line far too long", () => {
    const status = Array.from({ length: 90 }, (_, i) => `w${i}`).join(" ");
    expect(hardToRead(`# T\n\n**Status:** ${status}\n\n## A\n\nok`)).toBe("its Status line is 90 words long");
  });
  it("a paragraph that never breaks", () => {
    const para = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
    expect(hardToRead(`# T\n\n${para}\n`)).toBe("one paragraph runs 300 words without a break");
  });
  it("an ordinary doc is fine", () => {
    expect(hardToRead("# T\n\n**Status:** done\n\nShort text.\n")).toBeUndefined();
  });
  it("code blocks are not paragraphs", () => {
    const code = Array.from({ length: 300 }, (_, i) => `x${i}`).join(" ");
    expect(hardToRead(`# T\n\n\`\`\`\n${code}\n\`\`\`\n`)).toBeUndefined();
  });
});

describe("homeMarkdown — the project's home page", () => {
  const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
  const docs: HomeDoc[] = [
    doc({
      path: "docs/plan-a.md",
      title: "Plan A",
      plan: { done: 2, total: 5, status: "in progress", nextTask: "Write the tests" },
    }),
    doc({ path: "docs/old.md", title: "Old doc", text: `# Old\n\n${long}\n` }),
    doc({
      path: "docs/features/billing.md",
      title: "Billing",
      feature: true,
      missingCode: ["lib/credits.ts"],
    }),
    doc({ path: "docs/features/voice.md", title: "Voice", feature: true }),
    doc({ path: "docs/_archive/gone.md", title: "Archived", archived: true, text: `# A\n\n${long}\n` }),
    doc({ path: "docs/shipped.md", title: "Shipped", plan: { done: 4, total: 4, status: "done" } }),
  ];
  const page = homeMarkdown({
    project: "MarkVid",
    docs,
    handover: { file: "NEXT-SESSION.md", ...handoverNext(HANDOVER) },
    now: NOW,
  });

  it("leads with what is being worked on and what is next", () => {
    expect(page.indexOf("## What's being worked on")).toBeLessThan(
      page.indexOf("## Docs that are hard to read"),
    );
    expect(page).toContain("**Now:** Handover — 2026-11-24");
    expect(page).toContain("1. Confirm the push passed.");
    expect(page).toContain("[NEXT-SESSION.md](NEXT-SESSION.md)");
  });
  it("lists docs with open task boxes, their progress and the next task", () => {
    expect(page).toMatch(/\[Plan A\]\(docs\/plan-a\.md\) — 2 of 5 done · next: Write the tests/);
    expect(page).not.toMatch(/Shipped\]\(docs\/shipped\.md\) — 4 of 4/);
  });
  it("names hard-to-read docs with the reason, archived ones left out", () => {
    expect(page).toContain("[Old doc](docs/old.md) — one paragraph runs 300 words without a break");
    expect(page).not.toContain("docs/_archive/gone.md");
  });
  it("names docs that point at code that is gone", () => {
    expect(page).toContain(
      "[Billing](docs/features/billing.md) — names `lib/credits.ts`, no longer in the code",
    );
  });
  it("lists every feature, by title", () => {
    const features = page.slice(page.indexOf("## Find the doc for a feature"));
    expect(features.indexOf("[Billing]")).toBeLessThan(features.indexOf("[Voice]"));
  });
  it("'What's open': what waits on me and the open questions, in one place", () => {
    const withItems = homeMarkdown({
      project: "P",
      now: NOW,
      names: ["@kish"],
      docs: [
        doc({
          path: "docs/plan.md",
          title: "Plan",
          items: [
            { line: 3, kind: "task", text: "Review the migration @kish", who: ["kish"] },
            { line: 9, kind: "question", text: "Who owns the rollout?", who: [] },
            {
              line: 12,
              kind: "question",
              text: "Which model do we run on the A100, given the memory limit we measured on the second benchmark run last week?",
              who: [],
            },
          ],
        }),
        doc({
          path: "docs/_archive/old.md",
          title: "Old",
          archived: true,
          items: [{ line: 1, kind: "question", text: "An old question?", who: [] }],
        }),
      ],
    });
    const open = withItems.slice(withItems.indexOf("## What's open"));
    expect(open).toContain("### Waiting on you (1)");
    // owner report 2026-11-24: each line number opens the doc at that line, and a question is never cut short
    expect(open).toContain("- Review the migration @kish — [Plan](docs/plan.md) · [line 4](docs/plan.md#L4)");
    expect(open).toContain("### Questions waiting for an answer (2)");
    expect(open).toContain("- Who owns the rollout? — [Plan](docs/plan.md) · [line 10](docs/plan.md#L10)");
    expect(open).toContain("second benchmark run last week? — [Plan](docs/plan.md)");
    expect(open).not.toContain("An old question?");
  });

  it("says so when there is nothing to show in a section", () => {
    const empty = homeMarkdown({ project: "P", docs: [], now: NOW });
    expect(empty).toContain("No docs are hard to read.");
    expect(empty).toContain("No handover note");
  });
});
