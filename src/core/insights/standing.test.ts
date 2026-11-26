import { describe, expect, it } from "vitest";
import { createMarkdownItEngine } from "../markdown/markdown-it-engine";
import type { Heading } from "../outline/types";
import { cutPoint, recordsFor, standing } from "./standing";

const engine = createMarkdownItEngine();
const parseOutline = (text: string): { headings: readonly Heading[] } => {
  const r = engine.parse(text, 1, { readingTools: true });
  if (!r.ok) throw new Error(r.reason);
  return r.document;
};

// A design doc shaped like the owner's MarkVid feature docs (2026-11-24 sample): a long Status line, numbered parts
// "V1-a — …", sub-headings that say BUILT / DECIDED / DRAFT with dates.
const DOC = `# Voice casting

**Status:** **V1-a BUILT 2026-08-18** (record \`docs/records/127-who-speaks.md\`) · **V1-b BUILT 2026-08-21**
(record \`docs/records/141-cast-audio.md\`) — the backend. **The issue closes at V1-c**, the casting screen.

## 0. The idea

Today an ad has one voice. This makes two voices real.

## 6. Owner's decisions (2026-08-18)

| # | Question | Answer |
|---|---|---|
| 1 | Done when? | V1-c |

## 7. V1-a — the contract

Words.

## 11. What V1-a shipped (2026-08-18)

Words.

## 12. V1-b — the cast reaches the audio (agreed 2026-08-21)

Words.

## 13. V1-c — the casting screen (built 2026-08-21)

Words.

## 14. V1-d — who speaks on screen (DRAFT, awaiting the owner)

### 14.3 DECIDED (owner, 2026-08-21) — option B

### 14.8 BUILT 2026-08-21 — and where the plan was wrong

Words.
`;

const headings = () => parseOutline(DOC).headings;

describe("standing — where a long doc stands", () => {
  it("lists the parts with their newest state: a later BUILT sub-heading beats DRAFT in the heading", () => {
    const s = standing(DOC, headings());
    expect(s.parts.map((p) => `${p.label}=${p.state}${p.date ? `@${p.date}` : ""}`)).toEqual([
      "V1-a=built@2026-08-18",
      "V1-b=built@2026-08-21",
      "V1-c=built@2026-08-21",
      "V1-d=built@2026-08-21",
    ]);
    // a part is named by its first section, not by a later "what it shipped" one
    expect(s.parts[0]?.name).toBe("the contract");
    expect(s.parts[0]?.headingId).toBe(headings().find((h) => h.text.startsWith("7."))?.id);
  });

  it("takes a part's state from the Status line when its headings say nothing", () => {
    const b = standing(DOC, headings()).parts.find((p) => p.label === "V1-b");
    expect(b).toMatchObject({ state: "built", date: "2026-08-21" });
  });

  it("warns when the Status line still talks about a built part as not done", () => {
    const s = standing(DOC, headings());
    expect(s.disagree).toHaveLength(1);
    expect(s.disagree[0]).toContain("V1-c");
    expect(s.disagree[0]).toContain("13");
  });

  it("puts the story in date order: the owner's decisions first, then each part", () => {
    const s = standing(DOC, headings());
    expect(s.events.map((e) => e.label)).toEqual(["Decided", "V1-a", "V1-b", "V1-c", "V1-d"]);
    expect(s.events[0]?.date).toBe("2026-08-18");
    expect(s.events[0]?.what).toBe("Owner's decisions"); // no date or "— …" tail repeated in the timeline
  });

  it("gives every top section its state, date and first sentence", () => {
    const s = standing(DOC, headings());
    const idea = s.sections.find((x) => x.title.startsWith("0."));
    expect(idea?.first).toBe("Today an ad has one voice.");
    expect(idea?.state).toBeUndefined();
    expect(s.sections.find((x) => x.title.startsWith("6."))?.state).toBe("decided");
    expect(s.sections.find((x) => x.title.startsWith("14."))?.state).toBe("built");
  });

  it("keeps the Status line as written, as plain text", () => {
    const s = standing(DOC, headings());
    expect(s.status).toMatch(/^V1-a BUILT 2026-08-18 \(record docs\/records\/127-who-speaks\.md\)/);
    expect(s.status).not.toContain("**");
  });

  it("reads a long Status line to its end (a part named late in it still gets its warning)", () => {
    const filler = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
    const text = DOC.replace("— the backend.", `— the backend ${filler}.`);
    const s = standing(text, parseOutline(text).headings);
    expect(s.status?.endsWith("the casting screen.")).toBe(true);
    expect(s.disagree).toHaveLength(1);
  });

  it("has nothing to say about an ordinary doc (no parts, no warnings)", () => {
    const text = "# Notes\n\n## Setup\n\nRun it.\n\n## Usage\n\nUse it.\n";
    const s = standing(text, parseOutline(text).headings);
    expect(s.parts).toEqual([]);
    expect(s.disagree).toEqual([]);
    expect(s.events).toEqual([]);
  });

  it("reads a Status line inside a note box, with several parts named before one 'built'", () => {
    const text = DOC.replace(
      /\*\*Status:\*\*[\s\S]*?the casting screen\.\n/,
      "> [!NOTE]\n> - **What this is:** casting.\n> - **Status:** done — V1-a built 2026-08-18; V1-b, V1-c and V1-d built 2026-08-21.\n",
    );
    const s = standing(text, parseOutline(text).headings);
    expect(s.status).toMatch(/^done — V1-a built/);
    expect(s.parts.find((p) => p.label === "V1-b")).toMatchObject({ state: "built", date: "2026-08-21" });
    expect(s.disagree).toEqual([]); // the Status line now agrees with the sections
  });

  it("ignores headings inside code fences", () => {
    const text = "# Doc\n\n**Status:** draft\n\n```md\n## 1. V9 — fake (built 2026-01-01)\n```\n";
    expect(standing(text, parseOutline(text).headings).parts).toEqual([]);
  });
});

