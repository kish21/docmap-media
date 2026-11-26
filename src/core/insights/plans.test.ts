import { describe, expect, it } from "vitest";
import { attention, dashboardCsv, planRow, sortPlans } from "./plans";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const DAY = 86_400_000;

const plan = [
  "---",
  "status: In review",
  "owner: Priya",
  "---",
  "# Search revamp plan",
  "**Goal:** fast search. Ask @sam about the API.",
  "## Steps",
  "- [x] build the index",
  "- [ ] switch the API — due 2026-12-01",
  "- [ ] delete the old index by 2026-11-01",
  "## Risks",
  "- memory on small machines",
  "- cache stampede",
  "## Open questions",
  "- keep v1 endpoint",
  "- which region first",
  "Do we need a flag?",
  "```",
  "Is this counted?",
  "```",
].join("\n");

describe("planRow: finished and next step (owner report 2026-11-23, MarkVid)", () => {
  const status = (s: string) =>
    planRow(
      `---\nstatus: ${s}\n---\n# Spec\n\nText from 2026-07-19.\n`,
      "docs/a-spec.md",
      NOW - 200 * DAY,
      NOW,
      90,
    )?.status;
  it("a status that starts with a finished word or a tick counts as done, never stale or overdue", () => {
    for (const s of [
      "✅ Built 2026-07-19 · deferred items done in 45/46",
      "Shipped in 3.1",
      "Superseded by 45",
      "Merged",
    ])
      expect(status(s), s).toBe("done");
    const r = planRow(
      "---\nstatus: ✅ Built 2026-07-19\n---\n# Spec\n",
      "docs/a-spec.md",
      NOW - 200 * DAY,
      NOW,
      90,
    );
    expect(r?.overdue).toBe(false);
    expect(status("Not built yet")).not.toBe("done");
    expect(status("In review")).not.toBe("done");
  });
  it("a plan in an archive folder is archived and never needs attention", () => {
    const r = planRow(
      "# Plan\n- [ ] ship by 2026-08-17\n",
      "docs/archive/G_Impl/x-plan.md",
      NOW - 200 * DAY,
      NOW,
      90,
    );
    expect(r?.archived).toBe(true);
    expect(attention(r!)).toEqual([]);
    expect(planRow("# Plan\n- [ ] a\n", "docs/plans/x-plan.md", NOW, NOW, 90)?.archived).toBe(false);
  });
  it("a date in a doc with no open task box is history, not overdue", () => {
    const r = planRow("# Design doc\n\nDecided on 2026-08-17.\n", "docs/x-design.md", NOW - DAY, NOW, 90);
    expect(r?.overdue).toBe(false);
    expect(r?.nextDate).toBeUndefined();
  });
  it("keeps the first open task as the next step (not one inside a code block)", () => {
    const r = planRow(plan, "docs/search plan.md", NOW - DAY, NOW, 90);
    expect(r?.nextTask).toBe("switch the API — due 2026-12-01");
    expect(
      planRow("# Plan\n```\n- [ ] no\n```\n- [x] a\n", "plan.md", NOW, NOW, 90)?.nextTask,
    ).toBeUndefined();
  });
});

