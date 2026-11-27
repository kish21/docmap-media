# All-in-One Markdown Viewer

**Click once. Your Markdown becomes a page you can actually read.**

📖 **Help website — every feature, where to find it, with pictures:** https://kish21.github.io/docmap-help/

Markdown files get long and hard to follow: READMEs, docs, specs, and the plans AI tools write. VS Code's own
preview opens in a second tab and gives you no way to find your way around. This one doesn't:

- **Same tab.** The file turns into a clean page right where it is. Click again to edit. No second tab, no
  switching back and forth.
- **Table of contents you can click.** Every heading on the left, the one you are reading highlighted. Jump
  anywhere in one click.
- **Always up to date.** The page changes as you type.
- **Everything shows properly.** Diagrams, tables, pictures, task lists, notes and footnotes.
- **Read it anywhere.** Open it in your browser, print it, or save it as a PDF.
- **Know what to trust.** Paragraphs that no longer match your code, contradict another doc or may be out of date
  are marked in the margin.

![A long Markdown file turned into a page with a clickable table of contents](https://raw.githubusercontent.com/kish21/markdown-docmap/main/screenshot.png)

Free. No setup, no account. It never changes your files unless you ask it to, and it collects nothing. AI features
use **your own** model or agent, and only when you switch them on. See [SECURITY.md](SECURITY.md) for the full
security architecture, file-access guarantees, and enterprise configuration guide.

**All features, with pictures:** <https://kish21.github.io/docmap-help/> — or in VS Code, `Ctrl+Shift+P` →
**All-in-One Markdown Viewer: What Can docmap Do?**

## Use docmap everywhere

| Surface | What it does | How to start |
| --- | --- | --- |
| **VS Code Extension** | Same-tab preview, clickable outline, Clean View, Trust markers, Docs Inbox, Plans Dashboard, Compare, Slides, Export | Install from VS Code Marketplace / Open VSX, press `Ctrl+Alt+V` |
| **Chrome Extension** | Read local `.md` files, `raw.githubusercontent.com`, and GitHub READMEs with Clean View, Slides, local review & highlights → Copy for AI, and Mermaid diagrams | Load Chrome MV3 extension (enable *Allow access to file URLs* for local `.md`) |
| **Standalone MCP Server** | 6 read-only local tools (`plans`, `open_questions`, `decisions`, `search`, `outline`, `check_doc`) for Claude Desktop, Claude Code, Cursor & Antigravity — no VS Code needed | `npx -y docmap-mcp /path/to/project` |
| **Agent Skill (`SKILL.md`)** | Teaches your AI agent to inspect outlines, search docs, and check plans/decisions before loading long files | `npx -y docmap-mcp --install-skill` |

## How to use it

1. Open any Markdown (`.md`) file.
2. Click **Show Preview** at the top right of the editor (or press `Ctrl+Alt+V`, `Cmd+Alt+V` on a Mac). The same tab
   now shows the page, at the section you were looking at. No second tab.
3. Read. Click any heading in the outline to go to it.
4. Want to edit? Click **Show Source** (same button, same keys). The tab shows the Markdown again, at the section you
   were reading.

Two more buttons sit next to it:

- **Open Preview to the Side**: the page opens next to your file and follows it as you type and scroll. Click a
  heading and the file jumps there.
- **Open Preview in Browser**: the page opens in your web browser and **follows your edits as you type** — no need
  to press the button again. The Markdown files it links to open as pages too, so its links work in the browser.
  The page is served only to your own computer, behind a private link. To save a copy you can keep or share
  instead, turn off `docmap.liveBrowser`.

**Always open Markdown as a preview:** right-click a Markdown file's tab, choose **Reopen Editor With…**, then
**Configure default editor for '\*.md'…** and pick **All-in-One Markdown Viewer (preview)**. To go back, do the same and pick
**Text Editor**.

## New in 3.0

### Know which docs you can trust
- **Trust markers** in the margin: **✗** the paragraph names a file, function, command, setting or version that is
  not in your code · **⇄** another doc says something different · **⚠** a file it names changed since it was written
  · **↺** a newer copy exists · **✓** you checked it. Hover to see why; click to mark it right or wrong, or ask your
  AI agent to check it against the code.
- **📄 Mentioned in N docs** above a code file that your docs talk about — one click opens the doc at that line.
- **Before you commit:** the status bar says **N docs mention files you changed** — open each one, or hand your AI
  "update this doc to match my change".

### Read AI-written Markdown comfortably
**Clean view** (on by default) tidies the page without touching the file: "**Owner:** Priya" bullets become a card,
"Note:" lines become note boxes, "Step 1:" lines a stepper, status words coloured chips, checklists get a progress
bar, code gets colours. **Show as written** switches it off.

### Plans: where do they stand?
- **Plans Dashboard**: every plan, grouped by folder — progress, status, owner, next date or overdue, open
  questions, risks. Only the columns your project fills; without an owner, the last git author shows. Then: what
  needs attention, dates coming up, plans that name files no longer in the code, what changed this week, open
  questions and decisions. A 🌐 beside each plan opens it in the browser. Sort it, save it as Markdown or CSV.
- **Home** — one page with what is being worked on and what is next, what's open (questions waiting for an answer,
  tasks that name you), hard-to-read docs, docs out of date with the code, and every feature.
