import * as vscode from "vscode";
import {
  STATUS_CHOICES,
  setStatusCell,
  setTask,
  splitCells,
  statusKind,
  updatedLabel,
} from "../core/authoring/tasks";
import { INTERNAL_TIMINGS } from "../core/config/config";

/**
 * 3.0 tick and status from the preview: the reader ticks a task box or picks a status on the page, and the host
 * changes that one line of the file. `line` is where the clicked line is NOW (undefined: an edit since the page was
 * drawn moved or touched it) — then nothing is changed. The line's text is checked again before the edit (still a
 * task, still a status cell), so a stale click never edits the wrong line. A file that had no unsaved changes is
 * saved after the edit, like a checkbox in any app; one with unsaved changes is left for the reader to save.
 */

/** Tells the reader nothing was changed (the line moved or is no longer what the page showed). */
const stale = (): false => {
  void vscode.window.showInformationMessage(
    "The file changed since the page was drawn — try again on the updated page.",
  );
  return false;
};

/** Replaces one line (the caller has checked it is still what the page showed), saving a file that was saved. */
export const replaceOneLine = (doc: vscode.TextDocument, line: number, text: string): Promise<boolean> =>
  replaceLine(doc, line, text);

async function replaceLine(doc: vscode.TextDocument, line: number, text: string): Promise<boolean> {
  const wasDirty = doc.isDirty;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, doc.lineAt(line).range, text);
  if (!(await vscode.workspace.applyEdit(edit))) return false;
  const saved = !wasDirty && doc.uri.scheme === "file" && (await doc.save());
  // owner review 2026-11-17: the reader sees that the file itself changed, and where
  vscode.window.setStatusBarMessage(
    `$(check) Updated ${updatedLabel(doc.uri.path, line, saved)}`,
    INTERNAL_TIMINGS.updatedMessageMs,
  );
  return true;
}

/** Tick (or clear) the task box on `line`. */
export async function tickTask(
  doc: vscode.TextDocument,
  line: number | undefined,
  checked: boolean,
): Promise<boolean> {
  if (line === undefined || line >= doc.lineCount) return stale();
  const next = setTask(doc.lineAt(line).text, checked);
  if (next === undefined) return stale();
  if (next === doc.lineAt(line).text) return true;
  return replaceLine(doc, line, next);
}

/** Offer the statuses for cell `column` of the table row on `line`, and write the one picked. */
export async function changeStatus(
  doc: vscode.TextDocument,
  line: number | undefined,
  column: number,
): Promise<boolean> {
  if (line === undefined || line >= doc.lineCount) return stale();
  const row = doc.lineAt(line).text;
  const cells = splitCells(row);
  const now = statusKind(cells[column] ?? "");
  if (now === undefined) return stale();
  const pick = await vscode.window.showQuickPick(
    STATUS_CHOICES.map((c) => ({
      label: `${c.kind === now ? "$(check) " : "$(blank) "}${c.word}`,
      word: c.word,
      ...(c.kind === now ? { description: "now" } : {}),
    })),
    {
      title: `Status: ${cells[0] || "this row"}`,
      placeHolder: "Pick the new status (written into the file)",
    },
  );
  if (!pick || statusKind(pick.word) === now) return false;
  if (doc.lineAt(line).text !== row) return stale(); // changed while the menu was open
  const next = setStatusCell(row, column, pick.word);
  if (next === undefined) return stale();
  return replaceLine(doc, line, next);
}
