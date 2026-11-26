import * as vscode from "vscode";
import { type PointerStep, pointerSteps } from "../core/authoring/rule-pointers";

/**
 * 3.0 "Point Other AI Tools to AGENTS.md…": writes small pointer files only when the user runs it and ticks them.
 * Owner rule: never overwrite a user's file. New files are created only if still missing (the edit fails rather
 * than replace one); an existing file gets one marked line at the end, left unsaved and opened so the user sees it
 * and can undo. Files that already name AGENTS.md are left alone. Returns the paths changed (for tests).
 */
export async function addRulePointers(only?: readonly string[]): Promise<string[]> {
  const folder =
    (vscode.window.activeTextEditor &&
      vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)) ??
    vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage(
      "Open a folder first: pointer files go at the top of a project.",
    );
    return [];
  }
  const at = (rel: string) => vscode.Uri.joinPath(folder.uri, ...rel.split("/"));
  if ((await read(at("AGENTS.md"))) === undefined) {
    const make = "New Doc from Template…";
    // not awaited: the command finishes now; the button still works while the message shows
    void vscode.window
      .showInformationMessage(
        "There is no AGENTS.md at the top of this folder to point to. Create one first (Agent guide template).",
        make,
      )
      .then((pick) =>
        pick === make ? vscode.commands.executeCommand("docmap.newDocFromTemplate", "agents") : undefined,
      );
    return [];
  }
  const texts = new Map<string, string | undefined>();
  for (const rel of ["CLAUDE.md", ".github/copilot-instructions.md", "GEMINI.md"])
    texts.set(rel, await read(at(rel)));
  const steps = pointerSteps((rel) => texts.get(rel));
  const doable = steps.filter((s): s is Exclude<PointerStep, { kind: "skip" }> => s.kind !== "skip");
  const skipped = steps.filter((s) => s.kind === "skip").map((s) => s.target.path);
  if (doable.length === 0) {
    void vscode.window.showInformationMessage(
      `Nothing to do: ${skipped.join(", ")} already point to AGENTS.md.`,
    );
    return [];
  }
  let chosen: typeof doable;
  if (only) chosen = doable.filter((s) => only.includes(s.target.path));
  else {
    const picked = await vscode.window.showQuickPick(
      doable.map((s) => ({
        label: s.target.path,
        description:
          s.kind === "create"
            ? `new file · for ${s.target.tool}`
            : `your file: adds 1 line at the end · for ${s.target.tool}`,
        detail: s.text.trim().replace(/\n/g, "  ⏎  "),
        // a user's own file is changed only when they tick it themselves
        picked: s.kind === "create",
        step: s,
      })),
      {
        canPickMany: true,
        title: "Point other AI tools to AGENTS.md (nothing is replaced; added lines stay unsaved)",
        ignoreFocusOut: true,
      },
    );
    if (!picked?.length) return [];
    chosen = picked.map((p) => p.step);
  }
  const done: string[] = [];
  for (const s of chosen) {
    const uri = at(s.target.path);
    const edit = new vscode.WorkspaceEdit();
    if (s.kind === "create") {
      // overwrite false + ignoreIfExists false: if the file appeared meanwhile, the edit fails instead of replacing it
      edit.createFile(uri, {
        overwrite: false,
        ignoreIfExists: false,
        contents: new TextEncoder().encode(s.text),
      });
      if (await vscode.workspace.applyEdit(edit)) done.push(s.target.path);
      continue;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    if (doc.getText() !== (texts.get(s.target.path) ?? "")) continue; // changed since we looked: leave it
    edit.insert(uri, doc.lineAt(doc.lineCount - 1).range.end, s.text);
    if (await vscode.workspace.applyEdit(edit)) {
      done.push(s.target.path);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  }
  const notes = [
    done.length ? `Done: ${done.join(", ")}.` : "Nothing changed.",
    chosen.some((s) => s.kind === "append" && done.includes(s.target.path))
      ? "Added lines are not saved yet: check them, then save (or undo)."
      : "",
    skipped.length ? `Left alone (already point to AGENTS.md): ${skipped.join(", ")}.` : "",
  ];
  void vscode.window.showInformationMessage(notes.filter(Boolean).join(" "));
  return done;
}

async function read(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}
