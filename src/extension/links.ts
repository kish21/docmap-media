import { realpathSync, statSync } from "node:fs";
import * as path from "node:path";

/**
 * Resolving links and images FROM a document TO a local file — the one place that decides whether a path the
 * document (i.e. possibly hostile content) names may be opened or loaded. Plain Node, no `vscode`: unit-tested.
 *
 * Rule: only relative paths (or `/rooted` paths, meaning "from the workspace root"), resolved against the
 * document's folder, and the result must stay inside one of the allowed roots — checked on the REAL path, so
 * a symlink inside the workspace cannot point outside it.
 */
export interface LocalTarget {
  /** Absolute, symlink-resolved file path — what is opened. */
  readonly file: string;
  /**
   * The same file under the path the user opened (symlinks NOT resolved), inside an allowed root — what the panel
   * is given to load, because VS Code checks resource roots on this form, not the resolved one.
   */
  readonly lexical: string;
  /** Heading id from `#fragment`, decoded, if any. */
  readonly fragment: string | undefined;
}

/**
 * @param href   the link or image path as it appears in the rendered document (percent-encoded by markdown-it)
 * @param docDir absolute folder of the document containing the link
 * @param roots  absolute folders the user opened (workspace folders); if empty, the document's folder alone
 */
export function resolveLocalTarget(
  href: string,
  docDir: string,
  roots: readonly string[],
  env: PathEnv = NODE_ENV,
): LocalTarget | undefined {
  return createResolver(docDir, roots, env)(href);
}

/**
 * The same resolution, with the roots' real paths computed ONCE — for resolving every image of a render without
 * touching the disk for the roots again per image.
 */
export function createResolver(
  docDir: string,
  roots: readonly string[],
  env: PathEnv = NODE_ENV,
): (href: string) => LocalTarget | undefined {
  const p = env.path;
  const rootList = roots.length > 0 ? roots : [docDir];
  const lexicalAllowed = rootList.map((r) => p.resolve(r));
  const allowed = lexicalAllowed.map((r) => realOrSelf(r, env));
  return (href) => resolveWith(href, docDir, lexicalAllowed, allowed, env);
}

function resolveWith(
  href: string,
  docDir: string,
  lexicalAllowed: readonly string[],
  allowed: readonly string[],
  env: PathEnv,
): LocalTarget | undefined {
  if (href === "" || href.startsWith("#") || href.startsWith("//")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined; // any scheme: not a local relative path

  const hashAt = href.indexOf("#");
  const rawPath = (hashAt === -1 ? href : href.slice(0, hashAt)).split("?")[0] ?? "";
  const rawFragment = hashAt === -1 ? undefined : href.slice(hashAt + 1);
  const decodedPath = safeDecode(rawPath);
  if (decodedPath === undefined || decodedPath === "") return undefined;
  // A document path is POSIX-style and plain. Backslashes (Windows separators → UNC network paths), colons
  // (drive letters, NTFS streams) and control characters are refused BEFORE anything touches the file system:
  // on Windows even asking whether "\\host\share\x" exists makes the machine connect to that host.
  if (hasUnsafeChar(decodedPath)) return undefined;

  const p = env.path;
  const base = decodedPath.startsWith("/") ? (rootContaining(docDir, lexicalAllowed, p) ?? docDir) : docDir;
  const lexical = p.resolve(base, decodedPath.replace(/^\/+/, ""));
  // 1. lexical confinement first — nothing outside the roots is ever looked up
  if (rootContaining(lexical, lexicalAllowed, p) === undefined) return undefined;
  // 2. only then the real path (does it exist, and does a symlink lead out?) — confined again
  const real = realpath(lexical, env);
  if (real === undefined) return undefined; // does not exist
  if (rootContaining(real, allowed, p) === undefined) return undefined; // a symlink escapes every allowed root
  if (!env.isFile(real)) return undefined; // a folder or device is never a link or image target

  return { file: real, lexical, fragment: rawFragment ? safeDecode(rawFragment) : undefined };
}

/** Backslash, colon, or any control character (U+0000–U+001F, U+007F). */
function hasUnsafeChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x5c || c === 0x3a || c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/** Which allowed root contains `file` (none → undefined). Works across drives: an absolute result is "outside". */
export function rootContaining(
  file: string,
  roots: readonly string[],
  p: PathEnv["path"] = path,
): string | undefined {
  return roots.find((root) => {
    const rel = p.relative(root, file);
    // "..drafts" is a name inside the root; only ".." itself or "../…" climbs out
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel));
  });
}

/** The two platform pieces resolution depends on — swappable so tests can replay Windows paths on Linux. */
export interface PathEnv {
  readonly path: Pick<typeof path, "resolve" | "relative" | "isAbsolute" | "sep">;
  readonly realpath: (p: string) => string;
  readonly isFile: (p: string) => boolean;
}

const NODE_ENV: PathEnv = {
  path,
  realpath: realpathSync,
  isFile: (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  },
};

function realpath(p: string, env: PathEnv): string | undefined {
  try {
    return env.realpath(p);
  } catch {
    return undefined;
  }
}

function realOrSelf(p: string, env: PathEnv): string {
  return realpath(p, env) ?? p;
}

const TEXT_FILE = /\.(md|markdown|mdx|txt)$/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
const CODE_FILE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|swift|scala|c|cc|cpp|h|hpp|sql|css|scss|html|json|ya?ml|toml|sh|ps1)$/i;

/**
 * A source file a docmap report may open in the editor as text (the Doc Atlas's code table). Only report pages
 * docmap wrote use this — a document's own links still open only Markdown, text and images.
 */
export function isCodeFile(file: string): boolean {
  return CODE_FILE.test(file);
}

/**
 * What a document may do with a resolved local file: Markdown/text opens in the editor, an image opens in VS
 * Code's image preview — anything else (notebooks, binaries, other extensions' custom editors) is refused.
 */
export function openKind(file: string): "text" | "image" | undefined {
  if (TEXT_FILE.test(file)) return "text";
  if (IMAGE_FILE.test(file)) return "image";
  return undefined;
}

/** Only image files may be loaded INTO the panel as images (`![](.ssh/id_rsa)` must not load). */
export function isImageFile(file: string): boolean {
  return IMAGE_FILE.test(file);
}

function safeDecode(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}
