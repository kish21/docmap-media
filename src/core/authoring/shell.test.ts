import { describe, expect, it } from "vitest";
import { isShellBlock, shellCommand } from "./shell";

describe("Run in Terminal (2026-11-22 review)", () => {
  it("offers it on shell blocks only", () => {
    for (const lang of ["sh", "bash", "zsh", "shell", "console", "powershell", "ps1", "pwsh", "cmd", "bat"])
      expect(isShellBlock(lang)).toBe(true);
    for (const lang of ["js", "python", "", "mermaid", "json"]) expect(isShellBlock(lang)).toBe(false);
  });

  it("drops prompts ($, PS>) and output lines of a console block; keeps the commands", () => {
    expect(shellCommand("$ npm install\n$ npm run build\n")).toBe("npm install\nnpm run build");
    expect(shellCommand("PS C:\\app> npm test\nok 3 tests\n")).toBe("npm test");
    expect(shellCommand("npm install\nnpm run build\n")).toBe("npm install\nnpm run build");
    expect(shellCommand("  \n")).toBe("");
  });

  it("splits bare carriage returns and strips ANSI escape sequences and C0 control chars", () => {
    expect(shellCommand("echo safe\recho evil")).toBe("echo safe\necho evil");
    expect(shellCommand("echo \x1b[31mred\x1b[0m\x1b[201~; rm -rf /")).toBe("echo red; rm -rf /");
    expect(shellCommand("echo hi\x03\x08\x00there")).toBe("echo hithere");
  });
});
