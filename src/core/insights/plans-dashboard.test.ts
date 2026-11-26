import { describe, expect, it } from "vitest";
import { type PlanRow, planRow } from "./plans";
import { ago, BROWSER_FRAGMENT, dashboardMarkdown, shortDate } from "./plans-dashboard";

const NOW = Date.parse("2026-11-16T12:00:00Z");
const DAY = 86_400_000;
const nb = (s: string) => s.replace(/ /g, " ");

const tracked = [
  "---",
  "status: In review",
  "owner: Priya",
  "---",
  "# Search revamp plan",
  "## Steps",
  "- [x] build the index",
  "- [ ] switch the API — due 2026-12-01",
  "- [ ] delete the old index by 2026-11-01",
  "## Risks",
  "- memory on small machines",
  "## Open questions",
  "- keep v1 endpoint",
  "Decision: we use Postgres.",
].join("\n");

const row = (text: string, file: string, ageDays = 1) =>
  planRow(text, file, NOW - ageDays * DAY, NOW, 90) as PlanRow;

describe("plans dashboard page", () => {
  const rows = [
    row(tracked, "docs/plans/search plan.md"),
    row("# Plan\n- [x] a\n- [x] b\n", "docs/plans/done-plan.md", 2),
    row("# Plan\n- [ ] ship by 2026-10-01\n", "late-plan.md", 3),
    row("# Auth design\n\nWe should do X.\n", "docs/architecture/auth-design.md", 30),
  ];

  it("groups plans by folder (top folder first), with a count and how many need attention", () => {
    const md = nb(dashboardMarkdown(rows, NOW, "attention"));
    const order = ["### Top folder", "### docs/architecture", "### docs/plans"].map((h) => md.indexOf(h));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(md).toContain("### docs/plans\n\n_2 plans · 1 needs attention_");
    expect(md).toContain("[Search revamp plan](docs/plans/search%20plan.md)");
  });

  it("puts totals on one line and what needs attention first, naming the folder", () => {
    const md = nb(dashboardMarkdown(rows, NOW, "attention"));
    expect(md).toContain("**4 plans** · 1 done · 1 in progress · 1 not started · 1 quiet · 1 open question");
    expect(md.indexOf("## Needs attention")).toBeLessThan(md.indexOf("## Plans by folder"));
    // owner screenshot 2026-11-23: a folder like G_Implementation broke the _italics_ and showed raw underscores
    expect(md).toMatch(/- \*\*\[Plan\]\(late-plan\.md\)\*\* — overdue since 2026-10-01 · in Top folder/);
    expect(md).not.toMatch(/ready/i);
  });

  it("lists dates coming up, open questions and decisions", () => {
    const md = nb(dashboardMarkdown(rows, NOW, "attention"));
    expect(md).toContain(
      "## Coming up\n\n_Dates in the next 30 days._\n\n- **1 Dec** — [Search revamp plan]",
    );
    expect(md).toContain(
      "## Open questions\n\n- **[Search revamp plan](docs/plans/search%20plan.md)**: keep v1 endpoint",
    );
    expect(md).toContain(
      "<summary>Decisions (1 plan)</summary>\n\n- **[Search revamp plan](docs/plans/search%20plan.md)**: we use Postgres.",
    );
  });

  it("shows only the columns the project fills", () => {
    const bare = [
      row("# Auth design\n\nText.\n", "docs/auth-design.md"),
      row("# Q3 roadmap\n", "roadmap.md", 30),
    ];
    const md = nb(dashboardMarkdown(bare, NOW, "changed"));
    expect(md).toContain("| Plan | Status | Changed |");
    expect(md).not.toContain("Progress");
    expect(md).not.toContain("no owner"); // nobody in this project writes owners
    const full = nb(dashboardMarkdown(rows, NOW, "attention"));
    expect(full).toContain("| Plan | Progress | Status | Owner | Next date | Notes | Changed |");
  });

  it("fills the owner from git and lists plans out of date with the code and recently changed", () => {
    const bare = [
      {
        ...row("# Auth design\n\nText.\n", "docs/auth-design.md"),
        lastEditor: "Sam",
        missing: ["src/old.ts"],
      },
    ];
    const md = nb(dashboardMarkdown(bare, NOW, "changed"));
    expect(md).toContain("| Plan | Status | Owner | Changed |");
    expect(md).toContain("| Sam _(last commit)_ |");
    expect(md).toContain("## Out of date with the code");
    expect(md).toContain("- [Auth design](docs/auth-design.md): `src/old.ts`");
    expect(md).toContain(
      "## Recently changed\n\n- [Auth design](docs/auth-design.md) — yesterday, last commit by Sam",
    );
  });

  it("adds a browser link beside each plan only when asked (not for agents)", () => {
    const withLinks = dashboardMarkdown(rows, NOW, "attention", { browserLinks: true });
    expect(withLinks).toContain(
      `[Search revamp plan](docs/plans/search%20plan.md) [🌐](docs/plans/search%20plan.md#${BROWSER_FRAGMENT} "Open this plan in the browser")`,
    );
    expect(dashboardMarkdown(rows, NOW, "attention")).not.toContain("🌐");
  });

  it("short dates: the year only when it is not this year; changes as today / yesterday / days ago", () => {
    expect(shortDate("2026-12-01", NOW)).toBe("1 Dec");
    expect(shortDate("2027-01-05", NOW)).toBe("5 Jan 2027");
    expect(ago(NOW, NOW)).toBe("today");
    expect(ago(NOW - DAY, NOW)).toBe("yesterday");
    expect(ago(NOW - 5 * DAY, NOW)).toBe("5 days ago");
    expect(ago(NOW - 40 * DAY, NOW)).toBe("7 Oct");
  });

  it("leads with the work in progress and its next open step; finished plans fold away", () => {
    const md = nb(dashboardMarkdown(rows, NOW, "attention"));
    expect(md).toContain(
      "## In progress\n\n- **[Search revamp plan](docs/plans/search%20plan.md)** — 1/3 done · next: switch the API — due 2026-12-01",
    );
    expect(md.indexOf("## In progress")).toBeLessThan(md.indexOf("## Needs attention"));
    // the finished plan is not a table row; it sits in a folded list under its folder
    expect(md).not.toMatch(/\| \[Plan\]\(docs\/plans\/done-plan\.md\)/);
    expect(md).toContain("<details>\n<summary>1 finished</summary>\n\n- [Plan](docs/plans/done-plan.md)");
    expect(md).toContain("<details>\n<summary>Decisions (1 plan)</summary>");
  });

  it("archived plans stay out of Needs attention and fold with the finished ones; 'no owner' only where most plans have one", () => {
    const old = row("# Plan\n- [ ] ship by 2026-08-17\n", "docs/archive/G_Implementation/x-plan.md", 200);
    const md = nb(dashboardMarkdown([...rows, old], NOW, "attention"));
    const attentionPart = md.slice(md.indexOf("## Needs attention"), md.indexOf("## Plans by folder"));
    expect(attentionPart).not.toContain("x-plan.md");
    expect(md).toContain("<summary>1 archived</summary>");
    // 1 plan of 5 names an owner: "no owner" on the rest is noise
    expect(md).not.toContain("no owner");
  });

  it("says how a file counts as a plan when there are none", () => {
    const md = dashboardMarkdown([], NOW, "changed");
    expect(md).toContain("No plans found");
    expect(md).toContain("front matter");
  });
});
