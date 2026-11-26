import * as path from "node:path";
import * as vscode from "vscode";
import {
  checkNewDocPath,
  headingsOnly,
  moreDocTypes,
  STARTERS,
  type Starter,
} from "../core/authoring/starters";
import {
  DOC_TYPES,
  type DocType,
  type DocTypeId,
  docTemplate,
  docType,
  slugify,
} from "../core/authoring/templates";
import { KINDS, kindInfo } from "../core/insights/standards";
import { teamDoc, teamTemplates } from "./doc-standards";

/**
 * 3.0 doc templates: "New Doc from Template…" creates a vision, scope, plan, architecture, spec, ticket, decision,
 * runbook, agent guide or structure doc in the shapes docmap reads best, and "Restructure into a clear doc" asks
 * which shape. The new file is only created where nothing exists yet — an existing file is opened, never replaced.
 */

/** Which shape to restructure into; "auto" = the agent picks the best fit. undefined = cancelled. */
export async function pickDocType(placeHolder: string): Promise<DocTypeId | "auto" | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: "$(sparkle) Let my agent pick the best fit", id: "auto" as const },
      ...DOC_TYPES.map((t) => ({ label: t.label, detail: t.detail, id: t.id })),
    ],
    { title: "Restructure into…", placeHolder },
  );
  return pick?.id;
}

/**
 * The command: pick a type, give it a title, see (and change) where it goes, get the file, opened. `here`: the folder
 * right-clicked in the Explorer ("New Doc from Template Here…"): the doc goes in it. A test passing `titleArg` skips
 * the questions.
 */
export async function newDocFromTemplate(
  typeArg?: string,
  titleArg?: string,
  here?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  const folder = here ? vscode.workspace.getWorkspaceFolder(here) : vscode.workspace.workspaceFolders?.[0];
  const root = folder?.uri;
  if (!root) {
    void vscode.window.showInformationMessage("Open a folder first: the new doc is saved inside it.");
    return undefined;
  }
  // the right-clicked folder, relative to the workspace folder ("" = its top)
  // (path.relative: Windows paths differ only by the drive letter's case — "c:" from VS Code, "C:" elsewhere)
  const fromRoot = here ? path.relative(root.fsPath, here.fsPath).replace(/\\/g, "/") : "";
  const hereRel = fromRoot.startsWith("..") || path.isAbsolute(fromRoot) ? "" : fromRoot;
  const place = (rel: string) => (hereRel ? `${hereRel}/${rel.split("/").pop() ?? rel}` : rel);
  const starterArg = STARTERS.find((s) => s.id === typeArg);
  const picked: DocType | Starter | undefined =
    DOC_TYPES.find((t) => t.id === typeArg) ?? starterArg ?? (await pickNewDoc(root));
  if (!picked) return undefined;
  // MADR and Spec Kit: docmap's full template in the same format (one entry per format)
  const viaType = "headings" in picked && picked.docType ? docType(picked.docType) : undefined;
  const chosen = viaType ?? picked;
  if ("headings" in chosen) return newFromStarter(root, chosen, titleArg, place);
  const type = chosen;
  const title =
    titleArg ??
    (await vscode.window.showInputBox({
      title: `New ${type.label.toLowerCase()}`,
      prompt: "Its title (for example: Checkout rollout)",
      value: type.file.includes("{slug}") ? "" : type.label,
      validateInput: (v) => (v.trim() ? undefined : "Give it a title"),
    }));
  if (!title?.trim()) return undefined;
  // a decision record, design doc, spec, runbook or architecture doc follows the team: its folder, numbering and
  // template win over docmap's shape
  const kind = KINDS.find((k) => k.docType === type.id)?.kind;
  const team = kind ? await teamDoc(root, kind, title.trim(), slugify(title)) : undefined;
  const rel = await confirmPath(place(team?.rel || type.file.replace("{slug}", slugify(title))), !!titleArg);
  if (!rel) return undefined;
  const today = new Date().toISOString().slice(0, 10);
  return writeNew(root, rel, team?.text ?? docTemplate(docType(type.id), title, today));
}

