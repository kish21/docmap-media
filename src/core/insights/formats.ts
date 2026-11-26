/**
 * The kinds of doc docmap recognises and the named, public formats it compares them with (3.0). Data only.
 * Only section NAMES are used — no text from any template is copied. Each format names its source page.
 *
 * - MADR 4 — https://adr.github.io/madr/ (MIT OR CC0-1.0)
 * - Nygard ADR — https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
 * - Google design doc — https://www.industrialempathy.com/posts/design-docs-at-google/
 * - Rust RFC — https://github.com/rust-lang/rfcs/blob/master/0000-template.md (MIT OR Apache-2.0)
 * - GitHub Spec Kit spec — https://github.com/github/spec-kit/blob/main/templates/spec-template.md (MIT)
 * - arc42 — https://docs.arc42.org/home/ (section names only; arc42's text is CC BY-SA 4.0 and is not copied)
 *
 * Kinds with no single public standard (runbook, design system, test plan, postmortem, release notes) have no named
 * format here: docmap offers its own suggested template for them (`authoring/templates.ts`), labelled as a
 * suggestion, and never lists a doc's "missing parts" against it (owner call 2026-11-18: no home-made checklists).
 */

export type DocKind =
  | "decision"
  | "design"
  | "spec"
  | "runbook"
  | "architecture"
  | "design-system"
  | "test-plan"
  | "postmortem"
  | "release-notes";

export interface Part {
  readonly heading: string;
  /** Other heading texts that count as this part (normalised: lower case, no numbers or marks). */
  readonly alsoCalled?: readonly string[];
  readonly required: boolean;
}

export interface NamedFormat {
  readonly id: string;
  readonly kind: DocKind;
  readonly name: string;
  readonly source: string;
  readonly parts: readonly Part[];
}

export interface KindInfo {
  readonly kind: DocKind;
  readonly label: string;
  /** Front matter `type:` values that mean this kind (lower case). */
  readonly types: readonly string[];
  /** A folder name in the path that means this kind. */
  readonly folder: RegExp;
  /** A file name that means this kind (optional). */
  readonly file?: RegExp;
  /** Usual folders for this kind, most common first (where a doc map points, where new docs go). */
  readonly folders: readonly string[];
  /** Usual places for a team template, from the repo root. */
  readonly templates: readonly string[];
  /** docmap's own template for this kind ("New Doc from Template…"), if it has one. */
  readonly docType?: string;
  /** A kind kept in one file at a fixed place (DESIGN.md), not a folder of docs. */
  readonly single?: string;
}

const req = (heading: string, ...alsoCalled: string[]): Part => ({ heading, alsoCalled, required: true });
const opt = (heading: string, ...alsoCalled: string[]): Part => ({ heading, alsoCalled, required: false });

export const KINDS: readonly KindInfo[] = [
  {
    kind: "decision",
    label: "Decision record",
    types: [
      "adr",
      "decision",
      "decision record",
      "decision-record",
      "architecture decision",
      "architecture decision record",
    ],
    folder: /(?:^|\/)(?:adrs?|decisions?|decision-records|architecture-decisions)\//i,
    file: /(?:^|\/)(?:adr[-_ ]?\d+)[^/]*\.md$/i,
    folders: ["docs/decisions", "docs/adr", "doc/adr", "docs/adrs", "adr", "decisions"],
    templates: ["docs/templates/decision.md", "docs/templates/adr.md", ".github/adr-template.md"],
    docType: "decision",
  },
  {
    kind: "design",
    label: "Design doc",
    types: ["design", "design doc", "design-doc", "rfc", "proposal"],
    folder: /(?:^|\/)(?:design|design-docs|designs|rfcs?|proposals?)\//i,
    file: /(?:^|\/)rfc[-_ ]?\d+[^/]*\.md$/i,
    folders: ["docs/design", "docs/rfcs", "rfcs", "design"],
    templates: ["docs/templates/design.md", "docs/templates/rfc.md", "rfcs/0000-template.md"],
    docType: "design",
  },
  {
    kind: "spec",
    label: "Feature spec",
    types: ["spec", "feature spec", "specification", "prd"],
    folder: /(?:^|\/)(?:specs?|specifications)\//i,
    file: /(?:^|\/)spec\.md$/i,
    folders: ["specs", "docs/specs"],
    templates: ["docs/templates/spec.md", ".specify/templates/spec-template.md"],
    docType: "spec",
  },
  {
    kind: "runbook",
    label: "Runbook",
    types: ["runbook", "playbook"],
    folder: /(?:^|\/)(?:runbooks?|playbooks?)\//i,
    file: /(?:^|\/)runbook[^/]*\.md$/i,
    folders: ["docs/runbooks", "runbooks"],
    templates: ["docs/templates/runbook.md", "runbooks/template.md"],
    docType: "runbook",
  },
  {
    kind: "architecture",
    label: "Architecture doc",
    types: ["architecture", "arc42"],
    folder: /(?:^|\/)(?:architecture|arc42)\//i,
    file: /(?:^|\/)architecture\.md$/i,
    folders: ["docs/architecture", "docs"],
    templates: ["docs/templates/architecture.md"],
    docType: "architecture",
  },
  {
    kind: "design-system",
    label: "Design system (DESIGN.md)",
    types: ["design system", "design-system", "design.md", "style guide"],
    folder: /(?:^|\/)design-system\//i,
    file: /(?:^|\/)design\.md$/i,
    folders: [],
    templates: ["docs/templates/design-system.md", "docs/templates/DESIGN.md"],
    docType: "design-system",
    single: "DESIGN.md",
  },
  {
    kind: "test-plan",
    label: "Test plan",
    types: ["test plan", "test-plan", "testplan"],
    folder: /(?:^|\/)(?:test-plans?|testplans?)\//i,
    file: /(?:^|\/)test-?plan[^/]*\.md$/i,
    folders: ["docs/test-plans", "docs/testing"],
    templates: ["docs/templates/test-plan.md"],
    docType: "test-plan",
  },
  {
    kind: "postmortem",
    label: "Postmortem",
    types: ["postmortem", "post-mortem", "incident review", "incident report"],
    folder: /(?:^|\/)(?:postmortems?|post-mortems?|incidents?)\//i,
    file: /(?:^|\/)post-?mortem[^/]*\.md$/i,
    folders: ["docs/postmortems", "postmortems", "docs/incidents"],
    templates: ["docs/templates/postmortem.md"],
    docType: "postmortem",
  },
  {
    kind: "release-notes",
    label: "Release notes",
    types: ["release notes", "release-notes", "release"],
    folder: /(?:^|\/)(?:releases|release-notes)\//i,
    file: /(?:^|\/)release-notes[^/]*\.md$/i,
    folders: ["docs/releases", "docs/release-notes"],
    templates: ["docs/templates/release-notes.md"],
    docType: "release-notes",
  },
];

