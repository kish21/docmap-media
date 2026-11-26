import { describe, expect, it } from "vitest";
import { readingOrder, readingOrderMarkdown, type StartDoc } from "./reading-order";

const doc = (rel: string, more: Partial<StartDoc> = {}): StartDoc => ({
  rel,
  inbound: 0,
  modified: 0,
  ...more,
});

describe("#47 where do I start?", () => {
  const docs: StartDoc[] = [
    doc("docs/decisions/0001-old.md", { kind: "decision", title: "Use Postgres", modified: 1 }),
    doc("docs/decisions/0002-new.md", { kind: "decision", title: "Use queues", modified: 5 }),
    doc("plans/launch-plan.md", { title: "Launch plan", openPlanItems: 3 }),
    doc("plans/done-plan.md", { title: "Done plan", openPlanItems: 0 }),
    doc("docs/design/cache.md", { kind: "design", title: "Cache design", inbound: 1 }),
    doc("docs/design/orders.md", { kind: "design", title: "Orders design", inbound: 4 }),
    doc("README.md", { title: "Shop" }),
    doc("lib/README.md", { title: "Lib" }),
    doc("notes/random.md", { title: "Random notes" }),
  ];

  it("orders README, design (most linked first), decisions (newest first), open plans; skips the rest", () => {
    const groups = readingOrder(docs);
    expect(groups.map((g) => [g.heading, g.steps.map((s) => s.rel)])).toEqual([
      ["What the project is", ["README.md"]],
      ["The design", ["docs/design/orders.md", "docs/design/cache.md"]],
      ["Recent decisions", ["docs/decisions/0002-new.md", "docs/decisions/0001-old.md"]],
      ["Work in progress", ["plans/launch-plan.md"]],
    ]);
    expect(groups[3]?.steps[0]?.why).toBe("A plan still in progress: 3 open items.");
  });

  it("with no README at the top (a parent folder opened), the highest README is the project's", () => {
    const groups = readingOrder([
      doc("sample-shop/docs/design/checkout.md", { kind: "design", title: "Checkout design" }),
      doc("sample-shop/lib/README.md", { title: "Lib" }),
      doc("sample-shop/README.md", { title: "Sample Shop" }),
    ]);
    expect(groups[0]).toEqual({
      heading: "What the project is",
      steps: [
        {
          rel: "sample-shop/README.md",
          title: "Sample Shop",
          why: "What the project is and how to run it.",
        },
      ],
    });
  });

  it("keeps each group short and lists a doc only once", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      doc(`docs/design/d${i}.md`, { kind: "design", openPlanItems: 2 }),
    );
    const groups = readingOrder(many);
    expect(groups.map((g) => g.steps.length)).toEqual([3, 3]);
    const all = groups.flatMap((g) => g.steps.map((s) => s.rel));
    expect(new Set(all).size).toBe(all.length);
  });

  it("writes numbered links (title, else path) with the reason, and a plain note when nothing is found", () => {
    const md = readingOrderMarkdown(
      readingOrder([doc("README.md"), doc("docs/design/a b.md", { kind: "design" })]),
    );
    expect(md).toContain(
      "## What the project is\n\n1. [README.md](README.md): What the project is and how to run it.",
    );
    expect(md).toContain("2. [docs/design/a b.md](docs/design/a%20b.md): What is being built and why.");
    expect(readingOrderMarkdown([])).toContain(
      "docmap found no README, design doc, decision, plan or runbook",
    );
  });
});
