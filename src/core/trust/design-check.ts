import { type Mismatch, mismatches, type RepoFacts } from "./check";
import { claimsIn } from "./claims";

/**
 * #40 "Does the code still match this design?": the per-paragraph trust checks (named files, functions, commands,
 * environment variables, versions), run over a whole doc on demand and listed in one place. Pure: the extension
 * gathers the repo facts. Code blocks and front matter are skipped — code is not a claim about the code.
 */
export interface DesignFinding {
  /** 0-based line where the paragraph starts. */
  readonly line: number;
  /** The heading the paragraph sits under ("" before the first heading). */
  readonly section: string;
  readonly mismatch: Mismatch;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

export function designCheck(text: string, repo: RepoFacts): DesignFinding[] {
  const lines = text.split(/\r?\n/);
  const out: DesignFinding[] = [];
  let i = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  let section = "";
  let fence: string | undefined;
  let start = -1;
  const para: string[] = [];
  const flush = () => {
    if (para.length) {
      for (const mismatch of mismatches(claimsIn(para.join("\n")), repo))
        out.push({ line: start, section, mismatch });
    }
    para.length = 0;
    start = -1;
  };
  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const f = FENCE.exec(line)?.[1];
    if (fence) {
      if (f && f[0] === fence[0] && f.length >= fence.length) fence = undefined;
      continue;
    }
    if (f) {
      flush();
      fence = f;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flush();
      section = h[1] ?? "";
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (start < 0) start = i;
    para.push(line);
  }
  flush();
  return out;
}

/** The list's title: how many things no longer match. */
export function designCheckTitle(title: string, count: number): string {
  if (count === 0) return `${title}: nothing contradicts the code`;
  return `${title}: ${count} ${count === 1 ? "thing no longer matches" : "things no longer match"} the code`;
}

/** A row of the list: the first asks the reader's AI to fix everything; the others jump to their line. */
export interface DesignCheckRow {
  readonly label: string;
  readonly detail: string;
  readonly description?: string;
  readonly line?: number;
  readonly ask: boolean;
}

/**
 * The list's rows. "Ask my AI" is an ordinary first row, not an icon in the title bar: testers missed that icon and
 * a click on it did nothing.
 */
export function designCheckRows(findings: readonly DesignFinding[]): DesignCheckRow[] {
  return [
    {
      label: "$(sparkle) Ask my AI to fix these",
      detail: "Your own AI proposes fixes for the doc or the code; nothing changes until you agree",
      ask: true,
    },
    ...findings.map((f) => ({
      label: f.section || "(top of the doc)",
      detail: f.mismatch.reason,
      description: `line ${f.line + 1}`,
      line: f.line,
      ask: false,
    })),
  ];
}

/** One line per finding for the AI prompt: where it is and what is wrong. */
export function findingLines(findings: readonly DesignFinding[]): string[] {
  return findings.map(
    (f) => `line ${f.line + 1}${f.section ? ` ("${f.section}")` : ""}: ${f.mismatch.reason}`,
  );
}