- **Badges in the outline** show open tasks, questions and paragraphs to check, per section.
- **Sign off this version**: your name and date go into the file; the page warns when it changes afterwards.

### See what changed, on the page
**⇆ Compare…** marks changes right on the page: since you last read it, your unsaved edits, the last commit, a week
ago, a tag or any version in git. New words underlined, removed words struck through. Ask your AI agent to sum up
the changes.

### AI: always yours, never ours
docmap has no AI of its own and no servers. By default it writes the prompt and hands it to your agent (Copilot
chat, or the clipboard for Claude Code, Cursor and others). Two more levels, **off until you turn them on**:
- **Answer with my model** — questions that only need an answer ("summarise this", "find the risks") are answered
  by your own model in VS Code (e.g. Copilot) on a page next to your doc. docmap asks before the first send.
- **Tools for agents** — your agent can ask docmap for your plans, open questions, outlines and
  doc-vs-code problems: in Copilot agent mode, and in Claude Code, Cursor and others through a small server that
  runs on your computer (**Set Up docmap Tools for My Agent**).

## New in 2.0

### Docs Inbox: get through hundreds of Markdown files
In the **docmap** Activity Bar sidebar, **Docs Inbox** sorts every Markdown file in your folder:
- **Changed since you read** and **New** (added in the last 7 days, not opened), like an email inbox. Tool folders
  (names starting with a dot, such as `.agents`) are left out; each group shows 10 files, then **Show all**.
- **Worth reading first**: files with open tasks, decisions, warnings, or that other docs point to.
- **Plans in progress**: how many tasks are done in each plan.
- **Possible duplicates**: files that say mostly the same thing, with a side-by-side compare.
- **Probably out of date**: not changed for months, every task done, or mentioning files that no longer exist.
- **Agent instructions**: your `AGENTS.md`, `CLAUDE.md`, Copilot and Cursor rules, together.
- **Decisions**: every "Decision:" line across your docs, on one page.

Hover a file or group for **Ask my AI agent** (sparkle icon), **✓ Mark as read** and **Move to archive** (nothing is deleted).

### Review AI plans, and send the review to your own AI agent
Hover a heading in the preview and click **⋯**: approve a section, ask a question or request a change. When you are
done, **Send my review to my AI agent** turns your marks into one clear prompt. The same menu can ask your agent to
**explain**, **challenge**, **find risks**, **turn into tasks** or **write tests** for that section, or to brief you on
what changed, continue a plan, add a TL;DR, make slides, a one-pager, a checklist or a README.

It works with the agent you already use: the prompt is copied, ready to paste into Claude Code, Codex, Copilot,
Cursor, Antigravity or any other (setting **Agent Target** → **auto** opens it in Copilot Chat instead). This extension runs no AI and sends nothing anywhere.
**Add Markdown Prompts to This Project** saves the prompts as commands your agent picks up
(`.github/prompts`, `.claude/commands`).

