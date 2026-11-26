import { describe, expect, it } from "vitest";
import { mainBranch, safeRef } from "./main-branch";

describe("main branch", () => {
  it("the remote's own default wins when it exists", () => {
    expect(mainBranch("origin/develop\n", "main\norigin/develop\norigin/main")).toBe("origin/develop");
  });
  it("without a remote default: origin/main, then origin/master, then local names", () => {
    expect(mainBranch(undefined, "feature\norigin/master\nmain")).toBe("origin/master");
    expect(mainBranch(undefined, "feature\nmaster\r\n")).toBe("master");
    expect(mainBranch("", "feature\nmain\norigin/main")).toBe("origin/main");
  });
  it("nothing that looks like a main branch: no option", () => {
    expect(mainBranch(undefined, "feature\nwip")).toBeUndefined();
    expect(mainBranch(undefined, undefined)).toBeUndefined();
  });
  it("a remote default git did not list, or an unsafe one, is ignored", () => {
    expect(mainBranch("origin/gone", "main")).toBe("main");
    expect(mainBranch("--output=x", "--output=x\nmaster")).toBe("master");
  });
  it("safe refs only", () => {
    expect(safeRef("origin/main")).toBe(true);
    expect(safeRef("-x")).toBe(false);
    expect(safeRef("a..b")).toBe(false);
    expect(safeRef("a b")).toBe(false);
  });
});
