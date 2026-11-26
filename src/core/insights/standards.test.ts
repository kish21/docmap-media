import { describe, expect, it } from "vitest";
import { docTemplate, docType } from "../authoring/templates";
import {
  compare,
  FORMATS,
  fillTemplate,
  folderFromConfig,
  formatFromSiblings,
  formatFromTemplate,
  isKindDoc,
  nextRecordName,
  normHeading,
  recognise,
  sectionHeadings,
} from "./standards";

const MADR = [
  "# Use Postgres",
  "## Context and Problem Statement",
  "We need a database.",
  "## Considered Options",
  "* Postgres",
  "## Decision Outcome",
  "Chosen: Postgres.",
  "### Consequences",
  "Good.",
].join("\n");

const NYGARD =
  "# 1. Record decisions\n## Status\nAccepted\n## Context\nx\n## Decision\ny\n## Consequences\nz\n";
const madr = FORMATS.find((f) => f.id === "madr");

describe("headings", () => {
  it("drops numbers, marks and a trailing colon", () => {
    expect(normHeading("2. **Considered options**:")).toBe("considered options");
  });
  it("ignores headings inside fenced code", () => {
    expect(sectionHeadings("## A\n```\n## B\n```\n## C")).toEqual(["a", "c"]);
  });
});

describe("recognise", () => {
  it("names MADR when its required parts are all there, wherever the file lives", () => {
    expect(recognise("notes/db.md", MADR)?.format?.name).toBe("MADR");
  });
  it("names Nygard ADR", () => {
    expect(recognise("doc/adr/0001-record.md", NYGARD)?.format?.name).toBe("Nygard ADR");
  });
  it("a decision record in its own style: kind known, no format named", () => {
    const r = recognise("docs/decisions/0003-cache.md", "# Cache\n## Why\n## What we picked\n");
    expect(r).toEqual({ kind: "decision", label: "Decision record", format: undefined });
  });
  it("front matter type: adr counts, and wins over the folder", () => {
    expect(recognise("x.md", "# A\n## B", "ADR")?.kind).toBe("decision");
    expect(recognise("specs/x.md", "# A", "runbook")?.kind).toBe("runbook");
  });
  it("docmap's own templates are recognised in the named formats they follow", () => {
    const named = (id: string, path: string) =>
      recognise(path, docTemplate(docType(id as never), "T", "2026-11-18"))?.format?.name;
    expect(named("decision", "docs/decisions/t.md")).toBe("MADR");
    expect(named("design", "docs/design/t.md")).toBe("Google design doc");
    expect(named("spec", "docs/specs/t.md")).toBe("GitHub Spec Kit");
  });
  it("design docs, specs, runbooks and arc42 are recognised by their named formats", () => {
    const doc = (...h: string[]) => h.map((x) => `## ${x}\n`).join("");
    expect(
      recognise(
        "notes/a.md",
        doc("Context and scope", "Goals and non-goals", "Design", "Alternatives considered"),
      )?.format?.name,
    ).toBe("Google design doc");
    expect(
      recognise(
        "x/0012-cache.md",
        doc(
          "Summary",
          "Motivation",
          "Guide-level explanation",
          "Reference-level explanation",
          "Drawbacks",
          "Rationale and alternatives",
        ),
      )?.kind,
    ).toBe("design");
    expect(
      recognise(
        "specs/001-login/spec.md",
        doc("User Scenarios & Testing *(mandatory)*", "Requirements", "Success Criteria"),
      )?.format?.name,
    ).toBe("GitHub Spec Kit");
    // runbooks have no named format (owner call 2026-11-18): headings alone never make a doc a runbook
    expect(recognise("ops/db.md", doc("Overview", "Troubleshooting", "Escalation"))).toBeUndefined();
    expect(recognise("docs/runbooks/db.md", doc("Overview"))?.format).toBeUndefined();
    expect(
      recognise(
        "docs/arch.md",
        doc(
          "1. Introduction and Goals",
          "2. Constraints",
          "3. Context and Scope",
          "4. Solution Strategy",
          "5. Building Block View {#section-building-block-view}",
        ),
      )?.format?.name,
    ).toBe("arc42");
  });
  it("DESIGN.md, test plans, postmortems and release notes are recognised by place or type (no named format)", () => {
    expect(recognise("DESIGN.md", "# Look")?.label).toBe("Design system (DESIGN.md)");
    expect(recognise("docs/test-plans/login.md", "# T")?.label).toBe("Test plan");
    expect(recognise("docs/postmortems/2026-11-01-outage.md", "# P")?.label).toBe("Postmortem");
    expect(recognise("docs/releases/3.1.md", "# R")?.label).toBe("Release notes");
    expect(recognise("notes/x.md", "# X", "postmortem")?.format).toBeUndefined();
  });
  it("docmap's new suggested templates are recognised where it puts them", () => {
    for (const [id, path, label] of [
      ["design-system", "DESIGN.md", "Design system (DESIGN.md)"],
      ["test-plan", "docs/test-plans/t.md", "Test plan"],
      ["postmortem", "docs/postmortems/t.md", "Postmortem"],
      ["release-notes", "docs/releases/t.md", "Release notes"],
      ["runbook", "docs/runbooks/t.md", "Runbook"],
    ] as const) {
      const type = docType(id);
      expect(type.file.replace("{slug}", "t")).toBe(path);
      expect(recognise(path, docTemplate(type, "T", "2026-11-18"))?.label).toBe(label);
    }
  });
  it("the folder names the kind even in the team's own style", () => {
    expect(recognise("docs/runbooks/db.md", "## Steps")?.label).toBe("Runbook");
    expect(recognise("rfcs/0042-x.md", "## Why")?.label).toBe("Design doc");
  });
  it("an ordinary doc is not recognised (shows nothing)", () => {
    expect(recognise("README.md", "# Hello\n## Install\n## Usage")).toBeUndefined();
  });
  it("a template file is never treated as a doc", () => {
    expect(recognise("docs/adr/template.md", MADR)).toBeUndefined();
    expect(recognise(".specify/templates/spec-template.md", "## Requirements")).toBeUndefined();
    expect(isKindDoc("docs/adr/template.md", "decision")).toBe(false);
    expect(isKindDoc("docs/adr/0002-x.md", "decision")).toBe(true);
  });
});

