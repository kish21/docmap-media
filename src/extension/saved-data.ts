import * as vscode from "vscode";
import { forgetAiConsent } from "./ai";
import type { NotesStore } from "./notes";
import type { PlaceStore } from "./places";
import { clearSeenTexts } from "./seen-text";
import { clearSnapshots } from "./snapshot";

/**
 * #41 docmap's saved data, all on this computer. At start-up only throwaway data is removed automatically: browser
 * page copies (already cleared at every start, see extension.ts) and the reading place of files that no longer
 * exist. Highlights, notes and read state are never removed automatically; "Clear docmap's Saved Data…" removes
 * what the reader picks, after asking.
 */
export type SavedDataId = "notes" | "places" | "seen" | "browser" | "aiConsent";

const KINDS: readonly { id: SavedDataId; label: string; detail: string }[] = [
  {
    id: "notes",
    label: "Highlights, review notes and read marks",
    detail: "This project only. The Docs Inbox shows every doc as unread again.",
  },
  { id: "places", label: "Place in each file", detail: "This project only. Maps open at the top again." },
  {
    id: "seen",
    label: "Copies for “since you last read it”",
    detail: "All projects. The next change is compared with the version you read next.",
  },
  {
    id: "browser",
    label: "Browser page copies",
    detail: "All projects. Written again when you open a page in the browser.",
  },
  {
    id: "aiConsent",
    label: "Permission to send text to your AI model",
    detail: "docmap asks again before it first sends text to your model.",
  },
];

export interface SavedData {
  readonly notes: NotesStore;
  readonly places: PlaceStore;
  readonly browserDir: string;
  readonly clearInboxCache?: () => Promise<void>;
}

/** Start-up clean-up: forgets the reading place of local files that are gone. Returns how many were dropped. */
export function cleanUpSavedData(data: SavedData): Promise<number> {
  return data.places.dropMissing(async (uri) => {
    const u = vscode.Uri.parse(uri);
    if (u.scheme !== "file") return true; // cannot tell: keep it
    return vscode.workspace.fs.stat(u).then(
      () => true,
      () => false,
    );
  });
}

/**
 * The command: the reader ticks what to remove, confirms, and it is removed. `picks` (tests) skips both questions.
 * Returns what was removed (undefined: cancelled).
 */
export async function clearSavedData(
  data: SavedData,
  picks?: readonly SavedDataId[],
): Promise<SavedDataId[] | undefined> {
  let chosen = picks ? [...picks] : undefined;
  if (!chosen) {
    const items = await vscode.window.showQuickPick(
      KINDS.map((k) => ({ label: k.label, detail: k.detail, id: k.id })),
      {
        canPickMany: true,
        title: "Clear docmap's saved data",
        placeHolder: "Tick what to remove. Everything is on this computer only.",
      },
    );
    if (!items?.length) return undefined;
    const names = items.map((i) => i.label.toLowerCase()).join("; ");
    const remove = "Remove";
    const ok = await vscode.window.showWarningMessage(
      `Remove ${names}? This cannot be undone.`,
      { modal: true },
      remove,
    );
    if (ok !== remove) return undefined;
    chosen = items.map((i) => i.id);
  }
  for (const id of chosen) {
    if (id === "notes") {
      await data.notes.clear();
      await data.clearInboxCache?.();
    } else if (id === "places") await data.places.clear();
    else if (id === "seen") await clearSeenTexts();
    else if (id === "browser") await clearSnapshots(data.browserDir);
    else if (id === "aiConsent") await forgetAiConsent();
  }
  if (!picks) void vscode.window.showInformationMessage("docmap's saved data you picked is removed.");
  return chosen;
}
