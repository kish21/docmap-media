import type { DocKind } from "./formats";

/**
 * #47 "Where do I start?": a reading order for someone new to the project, from what docmap already knows — the
 * README, how the parts fit, the design, the specs, recent decisions, the plans still in progress, the runbooks.
 * Only docs that exist; one line each on why. Pure: the extension hands over the scanned docs.
 */
export interface StartDoc {
  /** Workspace-relative path with `/`. */
  readonly rel: string;
  readonly title?: string | undefined;
  readonly kind?: DocKind | undefined;
  /** Open checklist items, when the doc reads as a plan that is not done. */
  readonly openPlanItems?: number | undefined;
  /** How many other docs link to it (the more, the more central). */
  readonly inbound: number;
  readonly modified: number;
}

export interface ReadingStep {
  readonly rel: string;
  readonly title: string;
  readonly why: string;
}

interface Step {
  readonly heading: string;
  /** `topReadme`: the project's README — the one closest to the top (a parent folder may be the one opened). */
  readonly pick: (d: StartDoc, topReadme: string | undefined) => boolean;
  readonly why: (d: StartDoc) => string;
  /** Newest first instead of most linked first (decisions). */
  readonly newest?: true;
  readonly max: number;
}

const name = (rel: string) => rel.split("/").pop()?.toLowerCase() ?? "";
const isReadme = (d: StartDoc) => name(d.rel) === "readme.md";

const STEPS: readonly Step[] = [
  {
    heading: "What the project is",
    pick: (d, topReadme) => d.rel === topReadme,
    why: () => "What the project is and how to run it.",
    max: 1,
  },
  {
    heading: "How to work on it",
    pick: (d) => name(d.rel) === "contributing.md",
    why: () => "How the team works: setup, rules, how to send a change.",
    max: 1,
  },
  {
    heading: "How the parts fit together",
    pick: (d) => d.kind === "architecture",
    why: () => "The big picture: the parts and how they talk.",
    max: 2,
  },
  {
    heading: "The design",
    pick: (d) => d.kind === "design" || d.kind === "design-system",
    why: (d) =>
      d.kind === "design-system"
        ? "How the interface should look and behave."
        : "What is being built and why. Read it before changing the code.",
    max: 3,
  },
  {
    heading: "What features must do",
    pick: (d) => d.kind === "spec",
    why: () => "What a feature must do, and how to tell it is done.",
    max: 3,
  },
  {
    heading: "Recent decisions",
    pick: (d) => d.kind === "decision",
    why: () => "A choice the team made, and why. Saves asking again.",
    newest: true,
    max: 3,
  },
  {
    heading: "Work in progress",
    pick: (d) => (d.openPlanItems ?? 0) > 0,
    why: (d) =>
      `A plan still in progress: ${d.openPlanItems} open ${d.openPlanItems === 1 ? "item" : "items"}.`,
    max: 3,
  },
  {
    heading: "When something breaks",
    pick: (d) => d.kind === "runbook",
    why: () => "What to do when something goes wrong.",
    max: 2,
  },
];

export interface ReadingGroup {
  readonly heading: string;
  readonly steps: readonly ReadingStep[];
}

/** The reading order, in groups; empty groups are left out, and a doc appears once. */
export function readingOrder(docs: readonly StartDoc[]): ReadingGroup[] {
  const used = new Set<string>();
  const out: ReadingGroup[] = [];
  const depth = (rel: string) => rel.split("/").length;
  const topReadme = docs
    .filter(isReadme)
    .map((d) => d.rel)
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0];
  for (const step of STEPS) {
    const picked = docs
      .filter((d) => !used.has(d.rel) && step.pick(d, topReadme))
      .sort((a, b) =>
        step.newest
          ? b.modified - a.modified || a.rel.localeCompare(b.rel)
          : b.inbound - a.inbound || a.rel.localeCompare(b.rel),
      )
      .slice(0, step.max);
    if (!picked.length) continue;
    for (const d of picked) used.add(d.rel);
    out.push({
      heading: step.heading,
      steps: picked.map((d) => ({ rel: d.rel, title: d.title?.trim() || d.rel, why: step.why(d) })),
    });
  }
  return out;
}

const href = (file: string) => encodeURI(file).replace(/\(/g, "%28").replace(/\)/g, "%29");
const text = (s: string) => s.replace(/[[\]]/g, "\\$&").replace(/[\r\n]+/g, " ");

/** The page: numbered steps under each group, each a link plus why. */
export function readingOrderMarkdown(groups: readonly ReadingGroup[]): string {
  const lines = ["# Where do I start?", ""];
  if (!groups.length) {
    lines.push(
      "docmap found no README, design doc, decision, plan or runbook in this project yet.",
      "",
      "Tip: **New Doc from Template…** starts one in the shape your team uses.",
    );
    return `${lines.join("\n")}\n`;
  }
  lines.push("Read these in order. Each one says why it is worth your time.", "");
  let n = 0;
  for (const g of groups) {
    lines.push(`## ${g.heading}`, "");
    for (const s of g.steps) lines.push(`${++n}. [${text(s.title)}](${href(s.rel)}): ${s.why}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
