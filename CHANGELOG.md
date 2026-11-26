# What's new

## 3.2.2 — enterprise readiness, big-workspace speed, and public open-source releases

- **Zero-cost startup (#52):** docmap no longer scans every Markdown file when VS Code opens — **Home on Start** is now
  off by default, and commit hints and code-link lenses stay idle until needed.
- **Smooth on large workspaces (#53, #55):** Docs Inbox streams files instead of holding all document text in memory,
  caches results by file size and modified time, yields between files, caps parallel file reads and `git` processes, and
  skips heavy duplicate checks and `git blame` on huge files.
- **Never reads `.env` files (#54):** trust checks only inspect `.env.example`, `.env.sample` and `.env.template`
  (never `.env` or `.env.*` secrets), bound code-identifier scanning, and avoid clearing the whole cache on unrelated
  file edits.
- **Faster large previews and diagrams (#56):** lowers the default large-file threshold to 1 MB, scales edit debounce on
  large documents, and renders Mermaid diagrams lazily as they scroll into view.
- **Security & open-source release pipeline (#57, #58):** adds `SECURITY.md` documenting docmap's privacy and sandboxing
  architecture, publishes the clean open-source repository at `kish21/markdown-docmap`, and builds reproducible `.vsix`
  releases with `SHA256SUMS.txt` in GitHub Actions.

## 3.2.1 — fixes for 3.2.0

- **◈ Doc Atlas** finds a doc you wrote since docmap last read the project (before, it showed the first feature
  instead), and an Atlas already open over your doc moves beside it.
- **Point at code to see it** always shows the code as it is now, not lines from before you changed it.
- **Long paragraphs:** Find (Ctrl+F) also finds text in the part behind **more…** and opens it; a highlight or
  comment there opens it too.

## 3.2.0 — easy reading, one Home page, fewer menus

- **Easy reading:** a long doc opens with **Where this stands** at the top — its parts and whether each is built,
  the story in date order with each part's build record, and a warning when the Status line at the top no longer
  matches the sections below it. Each part's heading shows its state. Long paragraphs show two sentences, then
  **more…**. Nothing is changed in your file; **Clean view** off shows it as written.
- **Point at code to see it:** hover a code name or a link to a code file in a doc and its lines appear (the named
  line marked). A code link such as `cart.py#L12` now opens that file at that line from any doc.
- **◈ Doc Atlas** on every page opens the graph beside the doc, centred on it: that doc's map fills the panel, and
  **☰ All features** brings back the list. It is not shown on docmap's own pages (Home, Open questions…).
- **Show source** on a doc's preview switches it to the Markdown text in the same tab.
- **From docmap's own pages:** clicking a doc opens its preview in a tab of its own (the page stays open) and shows
  the file in the Explorer.
- **Open questions** lists only real questions — text ending in "?" or a line marked "Question:" — each one whole,
  even when it runs over several lines. A "?" inside code, quotes or brackets is not a question. Click **line N** to
  open the doc at that line; Home's "What's open" works the same way.
- **Home (What's Going On in This Project):** what is being worked on and what is next (from your handover note),
  what's open (questions waiting for an answer, tasks that name you), hard-to-read docs, docs that name code that is
  gone, and every feature — on one page. It opens by itself in a project with many docs (setting **Home on Start**).
- **Fewer choices:** one **Make this easy to read** prompt instead of three. Rarely used commands are no longer in
  the Command Palette — all are still in **What can docmap do?**, or turn on **Show All Commands**.

## 3.1.1 — Doc Atlas per feature; readable docs; a plans dashboard that helps

- **Doc Atlas, a graph you walk:** instead of one diagram of every doc (unreadable on a big project), pick a feature
  and see only what is around it: the docs that link to it, the docs it links to and the code files it names. Click
  any box to move there. **Code details** lists its files and functions linked to the line, and the names it gives
  that are no longer in the code.
- **Browser view:** links to other files (they open in VS Code only) now read as plain text, without the dotted
  line, and the Plans dashboard's 🌐 "open in browser" link is left out there (you are already in the browser).
- A diagram that cannot be drawn now says so on the page, instead of quietly showing as code.
- **Docs Inbox:** docs in `archive`, `_archive`, `archived` or `old` folders get their own **Archived** group and no
  longer mix with current docs in New, Worth reading, Plans, Out of date or Doubtful.
- **New prompt "Make this easy to read":** your AI agent adds a status box at the top, turns long paragraphs and
  running logs into lists and dated tables, gives links readable names, gathers them under Related docs and folds
  long history. Every fact is kept.
- **Plans dashboard** leads with what is **in progress** and each plan's next open step. Finished plans and the
  decisions list fold away. A status such as "✅ Built 2026-07-19", "Shipped" or "Superseded" now counts as finished,
  so old docs no longer show as stale or overdue. Plans in `archive` / `old` folders fold into an **archived** list
  and never need attention. Only an open task box can be overdue (a past date in plain text is history), and
  "no owner" shows only where most plans name one.

## 3.1.0 — fewer false ✗ marks; comment, click and copy for your AI; every command in one list

- **Also in 3.1:** **Does the code still match this doc?**, **Where do I start?** (reading order), **Clear docmap's
  saved data**, "N docs mention files you changed" in the status bar before you commit, a shorter **New Doc** list,
  "Build from this doc" / "Fill in this doc" prompts, the Contents icon in its own margin, a calmer Docs Inbox (only
  New, Changed; tool folders skipped) and fewer buttons and settings by default (settings in groups).

- **Fewer false ✗ marks:** a shorter path (`webview/extras.ts` for `src/webview/extras.ts`), build output
  (`dist/`…), names the code uses but does not define, npm's own commands (`npm view`) and years ("TypeScript 2026")
  are no longer flagged. A folder holding your project works like the project itself (✗ marks, "Mentioned in N docs",
  "N docs mention files you changed", "Where do I start?").
- **A file moved?** The ✗ menu offers **Update `old` to `new`**: one click fixes that name on that line.
- **Clickable code names:** a file, function or class the doc names opens beside it (only ones your project has).
- **Comment on any words** in the preview; **Send My Review to My AI Agent** sends your comments with the words they
  are about.
- **Copy for my AI…:** this doc plus the linked docs you pick, as one text, with its size.
- **▶ Terminal** on shell blocks: the command goes into the terminal; you press Enter.
- **What Can docmap Do?:** every command in one list, by what you want to do.
- **New Doc:** you see (and can change) where the doc goes; **New Doc from Template Here…** on any folder; MADR and
  Spec Kit listed once, with the full template.
- **Does the Code Still Match This Doc?** (renamed from "…This Design?"): its first line asks your AI to fix them.

## 3.0.1 — Help opens again; the Markdown Files list shows your files on Windows

- **Fixed:** **Help (All Features)** (and the **?** on the Docs Inbox) said "file not found": the help page was left
  out of 3.0.0's package.
- **Fixed:** on Windows, the **Markdown Files** list could stay empty ("No Markdown files in this workspace yet") in a
  folder full of docs, when VS Code wrote the drive letter differently for the folder and its files.
- **Fixed:** **Write Doc Map for Agents** could build on an out-of-date copy of `CLAUDE.md` or `AGENTS.md` when the
  file had just changed on disk. It now starts from the file on disk unless you have unsaved edits.
- **Help page brought up to date:** the removed readiness score is gone from it; new section **What kind of doc is
  this?** (doc formats and **Compare with a Standard Format…**); the full list of templates; the page's button is
  called **⋯ Ask my AI agent**.
- Every feature, with where to find it and a screenshot: https://kish21.github.io/docmap-help/

## 3.0.0 — know which docs you can trust, and what to do next

**Trust**
- **Trust markers** beside each paragraph: ✗ doesn't match the code (files, functions, commands, env vars, versions
  it names), ⇄ conflicts with another doc, ⚠ may be stale (git: a file it names changed since), ↺ a newer copy
  exists, ✓ verified by you. Hover for why; click to mark verified / wrong, or ask your AI agent to check it. The
  Docs Inbox gains a **Doubtful** group.
- **Docs ↔ code:** code files that docs name show **📄 Mentioned in N docs** above them.

**Live browser page**
- **Open Preview in Browser follows your edits:** the page in your browser updates as you type in VS Code, keeping
  your place. It is served only to your own computer, behind a private link, and stops updating when VS Code
  closes. Prefer a saved copy? Turn off `docmap.liveBrowser`.

**Read AI-written docs comfortably**
- **Clean view** (on by default; **Show as written** turns it off): key–value bullets as cards, "Note:" lines as
  note boxes, steps as a stepper, status words as chips, checklist progress, syntax colours, image zoom, front
  matter as a header card. The layout never changes the file. Optional heading numbers.
- **Tick tasks and change statuses on the page:** click a task box to tick it, or click a status label in a table
  (done, in progress, blocked…) to pick a new one. Only that line of the file changes, and it is saved for you.
- **New Doc from Template…:** vision, scope, plan, architecture, feature spec, ticket, decision record, runbook,
  agent guide (AGENTS.md) or structure, in the shape every feature reads. **Restructure into a clear doc** asks your
  AI agent to reshape an existing doc the same way — every fact kept, gaps written as open questions.

**Docs in recognised formats — your team's format first**
- **The page says what kind of doc it is** when docmap is sure: decision record, design doc, feature spec, runbook
  or architecture doc, design system (DESIGN.md), test plan, postmortem or release notes, and the named format it
  follows where a recognised one exists (MADR, Nygard ADR, Google design doc, Rust-style RFC, GitHub Spec Kit, arc42).
  A doc in another style is never marked wrong, and there is no score.
- **New suggested templates** where no single standard exists: **DESIGN.md** (colours, type, spacing, components,
  accessibility, themes — what a developer or an AI agent needs to build matching screens), **test plan**,
  **postmortem** (blameless), **release notes**, and a rewritten **runbook** (when to use it, steps with a check
  after each, roll back, who to call). They are suggestions: your team's `docs/templates/<kind>.md` replaces any.
- **Compare with a Standard Format…** (or click that label) lists which parts of a format your doc has. Your team's
  own format comes first: its template file, or the headings most of its existing docs share. Information only:
  your file is never changed.
- **New docs follow your team:** a new decision record, design doc, spec or runbook goes in the folder your team
  already uses (adr-tools and log4brains settings are read), numbered like its neighbours, in your team's template.
  docmap's own decision, design and spec templates now use MADR, Google design-doc and Spec Kit section names.
- **Write Doc Map for Agents** adds a table to AGENTS.md (and CLAUDE.md) saying where each kind of doc lives and
  which shape to follow, so AI agents write docs in the right place. Only that section changes; you review and
  save it.
- **Point Other AI Tools to AGENTS.md…** adds small pointer files (`CLAUDE.md`, `.github/copilot-instructions.md`,
  `GEMINI.md`) so every agent reads the one AGENTS.md. Only the files you tick; a missing file is created, an
  existing one is never replaced (one marked line at the end, left unsaved); files that already mention AGENTS.md
  are left alone. The Agent guide template gains a **Never do** section.
- **Search All Docs…:** one search box over every Markdown file; each result shows the headings it sits under.
- **Doc Atlas:** a diagram of which docs link to which, grouped by folder, plus the docs that link to none.
  Read-only.
- **Tidy these docs:** a prompt for your agent (Docs Inbox → hover a group → ✨) that sorts docs into
  current, out of date, duplicate or misplaced, and changes nothing until you agree.
- **Prompts are copied by default:** "Prompt copied — paste it into your AI agent", so they work the same with
  Claude Code, Codex, Copilot, Cursor or any other. Setting **Agent Target** → **auto** opens Copilot Chat instead.
- **Small reading comforts:** `j` / `k` jump to the next / previous heading; Esc clears the heading filter and gives
  the keys back to the page; ticking a task or changing a status says "✓ Updated plan.md, line 12" in the status
  bar; clicking a trust count ("✗ 2 don't match the code") again goes to the next one; a folder with more than 10
  Markdown docs gets a one-time tip to open the Docs Inbox.
- **No readiness score:** the "Ready 7/10" plan check is gone. It was our own ten-part checklist, not an industry
  standard. The Plans Dashboard stays; a file counts as a plan by its name, its title or its front matter.

**Plans**
- **Plans Dashboard:** every plan, grouped by folder — progress, status, owner, next date / overdue,
  questions, risks, decisions. Only the columns your project fills; no owner written → the last git author; no
  task boxes → active / quiet / stale by last change. Sections: needs attention, coming up, out of date with the
  code, recently changed, open questions, decisions. 🌐 beside each plan opens it in the browser. Sort it, save as
  Markdown or CSV.
- **Open Questions** and **My Items** (tasks and questions that name you — setting `docmap.myNames`).
- **Outline badges:** open tasks, questions and doubtful paragraphs per section.
- **Sign off this version:** your name and date go into the file; the page flags any later change.

**See what changed**
- **⇆ Compare…** marks changes on the rendered page: since you last read it, your unsaved edits, the last commit,
  the main branch, a week ago, a tag or any git version. Ask your agent to summarise the changes.

**AI — always your own, never ours** (both off by default)
- **Answer with my model** (`docmap.ai.answerWithMyModel`): questions that need only an answer are answered by
  your own model in VS Code (e.g. Copilot) on a page, after you agree once. Prompts that change files still go to
  your agent.
- **Tools for agents** (`docmap.ai.tools`): plans, open questions, outlines and doc-vs-code checks for
  Copilot agent mode, and through a local MCP server for Claude Code, Cursor and others (**Set Up docmap Tools for
  My Agent**). It runs on your computer, only reads, and never goes online.

## 2.0.4 — the browser view no longer fills your disk

- **Fixed:** every file you opened in the browser left a page behind in the extension's storage (up to 5 MB each with
  diagrams), so its cache kept growing. Now there is only one browser view at a time: opening another file replaces
  the previous pages, the diagram library is stored once, and old pages from earlier versions are removed when the
  extension starts. **Export as HTML** still saves one self-contained file wherever you choose.

## 2.0.3 — sturdier start after an update

- **Fixed:** right after updating, some editors showed "No view is registered with id: docmap.inbox" and the
  extension stopped starting, so other features went missing too. Now only the Docs Inbox waits for a window reload
  (**Developer: Reload Window**); everything else works straight away.

## 2.0.2 — pre-release checks

- **Plays well with other extensions:** `Ctrl+Alt+V` is left to Paste Image when it is installed (the preview button
  still works); the writing keys step aside for Markdown All in One and Markdown Shortcuts.
- **Enter inside a code block** is always a plain Enter (no list continuation in examples).
- **Faster in big projects:** a closed Docs Inbox no longer re-reads every Markdown file after each save; it catches
  up when you open it. It skips dependency and build folders and respects VS Code's **Files: Exclude**.
- **Docs Inbox:** Cursor rule files (`.mdc`) open as text; **Move to Archive** creates the `archive` folder when needed.
- **Exported HTML** files can be opened by others (normal file permissions); untitled files export into the workspace.
- Keyboard shortcuts work from the first press, and docmap starts when a Markdown file opens.
- Remembered marks, highlights and read state are capped (the oldest files are forgotten first).
- Copilot prompt files use only the `description` field, so newer Copilot versions read them too.

## 2.0.1 — at home in Cursor, Antigravity and other VS Code-based editors

- **Ask my AI agent** opens Copilot Chat only in VS Code with Copilot installed. In Cursor, Antigravity, Windsurf,
  VSCodium and the like, the prompt is copied for you to paste into the agent you use there.
- **`Ctrl+I` stays your AI agent's key** in Cursor and other editors built on VS Code; italic uses it only in VS Code
  (the **Toggle Italic** command works everywhere).

## 2.0.0 — read the docs that matter, review them with your own AI agent

**New**
- **Docs Inbox** (Explorer sidebar): every Markdown file sorted into changed since you read, new, worth reading first,
  plans in progress, possible duplicates (with compare), probably out of date, agent instruction files and a decision
  log. Mark as read, move to an archive folder, or ask your AI agent about a file or a whole group.
- **Review mode**: the **⋯** beside each heading in the preview — approve, ask a question, request a change — then
  **Send my review to my AI agent**.
- **Ask my AI agent**: 18 ready prompts (explain, challenge, risks, tasks, tests, brief me on what changed, continue
  this plan, TL;DR, one-pager, slides, checklist, README, fix headings, update to match the code, merge duplicates,
  write an index, what is still open, instruction conflicts). Opens in Copilot Chat, or is copied for Claude Code,
  Cursor, Antigravity and others. **Add Markdown Prompts to This Project** saves them as agent commands.
- **Key points** strip, **what changed since you last read it**, **highlighter**, **themes** (Paper, GitHub, Night,
  Focus), text size and line width, **copy** buttons on code, a reading progress bar, and **slides** from `---`.
- **Writing helpers**: bold / italic / strikethrough keys, lists that continue on Enter, Format Table, Insert / Update
  Table of Contents.
- **Export as HTML** and **Export as PDF (print)**.

Nothing here runs AI or sends data: the prompts go to the agent you already use, and everything else is computed on
your computer. Highlights, review marks and read state are kept in VS Code's storage, never in your files.

## 0.2.3 — one button switches both ways

- **Fixed:** after **Show Preview**, clicking again did not bring the source back. The button (and `Ctrl+Alt+V` /
  `Cmd+Alt+V`) is now a true switch: on the source it shows the preview, on the preview it shows the source — in VS
  Code, Cursor, Antigravity and other editors built on VS Code.

## 0.2.2 — same-tab preview in Cursor, Antigravity and other VS Code-based editors

- **Fixed:** in Cursor, Antigravity and some other editors built on VS Code, **Show Preview** opened the page in a
  second tab instead of the same one. The source tab is now closed reliably, so you get one tab there too.
- What happens on each switch is written to the **All-in-One Markdown Viewer** output (View → Output), to help with
  any editor that still behaves differently.

## 0.2.1 — easier in a narrow side panel

- **More room to read beside your file.** In a narrow side preview the contents list now starts folded to one line
  — **Contents · the section you are reading** — so the page gets the whole height. Tap it to open the list;
  choosing a heading closes it again.
- **Plain names for the reading tools:** **Skim** is now **Quick read**, and **Fold 1 2 3** is now **Levels**.
- **Tables keep values whole:** a colour code, a name like `--surface-0` or a path is no longer split over two
  lines; a wide table scrolls sideways inside itself instead.

## 0.2.0 — preview in the same tab, and a clearer name

**New**
- **Preview in the same tab.** **Show Preview** turns the Markdown file's tab into the page, and **Show Source**
  turns it back. One tab instead of two, and each switch keeps your place: the page opens at the section the source
  was showing, and the source opens at the section you were reading. Keys: `Ctrl+Alt+V` (`Cmd+Alt+V` on a Mac).
- **Open every Markdown file as a preview**, if you like: right-click a Markdown tab → **Reopen Editor With…** →
  **Configure default editor for '\*.md'…** → **All-in-One Markdown Viewer (preview)**. Off unless you choose it.

**Changed**
- New name: **All-in-One Markdown Viewer**, and a new icon. Buttons and commands now say
  "Preview" instead of "Map". The extension ID and your settings are unchanged, so you get this as a normal update.
- **Markdown Map** in the Explorer is now **Markdown Files**. Clicking a file or heading there opens the preview in
  the file's own tab.

**Security**
- Updated the Markdown parser (markdown-it 15.0.3: a slow-down on crafted link definitions) and the diagram library
  (Mermaid 12.3.0, with a fixed DOMPurify). No known vulnerabilities in the package.

## 0.1.0 — first public release

The first version on the Visual Studio Marketplace. Everything from the earlier test versions (listed below), in one
package:

- Open any Markdown file as a clean web page, **beside the file**, **in its own tab**, or **in your browser**.
- An **outline** of every heading that shows where you are, jumps where you click, filters as you type, and can be
  resized or hidden.
- **Reading tools:** skim each section, fold to a heading level, see each section's reading time.
- Links between your Markdown files, pictures, diagrams, tables, note boxes, task lists and footnotes, in your VS Code
  theme.
- **Markdown Map** in the Explorer: every Markdown file in your folder, with its headings.
- It only reads your files, and it collects and sends nothing.

If you installed a test version from a `.vsix` file, uninstall it first: this release has a new extension ID
(`kish21.markdown-as-web-page`). Your settings are kept.

## 0.0.20

**New**
- **Resize or hide the outline**, like VS Code's own sidebar: drag the line between the outline and the text, or drag
  it all the way left to hide the outline. The **‹** button hides it, **›** brings it back (**Ctrl+B** in the
  browser), and a double-click on the line resets the width. Your choice is remembered, in VS Code and in the
  browser.

**Improved**
- **Reading Tools are now on by default:** skim, fold to a level, structure hints and GitHub extras are ready without
  changing a setting. Turn them off in Settings if you prefer the plain outline.
- The outline shows each section's **reading time** (for example **4 min**) instead of a word count like "876w".
  Hover over it for the number of words.

## 0.0.19

**New**
- A **Light / Dark** switch on the page you open in your browser (top of the outline, beside the file name). It
  starts with your computer's setting; your choice is remembered for the next time. Diagrams and pictures switch
  too. Inside VS Code the page still follows your VS Code theme.

## 0.0.18

**Improved**
- The page uses the full width of your screen, in VS Code and in the browser. On a big monitor the text and tables
  spread across the page instead of sitting in a narrow column with wide empty margins.

## 0.0.17

**Fixed**
- When you click a heading near the end of a document, the outline now marks that heading. Before, a short last
  section could not scroll to the top, so the section above it stayed marked.

**Improved**
- The extension page says where to change the settings (the gear icon → Settings), and a setting description no
  longer shows a raw `#docmap.readingTools#` code.

## 0.0.16

**Improved**
- The extension page now shows the animated demo, and **Report a problem** goes to a public page where anyone can
  open an issue.

## 0.0.15

**Improved**
- Tables on narrow windows and phones: columns no longer get squeezed into a thin strip one letter wide. A table
  that is still too wide scrolls sideways by itself, without moving the rest of the page.

## 0.0.14

**Fixed**
- A table with a long file name or path in it could spread wider than the page and push everything sideways, so
  part of the outline was cut off. Tables now stay inside the page, and long names wrap inside their cell.

## 0.0.13

**Improved**
- **Open Map in Browser** now also makes pages for the Markdown files your file links to, so those links work in
  the browser too (they used to show with a dotted line and do nothing). Only files inside your folder, at most 50
  pages.
- After you click a heading in the outline, that heading stays marked as the one you are reading. Before, the
  heading above it was sometimes marked instead.
- The extension page shows a short animated demo.

## 0.0.12

**Improved**
- Pictures added with HTML now show, like the diagrams many READMEs use (`<picture>` and `<img>`). When a picture
  has a light and a dark version, you see the one that matches your VS Code theme. Only picture files inside your
  folder are shown; nothing is downloaded from the web.
- HTML links (`<a href>`) work like normal links, and links to a jump target (`<a id>`) go to the right place.
- `<code>` inside HTML now shows as code.

## 0.0.11

**Improved**
- The three buttons at the top of a Markdown file now sit together, instead of VS Code's own preview button
  landing between them.
- Closing a Markdown file's tab no longer closes its page. The page stays open, and clicking a heading opens the file
  again. If the file is deleted or moved, the page says so.
- A new extension page with a screenshot, simple steps and a list of what it can do. The settings are described in
  plain words.

## 0.0.10

**Fixed**
- The outline was hard to read in some dark themes (such as Dark+) when your computer was set to light mode. It now
  follows your VS Code theme.
- Remembering where you were reading now saves less often while you scroll, so it does less work.

## 0.0.9

**Improved**
- New name: **Markdown as Web Page — Outline & Skim Reader** (it was "docmap"), so it is easier to find. Your
  settings are kept.

## 0.0.8

**New**
- **Diagrams:** ` ```mermaid ` blocks are drawn as diagrams.
- **Markdown Map** in the Explorer sidebar: all the Markdown files in your folder, with their headings. Click one to
  open it.
- The page remembers where you were reading, even after you restart VS Code.
- Simple HTML that READMEs often use now shows properly: fold-out sections (`<details>`), keyboard keys (`<kbd>`),
  superscript and subscript, line breaks and a few more. Anything else is shown as plain text, to keep you safe.

## 0.0.7

**New**
- A link to another Markdown file opens that file's page, at the right heading.
- Open a file's page again and it goes back to where you were reading.
- Print or save as PDF from the browser: you get the document alone, dark text on white, with every section open.

**Fixed**
- With two headings of the same name, a click could sometimes jump to the wrong one after an edit.

## 0.0.6

**New**
- Search the text in the page with `Ctrl+F` (`Cmd+F` on a Mac).

## 0.0.5

**Improved**
- New icons for the three buttons, each showing what it does, and an icon for the extension.

## 0.0.4

**New**
- **Reading Tools** (turn on in Settings) for long or AI-written documents: skim each section's first paragraph,
  fold to a heading level, see how long each section is, and get an outline even in notes with few headings.
- Task lists, footnotes and GitHub-style notes (`> [!NOTE]`, `> [!TIP]` …) show properly.

## 0.0.3

**Fixed**
- The buttons now appear in folders VS Code opens in restricted mode.

## 0.0.2

**New**
- Three buttons at the top of a Markdown file: open the page beside the file, in the file's own tab, or in your
  web browser.
