# Tier 1 — Doc + UX cleanup

**Goal**: bring the user-facing docs into line with what's actually shipped, and create the `docs/WORKFLOWS.md` that's missing from the doc graph.

**Why this tier first**: doc fixes are cited from later tiers (Tier 2 channel responses link to `docs/WORKFLOWS.md`; Tier 3 web UI references the workflows page from "what is this?" empty states). Also: lowest-risk, fastest to ship, makes the next session more productive.

**Estimated effort**: 1 session.

**Issues addressed**: U001, U002, U003, U014, U015, U016, U017.

---

## Pre-requisites

Read once before starting:

- [`../AUDIT.md`](../AUDIT.md) §5 (doc accuracy) and §6 (workflow clarity)
- `docs/ARCHITECTURE.md` (current canonical reference — was rewritten 2026-05-02)
- `docs/ONBOARDING.md` (380 lines — current setup walkthrough)
- `packages/cli/README.md` (the stale one)
- `packages/channels/README.md` (the very stale one)

Verify all four `pnpm` gates pass before starting (`build`, `test`, `lint`, `format:check`).

---

## Sub-tasks

### 1.1 Fix `packages/cli/README.md`

Drop the "Phase" column (Control framework is gone — phase numbers no longer have meaning). Replace with a simple `Status` column: `done` / `stub` / `planned`.

Add rows for shipped commands missing from the table:

- `factory spend [--group-by directive|day|model] [--project <name>]`
- `factory findings list|show <id>` (already in `packages/cli/src/commands/findings.ts`)
- `factory questions cleanup [--since <iso-date>] [--dry-run]` (already in `packages/cli/src/commands/questions.ts`)

Re-evaluate stub/planned markers:

- `factory logs` — currently listed as "stub". Confirm against `packages/cli/src/commands/`. If not present, mark "planned" or remove from table until built.
- `factory inspect <directiveId>` — listed as "planned". Keep or remove based on whether you intend to ship it; it's not in Tier 4 today.
- `factory push <project>` — listed as "planned". GitHub integration was retired by ADR 0019. Remove from table.

Update the "API" section if `buildCli()` exports changed (probably not — verify).

**Acceptance**: every command listed in the table corresponds to a real source file under `packages/cli/src/commands/`; no row marked `done` for code that doesn't exist; no command shipped but missing from the table.

### 1.2 Fix `packages/channels/README.md`

The doc still says `telegram` and `web` are _"future"_. Telegram is shipped (ADR 0022); web is shipped (ADRs 0025, 0027). Discord moved beyond _"phase-4 (this release)"_. Rewrite the Status section.

Then add full sections for the channels currently absent:

- **Telegram plugin section** — config schema (`telegramConfigSchema` in `src/telegram.ts`), capabilities (private chats vs groups, reply-to matcher, `bot_message_id` column for targeted answers), live smoke (`scripts/telegram-smoke.ts`).
- **Web "channel" section** — Note the boundary: web is **not** a `ChannelPlugin`. The web UI is a Fastify mount in the daemon (`/api/v1/*` JSON API + `/app/*` static SPA), with auth via `FACTORY5_UI_TOKEN`. ADRs 0025 + 0027 + 0028 are the contract. The web UI emits directives via the same SQLite path — it's a parallel inbound, not a `ChannelPlugin`. State this explicitly so readers don't expect a `createWebChannel()` factory.

Move "Adding a channel" to the bottom; verify steps still match current code.

**Acceptance**: the Status section reflects what's shipped; all four channel paths have a section in the doc; the `ChannelPlugin` vs Fastify-route distinction is called out.

### 1.3 Fix `apps/factory-web/README.md`

Remove "(wired in 9.3)" reference (Control-era phase number). Add a brief "Pages" section listing the 9 pages and what each is for. Keep the existing dev-loop and prod-loop sections.

**Acceptance**: no phase-number references; readers can see at a glance what pages exist.

### 1.4 Add §"Web dashboard" to `docs/ONBOARDING.md`

Insert between current §4 "First build" and §5 "Optional — Discord channel". Cover:

- What the dashboard is (read + write surface for directives, projects, questions, spend, findings).
- How to open it: factoryd's stdout includes a line `ui: http://127.0.0.1:25295/app/?t=<48-hex>`. The token is captured into sessionStorage on first load and stripped from the URL.
- How to recover the URL after losing terminal scrollback: `factory ui-token`.
- Tour the pages: Overview cards, Build form, Projects (list + detail with budget), Directives (list + detail with task table), Questions (list + answer form), Spend, Findings.
- Note the limitation today: detail pages don't refresh live (Tier 3 will fix).

**Acceptance**: a new operator can open the dashboard from cold based on the doc alone.