describe("recordsFor — each part's build record", () => {
  const known = [
    "docs/records/127-who-speaks.md",
    "docs/records/141-cast-audio.md",
    "docs/records/142-cast-user.md",
    "docs/records/144-on-screen.md",
  ];
  // records that link back to the doc: 141 also mentions V1-c as what comes next
  const back = [
    {
      path: "docs/records/127-who-speaks.md",
      title: "127 — who speaks",
      text: "Builds V1-a of voice-casting.md",
    },
    { path: "docs/records/141-cast-audio.md", title: "141", text: "V1-a then V1-b; V1-c is next" },
    {
      path: "docs/records/142-cast-user.md",
      title: "142 — the cast reaches the user",
      text: "V1-b done, this is V1-c",
    },
    { path: "docs/records/144-on-screen.md", title: "144", text: "V1-a, V1-b, V1-c, now V1-d" },
  ];

  it("uses the record the Status line names; else the back-link whose newest part is this one", () => {
    const r = recordsFor(standing(DOC, headings()), back, known);
    expect(Object.fromEntries([...r].map(([k, v]) => [k, v.path.split("/").pop()]))).toEqual({
      "V1-a": "127-who-speaks.md",
      "V1-b": "141-cast-audio.md",
      "V1-c": "142-cast-user.md",
      "V1-d": "144-on-screen.md",
    });
    expect(r.get("V1-c")?.title).toBe("142 — the cast reaches the user");
  });

  it("gives nothing when no record links back", () => {
    expect(recordsFor(standing(DOC, headings()), [], []).size).toBe(0);
  });
});

describe("cutPoint — where a long paragraph is cut after two sentences", () => {
  const long = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

  it("cuts after the second sentence when much more follows", () => {
    const text = `First one here. Second one here. ${long(80)}.`;
    expect(text.slice(0, cutPoint(text))).toBe("First one here. Second one here.");
  });

  it("leaves a short paragraph whole", () => {
    expect(cutPoint("One. Two. Three.")).toBeUndefined();
  });

  it("does not cut at e.g. or a version number", () => {
    const text = `Use v3.1 here, e.g. this way. Then this. ${long(80)}.`;
    expect(text.slice(0, cutPoint(text))).toBe("Use v3.1 here, e.g. this way. Then this.");
  });

  it("leaves it whole when little would be folded away", () => {
    expect(cutPoint(`${long(70)}. Second. Tail end.`)).toBeUndefined();
  });
});
