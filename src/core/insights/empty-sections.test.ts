import { describe, expect, it } from "vitest";
import { emptySections } from "./empty-sections";

describe("emptySections (#36)", () => {
  it("a heading with only blanks, a template hint or a placeholder is empty; text is not", () => {
    const doc = [
      "# Title",
      "",
      "## Goals",
      "",
      "<!-- What must be true when this is done -->",
      "",
      "## Design",
      "",
      "We cache reads.",
      "",
      "## Risks",
      "TBD",
      "## Rollout",
    ].join("\n");
    expect(emptySections(doc)).toEqual(["Goals", "Risks", "Rollout"]);
  });

  it("a section made only of sub-sections is not empty; an empty sub-section is", () => {
    const doc = "## Plan\n\n### Step one\n\nDo it.\n\n### Step two\n\n";
    expect(emptySections(doc)).toEqual(["Step two"]);
  });

  it("a heading inside fenced code is not a section, and code counts as content", () => {
    const doc = "## Example\n\n```md\n## Not a heading\n```\n";
    expect(emptySections(doc)).toEqual([]);
  });

  it("a filled doc has none", () => {
    expect(emptySections("# T\n\n## A\n\nx\n\n## B\n\ny\n")).toEqual([]);
  });
});
