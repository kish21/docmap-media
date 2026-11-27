import * as vscode from "vscode";
import { type DocmapConfig, resolveConfig } from "../core/config/config";
import { isLeftOut } from "../core/insights/inbox";
import type { InferHeadings } from "../core/markdown/reading-rules";

/** Reads `docmap.*` settings through the core's typed loader — the only way config enters the product. */
export function readConfig(): DocmapConfig {
  const s = vscode.workspace.getConfiguration("docmap");
  return resolveConfig({
    openPreviewByDefault: s.get("openPreviewByDefault"),
    largeFileBytes: s.get("largeFileBytes"),
    readingTools: s.get("readingTools"),
    inferHeadings: s.get("inferHeadings"),
    rememberPlace: s.get("rememberPlace"),
    diagrams: s.get("diagrams"),
    theme: s.get("theme"),
    fontScale: s.get("fontScale"),
    lineWidth: s.get("lineWidth"),
    staleDays: s.get("staleDays"),
    agentTarget: s.get("agentTarget"),
    writingHelpers: s.get("writingHelpers"),
    cleanView: s.get("cleanView"),
    homeOnStart: s.get("homeOnStart"),
    headingNumbers: s.get("headingNumbers"),
    myNames: s.get("myNames"),
    codeLens: s.get("codeLens"),
    aiAnswer: s.get("ai.answerWithMyModel"),
    aiModel: s.get("ai.model"),
    aiTools: s.get("ai.tools"),
    liveBrowser: s.get("liveBrowser"),
    skipFolders: s.get("skipFolders"),
    includeFolders: s.get("includeFolders"),
  });
}

/** #44: whether a file is left out of every doc list (tool dot-folders, build output, the reader's own rules). */
export function leftOut(uri: vscode.Uri, config: DocmapConfig = readConfig()): boolean {
  const rel = vscode.workspace.asRelativePath(uri, false);
  return isLeftOut(rel, { skip: config.skipFolders, include: config.includeFolders });
}

/**
 * The parse options that come from settings. EVERY parse of a document passes these same values — render, jump,
 * link target, snapshot — or heading ids differ between the map and a later jump.
 */
export function parseSettings(): { readonly readingTools: boolean; readonly inferHeadings: InferHeadings } {
  const { readingTools, inferHeadings } = readConfig();
  return { readingTools, inferHeadings };
}
