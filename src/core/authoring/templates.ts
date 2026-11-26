/**
 * 3.0 doc templates and writing rules: the shapes a product's Markdown docs take, built so every docmap feature
 * reads them — the header card, the Plans dashboard, task boxes, status labels, Open questions, decisions. Pure.
 * Hints are HTML comments: shown in the text, hidden on the page.
 *
 * The shapes follow the owner's product playbook (vision, scope, plan, architecture, runbook, feature tickets, as in
 * its worked example), Diátaxis (one purpose per doc), GitHub Spec Kit (spec → plan → tasks), MADR (decision
 * records) and AGENTS.md. Headings carry no hand-typed numbers: docmap numbers them on the page when asked.
 */

export type DocTypeId =
  | "vision"
  | "scope"
  | "plan"
  | "architecture"
  | "spec"
  | "design"
  | "ticket"
  | "decision"
  | "runbook"
  | "agents"
  | "structure"
  | "design-system"
  | "test-plan"
  | "postmortem"
  | "release-notes";

export interface DocType {
  readonly id: DocTypeId;
  readonly label: string;
  readonly detail: string;
  /** Suggested file name for a new doc (`{slug}` = the title as a file name). */
  readonly file: string;
  /** The sections, in order: heading and the hint written under it. */
  readonly sections: readonly (readonly [heading: string, hint: string])[];
}

/** The rules every doc follows (the restructure prompt hands them to the agent; Help shows them). */
export const WRITING_RULES: readonly string[] = [
  "One purpose per doc: a plan is a plan, a how-to is a how-to — do not mix them.",
  "One # title. The first section (In short) says what the doc is about and makes sense on its own.",
  "Specific headings (## Roll back the queue, not ## Step 2); no skipped levels; at most ### or ####; no hand-typed numbers in headings.",
  "Owner, status and dates at the top (front matter: owner, status, deadline); dates as YYYY-MM-DD.",
  "Tasks as - [ ] / - [x] items; statuses as one plain word in a table cell (to do, in progress, done, blocked, at risk).",
  "Decisions as lines starting with Decision: — with the reason.",
  "An ## Open questions section for anything not yet decided: the question, our suggestion, who decides and by when. Never invent an answer.",
  "Every number has a source, or is marked (proposed) or (estimate).",
  "A sentence before every code block saying what it does and where to run it.",
  "Plain words and sentences of 25 words or fewer; explain an abbreviation the first time.",
];

const QUESTIONS: readonly [string, string] = [
  "Open questions",
  "One per line: the question · our suggestion · who decides, by when.",
];