describe("team format", () => {
  it("a template's headings become the team's parts; placeholders skipped", () => {
    const t = formatFromTemplate("docs/adr/template.md", "# {title}\n## Why\n## Choice\n## {option 1}\n");
    expect(t?.parts.map((p) => p.heading)).toEqual(["why", "choice"]);
    expect(t?.from).toBe("docs/adr/template.md");
  });
  it("headings shared by most sibling docs become the team's format", () => {
    const docs = ["## Why\n## Choice\n## Risk", "## Why\n## Choice", "## Why\n## Choice\n## Extra"];
    const t = formatFromSiblings("docs/adr", docs);
    expect(t?.parts.map((p) => p.heading)).toEqual(["why", "choice"]);
    expect(t?.from).toBe("3 docs in docs/adr");
  });
  it("too few siblings: no guess", () => {
    expect(formatFromSiblings("docs/adr", ["## Why\n## Choice", "## Why\n## Choice"])).toBeUndefined();
  });
});

describe("new records follow the team", () => {
  it("reads the folder from adr-tools and log4brains config, refusing paths that leave the repo", () => {
    expect(folderFromConfig(".adr-dir", "doc/architecture/decisions\n")).toBe("doc/architecture/decisions");
    expect(folderFromConfig(".log4brains.yml", "project:\n  adrFolder: ./docs/adr\n")).toBe("docs/adr");
    expect(folderFromConfig(".adr-dir", "../elsewhere")).toBeUndefined();
    expect(folderFromConfig(".adr-dir", "/etc")).toBeUndefined();
  });
  it("numbers a new record like its neighbours", () => {
    expect(nextRecordName(["0001-a.md", "0012-b.md", "template.md"], "cache")).toBe("0013-cache.md");
    expect(nextRecordName(["use-postgres.md"], "cache")).toBe("cache.md");
  });
  it("fills the team template's title", () => {
    expect(fillTemplate("# {title}\n\n## Why\n", "Cache")).toBe("# Cache\n\n## Why\n");
    expect(fillTemplate("## Why\n", "Cache")).toBe("# Cache\n\n## Why\n");
  });
});

describe("compare", () => {
  it("lists missing required parts and unused optional ones; never the doc's own extras", () => {
    const c = compare(
      "## Context and Problem Statement\n## My own part\n## Decision Outcome",
      madr?.parts ?? [],
    );
    expect(c.missing).toEqual(["Considered Options"]);
    expect(c.unused).toContain("Decision Drivers");
    expect(c.present).toEqual(["Context and Problem Statement", "Decision Outcome"]);
    expect([...c.missing, ...c.unused, ...c.present]).not.toContain("My own part");
  });
});