describe("planRow", () => {
  it("reads progress, status, owners, the next date, questions and risks", () => {
    const r = planRow(plan, "docs/search plan.md", NOW - DAY, NOW, 90);
    expect(r).toMatchObject({
      title: "Search revamp plan",
      done: 1,
      total: 3,
      status: "in progress",
      declared: "In review",
      owners: ["Priya", "@sam"],
      nextDate: "2026-12-01",
      overdue: false,
      questions: 3,
      risks: 2,
    });
    expect(r).not.toHaveProperty("ready");
  });

  it("is undefined for a file that is not a plan", () => {
    expect(planRow("# Rust notes\n\nEnums.\n", "notes.md", NOW, NOW, 90)).toBeUndefined();
  });

  it("counts a plan only by its name, title or front matter — never by which sections it has", () => {
    const sections = ["Goal", "Scope", "Owner", "Steps", "Risks", "Rollback"].map(
      (h) => `## ${h}\n\nText.\n`,
    );
    expect(planRow(`# Notes\n\n${sections.join("\n")}`, "notes.md", NOW, NOW, 90)).toBeUndefined();
    expect(planRow("---\ntype: plan\n---\n# Notes\n", "notes.md", NOW, NOW, 90)).toBeDefined();
    expect(planRow("---\nkind: proposal\n---\n# Notes\n", "notes.md", NOW, NOW, 90)).toBeDefined();
    expect(planRow("# Q3 roadmap\n", "notes.md", NOW, NOW, 90)).toBeDefined();
    expect(planRow("# Notes\n", "search-plan.md", NOW, NOW, 90)).toBeDefined();
  });

  it("done, stale, blocked and overdue", () => {
    expect(planRow("# Plan\n- [x] a\n- [x] b\n", "p.md", NOW, NOW, 90)?.status).toBe("done");
    expect(planRow("# Plan\n- [ ] a\n", "p.md", NOW - 100 * DAY, NOW, 90)?.status).toBe("stale");
    expect(planRow("---\nstatus: blocked\n---\n# Plan\n- [ ] a\n", "p.md", NOW, NOW, 90)?.status).toBe(
      "blocked",
    );
    const late = planRow("# Plan\n- [ ] ship by 2026-10-01\n", "p.md", NOW, NOW, 90);
    expect(late).toMatchObject({ nextDate: "2026-10-01", overdue: true });
    expect(attention(late!)).toContain("overdue since 2026-10-01");
  });
});

describe("dashboard", () => {
  const rows = [
    planRow(plan, "docs/search plan.md", NOW - DAY, NOW, 90)!,
    planRow("# Plan\n- [x] a\n- [x] b\n", "done-plan.md", NOW - 2 * DAY, NOW, 90)!,
    planRow("# Plan\n- [ ] ship by 2026-10-01\n", "late-plan.md", NOW - 3 * DAY, NOW, 90)!,
  ];

  it("sorts by what needs attention, by date, by progress", () => {
    expect(sortPlans(rows, "attention").map((r) => r.file)[0]).toBe("late-plan.md");
    expect(sortPlans(rows, "date").map((r) => r.file)).toEqual([
      "late-plan.md",
      "docs/search plan.md",
      "done-plan.md",
    ]);
    expect(sortPlans(rows, "progress").map((r) => r.file)[0]).toBe("late-plan.md");
  });

  it("CSV quotes commas and quotes, and defuses spreadsheet formulas", () => {
    const evil = { ...rows[0]!, title: '=HYPERLINK("x"), y' };
    const csv = dashboardCsv([evil], "changed");
    expect(csv.split("\r\n")[1]).toContain(`"'=HYPERLINK(""x""), y"`);
  });
});

describe("status without task boxes or a status of its own", () => {
  it("comes from when the plan last changed: active, quiet, stale", () => {
    expect(planRow("# Plan\n\nText.\n", "p.md", NOW - 3 * DAY, NOW, 90)?.status).toBe("active");
    expect(planRow("# Plan\n\nText.\n", "p.md", NOW - 30 * DAY, NOW, 90)?.status).toBe("quiet");
    expect(planRow("# Plan\n\nText.\n", "p.md", NOW - 100 * DAY, NOW, 90)?.status).toBe("stale");
  });

  it("'no owner' is a reason only where the project writes owners; gone files are a reason", () => {
    const r = planRow("# Plan\n- [ ] a\n", "p.md", NOW, NOW, 90)!;
    expect(attention(r)).toContain("no owner");
    expect(attention(r, { ownersUsed: false })).not.toContain("no owner");
    expect(attention({ ...r, missing: ["src/gone.ts"] })).toContain("names 1 file that no longer exists");
  });

  it("keeps the first few open questions and decisions as text", () => {
    const r = planRow(plan, "docs/search plan.md", NOW, NOW, 90)!;
    expect(r.questionList).toEqual(["keep v1 endpoint", "which region first", "Do we need a flag?"]);
  });
});
