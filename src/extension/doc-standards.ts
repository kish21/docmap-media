import * as vscode from "vscode";
import { INTERNAL_TIMINGS } from "../core/config/config";
import { type DocMapEntry, docMapSection, importsAgents, withDocMap } from "../core/insights/doc-map";
import {
  type Comparison,
  compare,
  type DocKind,
  fillTemplate,
  folderFromConfig,
  formatFromSiblings,
  formatFromTemplate,
  formatsOf,
  frontMatterType,
  isKindDoc,
  KINDS,
  kindFromPath,
  kindInfo,
  nextRecordName,
  type Part,
  recognise,
  sectionHeadings,
  TEMPLATES_IN_FOLDER,
  type TeamFormat,
} from "../core/insights/standards";
import { leftOut, readConfig } from "./settings";

/**
 * 3.0 named formats. "Compare with a Standard Format…" shows which parts of a format (the team's own first, then the
 * named public ones for that kind of doc) a doc has — information only: no score, nothing marked wrong, the file is
 * never changed. New docs go where the team keeps them, in the team's template when there is one. "Write Doc Map for
 * Agents" puts a where-each-doc-goes table into AGENTS.md (and CLAUDE.md), left unsaved for the user to review.
 */

/** Most docs read to learn a team's shape, the largest file read, and the most files listed for the doc map. */
const MAX_SIBLINGS = 50;
const MAX_BYTES = 1_000_000;
const MAX_FILES = 3000;
const EXCLUDE = "**/{node_modules,.git,dist,out,build,.vscode-test}/**";

const decoder = new TextDecoder();
async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File || stat.size > MAX_BYTES) return undefined;
    return decoder.decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

const join = (root: vscode.Uri, rel: string): vscode.Uri => vscode.Uri.joinPath(root, ...rel.split("/"));
const dirOf = (rel: string): string => rel.split("/").slice(0, -1).join("/");
const isDir = (uri: vscode.Uri): Thenable<boolean> =>
  vscode.workspace.fs.stat(uri).then(
    (s) => s.type === vscode.FileType.Directory,
    () => false,
  );

/** The team's template for this kind: inside its folder first, then the kind's usual places at the root. */
async function teamTemplate(
  root: vscode.Uri,
  kind: DocKind,
  folder: string | undefined,
): Promise<{ rel: string; text: string } | undefined> {
  const inFolder =
    folder === undefined ? [] : TEMPLATES_IN_FOLDER.map((p) => (folder ? `${folder}/${p}` : p));
  for (const rel of [...inFolder, ...kindInfo(kind).templates]) {
    const text = await readText(join(root, rel));
    if (text?.trim() && formatFromTemplate(rel, text)) return { rel, text };
  }
  return undefined;
}

/** The shape the docs of `kind` in `folder` share (at most `MAX_SIBLINGS` read; `skip` left out). */
async function siblingFormat(
  root: vscode.Uri,
  kind: DocKind,
  folder: string,
  skip?: string,
): Promise<TeamFormat | undefined> {
  const entries = await vscode.workspace.fs.readDirectory(join(root, folder)).then(
    (e) => e,
    () => [] as [string, vscode.FileType][],
  );
  const docs: string[] = [];
  for (const [name, type] of entries) {
    if (docs.length >= MAX_SIBLINGS) break;
    const rel = folder ? `${folder}/${name}` : name;
    if (type !== vscode.FileType.File || rel === skip || !/\.md$/i.test(name) || !isKindDoc(rel, kind))
      continue;
    const text = await readText(join(root, rel));
    if (text !== undefined) docs.push(text);
  }
  return formatFromSiblings(folder, docs);
}

/** The team's format for a doc of `kind` at `rel`: its template, else the shape most docs beside it share. */
export async function findTeamFormat(
  root: vscode.Uri,
  rel: string,
  kind: DocKind,
): Promise<TeamFormat | undefined> {
  const folder = dirOf(rel);
  const template = await teamTemplate(root, kind, folder);
  if (template) return formatFromTemplate(template.rel, template.text);
  return siblingFormat(root, kind, folder, rel);
}

/** Where the team keeps docs of `kind`: adr-tools / log4brains config (decisions), else the first usual folder. */
export async function kindFolder(root: vscode.Uri, kind: DocKind): Promise<string | undefined> {
  if (kind === "decision")
    for (const file of [".adr-dir", ".log4brains.yml"] as const) {
      const text = await readText(join(root, file));
      const dir = text === undefined ? undefined : folderFromConfig(file, text);
      if (dir) return dir;
    }
  for (const dir of kindInfo(kind).folders) if (await isDir(join(root, dir))) return dir;
  return undefined;
}

interface Choice {
  readonly label: string;
  readonly description?: string;
  readonly parts: readonly Part[];
  readonly source?: string;
}

