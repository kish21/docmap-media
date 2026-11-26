import { describe, expect, it } from "vitest";
import { docItems, isMine, myItemsReport, pathMentions, questionsReport, sectionBadges } from "./items";

const doc = [
  "# Plan",
  "- [ ] write the adapter @kish",
  "- [x] done thing",
  "Do we keep v1?",
  "## Open questions",
  "- which region first?",
  "- Owner: Priya, which date?",
  "## Notes",
  "```",
  "is code a question?",
  "- [ ] not a task",
  "```",
  "Question: who pays for it",
  "See `src/app/main.ts` and `README.md`.",
].join("\n");

describe("docItems", () => {
  it("finds open tasks and questions (labelled, or ending in ?) outside code", () => {
    expect(docItems(doc).map((i) => [i.line, i.kind, i.text])).toEqual([
      [1, "task", "write the adapter @kish"],
      [3, "question", "Do we keep v1?"],
      [5, "question", "which region first?"],
      [6, "question", "Owner: Priya, which date?"],
      [12, "question", "who pays for it"],
    ]);
  });

  // owner report 2026-11-24 (MarkVid's Open questions page): statements under a questions heading were listed, and
  // an item that wraps onto the next line was cut at the line end ("Without it the")
  it("lists only real questions, each whole even when it wraps onto the next lines", () => {
    const wrapped = [
      "## 7. Open questions",
      "- **Wan 2.2 is the newest OSS Wan** — 2.5 is API-only. Without it the",
      "  decode fails at the finish line.",
      "- Which model do we run on the A100, given the",
      "  memory limit we measured?",
      "- [ ] measure the decode",
      "  on the big card",
      "",
      "We measured it twice. Should the",
      "endpoint spawn one job per scene? Then the page polls.",
      "> Do we keep the old",
      "> endpoint?",
    ].join("\n");
    expect(docItems(wrapped).map((i) => [i.line, i.kind, i.text])).toEqual([
      [3, "question", "Which model do we run on the A100, given the memory limit we measured?"],
      [5, "task", "measure the decode on the big card"],
      [8, "question", "Should the endpoint spawn one job per scene?"],
      [10, "question", "Do we keep the old endpoint?"],
    ]);
  });

  // spot check on MarkVid: a "?" in code, in front matter, in a quote or an aside is not an open question; and a
  // long paragraph's question is found whole
  it("does not count a '?' in code, front matter, quotes or brackets", () => {
    const long = "Words here. ".repeat(30);
    const noisy = [
      "---",
      "title: 'One question, two switches?'",
      "---",
      "Both read `active ? org : user` here; solo accounts spend one.",
      'The owner asked: "where are the images?" and we looked.',
      "Treat it as a top-up (see *…give somebody credits?* above).",
      "",
      `${long}Can we drop the old table?`,
    ].join("\n");
    expect(docItems(noisy).map((i) => [i.line, i.text])).toEqual([[7, "Can we drop the old table?"]]);
  });

  it("knows who an item names", () => {
    const items = docItems(doc);
    expect(items[0]?.who).toEqual(["@kish"]);
    expect(items[3]?.who).toEqual(["Priya"]);
    expect(isMine(items[0]!, ["kish"])).toBe(true);
    expect(isMine(items[0]!, ["@KISH"])).toBe(true);
    expect(isMine(items[3]!, ["priya"])).toBe(true);
    expect(isMine(items[1]!, ["kish"])).toBe(false);
    expect(isMine(items[0]!, [])).toBe(false);
  });
});

describe("sections and paths", () => {
  it("counts open tasks and questions per section", () => {
    const badges = sectionBadges(docItems(doc), [
      { id: "plan", line: 0 },
      { id: "open-questions", line: 4 },
      { id: "notes", line: 7 },
    ]);
    expect(badges).toEqual([
      { headingId: "plan", tasks: 1, questions: 1 },
      { headingId: "open-questions", tasks: 0, questions: 2 },
      { headingId: "notes", tasks: 0, questions: 1 },
    ]);
  });

  it("finds repository paths in code spans (with a folder), not in code blocks", () => {
    expect(pathMentions(doc)).toEqual([{ path: "src/app/main.ts", line: 13 }]);
  });
});

describe("reports", () => {
  const files = [{ file: "docs/my plan.md", title: "Plan", items: docItems(doc) }];
  it("Open questions lists every question by file, linked", () => {
    const md = questionsReport(files, "2026-11-16");
    expect(md).toContain("_4 questions in 1 file");
    expect(md).toContain("## [Plan](docs/my%20plan.md)");
    // the line number opens the doc at that line (owner report 2026-11-24)
    expect(md).toContain("- which region first? _([line 6](docs/my%20plan.md#L6))_");
  });
  it("My items lists what names me, and says how to set my names", () => {
    expect(myItemsReport(files, ["@kish"], "2026-11-16")).toContain(
      "- [ ] write the adapter @kish _(line 2)_",
    );
    expect(myItemsReport(files, [], "2026-11-16")).toContain(
      'add your name and @handle to the setting "docmap.myNames"',
    );
  });
});