/** The reader sees where the doc goes and may change it (2026-11-22 review: no silent folders). */
async function confirmPath(rel: string, skip: boolean): Promise<string | undefined> {
  if (skip) return rel;
  const name = rel.split("/").pop() ?? rel;
  const answer = await vscode.window.showInputBox({
    title: "Save the new doc as",
    prompt:
      "Where it goes, inside the open folder. Change the folder or the name if you like, then press Enter.",
    value: rel,
    valueSelection: [rel.length - name.length, rel.length - 3],
    validateInput: (v) => checkNewDocPath(v),
  });
  return answer?.trim().replace(/\\/g, "/");
}

/**
 * #37 New Doc's short list: the team's own templates first, then a few known formats (one line each, a "read more"
 * button), then docmap's full list. undefined = cancelled.
 */
async function pickNewDoc(root: vscode.Uri): Promise<DocType | Starter | undefined> {
  type Item = vscode.QuickPickItem & { pick?: DocType | Starter | "more" };
  const readMore: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("link-external"),
    tooltip: "Read more about this format",
  };
  const team: Item[] = [];
  for (const t of await teamTemplates(root)) {
    const type = DOC_TYPES.find((d) => d.id === kindInfo(t.kind).docType);
    if (type)
      team.push({
        label: `$(organization) ${kindInfo(t.kind).label}: your team's template`,
        description: t.rel,
        pick: type,
      });
  }
  const items: Item[] = [
    ...(team.length ? [{ label: "Your team", kind: vscode.QuickPickItemKind.Separator }, ...team] : []),
    { label: "Known formats", kind: vscode.QuickPickItemKind.Separator },
    ...STARTERS.map((s) => ({ label: s.name, detail: s.purpose, buttons: [readMore], pick: s })),
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    {
      label: "$(list-unordered) More doc types…",
      detail: "docmap's own templates: vision, plan, design doc, runbook, test plan and more",
      pick: "more",
    },
  ];
  const picked = await new Promise<Item["pick"]>((resolve) => {
    const qp = vscode.window.createQuickPick<Item>();
    qp.title = "New doc";
    qp.placeholder = "What kind of doc? Section headings only; you write the rest.";
    qp.items = items;
    qp.onDidTriggerItemButton((e) => {
      const p = e.item.pick;
      if (p && p !== "more" && "source" in p) void vscode.env.openExternal(vscode.Uri.parse(p.source));
    });
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0]?.pick);
      qp.hide();
    });
    qp.onDidHide(() => {
      resolve(undefined);
      qp.dispose();
    });
    qp.show();
  });
  if (picked !== "more") return picked;
  return (
    await vscode.window.showQuickPick(
      moreDocTypes().map((t) => ({ label: t.label, detail: t.detail, type: t })),
      { title: "New doc from template", placeHolder: "What kind of doc?" },
    )
  )?.type;
}

/** A known format: its headings only, in the team's folder for that kind when it has one. */
async function newFromStarter(
  root: vscode.Uri,
  starter: Starter,
  titleArg: string | undefined,
  place: (rel: string) => string,
): Promise<vscode.Uri | undefined> {
  const title =
    titleArg ??
    (await vscode.window.showInputBox({
      title: `New doc: ${starter.name}`,
      prompt: "Its title (for example: Checkout rollout)",
      value: starter.file.includes("{slug}") ? "" : "Changelog",
      validateInput: (v) => (v.trim() ? undefined : "Give it a title"),
    }));
  if (!title?.trim()) return undefined;
  const team = starter.kind ? await teamDoc(root, starter.kind, title.trim(), slugify(title)) : undefined;
  const rel = await confirmPath(
    place(team?.rel || starter.file.replace("{slug}", slugify(title))),
    !!titleArg,
  );
  if (!rel) return undefined;
  return writeNew(root, rel, headingsOnly(starter, title.trim()));
}

/** Creates the file only where nothing exists yet (an existing file is opened, never replaced), then opens it. */
async function writeNew(root: vscode.Uri, rel: string, text: string): Promise<vscode.Uri> {
  const uri = vscode.Uri.joinPath(root, ...rel.split("/"));
  const exists = await vscode.workspace.fs.stat(uri).then(
    () => true,
    () => false,
  );
  if (exists)
    void vscode.window.showInformationMessage(`${rel} already exists — opened it, nothing replaced.`);
  else await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  await vscode.window.showTextDocument(uri);
  return uri;
}
