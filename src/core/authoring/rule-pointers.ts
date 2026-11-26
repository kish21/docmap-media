/**
 * 3.0 rule-file pointers (owner call 2026-11-18): small files that send other AI tools to the one AGENTS.md, written
 * only when the user runs the command. Owner rule: never overwrite a user's file. A file that exists gets one marked
 * line added at the end (shown before, left unsaved); one that already names AGENTS.md is left alone. Pure.
 */

export interface PointerTarget {
  /** Workspace-relative path, "/" separated. */
  readonly path: string;
  /** Which tool reads it (shown in the picker). */
  readonly tool: string;
  /** The text a new file gets. */
  readonly fresh: string;
  /** The line added at the end of an existing file. */
  readonly line: string;
}

const MARK = "<!-- docmap: points to AGENTS.md -->";

export const POINTER_TARGETS: readonly PointerTarget[] = [
  {
    path: "CLAUDE.md",
    tool: "Claude Code",
    fresh: `${MARK}\n@AGENTS.md\n`,
    line: "@AGENTS.md",
  },
  {
    path: ".github/copilot-instructions.md",
    tool: "GitHub Copilot",
    fresh: `${MARK}\nRead AGENTS.md at the repository root first: it holds this project's rules for AI agents.\n`,
    line: "Read AGENTS.md at the repository root first: it holds this project's rules for AI agents.",
  },
  {
    path: "GEMINI.md",
    tool: "Gemini CLI and Antigravity",
    fresh: `${MARK}\nRead AGENTS.md at the repository root first: it holds this project's rules for AI agents.\n`,
    line: "Read AGENTS.md at the repository root first: it holds this project's rules for AI agents.",
  },
];

export type PointerStep =
  | { readonly kind: "create"; readonly target: PointerTarget; readonly text: string }
  | { readonly kind: "append"; readonly target: PointerTarget; readonly text: string }
  | { readonly kind: "skip"; readonly target: PointerTarget; readonly why: string };

/** What the command would do for each target, given each file's current text (undefined: no such file). */
export function pointerSteps(existing: (path: string) => string | undefined): PointerStep[] {
  return POINTER_TARGETS.map((target) => {
    const text = existing(target.path);
    if (text === undefined) return { kind: "create", target, text: target.fresh };
    if (/agents\.md/i.test(text)) return { kind: "skip", target, why: "already points to AGENTS.md" };
    const gap = text.length === 0 ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    return { kind: "append", target, text: `${gap}${MARK}\n${target.line}\n` };
  });
}
