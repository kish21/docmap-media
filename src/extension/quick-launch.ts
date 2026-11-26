import * as vscode from "vscode";

/** One labeled quick-launch row in the docmap Activity Bar sidebar. */
export interface QuickLaunchEntry {
  readonly label: string;
  readonly description: string;
  readonly command: string;
  readonly icon: string;
}

export const QUICK_LAUNCH_ITEMS: readonly QuickLaunchEntry[] = [
  {
    label: "Home",
    description: "What's going on in this project",
    command: "docmap.home",
    icon: "home",
  },
  {
    label: "Plans Dashboard",
    description: "Progress, owners, dates & risks",
    command: "docmap.plansDashboard",
    icon: "dashboard",
  },
  {
    label: "Doc Atlas",
    description: "Feature map & code links",
    command: "docmap.docAtlas",
    icon: "type-hierarchy",
  },
  {
    label: "Open Questions",
    description: "Unanswered questions across docs",
    command: "docmap.openQuestions",
    icon: "question",
  },
  {
    label: "Search All Docs",
    description: "Find text across Markdown files",
    command: "docmap.searchDocs",
    icon: "search",
  },
  {
    label: "New Doc from Template",
    description: "Start a plan, spec, or ADR",
    command: "docmap.newDocFromTemplate",
    icon: "new-file",
  },
];

/**
 * 3.3.0: one calm, labeled home for docmap's workspace views in the Activity Bar — zero startup scan cost.
 */
export class QuickLaunchProvider implements vscode.TreeDataProvider<QuickLaunchEntry> {
  getTreeItem(entry: QuickLaunchEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(entry.label, vscode.TreeItemCollapsibleState.None);
    item.description = entry.description;
    item.tooltip = `${entry.label} — ${entry.description}`;
    item.iconPath = new vscode.ThemeIcon(entry.icon);
    item.command = { command: entry.command, title: entry.label };
    return item;
  }

  getChildren(element?: QuickLaunchEntry): QuickLaunchEntry[] {
    return element ? [] : [...QUICK_LAUNCH_ITEMS];
  }
}
