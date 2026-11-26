# Help: what All-in-One Markdown Viewer does, and how to try each feature

> [!TIP]
> The same help with pictures, on the web: https://kish21.github.io/docmap-help/
>
> Open this page in VS Code any time: `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`) → type **help** → **All-in-One Markdown
> Viewer: Help (All Features)**. For a guided tour: **Help: Get Started** → **All-in-One Markdown Viewer**.
> To find and run any command by what you want to do: **What Can docmap Do?** (also in the page's **⋯ Ask my AI
> agent** menu and the Docs Inbox **⋯**).
>
> **Start here:** `Ctrl+Shift+P` → **Home (What's Going On in This Project)** — what is being worked on and what is
> next, what's open, hard-to-read docs, docs out of date with the code, and every feature, on one page.
>
> Since 3.2 the rarely used commands (decision log, reading order, open questions, my items, agent set-up, clear
> saved data) are not in the Command Palette: run them from **What Can docmap Do?**, or turn on the setting
> **docmap: Show All Commands**.

Every feature below has three parts: **what it does**, **try it** (an example to paste — use the copy button on each
example), and **what you should see**.

Before you start: open a project folder in VS Code (ideally one that uses git) and create a new file called
`try-docmap.md` in it. You will paste the examples into that file.

## Contents

| # | Feature | New in |
| --- | --- | --- |
| 1 | [Preview in the same tab](#1-preview-in-the-same-tab) | 0.2 |
| 2 | [Clean view for AI-written Markdown](#2-clean-view-for-ai-written-markdown) | 3.0 |
| 3 | [Trust markers](#3-trust-markers) | 3.0 |
| 4 | [What kind of doc is this?](#4-what-kind-of-doc-is-this) | 3.0 |
| 5 | [Plans Dashboard](#5-plans-dashboard) | 3.0 |
| 6 | [Open Questions and My Items](#6-open-questions-and-my-items) | 3.0 |
| 7 | [Compare: what changed, on the page](#7-compare-what-changed-on-the-page) | 3.0 |
| 8 | [Sign off a version](#8-sign-off-a-version) | 3.0 |
| 9 | [Docs mentioned in code](#9-docs-mentioned-in-code) | 3.0 |
| 10 | [Docs Inbox](#10-docs-inbox) | 2.0 |
| 11 | [Review and your AI agent](#11-review-and-your-ai-agent) | 2.0 |
| 12 | [AI that uses your own model](#12-ai-that-uses-your-own-model) | 3.0 |
| 13 | [Tools for your AI agents](#13-tools-for-your-ai-agents) | 3.0 |
| 14 | [Reading, writing and sharing](#14-reading-writing-and-sharing) | 2.0 |
| 15 | [New docs from templates, and restructuring old ones](#15-new-docs-from-templates-and-restructuring-old-ones) | 3.0 |

## 1. Preview in the same tab

**What it does:** turns a Markdown file into a readable page, in the same tab, with a clickable outline on the left.

**Try it:** open any `.md` file and press `Ctrl+Alt+V` (Mac: `Cmd+Alt+V`), or click **Show Preview** at the top
right of the editor. Press it again to go back to the text.

**What you should see:** the same tab shows the page, at the section you were looking at. Clicking a heading on the
left jumps to it. The box at the top (**In short**) sums the file up.

## 2. Clean view for AI-written Markdown

**What it does:** AI tools write Markdown with "**Owner:** …" bullets, "Note:" lines and status words. Clean view
shows them neatly. **Your file is not changed** — unless you tick a box or pick a status (below).

**Try it:** paste this into `try-docmap.md`, then press `Ctrl+Alt+V`:

```markdown
# Payments rollout

- **Owner:** Priya
- **Deadline:** 2026-12-01
- **Status:** in progress

Note: the old API stays on until every client has moved.

Step 1: Turn on shadow mode.

Step 2: Compare results for a week.

| Task | Status |
| --- | --- |
| Shadow mode | done |
| Load test | in progress |
| Switch traffic | blocked |

- [x] Write the adapter
- [ ] Switch traffic
```

**What you should see:**
- the Owner / Deadline / Status bullets as a neat card
- "Note:" as a blue note box; Step 1 and Step 2 as numbered steps
- done, in progress, blocked as coloured labels in the table
- a progress bar above the checklist ("1 of 2 done")

**Turn it off:** click **Show as written** at the top of the page (click **Clean view** to turn it back on).

**Tick and change status on the page:** click the box next to "Switch traffic": it is ticked in the file too
(`- [x] Switch traffic`) and the progress bar shows **2 of 2 done**. Click the **blocked** label in the table → pick
**done**: the table row in the file now says done. Only that line changes, and the file is saved for you.

## 3. Trust markers

**What it does:** marks paragraphs you should not trust: they name files or commands that are not in your code,
disagree with another doc, or may be out of date. You see it in the left margin, next to the paragraph.

**Try it:** add this paragraph to `try-docmap.md`, **save**, and open the preview:

```markdown
The settings live in `src/old-settings-file.ts` and you run `npm run deploy-everything`.
```

**What you should see:**
- a red **✗** in the margin next to that paragraph
- hover it: "Mentions `src/old-settings-file.ts`, which is not in the repository" (and the same for the command, if
  your project has a `package.json`)
- at the top: **✗ 1 doesn't match the code**

**Then:** click the ✗ → **Mark as verified** (it turns into ✓; if the code changes after that, the mark comes back),
or **Verify this paragraph against the code** to ask your AI agent. Hover any other paragraph and click the faint dot to check that one.

**A file moved?** When the file the doc names is gone but a file with the same name is somewhere else in the project,
the ✗ menu offers **Update `old/path` to `new/path`**. One click changes that one name on that one line, nothing else.

**Not flagged** (so a ✗ means something): a shorter path (`webview/extras.ts` for `src/webview/extras.ts`), build
output and installed packages (`dist/`, `node_modules/`…), names the code uses but does not define (a library's
types, constants), npm's own commands (`npm view`), and years ("TypeScript 2026"). Opening a folder that holds your
project (instead of the project itself) works too.

| Marker | Means |
| --- | --- |
| ✗ | It names something that is not in your code |
| ⇄ | Another doc says something different (e.g. "Port: 8080" here, "Port: 3000" there) |
| ⚠ | A file it names changed after this paragraph was written (needs git) |
| ↺ | A newer, almost identical doc exists |
| ✓ | You checked it and marked it true |

## 4. What kind of doc is this?

**What it does:** when docmap is sure, the page says what kind of doc it is and the well-known format it follows,
for example **Decision record · MADR**. Kinds: decision record, design doc, feature spec, runbook, architecture doc,
design system (DESIGN.md), test plan, postmortem, release notes. A doc in another style is never marked wrong, and
there is no score.

**Try it:** `Ctrl+Shift+P` → **New Doc from Template…** → **More doc types…** → **Decision record** → any title.
Open its preview.

**What you should see:** a small label at the top left: **Decision record · MADR**. Click it (or **What Can docmap Do?** →
**Compare with a Standard Format…**) to see which parts of the format the doc has: ✓ has it, ○ the format expects
it, – optional and not used. Your team's own format comes first: its template in `docs/templates/`, or the headings
most of its docs share. Information only: your file is never changed.

## 5. Plans Dashboard

**What it does:** one table of every plan in your project: how far along, status, owner, next date, open
questions, risks, grouped by folder.

**Try it:** `Ctrl+Shift+P` → **Plans Dashboard** (or the **⋯** at the top of the Docs Inbox).

**What you should see:** a page with totals at the top, one row per plan (click a name to open it), and a **Needs
attention** list (overdue, blocked, no owner, names files that no longer exist).

**More:** **What Can docmap Do?** → **Plans Dashboard: Sort, Export or Ask My Agent…** — sort it, save it as Markdown or a
CSV for a spreadsheet, or ask your agent for a status report of every plan.

## 6. Open Questions and My Items

**What it does:** collects every open question, and everything assigned to you, from all your docs.

**Try it:** add these lines to `try-docmap.md` and save:

```markdown
## Open questions

- Do we keep the v1 endpoint?
- [ ] Ask @priya about the rollout date
```

Then `Ctrl+Shift+P` → **Home (What's Going On in This Project)**. For "Waiting on you", first set your name:
Settings → search **docmap my names** → add `@priya` (or your own name).

**What you should see:** Home's **What's open** part lists the question under **Questions waiting for an answer**
and the task under **Waiting on you**, each with the doc it is in. In the preview's outline, the "Open questions"
heading shows small counts: **☐1 ?1** (one open task, one question). The full lists, by file with line numbers, are
still there: **What Can docmap Do?** → **Open Questions (Every Doc)** or **My Items**.

## 7. Compare: what changed, on the page

**What it does:** shows what changed in a doc right on the page — new words underlined, removed words crossed out.

**Try it:** open the preview of a file that is committed in git. Change a few words in the text (don't save). Click
**⇆ Compare…** at the top of the page → **The last commit**.

**What you should see:** a bar "**Changes since the last commit:** 1 changed"; your new words underlined in green,
the old ones crossed out in red. **Stop comparing** clears it.

**Other choices:** the version I last read · the saved file · the main branch (main, master…) · a week ago · a tag
· any git version. **✨ Summarise**
asks your AI agent to explain the changes.

## 8. Sign off a version

**What it does:** records "I approve this version" in the file itself, and warns when the file changes later.

**Try it:** in the preview, click **⋯ Ask my AI agent** at the top → **Sign off this version…** → type your
name.

**What you should see:** the file gets a line `signed-off-by: Your Name 2026-11-16 #…` at the top, and the page
shows **✓ Signed off by Your Name**. Change any word and save: it becomes **⚠ Changed since Your Name signed off**.

## 9. Docs mentioned in code

**What it does:** in a code file, shows which docs talk about it.

**Try it:** in `try-docmap.md`, mention a real file of your project in backticks, e.g. `` `src/index.ts` ``, and save.
Open that code file.

**What you should see:** a small line at the top of the code file: **📄 Mentioned in 1 doc**. Click it to open the doc
at that line. (Turn off: setting **Code Lens**.)

**Before you commit:** change that code file (don't commit yet). The status bar shows **📖 1 doc mentions files you
changed**. Click it: pick the doc to open it, or point at it and click the sparkle icon on its right to hand your AI "update this doc to match my
change". The line goes away once you commit. Never a pop-up.

**Does the code still match this doc?** In any doc (most useful in a design doc), run **All-in-One Markdown Viewer: Does
the Code Still Match This Doc?** from the Command Palette or the editor's right-click menu. You get one list of what the
doc names that the code no longer has: files, functions, `npm run` scripts, settings and versions. Pick a line to jump
to it; the first line, **Ask my AI to fix these** (with a sparkle icon), hands the doc and the list to your AI, which says whether the doc or the code is wrong and proposes
a fix, changing nothing until you agree. It checks only what the doc names, not how the code behaves.

## 10. Docs Inbox

**What it does:** sorts every Markdown file in your project like an email inbox.

**Try it:** open the Explorer (left sidebar) → **Docs Inbox** section.

**What you should see:** groups such as **Changed since you read**, **New — last 7 days, not opened**, **Worth
reading first**, **Plans in progress**, **Possible duplicates**, **Probably out of date**, **Doubtful — check before
you trust**. The icons at the top make a new doc, search every doc and open this help; the **⋯** next to them has the
Plans Dashboard, the Decision log, the Doc Atlas, Where Do I Start? and Refresh.

Each group lists 10 files, then **Show all**. One click does the group's job: a changed doc opens with what changed
marked; a possible duplicate opens side by side with its twin (then **Are these really duplicates?** or **Merge them
into one** hands the question to your AI); an out-of-date doc says why and offers **Update this doc to match the
code**. Files in tool folders (names starting with a dot, such as `.agents`) are left out; the settings
**Skip Folders** and **Include Folders** change that.

**Search all docs:** `Ctrl+Shift+P` → **Search All Docs…** → type a word. Each result shows its file and the headings
it sits under (`› Scope › Deferred`); pick one to open the file at that line.

**Doc Atlas:** `Ctrl+Shift+P` → **Doc Atlas (Your Features)**. A graph you walk. On the left, your features grouped
by folder, with a search box (a doc counts as a feature when it sits in a `features` or `specs` folder, or reads as a
design or spec; archived docs are left out). In the middle, the doc you picked: the docs that link to it on the left,
the docs it links to on the right, the code files it names below. Click any box to move there; the trail at the top
takes you back. **Open the doc** opens it; **Code details** lists its files and functions linked to the line, and the
names it gives that are no longer in the code. Read-only: nothing is written.

**Where do I start?** New to a project? **What Can docmap Do?** → **Where Do I Start? (Reading Order for This Project)**, or
the Docs Inbox's **…** menu. A page lists, in order, the README, how the parts fit, the design, the specs, recent
decisions, plans still in progress and runbooks: only docs that exist, each with one line on why to read it. Click a
title to open it.

**Tidy a folder with your agent:** in the Docs Inbox, hover over a group (for example **Worth reading first**) →
click its sparkle icon → **Tidy these docs**. Your agent proposes what is current, out of date, duplicated or misplaced, and changes nothing
until you agree.

## 11. Review and your AI agent

**What it does:** lets you review a doc section by section, and hands good prompts to the AI agent you already use
(the prompt is copied, with a message "Prompt copied — paste it into your AI agent": Claude Code, Codex, Copilot,
Cursor… — whichever you use. To open it in Copilot Chat instead, set **Agent Target** to **auto**).

**Try it:** in the preview, click the **⋯** next to a heading → **Ask a question…** → type a question. Then
`Ctrl+Shift+P` → **Send My Review to My AI Agent**.

**What you should see:** your agent receives one prompt with every section you marked and your notes. The **⋯** at
the top of the page offers ready prompts: explain, challenge, find risks, turn into tasks, summarise, make slides,
tidy the formatting, continue this plan…

**Comment on any words:** select text in the preview → **Comment** → type your comment (for example "use Postgres
here, not SQLite"). The words get a dashed underline and a small ✎; point at them to read your comment, click them to
delete it. **Send My Review to My AI Agent** sends every comment with the words it is about, like a review on GitHub.
Comments stay on this computer until you send them.

**Copy for my AI:** **⋯ Ask my AI agent** → **Copy for my AI…** → tick the linked docs to add → Enter. This doc and
those docs are copied as one text (template hints left out), and docmap tells you its size ("about 3,000 words"), so
you can paste it into any AI chat.

## 12. AI that uses your own model

**What it does:** instead of handing a prompt to your agent, your **own** model in VS Code (e.g. GitHub Copilot)
writes the answer on a page next to your doc. **Off by default.** docmap has no AI and no servers of its own.

**Try it** (needs GitHub Copilot in VS Code): Settings → search **docmap answer with my model** → turn it on. In the
preview, **⋯ Ask my AI agent** → **Ask my AI agent about this file…** → **Summarise this file**.

**What you should see:** VS Code may ask once whether docmap can use your model, and docmap asks once what it will
send. Then a page **AI — Summarise this file** fills in, naming the model that answered. Prompts that change files
(like "Turn this into a checklist") still go to your agent.

## 13. Tools for your AI agents

**What it does:** your AI agent can ask docmap for your plans, open questions, a doc's outline, and docs that don't
match the code. **Off by default.** Runs on your computer, only reads.

**Try it in Copilot:** Settings → search **docmap ai tools** → turn on. Open Copilot Chat in **Agent** mode and type:
`#docmapPlans which plans are overdue?`

**Try it in Claude Code, Cursor and others:** **What Can docmap Do?** → **Set Up docmap Tools for My Agent (MCP)…** → pick
your agent → follow the copied instructions. Then ask your agent: "use docmap to list my plans".

**What you should see:** the agent answers using docmap's table of your plans.

**One rule file for every agent:** keep your rules in `AGENTS.md`, then **What Can docmap Do?** → **Point Other AI Tools to
AGENTS.md…**. Tick the files to add: `CLAUDE.md` (Claude Code), `.github/copilot-instructions.md` (Copilot),
`GEMINI.md` (Gemini, Antigravity). A missing file is created with one pointer line. **Your existing files are never
replaced:** one marked line is added at the end, only if you tick that file, and left unsaved so you can check it or
undo. Files that already mention AGENTS.md are left alone.

## 14. Reading, writing and sharing

| Want to | Do |
| --- | --- |
| Read faster | `s` shows only the first line of each section; `1` `2` `3` `0` show heading levels |
| Find in the outline · in the text | `/` · `Ctrl+F` |
| Change the look | `Ctrl+Shift+P` → **Choose Reading Look** (themes, text size, width) |
| Highlight · comment | Select text in the page → **Highlight** or **Comment** |
| Open a file or function the doc names | Click its name in the page (dotted underline): it opens beside the doc |
| Run a command from the doc | Point at a shell block → **▶ Terminal**: the command goes into the terminal; you press Enter (several lines: VS Code asks first) |
| Find any command | **⋯ Ask my AI agent** → **What can docmap do?**, the Docs Inbox **⋯**, or `Ctrl+Shift+P` → **What Can docmap Do?** |
| Slides | Separate sections with a line `---` → **⋯ Ask my AI agent** → **Show as slides** (in the browser page: **▶ Slides**) |
| Bold · italic · strike | `Ctrl+B` · `Ctrl+I` · `Alt+S` in the editor |
| Tables · contents | **Format Table** · **Insert / Update Table of Contents** |
| Share | In the tab's **⋯** menu: **Open Preview in Browser** · **Export as HTML…** · **Export as PDF (Print)…** |
| Number headings | Setting **Heading Numbers** |

## 15. New docs from templates, and restructuring old ones

**What it does:** starts a new doc in a shape every feature here reads well, or asks your AI agent to reshape an
existing one. Shapes: Vision, Scope, Plan, Architecture, Feature spec, Design doc, Ticket, Decision record, Runbook,
Design system (DESIGN.md), Test plan, Postmortem, Release notes, Agent guide (AGENTS.md, with a **Never do** section
for the agent's hard rules), Structure.

**The list is short:** your team's own templates first (a `template.md` in its decisions folder, or
`docs/templates/<kind>.md`), then five known formats: MADR, Nygard ADR, RFC (Rust style), GitHub Spec Kit and Keep a
Changelog. Each has one line on what it is for and a **↗ read more** button. MADR and Spec Kit give docmap's full
template in that format (owner / status at the top, a hint under each section); the others write their section
headings only. **More doc types…** opens docmap's other shapes (each format is listed once).

**You choose where it goes:** after the title, docmap shows where the doc will be saved (for example
`docs/decisions/0002-use-redis.md`). Change the folder or the name, or just press Enter. Or right-click a folder in
the Explorer → **New Doc from Template Here…** to put it in that folder.

**Try it (known format):** `Ctrl+Shift+P` → **New Doc from Template…** → **Nygard ADR** → title `Use Redis`.

**What you should see:** a new doc with `# Use Redis` and four empty sections: Status, Context, Decision,
Consequences.

Credit: these formats' section names come from MADR (MIT or CC0), Michael Nygard's ADR (copyright waived), the Rust
RFC template (MIT or Apache-2.0), GitHub Spec Kit (MIT) and Keep a Changelog (Olivier Lacan, MIT). No text is copied.

**Try it (new doc):** `Ctrl+Shift+P` → **New Doc from Template…** → **More doc types…** → **Plan** → title
`Checkout rollout`.

**What you should see:** `docs/plans/checkout-rollout.md` opens with owner / status / created at the top and the
sections from In short to Open questions, each with a grey hint (`<!-- … -->`) that the preview hides. An existing
file is opened, never replaced. A decision record, design doc, spec or runbook goes in the folder your team already
uses, numbered like its neighbours (e.g. `docs/decisions/0002-….md`), in your team's template
(`docs/templates/<kind>.md`) when there is one.

**Try it (existing doc):** in any preview, **⋯ Ask my AI agent** → **Ask my AI agent about this file…** →
**Make this easy to read**.

**What you should see:** your agent gets a prompt to lay the doc out cleanly — a status box at the top, clear
sections, real lists and tables, readable link names, long logs folded — keeping every fact, deleting nothing, and
writing "not stated" instead of guessing. Afterwards, **⇆ Compare… → The last commit** shows exactly what changed.
(Since 3.2 this one prompt replaces "Restructure into a clear doc" and "Tidy this file's formatting".)

**Two more in the same list, shown only when they fit:**
- **Build from this doc** (design docs, specs, architecture docs): your agent builds exactly what the doc says, then
  lists anything it had to change, assume or leave out, and why. The doc itself is not edited. Each time it picks
  between options the doc doesn't settle, it writes a short decision record (Context, Options considered, Decision,
  Why) in your decisions folder, so the reasons are kept.
- **Fill in this doc** (a doc with empty sections, e.g. a new one from a template): your agent keeps every heading,
  fills the empty ones from the code, and puts anything it is unsure of under **Open questions**.
- **Does the code still match this design?** (design docs, specs, architecture docs): your agent compares the doc
  with the code and, for each difference, says which side looks wrong and the fix. It changes nothing until you agree.

**Write Doc Map for Agents** also opens with a **Before building** line when the project has design docs, so your
agent reads them before it codes.

**The rules the templates and the prompt follow:**
- One purpose per doc; one `#` title; an **In short** first section that makes sense on its own.
- Specific headings, no skipped levels, no hand-typed numbers (turn on **Heading Numbers** instead).
- Owner, status and dates at the top; dates as `2026-12-01`; tasks as `- [ ]`; statuses as one word in a table.
- `Decision:` lines with the reason; an **Open questions** section; every number sourced or marked (proposed).

## Settings

Settings → search **docmap**. They come in groups: the main ones, **Reading look**, **Docs Inbox**, **AI**, and
**Advanced** (rarely needed). The ones you may want to change:

| Setting | What it does | Default |
| --- | --- | --- |
| Clean View | Neat layout for AI-written Markdown | On |
| Code Lens | "📄 Mentioned in N docs" in code files | On |
| My Names | Your names and @handles, for My Items and sign-off | git user name |
| AI: Answer With My Model | Your own model answers on a page | Off |
| AI: Tools | Tools for your AI agents | Off |
| Agent Target | Where prompts go: copied to paste into any agent, or **auto** (Copilot Chat when there is one) | clipboard |
| Theme · Font Scale · Line Width | Reading look | VS Code · 1 · normal |

## Privacy

- No accounts, no tracking, no servers.
- What docmap remembers stays on your computer. Browser page copies and the reading place of deleted files are
  removed by themselves at start; highlights, notes and read marks never are. To remove any of it, run **Clear
  docmap's Saved Data…** from the Command Palette, tick what to remove and confirm.
- Your document text leaves your computer only with **AI: Answer With My Model** on, to your own model, after you
  agree.

## Something not working?

Warning: right after an update, if the Docs Inbox is missing, run `Ctrl+Shift+P` → **Developer: Reload Window**.

Report a problem: https://github.com/kish21/docmap-media/issues
