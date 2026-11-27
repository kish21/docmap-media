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

/** Strips ANSI CSI / OSC / single-ESC sequences and C0/DEL control chars (except \n, \r, \t) before sending to a terminal. */
function stripTerminalControls(code: string): string {
  let out = "";
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    if (c === 0x1b) {
      const next = code.charCodeAt(i + 1);
      if (next === 0x5b /* [ CSI */) {
        let j = i + 2;
        while (j < code.length && code.charCodeAt(j) >= 0x20 && code.charCodeAt(j) <= 0x3f) j++;
        if (j < code.length && code.charCodeAt(j) >= 0x40 && code.charCodeAt(j) <= 0x7e) {
          i = j;
          continue;
        }
      } else if (next === 0x5d /* ] OSC */) {
        let j = i + 2;
        while (j < code.length) {
          const oc = code.charCodeAt(j);
          if (oc === 0x07) {
            i = j;
            break;
          }
          if (oc === 0x1b && code.charCodeAt(j + 1) === 0x5c) {
            i = j + 1;
            break;
          }
          j++;
        }
        continue;
      } else if (next >= 0x40 && next <= 0x5f) {
        i += 1;
        continue;
      }
      continue;
    }
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0x7f) continue;
    out += code[i];
  }
  return out;
}

/** The commands of a shell block, one per line, without prompts; output lines of a transcript are dropped. */
export function shellCommand(code: string): string {
  const clean = stripTerminalControls(code);
  const lines = clean.split(/\r\n|\r|\n/).filter((l) => l.trim());
  const prompted = lines.filter((l) => PROMPT.test(l) && !/^\s*#\s/.test(l));
  const kept = prompted.length ? prompted.map((l) => l.replace(PROMPT, "")) : lines;
  return kept.map((l) => l.trimEnd()).join("\n");
}