export const FORMATS: readonly NamedFormat[] = [
  {
    id: "madr",
    kind: "decision",
    name: "MADR",
    source: "https://adr.github.io/madr/",
    parts: [
      req("Context and Problem Statement"),
      opt("Decision Drivers"),
      req("Considered Options"),
      req("Decision Outcome"),
      opt("Consequences"),
      opt("Confirmation"),
      opt("Pros and Cons of the Options"),
      opt("More Information"),
    ],
  },
  {
    id: "nygard",
    kind: "decision",
    name: "Nygard ADR",
    source: "https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions",
    parts: [req("Status"), req("Context"), req("Decision"), req("Consequences")],
  },
  {
    id: "google-design",
    kind: "design",
    name: "Google design doc",
    source: "https://www.industrialempathy.com/posts/design-docs-at-google/",
    parts: [
      req("Context and scope", "context", "background"),
      req("Goals and non-goals", "goals"),
      req("The actual design", "design", "detailed design", "proposed design"),
      req("Alternatives considered", "alternatives"),
      opt("Cross-cutting concerns", "crosscutting concerns"),
    ],
  },
  {
    id: "rust-rfc",
    kind: "design",
    name: "RFC (Rust style)",
    source: "https://github.com/rust-lang/rfcs/blob/master/0000-template.md",
    parts: [
      req("Summary"),
      req("Motivation"),
      req("Guide-level explanation"),
      req("Reference-level explanation"),
      req("Drawbacks"),
      req("Rationale and alternatives"),
      opt("Prior art"),
      opt("Unresolved questions"),
      opt("Future possibilities"),
    ],
  },
  {
    id: "spec-kit",
    kind: "spec",
    name: "GitHub Spec Kit",
    source: "https://github.com/github/spec-kit/blob/main/templates/spec-template.md",
    parts: [
      req("User Scenarios & Testing", "user scenarios and testing", "user scenarios"),
      opt("Edge Cases"),
      req("Requirements"),
      opt("Key Entities"),
      req("Success Criteria"),
      opt("Assumptions"),
    ],
  },
  {
    id: "arc42",
    kind: "architecture",
    name: "arc42",
    source: "https://docs.arc42.org/home/",
    parts: [
      req("Introduction and Goals"),
      req("Constraints", "architecture constraints"),
      req("Context and Scope", "system scope and context"),
      req("Solution Strategy"),
      req("Building Block View"),
      opt("Runtime View"),
      opt("Deployment View"),
      opt("Crosscutting Concepts", "cross-cutting concepts"),
      opt("Architecture Decisions"),
      opt("Quality Requirements"),
      opt("Risks and Technical Debt", "risks and technical debts"),
      opt("Glossary"),
    ],
  },
];

export const kindInfo = (kind: DocKind): KindInfo =>
  KINDS.find((k) => k.kind === kind) ?? (KINDS[0] as KindInfo);
export const formatsOf = (kind: DocKind): NamedFormat[] => FORMATS.filter((f) => f.kind === kind);
