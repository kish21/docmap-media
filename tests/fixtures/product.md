<!--
PRODUCT.md — the living spine of this product.

This single file is the shared memory of the product-playbook skills. Each skill
READS the sections it depends on and APPENDS/UPDATES its own. Read it top-to-bottom
to understand the whole product: what it is, why, what's built, and what's next.

Rules:
- A section that is empty/missing = that phase's exit criteria are not yet met.
- A section whose only content is a dated `_Not run <date>: <what was missing> — run <phase> first._`
  line is STILL empty: that phase was attempted and correctly declined. One line, replaced on the next
  attempt, scaffold untouched (MECHANISMS.md §Declined runs). An `Override <date>:` line is different —
  it is a deliberate skip, and it DOES count as filled.
- Keep entries short and honest. Record HOW something was verified, not just "done".
- **A section is a RECORD, not a container** (PRINCIPLES.md): summary, the decision, the evidence line,
  and a pointer to where the detail lives — STRUCTURE.md, DESIGN.md, docs/adr/*, docs/runbook.md,
  docs/features/*, docs/deployment.md, src/schemas/*. **There is no byte cap** — the test is per field:
  *is this the decision, or the reasoning behind it?* Reasoning moves to the companion; a required field
  answered tightly stays, however many bytes it is. **Never trim to a number.** A spine that holds only
  records stays readable; one that holds reasoning gets grepped instead of read, and a phase that greps
  is how a recorded decision gets missed by the one phase that needed it.
- **A pointer is an instruction to open the file** (MECHANISMS.md §Follow the pointer). Every companion
  is a new place a phase could find a signpost where it needed a definition — which is exactly how one
  phase invented ten types that were already frozen in code.
- Anything explicitly OUT OF SCOPE stays out until the recorded trigger fires.
- Every skill, when it writes back, UPDATES the header line below — bump `Stage:` to its phase
  and set `Last updated:` to today.
-->

# PRODUCT — docmap

_Last updated: 2026-09-23 · Stage: Contracts · AI product? no_
_Playbook: canonical order — Vision, Validate, Scope, Plan, Architect, Structure, Design, Foundation, Contracts done; /tickets next (Entry 2 overridden 2026-09-23 — owner-first)_

## Vision            <!-- /vision --> (the record; see docs/vision.md for the reasoning)
- **Vision (ONE sentence — the world this product creates, not what it does):** No developer loses their
  way in a long document again — any doc in their project opens as a page whose structure is visible at a
  glance.
- **Who it's for:** the owner first; then developers holding long Markdown in their projects — READMEs,
  specs, and the long plans/agent files AI coding tools now write. Second audience: developers who want the
  same rendering inside their own app (library/API).
- **Problem (why now):** raw Markdown becomes unreadable as it grows (structure invisible beyond heading
  levels, no outline while editing, heading-based links break, editors degrade past a few hundred KB).
  **Why now:** AI coding tools are generating long Markdown artefacts at volume, so the amount a developer
  must *read* has risen sharply while reading tools have not moved; a 2026 HN thread names the gap as "a
  massive lack of Markdown viewers".
- **Value proposition:** free and open source, no config, no account. Other free tools *display* Markdown;
  docmap makes a long document **navigable** — sidebar outline, collapsible sections, search, you-are-here
  highlighting — live-updating on save. One engine, several surfaces, **in this order**: (1) a VS Code
  button beside Preview, opening the map in a panel, with an **"open in browser"** option for the same view;
  (2) CLI (`npx docmap`) for reading outside the editor — built after (1), *if needed*; (3) `build` to plain
  HTML for free hosting; (4) import as a library/API.
  _superseded 2026-09-22: surface order was "CLI first, browser tab" — changed by /validate Entry 1
  (standalone viewers 671 installs/wk vs 10.3M for an in-editor Markdown extension). Confirmed by the owner._
- **Current-year market / competitor read (verified, not from memory — every search listed in docs/vision.md):**
  Free/installable: **markserv** (folder → GitHub-styled HTML, live reload — closest prior art),
  **glow** (terminal, v2.1.2 Apr-2026), **grip** (abandoned since 2023-10), **VS Code preview** (free,
  already open — the real competitor), **mdatlas** npm v2.0.0 (browsable web UI over local Markdown —
  **nearest direct competitor**, found during the npm name check), **doclens** npm v1.0.0 (14-format
  embeddable viewer). Paid/hosted, set aside: ApyHub · ConvertAPI · Apify · Mintlify (~$150/mo Growth) ·
  GitBook · Docusaurus (free but React + self-host). **Sharpening insight:** the market splits into
  *converters* and *site generators*; nobody free is optimising for navigating a **single long document**.
  Detail + full search list: `docs/vision.md` §5–6.
- **North star — target + date:** 100 developers other than the owner using docmap weekly by **2027-03-31**.
- **North star — 2–3 input metrics (the numbers that move between events/releases and drive it):** weekly
  npm installs · GitHub stars · issues/PRs opened by people other than the owner (per release, and weekly).
- **North star — 1 guardrail (what must NOT get worse while chasing it):** a 1 MB Markdown file opens in
  under 1 second, **and** the tool never collects user data (no telemetry, ever).
- **North star — instrumentation (how it gets measured; "nothing records this yet" is a finding):** **VS Code
  Marketplace install count (primary)** + npm download statistics + GitHub Insights.
  _updated 2026-09-22 by /validate: the Marketplace publishes per-extension installs, which partly repairs
  the finding below._ **FINDING (still standing) — weekly *usage* cannot be measured directly:** a
  no-telemetry tool cannot observe who opens it; installs over-count (CI, abandoned installs) and
  under-count (vendored copies). The guardrail is what makes it unmeasurable — a deliberate trade.
  Honest-signal options (opt-in feedback link, non-owner issue count) in `docs/vision.md` §8. Revisit at `/plan`.
- **Job-to-be-done (when <situation>, I want to <motivation>, so I can <outcome>):** when I open a long
  Markdown file, I want to see its structure and jump straight to the part I need, so I can understand it
  without scrolling and hunting.
- **Riskiest assumption this depends on:** that developers who **already have** a Markdown preview extension
  will install a **second** extension for an outline sidebar, search and collapsible sections on long files.
  **UNTESTED** — see `#Validation` Entry 2.
  _superseded 2026-09-22 by /validate Entry 1: the prior assumption ("developers will open a separate tool
  outside the editor") was TESTED and answered **no** — 671 installs/wk standalone vs 10.3M in-editor. It is
  settled, not carried._
- **Business model (free / paid / internal):** free and open source.
- **Detail:** `docs/vision.md` (reasoning + workings; this section stays a RECORD)
- **Read (file · date · verbatim quote):** `docs/vision.md` · 2026-09-22 · "the market splits into
  *converters* (give HTML back) and *site generators*"

## Validation        <!-- /validate --> (the record; see docs/validation.md for the raw notes. Append a dated entry per run)

### Entry 1 — 2026-09-22 · desk check · VERDICT: PIVOT (surface)
- **Assumption under test (falsifiable: <user> will <behaviour> because <reason>):** developers with long
  Markdown files **will install and open a standalone viewer**, because their editor's preview is not enough.
- **Experiment (type · who it reaches · time box · due date):** rung 1 desk check — public install counts +
  public complaints · reaches every developer who already chose standalone vs in-editor in the wild ·
  one sitting · ran and completed 2026-09-22.
- **Pass/fail threshold (written BEFORE the result):** PASS = standalone installs **≥ 1,000/wk** AND ≥ 3
  distinct public complaints about navigating long Markdown · PIVOT = < 200/wk with real complaints ·
  KILL = weak installs and < 3 complaints. **Recorded flaw:** the bands leave a gap between 200 and 1,000
  and the result landed in it; the bar was **not** re-drawn after the fact (`docs/validation.md` Entry 1).
- **Measured result (number / quoted evidence · date · raw notes in docs/validation/):** 2026-09-22 —
  `markserv` **671 installs/wk**; `mdatlas` (nearest competitor) **0/wk**; `markdown-preview-enhanced`
  (VS Code) **10,327,473 installs**; `markdown-all-in-one` 659,562 on Open VSX; `docsify-cli` 46,995/wk.
  Complaints side passed (≥ 3 distinct, `docs/vision.md` §3). `evidence: GET api.npmjs.org/downloads/point/last-week/{markserv,mdatlas,docsify-cli} + marketplace.visualstudio.com + open-vsx.org → figures above · docs/validation.md Entry 1 · 2026-09-22`
- **Verdict (proceed / pivot / kill) + one-line reason:** **PIVOT (surface only)** — the pain is real but
  in-editor beats standalone ~1,000×, so docmap ships as a **VS Code extension first** (a Map button beside
  Preview, plus an "open in browser" option), with CLI/`build`/library as the same engine on later surfaces.
  The product, the user and the value proposition are unchanged. Owner-confirmed 2026-09-22.
- **Override (only if skipped: date · reason · "assumption untested" · checked against #Vision):** none —
  the experiment ran.

### Entry 2 — 2026-09-22 · the new riskiest assumption · STATE: untested, proceeding provisionally
- **Assumption under test (falsifiable: <user> will <behaviour> because <reason>):** developers who already
  have a Markdown preview extension **will install a second extension** for an outline sidebar, search and
  collapsible sections, because long files are hard to navigate.
- **Experiment (type · who it reaches · time box · due date):** rung 2 — show a rough working extension on a
  real long file to **3–5 developers** · participants and date **not yet named** (owner has not confirmed
  reach) · run it against the first rough extension, since building it and testing this are the same motion.
- **Pass/fail threshold (written BEFORE the result):** **≥ 3 of 5 say they would install it, unprompted, and
  can name what it saves them.** Below that, the outline is a nice-to-have and the product needs rethinking.
- **Measured result (number / quoted evidence · date · raw notes in docs/validation/):** PENDING.
- **Verdict (proceed / pivot / kill) + one-line reason:** PENDING — **this gate is NOT closed.**
- **Override (only if skipped: date · reason · "assumption untested" · checked against #Vision):**
  **Override 2026-09-23: "We are building for myself and builders comes later I will use it first so
  let's develop this" — bypassed the Entry 2 gate at `/architect`.** Assumption **untested**; the 3-of-5
  test is scheduled in `#Plan` M4. Checked against `#Vision`: consistent — "the owner first".
  _Earlier (2026-09-22):_ **Proceeding provisionally** by owner decision: `/scope` and `/plan` continue with navigation-demand work
  marked as resting on an untested assumption; the mark clears when a result lands. `/drift-check` carries
  this as a standing finding until then.
- **Detail:** `docs/validation.md` (reasoning + workings; this section stays a RECORD)
- **Read (file · date · verbatim quote):** `docs/validation.md` · 2026-09-22 · "the desk check settled
  *where* people are, not *whether they want navigation*" · `docs/vision.md` · 2026-09-22 · "a 2026 Hacker
  News thread frames the gap as a **lack of viewers**"

## Scope             <!-- /scope --> (the record; see docs/scope.md for the reasoning)
- **THE core feature (the one thing):** **In VS Code, open a Markdown file as a map** — a heading outline in
  a side panel, click to jump, highlighting where you are as you scroll. `[rests on untested #Validation
  Entry 2]`
- **In scope (now):** each item → the customer outcome it buys:
  - **Map button in the editor title bar, beside Preview** → one click from any `.md`, nothing to remember.
  - **Heading outline, click to jump** → reach any section in seconds instead of scrolling.
  - **You-are-here highlighting on scroll** → never lose your place in a long file.
  - **Collapse / expand sections** → hide the part you are not reading.
  - **Filter the outline by typing (headings only)** → 60 headings narrow to 3. _Owner call 2026-09-22:
    heading filter, not full text — `docs/scope.md` §3._
  - **"Open in browser" — snapshot** → read the same map full-screen outside the editor; press again after
    edits to refresh. _Owner call 2026-09-22: snapshot, not live — no background server in v1,
    `docs/scope.md` §3._
  - **Updates as you edit (in-panel)** → never showing a stale version.
  - **Keyboard navigation + inherits the user's VS Code theme** → usable without a mouse, and correct in
    dark/high-contrast themes.
  - **Explicit states for no-headings / very large / malformed files** → never a blank panel.
  - **README · MIT licence · "collects nothing, sends nothing" line · issues link** → publishable, and honest.
- **Deferred (out for now + the trigger that would bring it in):**
  - **CLI `npx docmap`** → the extension works and the owner wants it outside VS Code, or a user asks.
  - **`build` to publishable HTML** → someone wants to publish docs with it.
  - **Library / API for other apps** → a developer asks to embed it.
  - **Full-text search** → users say heading filtering is not enough.
  - **Folder-wide map (all docs at once)** → single-file navigation proves itself with real users.
  - **JSON · YAML · OpenAPI · logs** (the original `oneDocAll` idea) → Markdown version passes the 3-of-5
    test in `#Validation` Entry 2.
  - **Mermaid · maths · custom themes** → user requests. _Warning in `docs/scope.md` §5: this is the road
    back to being "another preview"._
  - **Open VSX publishing** → a Cursor/VSCodium user asks.
  - **Live-updating browser view (local server)** → the browser view gets used often enough that
    re-pressing annoys; needs a deliberate port/security design.
- **Non-goals (deliberately never building):** editing Markdown (VS Code does that) · telemetry or analytics
  of any kind (`#Vision` guardrail) · accounts, login, cloud sync, hosting, paid tiers · replacing the
  built-in preview (docmap sits beside it) · AI summarising (`#Vision`: AI product? no — reopening pulls in
  prompt versioning, evals, cost-per-run and the LLM security layer; reversal protocol only).
- **Table stakes (each: in-scope now / Deferred + trigger / N-A + reason — none may be blank):**
  - password reset → **N/A** (no accounts) · email verification → **N/A** (no accounts, no email) ·
    account deletion + data export → **N/A** (nothing is collected; README says so plainly) ·
    empty/loading/error states → **IN SCOPE** · privacy policy + terms → **IN SCOPE (adapted)**: MIT licence
    + one honest line, not a legal document · accessibility baseline → **IN SCOPE** (keyboard, visible focus,
    theme-inherited colours — non-negotiable for a reading tool) · a way to report a problem → **IN SCOPE**
    (GitHub issues; also the only feedback channel the no-telemetry guardrail leaves).
- **Detail:** `docs/scope.md` (reasoning + workings; this section stays a RECORD)
- **Read (file · date · verbatim quote):** `docs/scope.md` · 2026-09-22 · "v1 is not \"a small product\", it
  is **the experiment**" · `docs/validation.md` · 2026-09-22 · "building it and testing the assumption are
  the same motion"

## Plan              <!-- /plan --> (the record; see docs/plan.md for the milestone detail)
- **Phases / milestones (core first):** _Owner-first (owner, 2026-09-23): "building for myself and builders
  comes later — I will use it first"._
  - **M1 — First map:** Map button beside Preview opens a panel with the heading outline; click jumps.
  - **M2 — Daily driver:** you-are-here highlighting · collapse/expand · heading filter · live update ·
    keyboard + theme · no-headings/large/malformed states · installable `.vsix`.
  - **M3 — Owner's week:** "open in browser" snapshot + the owner uses docmap on real docs for a week.
  - **M4 — Share with builders (trigger, not date):** README · MIT · "collects nothing, sends nothing" ·
    issues link → tiny pre-public check → Marketplace publish (`/deploy`) → 3-of-5 test (`#Validation` Entry 2).
    **Trigger:** M3 passes and the owner wants others to have it.
  - Not scheduled (stay in `#Scope` Deferred with their triggers): CLI, `build`, library, full-text search,
    folder map, JSON/YAML, Mermaid/maths, Open VSX, live browser view.
- **Timeline:** start 2026-09-23 · M1 by **2026-09-30** · M2 by **2026-10-07** · M3 by **2026-10-14** · M4 on
  trigger (north-star risk if not fired by **2026-12-31** — `docs/plan.md` §5). No paid infra at any point.
- **Exit criteria per milestone:**
  - **M1:** on `PRODUCT.md`, clicking Map opens a panel listing every heading in order at its level; clicking
    any heading scrolls the editor to that line. Automated: outline-extraction unit test on a fixture.
  - **M2:** all in-scope items work in the owner's own VS Code from the installed `.vsix`; a generated 1 MB
    fixture renders its outline in **< 1 s** (timed test); outline usable by keyboard alone; correct in a
    dark and a high-contrast theme; the three edge states show a message, never a blank panel.
  - **M3:** snapshot opens a self-contained HTML map in the browser; the owner uses docmap on ≥ 5 real
    reading sessions in one week and writes a one-line verdict per session (`docs/validation.md`).
  - **M4:** 1–2 developers each find a named section unaided **before** publishing; the Marketplace listing
    installs on a clean VS Code; Entry 2 gets a measured result (≥ 3 of 5 would install, unprompted).
- **Four-risks row per milestone (value · usability · feasibility · viability — which this milestone retires and how you'll know; cite evidence for one already retired):**
  - **M1:** feasibility — the panel + jump works on a real file. Value (surface) already retired by
    `#Validation` Entry 1.
  - **M2:** feasibility — 1 MB < 1 s guardrail measured · usability (owner-sized) — keyboard, theme, edge states.
  - **M3:** value (owner-sized) — does the owner reach for it in 5 sessions? · usability — owner's verdict lines.
  - **M4:** value — `#Validation` Entry 2 (3-of-5) · usability — pre-public check + 5 unaided attempts ·
    viability — listing live at $0 running cost (`#Vision`: free/OSS; no server, Marketplace free).
- **Usability checkpoint before going public (which milestone, and its exit criterion):** **M4, before
  publishing** — 1–2 developers install the `.vsix` and find a named section unaided. (Owner chose "publish
  first, test after" for the full 3-of-5, with this tiny check added so a usability check still precedes public.)
- **Concern-area coverage (security · ai · observability · DX · testing · infra · docs · product → now/next/later/N-A + trigger):**
  - **security — now:** strict webview Content-Security-Policy, rendered Markdown sanitised, no network,
    no listening port; **next** (`/foundation`): secret-scan + dependency audit in CI.
  - **ai — N/A:** `#Vision` AI product? no (reversal protocol only).
  - **observability — now:** local Output-channel logging of errors only; **N/A** telemetry (guardrail);
    **later (M4):** Marketplace installs weekly + non-owner issues.
  - **DX — now:** README for building/running (owner); **M4:** public README, CHANGELOG; **later:**
    CONTRIBUTING — trigger: first outside PR.
  - **testing — now:** unit tests for outline extraction (M1), 1 MB timing test (M2), extension integration
    test (M2), dark/high-contrast check (M2).
  - **infra — next** (`/foundation`): GitHub Actions CI; **N/A:** database, migrations, containers, backups
    (no stored data; git is the backup).
  - **documentation — now:** ADRs at `/architect`, feature docs per `/build`; `PRODUCT.md` stays the spine.
  - **product — now:** vision/validation/scope done; Entry 2 → M4; north-star review in `/learn` by 2026-12-31.
- **Detail:** `docs/plan.md` (reasoning + workings; this section stays a RECORD)
- **Read (file · date · verbatim quote):** `docs/scope.md` · 2026-09-23 · "v1 is small enough to build, show,
  and abandon" · `docs/validation.md` · 2026-09-23 · "building it and testing the assumption are the same
  motion" · `docs/vision.md` · 2026-09-23 · "the market splits into"

## Architecture      <!-- /architect --> (one line per decision; see docs/adr/* for the ADRs themselves)
- **Stack + tools (and why, 2026 OSS-first):** optimised for one owner · $0 running cost · compatibility
  with VS Code · speed on 1 MB · low lock-in. All rows **user-chosen** (owner approved 2026-09-23).
  - **Kind:** VS Code extension + webview UI (has UI → `/design-system` runs, theme-inherited) — ADR-0001.
  - **Language:** TypeScript (strict), extension host on Node — ADR-0001.
  - **Markdown:** markdown-it 15, `html: false`; heading lines from token maps — ADR-0002.
  - **Webview UI:** plain TypeScript + DOM, no framework; only `--vscode-*` theme variables — ADR-0003.
  - Nothing paid. Detail + search list: `docs/architecture.md`.
- **Data custody (local/self-hosted · managed-serverless · embedded) + why (privacy/cost/portability/lock-in):**
  **user's machine, nothing stored** — reads the open document in memory; writes only the snapshot HTML the
  user asks for. Why: the no-telemetry guardrail. **user-chosen.**
- **Runtime target (container-anywhere · PaaS · VPS · user's machine) — decides what `/structure` scaffolds:**
  **user's machine** for every unit: extension (`.vsix`, VS Code extension host) · webview (inside the
  `.vsix`) · browser snapshot (local HTML file). M4 distribution: VS Code Marketplace (free) via `/deploy`.
  **user-chosen.**
- **Identity custody (self-hosted auth · vendor auth + RLS) — or N/A:** **N/A** — no accounts.
- **Dev tooling (hook runner · secret scanner · task runner · formatter/linter · dependency manifest — `/structure` scaffolds exactly these):**
  lefthook · gitleaks · npm scripts · Biome · `package.json` + `package-lock.json` (npm). Plus esbuild,
  Vitest, `@vscode/test-cli`, `@vscode/vsce` — ADR-0004.
- **Key decisions / ADRs (patterns applied · anti-patterns avoided):** ADR-0001 pure core behind ports ·
  ADR-0002 markdown-it + html off + strict CSP · ADR-0003 vanilla webview + theme variables · ADR-0004 dev
  tooling. Patterns: ports & adapters · typed host↔webview protocol · unidirectional state · debounced
  recompute. Avoided: god `extension.ts` · untyped `postMessage` · parse per keystroke · unsafe `innerHTML`
  · CSP-less webview · hard-coded colours.
- **Externals behind provider/adapter interfaces (+ resilience strategy each):** no network externals.
  `EditorPort` (editor closed → state, never throws) · `MarkdownEngine` (parse error → typed error state) ·
  `BrowserOpener` (fails → show path) · `SnapshotWriter` (fails → message, no partial file).
- **Resilience · perf/cost budget · migrations approach:** debounce edits (setting, 300 ms) · "very large
  file" state above a threshold (setting, 5 MB) · **budget: 1 MB → outline visible ≤ 1 s; parse + render ≤
  400 ms** (probe: 266 + 21 ms; DOM share aspirational until M2's timing test) · **$0** · migrations **N/A**
  (no datastore; settings via `contributes.configuration`). Security: no secrets exist; gitleaks guards anyway.
  Observability: local `LogOutputChannel`, errors only; no telemetry.
- **(AI) prompt-versioning · eval harness · tracing:** **N/A** — `#Vision` AI product? no.

## Structure         <!-- /structure --> (see STRUCTURE.md for the full folder map)
- **Folder → purpose map (summary):** split by **runtime** (three bundles, ADR-0001), then by concern:
  `src/core/{outline,markdown,protocol,config}` (pure, Vitest beside the code) · `src/extension/` (only
  `vscode` importer) · `src/webview/` (only DOM code) · `tests/{integration,fixtures}` · `scripts/` ·
  `docs/adr/`. Hub files: `package.json` · `src/extension/extension.ts` · `src/core/protocol/messages.ts` ·
  `src/core/config/config.ts`. Config adapted: VS Code settings (`docmap.*`) instead of YAML files — a YAML
  file would be dead config (`STRUCTURE.md` §Config). Root scaffolding per ADR-0004: `lefthook.yml` ·
  `.gitleaks.toml` · npm scripts · `package.json` · `.gitignore` (covers `.env*`) · `.env.example`
  (placeholder `VSCE_PAT` only; test datastore N/A) · README · LICENSE (MIT) · SECURITY · CHANGELOG ·
  CONTRIBUTING · `AGENTS.md` (+ `CLAUDE.md` → it).
  `evidence: python3 scripts/check_structure.py -> map and tree agree both ways (14 folders, 4 hub files) - STRUCTURE.md - 2026-09-23`
- **Prompts location (AI):** **N/A** — `#Vision` AI product? no.

## Design             <!-- /design-system --> (UI products only; see DESIGN.md for the full system)
- **Has user-facing UI?** yes — the map panel (and the same page as the browser snapshot).
- **Design principles (4–6, derived from vision):** document is the hero · feels native to VS Code · where
  am I, always · keyboard first · fast over fancy (`DESIGN.md` §1).
- **Archetype (aesthetic family + why it fits):** Terminal-Core / Developer, restraint variant — owner's
  reference "Native VS Code"; developer audience, hours a day, calm; scan the outline, read the document.
- **Foundations summary (font pairing · base body size + type scale · one accent + palette · density · depth · motion):**
  the user's VS Code fonts (Law 1 deviation, owner's choice) · base 14px, ratio 1.2, body 16.8px · one accent
  = theme link colour · 28px rows, 280px outline, 72ch column · flat · Tier 0, no decorative motion.
- **Tokens:** every token → a `--vscode-*` variable with OKLCH light/dark fallbacks for the snapshot; WCAG-AA
  computed in both modes (`DESIGN.md` §2). `evidence: python3 <plugin>/commands/frontend-audit/audit.py docs/design-sample.html src/webview/tokens.css src/webview/styles.css -> 4 pass | 1 warn (Law13 focus: false positive, :focus-visible lives in styles.css) | 0 error - DESIGN.md - 2026-09-23`
- **Approved sample page (path):** `docs/design-sample.html` (owner-approved 2026-09-23) · **DESIGN.md (path):**
  `DESIGN.md` · **Stylesheets the app loads:** `src/webview/tokens.css`, `src/webview/styles.css`.

## Foundation        <!-- /foundation --> (the record; see docs/runbook.md for how to boot and verify it)
- **Runs end-to-end (walking skeleton):** Map button (editor title, Markdown only) → "Map: <file>" webview
  panel → webview posts `ready` → host posts `render` → panel shows "docmap is running for <file>". Built
  `.vsix` packages (14.5 KB, dist + docs only). `evidence: npx vsce package --no-dependencies -> Packaged docmap-0.0.1.vsix (12 files, 14.5 KB) - docmap-0.0.1.vsix - 2026-09-23`
  In-VS-Code run: `evidence: CI run 35824260644 "Integration tests inside real VS Code" -> 2 passing (Map opens beside sample.md; setting 123 read back) - tests/integration/extension.test.ts - 2026-09-23`
  (not runnable in this container: the VS Code download is blocked by its network policy). Full CI run green.
- **Config flows verified (no dead config):** `docmap.*` settings → `src/extension/settings.ts` →
  `resolveConfig` (typed, validated). Integration test sets `updateDebounceMs=123` and reads it back through
  the extension API (CI). `evidence: npm test -> 9 passed (config defaults/valid/nonsense) - src/core/config/config.test.ts - 2026-09-23`
- **Fail-loud/fail-closed guards (placeholder rejection · test-datastore refusal) · secret-scan + dependency-vuln scan · CI mirrors prod:**
  env-guard refuses publishing on a missing/placeholder `VSCE_PAT`, by name, no override —
  `evidence: cp .env.example .env && node scripts/env-guard.mjs VSCE_PAT -> exit 1 "still the .env.example placeholder" - scripts/env-guard.test.mjs - 2026-09-23`.
  Core purity: lint bans `vscode` in `src/core`, `tsconfig.core.json` bans DOM (both planted → red).
  gitleaks 8.30.1: history clean; planted `ghp_` token → pre-commit exit 1. `npm audit`: 0 vulnerabilities
  after overriding mocha's `diff`/`serialize-javascript` (test tooling only; mocha re-verified). Test-datastore
  refusal **N/A** (no datastore). CI (`.github/workflows/ci.yml`) mirrors the release path: `npm ci` →
  audit → gitleaks → typecheck → lint → unit → build → structure → UI audit → tokens → integration → package.
- **Isolated test datastore provisioned (variable + teardown) · test runner uses the app's config loader:**
  **N/A** — no datastore; tests use `tests/fixtures/`. Integration tests read config through the same
  `readConfig()` the extension uses.
- **Usable end-to-end (a seeded account can log in) · seed is idempotent + prod-refusing · dev credentials location:**
  **N/A** — no accounts, no seed, no credentials.
- **Commit hooks + CI auto-run (lint/format/secret-scan/tests · UI: frontend audit, project copy + engine version) · runs in its container · async-safe:**
  lefthook pre-commit: Biome · typecheck · Vitest · UI audit · structure · gitleaks. UI audit copy
  `scripts/frontend-audit/audit.py` (engine 1.73.0) in hook + CI — `evidence: append .planted{color:#ff0000} to src/webview/styles.css && npm run audit:ui -> exit 1 [FAIL Law14-raw-hex]; removed -> exit 0 - scripts/frontend-audit/audit.py - 2026-09-23`.
  Tokens resolve at runtime — `evidence: npm run check:tokens -> 5 PASS (theme wins, light + dark fallbacks) - scripts/check-tokens.mjs - 2026-09-23`.
  Dependabot weekly (npm, grouped; actions). Container **N/A** (runs in VS Code). Async: nothing blocks — parsing
  is ~0.3 s/MB and debounced.
- **Observability wired (tracing / error-reporter, even a stub):** `LogOutputChannel` "docmap"
  (`src/extension/log.ts`); Biome `noConsole` = error outside `scripts/`/`tests/`. No telemetry (guardrail).

## Contracts         <!-- /contracts --> (the record + the paths; see docs/contracts.md. The types live in code, never here)
- **Typed models / schemas / migrations:** document model `src/core/outline/types.ts` · parser port
  `src/core/markdown/engine.ts` · heading ids `src/core/outline/slug.ts` · host↔webview protocol + runtime guards
  `src/core/protocol/messages.ts` · settings `package.json` → `src/core/config/config.ts`. Persistence and
  migrations **N/A** (no datastore). Documented in `docs/contracts.md` §1.
  `evidence: npm test -> 31 passed (slug, messages, config, panel-html, env-guard) - src/core/**/*.test.ts - 2026-09-23`
- **Boundary units/scale agreed:** lines **0-based** (VS Code + markdown-it agree) · level 1–6 · size **UTF-8
  bytes** · debounce **ms** · `docVersion` = `TextDocument.version` (stale dropped, lines clamped) · ids
  GitHub-compatible — checked against github-slugger: 13/15 identical, 2 deliberate (`docs/contracts.md` §6).
- **Contract versioning / back-compat approach:** protocol internal to one `.vsix`, additive-only; settings
  never renamed or re-unitised (new key + `deprecationMessage`).
- **PII/sensitive fields classified · tenant-owner key · idempotency/natural key:** document text in memory only,
  never logged or sent · the only write is the user-requested snapshot on their machine · tenant key **N/A**
  (single-user, local) · `render` is whole-state per `docVersion` (idempotent).
- **Detail:** `docs/contracts.md` (reasoning + workings; this section stays a RECORD)
- **Read (file · date · verbatim quote):** `docs/adr/0002-markdown-it-html-disabled-strict-csp.md` · 2026-09-23 ·
  "`/build` must **drop comments**" · `STRUCTURE.md` · 2026-09-23 · "the host↔webview message union — adding a message is one line here"

## Build log         <!-- /build --> (one entry per feature; see docs/features/*)
| Feature | DoD (incl. security) met? | How verified | Doc |
|---|---|---|---|

## Dev-complete      <!-- /dev-check -->
<!-- Evidence format (the ONE form - docs/state-model.md §2f). Append to any criterion you can re-run:
     - [x] Authentication works - `evidence: pnpm test:e2e -> 18 passed - tests/e2e/auth.spec.ts - 2026-09-10`
     command -> result - artefact - date. A criterion with no evidence line is honest and is reported
     UNVERIFIED by /drift-check; a line that names no command or no date fails CI. Never invent a second
     format. -->
- [ ] Every core-scope feature built & runs
- [ ] Exit criteria + security DoD verified (with **re-runnable** evidence: `command -> result - artefact - date`)
- [ ] No hardcoding · prompts externalized · contracts typed · builds green
- [ ] Scope re-check — nothing crept in

## Deployment        <!-- /deploy --> (see docs/deployment.md for the full runbook)
- **Host (copied from #Architecture, never re-decided) · category — one per deployable unit:**
- **Live URL:**
- **Env vars set on the host (names only — values are the user's to paste):**
- **Migrations on deploy (the command, where it runs, what happens on failure):**
- **Who can get in (credentials in the built output · every way to a session · previews · what a stranger can spend):**
- **Proof it answers:** `evidence: <command> -> <result> - <artefact> - <YYYY-MM-DD>` (a signed-in path the owner walked: `owner-verified (manual) <YYYY-MM-DD>: ...`)
- **Rollback path:**
- **Known gaps:**

## Tests             <!-- /test --> (the record; see docs/tests.md for the test plan)
- **Isolated test datastore (the target the suite runs against) · bootstrap refuses dev/prod:**
- **Unit / integration / regression coverage (critical path accounted for):**
- **Adversarial/security (prompt-injection, authz) cases:**
- **Real-user-environment (DOM injection · locale/timezone · reduced motion/forced colours/zoom · degraded network):**
- **Live-path verified (not just isolated units):**
- **Golden/eval dataset location · tests deterministic · run in CI (red blocks merge):**
- **Detail:** `docs/tests.md` (reasoning + workings; this section stays a RECORD)
- **Read (file · date · verbatim quote):**

## Evaluation        <!-- /eval --> (the record; see docs/evaluation.md for the measurements)
- **Is it good? (measured vs a recorded baseline; regression fails):**
- **Metrics + confidence score:**
- **Cost-per-run · (AI) scoring-bias:**
- **Operational failures (separated from quality):**
- **Detail:** `docs/evaluation.md` (reasoning + workings; this section stays a RECORD)
- **Read (file · date · verbatim quote):**

## Ship log          <!-- /ship -->
| Date | What shipped | Review + /security-review | Skipped phases (none = full chain ran) | Docs reconciled | CHANGELOG | Rollback / flag | PR |
|---|---|---|---|---|---|---|---|

## Learnings         <!-- /learn --> (the record; see docs/learnings.md for the retro detail)
- **Success metric + result (instrumented, not guessed):**
- **User/usage signal incorporated:**
- **Retro (what worked / what to change):**
- **Decided next — build / iterate / KILL (from evidence):**
- **Observability + cost watch in place:**
- **Detail:** `docs/learnings.md` (reasoning + workings; this section stays a RECORD)
- **Read (file · date · verbatim quote):**

## Drift log         <!-- /drift-check (run anytime) -->
| Date | Drift found (scope/vision/plan/docs) | Recommendation (cut / re-scope+trigger / fix) |
|---|---|---|