export const DOC_TYPES: readonly DocType[] = [
  {
    id: "vision",
    label: "Vision",
    detail: "Why the product exists: who it is for, the problem, why now, the goal, how we will know",
    file: "docs/vision.md",
    sections: [
      ["In one line", "What the product does, for whom, and the result — one sentence."],
      ["Who it is for", "The main users, others who use it, how many, and the first users to serve."],
      ["The problem", "What goes wrong for them today and why it happens, with a fact and its source."],
      ["Why now", "What changed that makes this possible or urgent now."],
      ["How it is solved today", "What people do instead, and what that costs them."],
      ["The experience", "One person's day with the product, from the need to the result, step by step."],
      ["How it works", "The main parts; where AI is used and where a person decides."],
      ["Value and business model", "What it is worth to whom, and how it pays for itself."],
      [
        "How we will know",
        "The goal as a number and a date, each measure and how it is counted, and one thing that must not happen.",
      ],
      ["Riskiest assumption", "The belief that, if wrong, sinks the product — and how we test it first."],
      ["Rules, languages and data", "Laws, languages and data it must respect, and what each means here."],
      ["Competitors", "A table: Who | What they do | Price | Where they win — include where they beat us."],
      QUESTIONS,
    ],
  },
  {
    id: "scope",
    label: "Scope",
    detail: "What gets built now, what later (and what brings it in), and what never",
    file: "docs/scope.md",
    sections: [
      [
        "The core feature",
        "The one thing the product exists for, in one sentence: who asks, what they get. Which risk it tests.",
      ],
      ["In the first version", "A table: Part | What a person can do | Done when (a check anyone can run)."],
      ["Who builds it, and when", "Who builds it and for how long; the first version must fit."],
      ["Later, and what brings each in", "A table: Part | When (the signal, with a number)."],
      ["Never", "What we will not build, each with why."],
      [
        "The basics everyone expects",
        "Sign-in, privacy, help, errors, accessibility… each: in now, later (when), or not needed (why).",
      ],
      ["Options considered", "Other ways we could have cut it, and why not."],
      QUESTIONS,
    ],
  },
  {
    id: "plan",
    label: "Plan",
    detail: "How the work gets done: goal and dates, owners, milestones, rollout, risks, testing, rollback",
    file: "docs/plans/{slug}.md",
    sections: [
      [
        "In short",
        "What will work by which date, what the first demo will show, and what it will not show yet.",
      ],
      ["Scope", "In: … Out: … (link the scope doc if there is one)."],
      ["Owners", "Who owns it, who decides, who builds (@names)."],
      [
        "Milestones",
        "A table: Id | Name | Dates | Delivers | Done when | Status — each milestone something a user can do.",
      ],
      ["Steps", "- [ ] the next tasks, in order, each small and testable."],
      ["Rollout", "How it reaches users: release, migration, feature flag, who is told."],
      ["Risks", "Each risk, the milestone that tests it, and what we do — biggest first."],
      [
        "Testing",
        "How we know it works: Done when: … per milestone, and the usability check before going public.",
      ],
      ["Rollback", "How to undo it if it goes wrong, and who decides to."],
      ["Timeline", "Dates as YYYY-MM-DD, schedule risks, and the buffer with its dates."],
      QUESTIONS,
    ],
  },
  {
    id: "architecture",
    label: "Architecture",
    detail: "How it is built: drivers, rules, flow, building blocks, data, decisions, security",
    file: "docs/architecture.md",
    sections: [
      ["Overview", "What the system is and its main parts, in a few lines."],
      ["What drives the design", "The needs and limits that shape it (scale, cost, privacy, team)."],
      ["Rules the code must keep", "The few rules that must never be broken, each with why."],
      ["How it works, step by step", "The main flow, from input to result."],
      ["Building blocks", "A table: Part | Job | Technology."],
      ["Data", "What is stored, where, for how long, and who can see it."],
      [
        "Decisions",
        "One line each: Decision: <choice> — because <reason> (link a decision record for big ones).",
      ],
      ["Security and privacy", "Secrets, personal data, and what is checked."],
      ["Running it", "Where it runs and how it is deployed (link the runbook)."],
      ["Risks", "What could go wrong in the design."],
      QUESTIONS,
    ],
  },
  {
    id: "spec",
    label: "Feature spec",
    detail:
      "One feature in the GitHub Spec Kit shape: user scenarios and tests, requirements, success criteria",
    file: "docs/specs/{slug}.md",
    // Spec Kit's section names (github/spec-kit spec-template), so "Compare with a Standard Format" recognises it
    sections: [
      ["In short", "What the feature lets a user do, and why now."],
      [
        "User Scenarios & Testing",
        "As <who>, I want <what>, so that <why> — one per line, each with Done when: … (a check anyone can run).",
      ],
      ["Edge Cases", "What happens at the limits: empty, too large, offline, no permission."],
      ["Requirements", "What the system must do, one per line, each testable."],
      ["Success Criteria", "How we know it worked: a number or an observable result, with a date."],
      ["Assumptions", "What we take as given; each one could be wrong."],
      ["Tasks", "- [ ] small steps, each testable, in order."],
      QUESTIONS,
    ],
  },
  {
    id: "design",
    label: "Design doc",
    detail:
      "One design in the Google design-doc shape: context, goals and non-goals, the design, alternatives",
    file: "docs/design/{slug}.md",
    // section names from "Design Docs at Google" (industrialempathy.com), so the compare command recognises it
    sections: [
      ["In short", "What is being designed, and the result, in two lines."],
      ["Context and scope", "What exists today, what this covers and what it does not."],
      [
        "Goals and non-goals",
        "Goals: … Non-goals: … — each one line; non-goals are things one could want but we don't.",
      ],
      [
        "The actual design",
        "How it works: the main parts, the flow, the data, the interfaces. Diagrams welcome.",
      ],
      ["Alternatives considered", "Each other way, and why not — the trade-off, not a straw man."],
      [
        "Cross-cutting concerns",
        "Security, privacy, observability, cost — what this design does about each.",
      ],
      QUESTIONS,
    ],
  },
  {
    id: "ticket",
    label: "Ticket",
    detail: "One piece of work: goal, done when, owner, files, depends on, demo, tasks, how to verify",
    file: "docs/issues/{slug}.md",
    sections: [
      ["Goal", "What works after this is merged, in one sentence."],
      ["Done when", "The exit check: an action and what is seen, a number or a command."],
      ["Owner", "Who does it (@name)."],
      ["Files", "The files it changes or adds."],
      ["Depends on", "Tickets or decisions it waits for."],
      ["Demo", "What you can show once it is merged."],
      ["Tasks", "- [ ] the steps, in order."],
      ["Definition of done", "Tests, review, security and docs that must be in place."],
      ["Verification", "The command that proves it, in a code block, with what it should print."],
    ],
  },
  {
    id: "decision",
    label: "Decision record",
    detail: "One decision in the MADR format: the problem, the options, the outcome and its consequences",
    file: "docs/decisions/{slug}.md",
    // MADR's section names (https://adr.github.io/madr/), so "Compare with a standard format" recognises it.
    sections: [
      ["Context and Problem Statement", "The problem and what forces the decision now."],
      ["Decision Drivers", "What matters most in choosing (cost, speed, risk…). Optional."],
      ["Considered Options", "Each option, with its pros and cons."],
      ["Decision Outcome", "Decision: <the choice> — because <the reason>."],
      ["Consequences", "What becomes easier, what becomes harder, what we must now do."],
    ],
  },
  {
    id: "runbook",
    label: "Runbook",
    // docmap's suggested shape (no single public standard): one task or alert per runbook, steps you can follow
    // half-asleep, a check after each, a way back, and who to call
    detail:
      "Suggested template: what it is for, when to use it, steps, check it worked, roll back, who to call",
    file: "docs/runbooks/{slug}.md",
    sections: [
      ["In short", "What this runbook does and the result, in one or two lines."],
      ["When to use it", "The alert, symptom or request that brings you here — and when NOT to use it."],
      [
        "Before you start",
        "Access, tools and settings you need (where secrets live, never the value), and how risky this is.",
      ],
      [
        "Steps",
        "Numbered steps, one action each, the command in a code block, and what you should see after it.",
      ],
      ["Check it worked", "The command or screen that proves it, and what a good result looks like."],
      ["Roll back", "How to undo each step if it went wrong."],
      ["If it goes wrong", "Who to call or which channel, and what to tell them."],
      ["Related", "Dashboards, logs, alerts and other runbooks."],
    ],
  },
  {
    id: "design-system",
    label: "Design system (DESIGN.md)",
    // docmap's suggested shape: what a developer or an AI agent needs to build screens that match
    detail:
      "Suggested template: principles, colour, type, spacing, components, icons, motion, accessibility, themes",
    file: "DESIGN.md",
    sections: [
      ["In short", "The look and feel in two lines, and who the screens are for."],
      ["Principles", "Three to five rules every screen follows, each with why."],
      [
        "Colour",
        "A table: Token | Use | Light | Dark — name tokens by their job (text, surface, accent, danger), never by hue; text contrast at least 4.5:1.",
      ],
      [
        "Typography",
        "Font families, the type scale (size · line height · weight per level), and the smallest size allowed.",
      ],
      ["Spacing and layout", "The spacing scale, grid or max widths, breakpoints, corner radius."],
      [
        "Components",
        "One ### per component: what it is for, its variants and states (hover, focus, disabled, error, loading), and do / don't.",
      ],
      ["Icons and images", "The icon set, sizes, and rules for pictures and alt text."],
      ["Motion", "Durations and easing, and what happens when the user asks for reduced motion."],
      [
        "Accessibility",
        "Keyboard, visible focus, contrast, screen-reader labels — the rules no screen may break.",
      ],
      ["Themes", "Dark mode and high contrast: how tokens change, and what must never be hard-coded."],
      ["Where it lives in code", "The file that defines the tokens, and how components use them."],
      QUESTIONS,
    ],
  },
  {
    id: "test-plan",
    label: "Test plan",
    detail:
      "Suggested template: what is tested and not, how, the cases, environments, when it is done, risks",
    file: "docs/test-plans/{slug}.md",
    sections: [
      ["In short", "What is being tested, for which release, and who owns it."],
      ["In scope and out of scope", "In: … Out: … — and why each out-of-scope item is safe to skip."],
      ["Approach", "Unit, integration, end-to-end, manual, performance, security — which, and why."],
      [
        "Test cases",
        "A table: Id | What is checked | Steps | Expected result | Status (to do, done, blocked).",
      ],
      ["Environments and data", "Where the tests run, the test data, and test accounts (never real ones)."],
      ["Done when", "The exit check: what must pass, and what may stay open."],
      ["Risks", "What could hide a bug, and what we do about it."],
      QUESTIONS,
    ],
  },
  {
    id: "postmortem",
    label: "Postmortem",
    // blameless: systems and decisions, not people
    detail:
      "Suggested template (blameless): summary, impact, timeline, root cause, what went well and not, actions",
    file: "docs/postmortems/{slug}.md",
    sections: [
      ["In short", "What happened, how long, and who was affected — two lines."],
      ["Impact", "Users, data, money or promises affected, with numbers and their source."],
      ["Timeline", "A table: Time (with zone) | What happened | Who noticed or acted."],
      ["Root cause", "Why it happened — keep asking why; systems and decisions, never blame on a person."],
      ["What went well", "What helped us find and fix it."],
      ["What went badly", "What slowed us down or made it worse."],
      ["Action items", "- [ ] each fix, with an owner (@name) and a date."],
    ],
  },
  {
    id: "release-notes",
    label: "Release notes",
    detail: "Suggested template: highlights, new, changed, fixed, upgrade notes, known issues",
    file: "docs/releases/{slug}.md",
    sections: [
      ["Highlights", "The two or three changes a user will notice, in their words."],
      ["New", "One line per new feature: what a user can now do."],
      ["Changed", "What works differently now."],
      ["Fixed", "One line per fix: what was wrong, from the user's side."],
      ["Upgrade notes", "Breaking changes and what to do about each; empty if none."],
      ["Known issues", "What is still wrong, and the workaround."],
    ],
  },
  {
    id: "agents",
    label: "Agent guide (AGENTS.md)",
    detail: "What an AI coding agent needs: overview, commands, code style, testing, security",
    file: "AGENTS.md",
    sections: [
      ["Project overview", "What this project is, in two lines, and which docs to read first."],
      ["Build and test commands", "Each command, in a code block, with a sentence on what it does."],
      ["Code style", "The rules the code follows, and the tools that check them."],
      ["Testing", "How to run the tests, and what every change must be tested with."],
      ["Security", "Secrets, data and access: where they live and who may touch them."],
      [
        "Never do",
        "Hard rules for the agent, each with why. For example: never delete database migrations (production depends on them); never change the public API without a version bump.",
      ],
    ],
  },
  {
    id: "structure",
    label: "Structure",
    detail: "Where things go in the repository, and why",
    file: "STRUCTURE.md",
    sections: [
      ["Layout", "The folders as a tree, one comment each."],
      ["Where new things go", "A table: Kind of file | Folder | Why."],
      ["Rules", "The few layout rules that must not be broken, each with why."],
    ],
  },
];

/** A title as a file name: "Checkout rollout" → "checkout-rollout". */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60) || "untitled"
  );
}

/** A new doc of this type: front matter (owner/status/created), the title, and each section with its hidden hint. */
export function docTemplate(type: DocType, title: string, today: string): string {
  const head = [
    "---",
    "owner:",
    "status: draft",
    `created: ${today}`,
    "---",
    "",
    `# ${title.trim() || type.label}`,
  ];
  const body = type.sections.flatMap(([heading, hint]) => ["", `## ${heading}`, "", `<!-- ${hint} -->`]);
  return `${[...head, ...body].join("\n")}\n`;
}

export const docType = (id: DocTypeId): DocType =>
  DOC_TYPES.find((t) => t.id === id) ?? (DOC_TYPES[0] as DocType);
