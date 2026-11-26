import type * as vscode from "vscode";
import { isOutlineLayout, type OutlineLayout } from "../core/protocol/messages";

/**
 * The outline pane as the reader last left it — width and hidden/shown — one for every map and the browser page
 * (0.0.20, owner call). Kept in VS Code's own storage: a number and a flag, never document content.
 */
const LAYOUT_KEY = "docmap.outlineLayout";

/** The saved layout, if the reader changed it (read back defensively: storage is not typed). */
export function outlineLayout(context: vscode.ExtensionContext): OutlineLayout | undefined {
  const saved: unknown = context.globalState.get(LAYOUT_KEY);
  return isOutlineLayout(saved) ? saved : undefined;
}

export function saveOutlineLayout(context: vscode.ExtensionContext, layout: OutlineLayout): Thenable<void> {
  return context.globalState.update(LAYOUT_KEY, {
    outlineWidth: layout.outlineWidth,
    collapsed: layout.collapsed,
  });
}