### 1.5 Add §"Chat — CLI / Discord / Telegram" to `docs/ONBOARDING.md`

Insert as the next section. Cover:

- `factory chat` REPL — start it with `factory chat`, type a message, receive a reply. `/quit` to exit. Note the 120s per-turn timeout (issue U005, may grow in Tier 2/4).
- Discord chat — `@bot` in any guild channel opens a thread; replies in that thread go to the same conversation. `/build <name>` switches the directive intent.
- Telegram chat — DM the bot, or `@bot` in a group. Reply-to-bot answers a pending question.
- Shared model: every channel writes the same `Directive` shape; the brain doesn't care which channel originated the message.

**Acceptance**: a new operator who's done channel setup can hold a chat across all three surfaces.

### 1.6 Write `docs/WORKFLOWS.md`

The most important deliverable in this tier. Write a new doc covering:

**§1. The four canonical loops:**

1. **One-shot autonomous build.** Write a CLAUDE.md spec → `factory build <name> --autonomy autonomous --max-usd 5` → wait → answer pending questions if asked → done. Worked example with sample CLAUDE.md content.
2. **Chat-driven exploration.** `factory chat` (or Discord/Telegram) → "build me an X with Y" → assistant clarifies via `askUser` → confirm → run. When chat is the right starting point.
3. **Iterative fix loop.** Existing project → `factory findings show <id>` → request fix via `factory build <name>` (passing the finding id in the spec) → review → repeat.
4. **Resume after pause.** Long autonomous run → operator gets a notification (Discord/Telegram/email if configured) → answer via channel of choice → run continues.

**§2. Decision matrix.**

When to use which surface:

| Surface                   | Best for                                                                      |
| ------------------------- | ----------------------------------------------------------------------------- |
| `factory build` (CLI)     | Scripted / batched work, fastest path for a known spec                        |
| `factory chat` (CLI REPL) | Iterative spec authoring, fast turnaround                                     |
| Discord                   | Multi-operator teams, threads as conversation history, mobile via Discord app |
| Telegram                  | Solo operator on mobile, fastest notification UX                              |
| Web UI                    | Discoverability — see what's running, set budgets, answer questions visually  |

**§3. CLAUDE.md authoring guide.**

What makes a good spec? Cover:

- Must say what to build, not how (let architect/builder pick the implementation).
- Specify the runtime explicitly if not Python (`runtime: node` etc. — though `factory build --language` is the canonical way).
- List acceptance criteria — what does "done" look like?
- Reference patterns to follow (existing files in workspace, library docs URLs, etc.).
- Worked example: a 30-line CLAUDE.md for a small CLI tool.

**§4. Cross-references.** Reference from `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ONBOARDING.md`.

**Acceptance**: a new operator who's done setup can pick a workflow and execute it from the doc alone.

### 1.7 Single-pass audit of `docs/SKILLS.md` + `docs/AGENTS.md`

Both were last touched at scaffold time. Quick check:

- For each skill in `SKILLS.md`, verify the corresponding `skills/<name>.md` exists.
- For each agent in `AGENTS.md`, verify it's referenced from `packages/brain/src/`.
- If anything diverged, update the docs to match code.

**Acceptance**: skills/agents docs match what the brain actually uses.

---

## Acceptance criteria for the whole tier

- All four `pnpm` gates pass after edits (`build`, `test`, `lint`, `format:check`).
- All issues U001-U003, U014-U017 marked Resolved in [`../ISSUES.md`](../ISSUES.md).
- Cross-references between docs are consistent (no orphan refs to deleted files; new `docs/WORKFLOWS.md` referenced from at least three other docs).
- Append a session entry to [`../LOG.md`](../LOG.md).
- Tick the Tier 1 checkboxes in [`../ROADMAP.md`](../ROADMAP.md).

---

## Risks

- **Format drift**: prettier reformats markdown tables on save. Run `pnpm format:write` before committing if `format:check` fails.
- **Bikeshedding the workflows doc**: the four loops are reasonable but the user may have a fifth. Show the draft before fully committing.

---

## Suggested commit message

```
docs: refresh stale package READMEs, add web/chat onboarding, write WORKFLOWS

- packages/cli/README.md: drop Phase column, add spend/findings/questions
  cleanup rows, re-evaluate stub/planned markers
- packages/channels/README.md: rewrite Status section (Telegram + web no
  longer "future"); add Telegram plugin and Web channel sections
- apps/factory-web/README.md: drop phase-number scaffolding, add page index
- docs/ONBOARDING.md: new §"Web dashboard" + §"Chat (CLI/Discord/Telegram)"
- docs/WORKFLOWS.md: new — four canonical loops, decision matrix, CLAUDE.md
  authoring guide
- docs/SKILLS.md, docs/AGENTS.md: verified against current code
```
