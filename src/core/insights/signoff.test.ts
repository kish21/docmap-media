import { describe, expect, it } from "vitest";
import { signedHash, signoffs, withSignoff } from "./signoff";

describe("sign-off", () => {
  const doc = "# Plan\n\nShip it.\n";

  it("adds front matter with the sign-off, and the hash matches the signed text", () => {
    const signed = withSignoff(doc, "Priya", "2026-11-16");
    expect(signed).toMatch(/^---\nsigned-off-by: Priya 2026-11-16 #[a-z0-9]+\n---\n# Plan/);
    const [s] = signoffs(signed);
    expect(s).toMatchObject({ who: "Priya", date: "2026-11-16" });
    expect(s?.hash).toBe(signedHash(signed));
  });

  it("a second person is added; the same person again replaces their entry; other front matter is kept", () => {
    const base = "---\nstatus: draft\n---\n# Plan\n";
    let t = withSignoff(base, "Priya", "2026-11-16");
    t = withSignoff(t, "Sam", "2026-11-17");
    t = withSignoff(t, "priya", "2026-11-18");
    expect(t.startsWith("---\nstatus: draft\nsigned-off-by: ")).toBe(true);
    expect(signoffs(t).map((s) => `${s.who} ${s.date}`)).toEqual(["Sam 2026-11-17", "priya 2026-11-18"]);
  });

  it("an edit after signing changes the hash; CRLF files stay CRLF", () => {
    const signed = withSignoff(doc, "Priya", "2026-11-16");
    expect(signedHash(`${signed}More.\n`)).not.toBe(signoffs(signed)[0]?.hash);
    const crlf = withSignoff("# Plan\r\n\r\nShip.\r\n", "Sam", "2026-11-16");
    expect(crlf).toContain("---\r\nsigned-off-by: Sam");
    expect(signoffs(crlf)[0]?.hash).toBe(signedHash(crlf));
  });

  it("a name cannot break the line", () => {
    expect(signoffs(withSignoff(doc, "A; B #x", "2026-11-16"))[0]?.who).toBe("A  B  x");
  });
});
