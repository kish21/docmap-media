import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkEnv, parseDotenv } from "./env-guard.mjs";

describe("env-guard", () => {
  it("refuses the unedited .env.example (the real failure: copy it, publish with a public placeholder)", () => {
    const env = parseDotenv(readFileSync(".env.example", "utf8"));
    const problems = checkEnv(["VSCE_PAT"], env);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/VSCE_PAT is still the \.env\.example placeholder/);
  });
  it("refuses the unedited Open VSX placeholder too (M4 publishes there as well)", () => {
    const env = parseDotenv(readFileSync(".env.example", "utf8"));
    expect(checkEnv(["OVSX_PAT"], env)[0]).toMatch(
      /OVSX_PAT is still the \.env\.example placeholder.*open-vsx\.org/,
    );
  });
  it("refuses a missing variable, naming it and how to generate one", () => {
    expect(checkEnv(["VSCE_PAT"], {})[0]).toMatch(/VSCE_PAT is not set.*Personal access tokens/);
  });
  it("accepts a real-looking value", () => {
    expect(checkEnv(["VSCE_PAT"], { VSCE_PAT: "a-real-token-value" })).toEqual([]);
  });
});