### Enjoy reading
- **Key points** at the top: the doc's TL;DR, tasks done, decisions, warnings, and what changed since you last read it.
- **What changed** sections are marked in the page and the outline. **Mark as read** when you have seen them.
- **Highlighter**: select text → **Highlight**. Saved on your computer, never in the file. Click a highlight to remove it.
- **Themes**: Paper, GitHub, Night, Focus, or your VS Code colours, plus text size and line width
  (**Choose Reading Look** in the preview's **…** menu).
- **Copy** buttons on code blocks and a reading progress bar.
- **Slides**: a file with `---` lines shows as slides (**⋯ Ask my AI agent** → **Show as slides**, or **▶ Slides** in
  the browser page; then ← → and Esc).

### Write
- `Ctrl+B` bold, `Ctrl+I` italic, `Alt+S` strikethrough; lists and quotes continue when you press **Enter**.
  (Off automatically if Markdown All in One is installed, or with the **Writing Helpers** setting.)
- **Format Table** and **Insert / Update Table of Contents** (right-click in a Markdown file).

### Share
- **Export as HTML…** and **Export as PDF (Print)…** in the preview's **…** menu.

## What you can do

- **Find your way:** the outline shows every heading, and the one you are reading is highlighted. Fold parts of the
  outline, or type `/` to filter it.
- **Resize or hide the outline:** drag the line between the outline and the text to make the outline wider or
  narrower, or drag it all the way left to hide it. The **‹** button hides it too and the small list icon (**Contents**, in the left margin) brings it back
  (**Ctrl+B** / **Cmd+B** in the browser). Double-click the line for the normal width. Your choice is remembered.
- **Search the text:** `Ctrl+F` (`Cmd+F` on a Mac).
- **Live:** the page updates as you type, in the same tab or beside the file.
- **Follow links:** a link to another Markdown file opens that file's page, at the right heading.
- **Pick up where you left off:** open a file's page again, even after restarting VS Code, and it goes back to the
  section you were reading.
- **See all your docs:** **Markdown Files** in the Explorer sidebar lists every Markdown file in your folder with its
  headings. Click one to open it.
- **Diagrams:** ` ```mermaid ` blocks are drawn as diagrams.
- **README pictures and HTML:** pictures added with HTML (`<picture>`, `<img>`) show, in the light or dark
  version that matches your theme. Fold-out sections, keyboard keys and other simple HTML show too.
- **Print or save as PDF:** open the page in your browser and print it. You get the document alone, dark text on
  white, with every section open.
- **Themes:** the page uses your VS Code colours, light, dark and high contrast. The page opened in your browser has
  its own **Light / Dark** switch.

### Reading tools (on by default)

- **Reading time:** each outline entry shows how long its section takes to read, for example **4 min**. Hover over
  it for the word count.
- **Quick read** (key `s`): each section shows only its heading and first paragraph. Click one to read all of it.
- **Levels** (keys `1`, `2`, `3`, or `0` for all): show the document down to one heading level.
- **Structure hints:** in notes with few real headings, lines that act as headings (a line of **bold text**, or a
  numbered line like `2.1 Title`) appear in the outline in italics.
- **GitHub extras:** note boxes (`> [!NOTE]`), task lists (`- [ ] item`) and footnotes show formatted.

Prefer a plain outline? Turn off **Reading Tools** in Settings.

## Settings

To change them: open the Extensions view, click the **gear icon** on All-in-One Markdown Viewer and choose **Settings**.
Or open **File → Preferences → Settings** (Mac: **Code → Settings**) and search for **docmap**. Each setting shows as
*Docmap: …*. They come in groups; the rarely needed ones are under **Advanced**.

| Group | Setting | What it does | Default |
| --- | --- | --- | --- |
| Main | Reading Tools | Quick read, levels, reading times and structure hints. | On |
| Main | Writing Helpers | Bold / italic keys and lists that continue on Enter. | On |
| Main | Code Lens | **📄 Mentioned in N docs** above code files your docs name. | On |
| Main | My Names | Your names and @handles, for **My Items** and sign-off. | git's user name |
| Reading look | Theme · Font Scale · Line Width | The reading look of the preview. | VS Code colours · 1 · normal |
| Docs Inbox | Skip Folders · Include Folders | Folders the doc lists leave out, or keep after all. | — · `.github` |
| AI | Agent Target | Where AI prompts go: copied to paste into any agent, or the editor's chat when there is one. | clipboard |
| AI | AI: Answer With My Model | Answer questions with your own model in VS Code. | Off |
| AI | AI: Tools | docmap's tools for your agents (Copilot agent mode and MCP). | Off |
| Advanced | Clean View | Lay AI-written Markdown out neatly on the page (the switch on the page does the same). | On |
| Advanced | Heading Numbers | Number the headings in the page (1, 1.1, 1.2…). | Off |
| Advanced | Diagrams | Draw ` ```mermaid ` blocks as diagrams. | On |
| Advanced | Infer Headings | When structure hints show up: only in files with few headings, always, or never. | Only in files with few headings |
| Advanced | Remember Place | Go back to the section you were reading when you open a file's page again. | On |
| Advanced | Live Browser | **Open in browser** shows a live page that follows your edits. | On |
| Advanced | Large File Bytes | Files bigger than this ask before they open. | 5 MB |
| Advanced | Stale Days | Docs Inbox: "probably out of date" after this many days without a change. | 90 |
| Advanced | AI: Model | Which model family answers (empty: a Copilot model). | — |

## Keys in the page

| Key | Does |
| --- | --- |
| `Ctrl+Alt+V` / `Cmd+Alt+V` | Switch the tab between preview and source |
| `/` | Filter the outline |
| `Ctrl+F` / `Cmd+F` | Find text in the document |
| `↑` `↓` | Move through the outline |
| `←` `→` | Fold or unfold a heading |
| `Enter` | Go to the heading |
| `s`, `1` `2` `3` `0` | Quick read and levels (with Reading Tools on) |
| `Ctrl+B` / `Cmd+B` | Hide or show the outline (in the browser page) |

## Privacy

No accounts, no tracking, no servers. What docmap remembers stays on your computer, in VS Code's own storage: the
section you were reading, your marks, highlights and checks, and the text of each file as you last read it (for
**Compare**). Git is only read, and only in folders you trust.

Your document text leaves your computer only if you turn on **Answer with my model**, and then only to your own
model through VS Code, after you agree. The tools for agents run on your computer and only read Markdown files.

For a full security & privacy audit summary — including `.env` non-access guarantees, webview CSP, localhost live-server hardening, and corporate lockdown settings — see **[SECURITY.md](SECURITY.md)**.

## Problems or ideas

Open an issue: https://github.com/kish21/markdown-docmap/issues
