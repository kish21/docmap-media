/**
 * "▶ Terminal" on shell code blocks (2026-11-22 review): which blocks get it, and the commands it puts in the
 * terminal. A console transcript (`$ npm test` then its output) gives only the commands, without the prompts. Pure.
 */

const SHELL = new Set([
  "sh",
  "bash",
  "zsh",
  "fish",
  "shell",
  "console",
  "terminal",
  "powershell",
  "ps1",
  "pwsh",
  "cmd",
  "bat",
  "batch",
]);

export const isShellBlock = (lang: string): boolean => SHELL.has(lang.trim().toLowerCase());

const PROMPT = /^\s*(?:\$|>|#|PS [^>\n]*>)\s+/;

/** The commands of a shell block, one per line, without prompts; output lines of a transcript are dropped. */
export function shellCommand(code: string): string {
  const lines = code.split(/\r?\n/).filter((l) => l.trim());
  const prompted = lines.filter((l) => PROMPT.test(l) && !/^\s*#\s/.test(l));
  const kept = prompted.length ? prompted.map((l) => l.replace(PROMPT, "")) : lines;
  return kept.map((l) => l.trimEnd()).join("\n");
}
