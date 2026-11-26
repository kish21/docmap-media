/**
 * 3.0 "Compare with the main branch": which git ref is the repository's main branch. Pure: git's answers in, one
 * ref out. The remote's own default (origin/HEAD) wins; otherwise the usual names, remote first (it is what others
 * see), then local. Nothing found → undefined, and the option is not offered.
 */
const USUAL = [
  "origin/main",
  "origin/master",
  "main",
  "master",
  "origin/trunk",
  "trunk",
  "origin/develop",
  "develop",
];

/**
 * @param originHead output of `git symbolic-ref --short refs/remotes/origin/HEAD` ("origin/main"), if any
 * @param branches output of `git for-each-ref --format=%(refname:short) refs/heads refs/remotes`, one per line
 */
export function mainBranch(originHead: string | undefined, branches: string | undefined): string | undefined {
  const list = (branches ?? "")
    .split(/\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const head = originHead?.trim();
  if (head && head !== "origin/HEAD" && safeRef(head) && list.includes(head)) return head;
  return USUAL.find((name) => list.includes(name));
}

/** A ref git can be asked about safely (no option-looking or odd characters). */
export function safeRef(ref: string): boolean {
  return /^[\w./-]+$/.test(ref) && !ref.startsWith("-") && !ref.includes("..");
}
