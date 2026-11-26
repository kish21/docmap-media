/**
 * "What can docmap do?" (2026-11-22, owner: "a product the user can command … find the commands easier"): every
 * docmap command, grouped by what the reader wants to do, each with one plain line. Data only (no `vscode`), so a
 * unit test can check it lists every command in package.json.
 */

export interface GuideEntry {
  readonly command: string;
  /** What the reader sees in the list. */
  readonly label: string;
  /** One plain line: what it does for them. */
  readonly what: string;
}

export interface GuideGroup {
  readonly title: string;
  readonly entries: readonly GuideEntry[];
}

export const COMMAND_GUIDE: readonly GuideGroup[] = [
  {
    title: "Read a doc",
    entries: [
      {
        command: "docmap.openMapHere",
        label: "Show Preview (in This Tab)",
        what: "Read the doc laid out, with its contents on the left. Ctrl+Alt+V switches back and forth.",
      },
      {
        command: "docmap.showSource",
        label: "Show Source (in This Tab)",
        what: "Back to the plain text, to edit it.",
      },
      {
        command: "docmap.openMap",
        label: "Open Preview to the Side",
        what: "The laid-out doc beside the text you edit.",
      },
      {
        command: "docmap.openInBrowser",
        label: "Open Preview in Browser",
        what: "The doc in your web browser, updating as you edit — handy on a second screen.",
      },
      {
        command: "docmap.chooseLook",
        label: "Choose Reading Look",
        what: "Theme, text size and line width for reading.",
      },
      {
        command: "docmap.compare",
        label: "Show Changes on the Page",
        what: "What changed since you last read it, since the last commit, or against another version.",
      },
      {
        command: "docmap.exportHtml",
        label: "Export as HTML",
        what: "Save the doc as one web page to share.",
      },
      { command: "docmap.exportPdf", label: "Export as PDF", what: "Print the doc, or save it as a PDF." },
    ],
  },
  {
    title: "Check docs against the code",
    entries: [
      {
        command: "docmap.checkDesign",
        label: "Does the Code Still Match This Doc?",
        what: "Every file, function, script, setting and version the doc names that the code no longer has.",
      },
      {
        command: "docmap.showMentions",
        label: "Docs That Mention This File",
        what: "In a code file: which docs talk about it.",
      },
      {
        command: "docmap.compareWithStandard",
        label: "Compare with a Standard Format",
        what: "Which sections a known format (MADR, Spec Kit…) or your team's template expects, and which are missing.",
      },
    ],
  },
  {
    title: "Find your way around",
    entries: [
      {
        command: "docmap.whereToStart",
        label: "Where Do I Start?",
        what: "New to a project? A reading order: what it is, the design, recent decisions, work in progress.",
      },
      {
        command: "docmap.searchDocs",
        label: "Search All Docs",
        what: "Find words in every doc, grouped by doc and section.",
      },
      {
        command: "docmap.openQuestions",
        label: "Open Questions",
        what: "Every open question in every doc, in one list.",
      },
      { command: "docmap.myItems", label: "My Items", what: "Tasks and questions that name you." },
      {
        command: "docmap.home",
        label: "Home",
        what: "What is being worked on and what is next, hard-to-read docs, docs out of date, every feature.",
      },
      {
        command: "docmap.plansDashboard",
        label: "Plans Dashboard",
        what: "Every plan: how far along it is, and what needs attention.",
      },
      {
        command: "docmap.plansMenu",
        label: "Plans Dashboard: Sort, Export or Ask My Agent",
        what: "Sort the dashboard, save it as CSV, or ask your AI about it.",
      },
      {
        command: "docmap.decisionLog",
        label: "Decision Log",
        what: "Every decision written in your docs, newest first.",
      },
      {
        command: "docmap.docAtlas",
        label: "Doc Atlas",
        what: "Your features, one line each; click one for its docs and the code it names.",
      },
      {
        command: "docmap.refreshFolderMap",
        label: "Refresh Markdown Files",
        what: "Re-read the folder's Markdown files list.",
      },
      {
        command: "docmap.help",
        label: "Help (All Features)",
        what: "Every feature: what it does, where to find it, how to try it.",
      },
    ],
  },
  {
    title: "Write and tidy",
    entries: [
      {
        command: "docmap.newDocFromTemplate",
        label: "New Doc from Template",
        what: "A plan, decision, spec, runbook… with the right sections; you see where it is saved first.",
      },
      {
        command: "docmap.updateToc",
        label: "Insert / Update Table of Contents",
        what: "A list of the doc's sections at the cursor, kept up to date.",
      },
      {
        command: "docmap.formatTable",
        label: "Format Table",
        what: "Line up the columns of the table at the cursor.",
      },
      { command: "docmap.bold", label: "Toggle Bold", what: "Bold the selected words (Ctrl+B)." },
      { command: "docmap.italic", label: "Toggle Italic", what: "Italic for the selected words (Ctrl+I)." },
      {
        command: "docmap.strikethrough",
        label: "Toggle Strikethrough",
        what: "Strike through the selected words.",
      },
    ],
  },
  {
    title: "Work with your own AI",
    entries: [
      {
        command: "docmap.askAgent",
        label: "Ask My AI Agent About This File",
        what: "Summarise, make it easy to read, build from it, fill it in, check it… as a prompt for your AI.",
      },
      {
        command: "docmap.sendReview",
        label: "Send My Review to My AI Agent",
        what: "Your section marks and comments on the text, as one prompt.",
      },
      {
        command: "docmap.writeDocMap",
        label: "Write Doc Map for Agents",
        what: "Tell AI agents where your docs are and which to read first (AGENTS.md / CLAUDE.md).",
      },
      {
        command: "docmap.addRulePointers",
        label: "Point Other AI Tools to AGENTS.md",
        what: "One line in Claude's and Copilot's rule files, so every tool reads the same rules.",
      },
      {
        command: "docmap.addPrompts",
        label: "Add Markdown Prompts to This Project",
        what: "docmap's prompts as slash commands in Copilot and Claude Code.",
      },
      {
        command: "docmap.setupAgentTools",
        label: "Set Up docmap Tools for My Agent (MCP)",
        what: "Let your agent read docmap's checks itself (off until you set it up).",
      },
    ],
  },
  {
    title: "Your data",
    entries: [
      {
        command: "docmap.clearSavedData",
        label: "Clear docmap's Saved Data",
        what: "Remove highlights, comments, places and copies docmap keeps on this computer.",
      },
    ],
  },
];

/** Commands that act on something you clicked (a folder, an inbox row, a key press), so the finder leaves them out. */
export const NOT_IN_GUIDE: readonly string[] = [
  "docmap.whatCanItDo",
  "docmap.openMapAt",
  "docmap.newDocHere",
  "docmap.onEnter",
  "docmap.inbox.refresh",
  "docmap.inbox.markRead",
  "docmap.inbox.askAgent",
  "docmap.inbox.archive",
  "docmap.inbox.compare",
];
