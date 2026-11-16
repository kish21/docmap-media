# Help: everything All-in-One Markdown Viewer does

> [!TIP]
> Open this page any time: `Ctrl+Shift+P` → **All-in-One Markdown Viewer: Help (All Features)**. Every command
> below is in that same list — type a few words of its name.

The short version: open a `.md` file and press `Ctrl+Alt+V` (`Cmd+Alt+V` on a Mac). Your Markdown becomes a page with a
clickable outline. Everything else on this page builds on that.

## Contents

| Area | What it helps with | Section |
| --- | --- | --- |
| Read | Turn any Markdown file into a page you can find your way around | [Read](#read) |
| Trust | See which paragraphs no longer match your code or other docs | [Trust](#trust) |
| Clean view | Make AI-written Markdown look tidy without changing it | [Clean view](#clean-view) |
| Plans | Readiness, dashboard, open questions, my items, sign-off | [Plans](#plans) |
| Changes | See what changed, right on the page | [Changes](#changes) |
| Docs Inbox | Get through hundreds of Markdown files | [Docs Inbox](#docs-inbox) |
| Review and AI | Review a doc; use your own AI agent or model | [Review and AI](#review-and-ai) |
| Write and share | Writing keys, tables, export, browser | [Write and share](#write-and-share) |

## Read

Step 1: Open any `.md` file.

Step 2: Click **Show Preview** at the top right of the editor, or press `Ctrl+Alt+V` / `Cmd+Alt+V`. The same tab
becomes the page, at the section you were looking at.

Step 3: Click a heading in the outline on the left to go to it. Press the same key again to edit.

- **Open Preview to the Side:** the page next to your file, following it as you type and scroll.
- **Open Preview in Browser:** the page in your web browser; linked Markdown files open as pages too.
- **Always open as a preview:** right-click a Markdown tab → **Reopen Editor With…** → **Configure default editor
  for '\*.md'…** → **All-in-One Markdown Viewer (preview)**.

**In the outline:** `/` filters headings · `↑` `↓` move · `←` `→` fold · `Enter` goes there · drag the edge to
resize · `Ctrl+F` finds text in the page.

**Reading tools** (on by default): `s` quick read (first lines only) · `1` `2` `3` `0` show heading levels ·
reading time per section · structure hints for files without real headings.

**Key points** at the top of the page: an **In short** summary, tasks done, decisions and warnings, and what changed
since you last read the file (**Mark as read** clears it).

**Also:** diagrams (` ```mermaid `), tables, pictures (click to zoom), task lists, note boxes, footnotes; copy
buttons on code; highlights (select text → **Highlight**); slides (sections between `---` lines → **▶ Slides**);
your place is remembered per file.

**Reading look:** **Choose Reading Look (Theme, Text Size, Width)…** — themes VS Code, Paper, GitHub, Night, Focus.

## Trust

Markdown written months ago — or by an AI five minutes ago — can be wrong. A marker in the left margin tells you,
per paragraph:

| Marker | Means | Checked how |
| --- | --- | --- |
| ✗ doesn't match | It names a file, function, command, setting or version that is not in your code | Against your repository, on your computer |
| ⇄ conflicts | Another doc states the same fact differently | Against your other Markdown files |
| ⚠ may be stale | A file it names changed after the paragraph was written | Git history (trusted folders only) |
| ↺ superseded | A newer, near-identical doc exists | Docs Inbox |
| ✓ verified | You checked it | Your own mark |

- **Hover** a marker to read why. **Click** it to mark the paragraph verified or wrong, or to ask your AI agent to
  verify it against the code.
- **Hover** any paragraph and click the faint dot to check one that has no marker.
- Key points count them (**✗ 2 don't match the code**); click the count to jump to the first one.
- **📄 Mentioned in N docs** appears above a code file your docs talk about — click to open the doc at that line.

Note: editing a paragraph clears your ✓ or ✗ on it, because what you checked is no longer what is written.

## Clean view

On by default. It lays AI-written Markdown out neatly on the page — **the file is never changed**:

- "**Owner:** Priya" bullets → a card · front matter → a header card
- "Note:", "Warning:", "TL;DR:" lines → note boxes
- "Step 1:" lines and how-to lists → a stepper
- status words (done, in progress, blocked) → coloured chips; numbers right-aligned in tables
- checklists → a progress bar · dates and @people → chips · code → colours

**Show as written** (top of the page) switches it off; **✨ Clean view** switches it back. Optional: setting
**Heading Numbers** numbers headings 1, 1.1, 1.2. Want the file itself tidied? **Ask my AI agent → Tidy this file's
formatting**.

## Plans

**Ready N/10** appears on any doc that reads as a plan (by its name, its title, or its contents). It checks ten
parts: goal, scope, owner, steps, rollout, risks, testing, rollback, timeline, open questions.

Step 1: Click **Ready 7/10** to see which parts are there (click one to go to it) and which are missing.

Step 2: Choose a missing part — or **Fill all gaps** — and the "Make this plan ready" prompt goes to your agent. It
writes a TODO instead of guessing an owner or a date.

**Plans Dashboard** (also the dashboard icon on the Docs Inbox): every plan as one row.

| Column | Shows |
| --- | --- |
| Progress | Tasks done of total |
| Status | done, in progress, not started, stale, blocked — plus the plan's own `status:` |
| Ready | The readiness score |
| Owner | From front matter, "Owner:" lines and @mentions |
| Next date | The next date in the plan, or ⚠ overdue |
| Questions · Risks · Decisions | Counts |

**Plans Dashboard: Sort, Export or Ask My Agent…** sorts it five ways, saves it as Markdown or CSV, or asks your
agent for a status report of every plan.

- **Open Questions (Every Doc):** every open question, by file — lines ending in "?", "Question:" lines, items under
  an "Open questions" heading.
- **My Items:** open tasks and questions that name you. Set **My Names** (e.g. `Priya`, `@priya`); empty uses
  git's user name.
- **Outline badges:** ☐ open tasks, ? questions, ✗ paragraphs to check, beside each heading.
- **Sign off this version** (the **⋯** menu at the top of the page): writes `signed-off-by: Name date #fingerprint`
  into the file's front matter and saves. The page shows **✓ Signed off by …**, or **⚠ Changed since … signed off**
  once the file changes.
- **Open Decision Log:** every "Decision:" line across your docs on one page.

## Changes

**⇆ Compare…** at the top of the page (or **Show Changes on the Page**) marks what changed — on the rendered page,
not in a code diff:

| Compare with | When to use it |
| --- | --- |
| The version I last read | "What changed since I looked?" |
| The saved file | See your unsaved edits |
| The last commit | Before you commit |
| A week ago · a tag · a git version | Catch up after time away; review a release |

New words are underlined, removed words struck through, added paragraphs get a green bar, removed paragraphs come
back struck through. The bar at the top counts them, offers **Summarise** (your agent explains the changes) and
**Stop comparing**.

## Docs Inbox

In the Explorer sidebar. Every Markdown file in your folder, sorted like an email inbox:

- **Changed since you read** · **New — not opened yet** · **Worth reading first**
- **Plans in progress** · **Possible duplicates** (with compare) · **Probably out of date**
- **Doubtful — check before you trust** (paragraphs that don't match the code, or conflict)
- **Agent instruction files** (AGENTS.md, CLAUDE.md, Copilot and Cursor rules) · **Decision log**

Right-click or use the icons to mark as read, ask your agent about a group, move to an archive folder, or compare
duplicates. Setting **Stale Days** decides "out of date" (90 days).

## Review and AI

docmap has **no AI of its own and no servers**. It works with yours, at the level you choose:

| Level | What happens | Default |
| --- | --- | --- |
| 0 — hand over | docmap writes the prompt; it opens in Copilot Chat, or is copied for Claude Code, Cursor, Antigravity… | on |
| 1 — answer with my model | Questions that only need an answer are answered by your model in VS Code, on a page | off |
| 2 — tools for agents | Your agent can ask docmap for plans, readiness, questions, outlines, doc-vs-code problems | off |

**Review a doc:** click **⋯** beside a heading → approve, ask a question, or request a change. **Send My Review to My
AI Agent** turns your marks into one prompt.

**Ask my AI agent** (the **⋯** at the top, or a heading's **⋯**): explain, challenge, find risks, make tasks, write
tests, summarise, brief me on changes, continue the plan, make slides or a one-pager, fix the structure, tidy the
formatting, make this plan ready… **Add Markdown Prompts to This Project** saves them as Copilot prompt files and
Claude Code commands.

**Level 1 — Answer With My Model** (setting): summarise, explain, challenge, find risks, make tasks, verify a
paragraph and summarise changes are answered on a page by your own model (Copilot, or any model VS Code offers;
setting **AI: Model** picks one). docmap asks before the first send and names what it sends. Prompts that change
files still go to your agent.

**Level 2 — AI: Tools** (setting): five tools — plans dashboard, open questions, plan readiness, doc outline, check a
doc against the repo.

Step 1: Turn on **AI: Tools**.

Step 2: In Copilot Chat (agent mode), type `#docmapPlans`, `#docmapReadiness`… For Claude Code, Cursor and others,
run **Set Up docmap Tools for My Agent (MCP)…** and follow the copied instructions.

Note: the tools run on your computer, only read Markdown files in your project, and never go online.

## Write and share

- `Ctrl+B` bold · `Ctrl+I` italic (VS Code only; your agent keeps it in Cursor and others) · `Alt+S` strikethrough
- **Enter** continues lists and checklists · **Format Table** lines up columns · **Insert / Update Table of
  Contents**
- **Export as HTML…** (one file that works anywhere) · **Export as PDF (Print)…**
- **Open Preview in Browser** to share or print the page

Setting **Writing Helpers** turns the keys off (they also step aside when Markdown All in One is installed).

## Settings

Search **docmap** in Settings.

| Setting | Default |
| --- | --- |
| Reading Tools · Remember Place · Diagrams · Writing Helpers · Clean View · Code Lens | On |
| Heading Numbers · AI: Answer With My Model · AI: Tools | Off |
| Theme · Font Scale · Line Width | VS Code · 1 · normal |
| Stale Days | 90 |
| Agent Target | auto (chat when there is one, else clipboard) |
| My Names · AI: Model | empty |
| Large File Bytes · Update Debounce Ms · Infer Headings | 5 MB · 300 ms · auto |

## Privacy

- No accounts, no tracking, no servers.
- Stored on your computer only: your reading place, marks, highlights, checks, and each file's text as you last read
  it (for Compare).
- Git is only read, and only in folders you trust.
- Document text leaves your computer only with **Answer With My Model** on, to your own model, after you agree.

## Problems or ideas

Warning: after updating, if the Docs Inbox is missing, run **Developer: Reload Window**.

Open an issue: https://github.com/kish21/docmap-media/issues
