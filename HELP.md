# Help: what All-in-One Markdown Viewer does, and how to try each feature

> [!TIP]
> Open this page in VS Code any time: `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`) → type **help** → **All-in-One Markdown
> Viewer: Help (All Features)**. For a guided tour: **Help: Get Started** → **All-in-One Markdown Viewer**.

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
| 4 | [Plan readiness](#4-plan-readiness) | 3.0 |
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

## 1. Preview in the same tab

**What it does:** turns a Markdown file into a readable page, in the same tab, with a clickable outline on the left.

**Try it:** open any `.md` file and press `Ctrl+Alt+V` (Mac: `Cmd+Alt+V`), or click **Show Preview** at the top
right of the editor. Press it again to go back to the text.

**What you should see:** the same tab shows the page, at the section you were looking at. Clicking a heading on the
left jumps to it. The box at the top (**In short**) sums the file up.

## 2. Clean view for AI-written Markdown

**What it does:** AI tools write Markdown with "**Owner:** …" bullets, "Note:" lines and status words. Clean view
shows them neatly. **Your file is never changed.**

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

**Turn it off:** click **Show as written** at the top of the page (click **✨ Clean view** to turn it back on).

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

**Then:** click the ✗ → **Mark as verified** (it turns into ✓), or **Verify this paragraph against the code** to
ask your AI agent. Hover any other paragraph and click the faint dot to check that one.

| Marker | Means |
| --- | --- |
| ✗ | It names something that is not in your code |
| ⇄ | Another doc says something different (e.g. "Port: 8080" here, "Port: 3000" there) |
| ⚠ | A file it names changed after this paragraph was written (needs git) |
| ↺ | A newer, almost identical doc exists |
| ✓ | You checked it and marked it true |

## 4. Plan readiness

**What it does:** for any doc that looks like a plan, checks ten things a plan needs: goal, scope, owner, steps,
rollout, risks, testing, rollback, timeline, open questions.

**Try it:** rename your file to `try-docmap-plan.md` (any name with "plan" works), or use the Payments rollout
example above, and open the preview.

**What you should see:** a chip at the top like **◔ Ready 3/10**. Hover it to see what's missing. Click it:
- parts the plan has → click to go to that line
- parts that are missing → click one (or **Fill all gaps**) and a prompt goes to your AI agent to write them

## 5. Plans Dashboard

**What it does:** one table of every plan in your project: how far along, status, readiness, owner, next date,
open questions, risks.

**Try it:** `Ctrl+Shift+P` → **Plans Dashboard** (or the dashboard icon at the top of the Docs Inbox).

**What you should see:** a page with totals at the top, one row per plan (click a name to open it), and a **Needs
attention** list (overdue, blocked, no owner, low readiness).

**More:** `Ctrl+Shift+P` → **Plans Dashboard: Sort, Export or Ask My Agent…** — sort it, save it as Markdown or a
CSV for a spreadsheet, or ask your agent for a status report of every plan.

## 6. Open Questions and My Items

**What it does:** collects every open question, and everything assigned to you, from all your docs.

**Try it:** add these lines to `try-docmap.md` and save:

```markdown
## Open questions

- Do we keep the v1 endpoint?
- [ ] Ask @priya about the rollout date
```

Then `Ctrl+Shift+P` → **Open Questions (Every Doc)**. For My Items, first set your name: Settings → search
**docmap my names** → add `@priya` (or your own name) → `Ctrl+Shift+P` → **My Items**.

**What you should see:** a page listing the questions by file with line numbers; My Items lists the task that names
@priya. In the preview's outline, the "Open questions" heading shows small counts: **☐1 ?1** (one open task, one question).

## 7. Compare: what changed, on the page

**What it does:** shows what changed in a doc right on the page — new words underlined, removed words crossed out.

**Try it:** open the preview of a file that is committed in git. Change a few words in the text (don't save). Click
**⇆ Compare…** at the top of the page → **The last commit**.

**What you should see:** a bar "**Changes since the last commit:** 1 changed"; your new words underlined in green,
the old ones crossed out in red. **Stop comparing** clears it.

**Other choices:** the version I last read · the saved file · a week ago · a tag · any git version. **✨ Summarise**
asks your AI agent to explain the changes.

## 8. Sign off a version

**What it does:** records "I approve this version" in the file itself, and warns when the file changes later.

**Try it:** in the preview, click **⋯ Review / ask my AI agent** at the top → **Sign off this version…** → type your
name.

**What you should see:** the file gets a line `signed-off-by: Your Name 2026-11-16 #…` at the top, and the page
shows **✓ Signed off by Your Name**. Change any word and save: it becomes **⚠ Changed since Your Name signed off**.

## 9. Docs mentioned in code

**What it does:** in a code file, shows which docs talk about it.

**Try it:** in `try-docmap.md`, mention a real file of your project in backticks, e.g. `` `src/index.ts` ``, and save.
Open that code file.

**What you should see:** a small line at the top of the code file: **📄 Mentioned in 1 doc**. Click it to open the doc
at that line. (Turn off: setting **Code Lens**.)

## 10. Docs Inbox

**What it does:** sorts every Markdown file in your project like an email inbox.

**Try it:** open the Explorer (left sidebar) → **Docs Inbox** section.

**What you should see:** groups such as **Changed since you read**, **New — not opened yet**, **Worth reading
first**, **Plans in progress**, **Possible duplicates**, **Probably out of date**, **Doubtful — check before you
trust**. The icons at the top open the Plans Dashboard, the Decision log and this help.

## 11. Review and your AI agent

**What it does:** lets you review a doc section by section, and hands good prompts to the AI agent you already use
(Copilot Chat in VS Code; in Cursor, Antigravity and others the prompt is copied for you to paste).

**Try it:** in the preview, click the **⋯** next to a heading → **Ask a question…** → type a question. Then
`Ctrl+Shift+P` → **Send My Review to My AI Agent**.

**What you should see:** your agent receives one prompt with every section you marked and your notes. The **⋯** at
the top of the page offers ready prompts: explain, challenge, find risks, turn into tasks, summarise, make slides,
tidy the formatting, make this plan ready…

## 12. AI that uses your own model

**What it does:** instead of handing a prompt to your agent, your **own** model in VS Code (e.g. GitHub Copilot)
writes the answer on a page next to your doc. **Off by default.** docmap has no AI and no servers of its own.

**Try it** (needs GitHub Copilot in VS Code): Settings → search **docmap answer with my model** → turn it on. In the
preview, **⋯ Review / ask my AI agent** → **Ask my AI agent about this file…** → **Summarise this file**.

**What you should see:** VS Code may ask once whether docmap can use your model, and docmap asks once what it will
send. Then a page **AI — Summarise this file** fills in, naming the model that answered. Prompts that change files
(like "Turn this into a checklist") still go to your agent.

## 13. Tools for your AI agents

**What it does:** your AI agent can ask docmap for your plans, their readiness, open questions, a doc's outline, and
docs that don't match the code. **Off by default.** Runs on your computer, only reads.

**Try it in Copilot:** Settings → search **docmap ai tools** → turn on. Open Copilot Chat in **Agent** mode and type:
`#docmapPlans which plans are overdue?`

**Try it in Claude Code, Cursor and others:** `Ctrl+Shift+P` → **Set Up docmap Tools for My Agent (MCP)…** → pick
your agent → follow the copied instructions. Then ask your agent: "use docmap to list my plans".

**What you should see:** the agent answers using docmap's table of your plans.

## 14. Reading, writing and sharing

| Want to | Do |
| --- | --- |
| Read faster | `s` shows only the first line of each section; `1` `2` `3` `0` show heading levels |
| Find in the outline · in the text | `/` · `Ctrl+F` |
| Change the look | `Ctrl+Shift+P` → **Choose Reading Look** (themes, text size, width) |
| Highlight | Select text in the page → **Highlight** |
| Slides | Separate sections with a line `---` → **▶ Slides** |
| Bold · italic · strike | `Ctrl+B` · `Ctrl+I` · `Alt+S` in the editor |
| Tables · contents | **Format Table** · **Insert / Update Table of Contents** |
| Share | **Open Preview in Browser** · **Export as HTML…** · **Export as PDF (Print)…** |
| Number headings | Setting **Heading Numbers** |

## Settings

Settings → search **docmap**. The ones you may want to change:

| Setting | What it does | Default |
| --- | --- | --- |
| Clean View | Neat layout for AI-written Markdown | On |
| Code Lens | "📄 Mentioned in N docs" in code files | On |
| My Names | Your names and @handles, for My Items and sign-off | git user name |
| AI: Answer With My Model | Your own model answers on a page | Off |
| AI: Tools | Tools for your AI agents | Off |
| Agent Target | Where prompts go: chat when there is one, or always the clipboard | auto |
| Theme · Font Scale · Line Width | Reading look | VS Code · 1 · normal |

## Privacy

- No accounts, no tracking, no servers.
- What docmap remembers stays on your computer.
- Your document text leaves your computer only with **AI: Answer With My Model** on, to your own model, after you
  agree.

## Something not working?

Warning: right after an update, if the Docs Inbox is missing, run `Ctrl+Shift+P` → **Developer: Reload Window**.

Report a problem: https://github.com/kish21/docmap-media/issues