/** The result as list rows: ✓ has it · ○ the format expects it · – optional, not used. */
export function comparisonRows(c: Comparison): string[] {
  return [
    ...c.present.map((h) => `$(check) ${h}`),
    ...c.missing.map((h) => `$(circle-large-outline) ${h} — not in this doc`),
    ...c.unused.map((h) => `$(dash) ${h} — optional, not used`),
  ];
}

export interface CompareOptions {
  /** A format's label to use without asking (tests). */
  readonly pick?: string;
  /** The kind to compare as, when docmap does not recognise the doc (tests). */
  readonly kind?: DocKind;
  /** false = no result list (tests). */
  readonly show?: boolean;
}

/** The command. Returns what was compared, undefined when cancelled. */
export async function compareWithStandard(
  document: vscode.TextDocument,
  opts: CompareOptions = {},
): Promise<{ kind: DocKind; format: string; comparison: Comparison } | undefined> {
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  const rel = folder ? vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/") : "";
  const text = document.getText();
  const found = recognise(rel || document.uri.path, text, frontMatterType(text));
  const kind =
    found?.kind ??
    opts.kind ??
    // (not "kind": that name is taken by QuickPickItem's separator flag)
    (
      await vscode.window.showQuickPick(
        KINDS.map((k) => ({ label: k.label, docKind: k.kind })),
        {
          title: "docmap is not sure what kind of doc this is. Compare it as…",
          placeHolder: "A kind of doc (your doc is not changed)",
        },
      )
    )?.docKind;
  if (!kind) return undefined;
  const team = folder ? await findTeamFormat(folder.uri, rel, kind) : undefined;

  const choices: Choice[] = [];
  if (team)
    choices.push({ label: "Your team's format", description: `from ${team.from}`, parts: team.parts });
  const named = formatsOf(kind).sort((a, b) => Number(b === found?.format) - Number(a === found?.format));
  for (const f of named)
    choices.push({ label: f.name, description: f.source, parts: f.parts, source: f.source });

  const label = kindInfo(kind).label;
  if (choices.length === 0) {
    // no public standard for this kind and no team format: nothing to compare with (no home-made checklist)
    if (opts.show !== false)
      void vscode.window.showInformationMessage(
        `There is no single standard format for a ${label.toLowerCase()}, so docmap does not check one. Its suggested template is in New Doc from Template…; to have your team's own, add docs/templates/${kind}.md.`,
      );
    return undefined;
  }
  const chosen =
    choices.find((c) => c.label === opts.pick) ??
    (opts.show === false
      ? choices[0]
      : await vscode.window.showQuickPick(choices, {
          title: `${label}${found?.format ? ` (${found.format.name})` : ""}: compare with…`,
          placeHolder: "A format to compare with (your doc is not changed)",
        }));
  if (!chosen) return undefined;

  const comparison = compare(text, chosen.parts);
  if (opts.show !== false) {
    const open = "$(link-external) Read about this format";
    const rows = comparisonRows(comparison).map((l) => ({ label: l }));
    const picked = await vscode.window.showQuickPick(chosen.source ? [...rows, { label: open }] : rows, {
      title: `${label} compared with ${chosen.label}: ${comparison.present.length} of its parts here, ${comparison.missing.length} not`,
      placeHolder: "Information only — a different style is fine. Esc to close.",
    });
    if (picked?.label === open && chosen.source)
      await vscode.env.openExternal(vscode.Uri.parse(chosen.source));
  }
  return { kind, format: chosen.label, comparison };
}

/** #37: the team's own templates, one per kind that has one (New Doc lists them first). */
export async function teamTemplates(root: vscode.Uri): Promise<{ kind: DocKind; rel: string }[]> {
  const out: { kind: DocKind; rel: string }[] = [];
  for (const info of KINDS) {
    if (!info.docType) continue;
    const folder = await kindFolder(root, info.kind);
    const found = await teamTemplate(root, info.kind, folder);
    if (found) out.push({ kind: info.kind, rel: found.rel });
  }
  return out;
}

/** A new doc of `kind` the team's way: its folder, numbering and template. undefined = the team has no folder. */
export async function teamDoc(
  root: vscode.Uri,
  kind: DocKind,
  title: string,
  slug: string,
): Promise<{ rel: string; text: string | undefined } | undefined> {
  const folder = await kindFolder(root, kind);
  if (folder === undefined || (kind === "architecture" && folder === "docs")) {
    // no team folder: still use a template at one of the usual root places, in docmap's file location
    const template = await teamTemplate(root, kind, undefined);
    return template ? { rel: "", text: fillTemplate(template.text, title) } : undefined;
  }
  const names = await vscode.workspace.fs.readDirectory(join(root, folder)).then(
    (e) => e.map(([n]) => n),
    () => [] as string[],
  );
  const template = await teamTemplate(root, kind, folder);
  return {
    rel: `${folder}/${nextRecordName(names, slug)}`,
    text: template ? fillTemplate(template.text, title) : undefined,
  };
}

/** The doc map's facts: per kind, where its docs are, how many, and the team's shape. */
export async function docMapEntries(root: vscode.Uri): Promise<DocMapEntry[]> {
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, "**/*.md"),
    EXCLUDE,
    MAX_FILES,
  );
  const byKind = new Map<DocKind, string[]>();
  const config = readConfig();
  for (const uri of files) {
    if (leftOut(uri, config)) continue; // tool dot-folders are not the team's docs (#44)
    const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
    const kind = kindFromPath(rel);
    if (kind) byKind.set(kind, [...(byKind.get(kind) ?? []), rel]);
  }
  const entries: DocMapEntry[] = [];
  for (const info of KINDS) {
    const docs = byKind.get(info.kind) ?? [];
    if (info.single) {
      // one file at a fixed place (DESIGN.md): is it there, and does the team have its own template?
      const there = (await readText(join(root, info.single))) !== undefined;
      const template = await teamTemplate(root, info.kind, undefined);
      entries.push({
        kind: info.kind,
        count: there ? 1 : 0,
        team: template ? { from: template.rel, headings: sectionHeadings(template.text) } : undefined,
      });
      continue;
    }
    let folder = await kindFolder(root, info.kind);
    if (folder === "docs" && info.kind === "architecture") folder = undefined;
    if (!folder && docs.length) {
      // the folder most of them sit in (cut at the kind's own folder name: specs/001-x/spec.md → specs)
      const tally = new Map<string, number>();
      for (const rel of docs) {
        const m = info.folder.exec(rel);
        const dir = m ? rel.slice(0, m.index + m[0].length - 1).replace(/^\//, "") : dirOf(rel);
        tally.set(dir, (tally.get(dir) ?? 0) + 1);
      }
      folder = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    const inFolder = folder ? docs.filter((d) => d.startsWith(`${folder}/`)).length : 0;
    const template = await teamTemplate(root, info.kind, folder);
    const team = template
      ? { from: template.rel, headings: sectionHeadings(template.text) }
      : folder
        ? await siblingFormat(root, info.kind, folder).then((t) =>
            t ? { from: t.from, headings: t.parts.map((p) => p.heading) } : undefined,
          )
        : undefined;
    entries.push({ kind: info.kind, folder, count: folder ? inFolder : docs.length, team });
  }
  return entries;
}

/**
 * Right after a file changes on disk, VS Code's open copy of it can still hold the old text for a moment, and an edit
 * built on that copy is then rejected or lands on the old text. With no unsaved edits, wait (a few seconds at most)
 * until the copy matches the disk. Unsaved edits are the reader's: those are kept as they are.
 */
async function caughtUpWithDisk(doc: vscode.TextDocument): Promise<void> {
  for (let i = 0; i < INTERNAL_TIMINGS.diskCatchUpPolls && !doc.isDirty; i++) {
    const disk = await readText(doc.uri);
    if (disk === undefined || disk === doc.getText()) return;
    await new Promise((r) => setTimeout(r, INTERNAL_TIMINGS.diskCatchUpPollMs));
  }
}

/**
 * The command: the doc map into AGENTS.md (made if missing) and into CLAUDE.md when it exists and does not already
 * import AGENTS.md. Only the part between docmap's markers changes; the files are left unsaved, open, for review.
 */
export async function writeDocMap(): Promise<{ files: string[]; section: string } | undefined> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    void vscode.window.showInformationMessage("Open a folder first: the doc map describes its docs.");
    return undefined;
  }
  const section = docMapSection(await docMapEntries(root));
  const targets = ["AGENTS.md"];
  const claude = await readText(join(root, "CLAUDE.md"));
  if (claude !== undefined && !importsAgents(claude)) targets.push("CLAUDE.md");

  const edit = new vscode.WorkspaceEdit();
  const docs: vscode.Uri[] = [];
  for (const name of targets) {
    const uri = join(root, name);
    const exists = await vscode.workspace.fs.stat(uri).then(
      () => true,
      () => false,
    );
    if (exists) {
      const doc = await vscode.workspace.openTextDocument(uri);
      await caughtUpWithDisk(doc);
      const all = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      edit.replace(uri, all, withDocMap(doc.getText(), section));
    } else {
      edit.createFile(uri, { ignoreIfExists: true });
      edit.insert(uri, new vscode.Position(0, 0), withDocMap("# Agent instructions\n", section));
    }
    docs.push(uri);
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    void vscode.window.showWarningMessage("docmap could not write the doc map (the file may be read-only).");
    return undefined;
  }
  for (const uri of docs) await vscode.window.showTextDocument(uri, { preview: false });
  void vscode.window.showInformationMessage(
    `Doc map written into ${targets.join(" and ")} — review it, then save (Ctrl+S). Nothing else in the file changed.`,
  );
  return { files: targets, section };
}
