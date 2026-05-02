# Audit — factory5 → first-class (2026-05-02)

Frozen snapshot of the state-of-the-system audit. Used as input for the four-tier roadmap. Captured the day after the Control framework + build journal cleanup commits landed.

## What's good

- **15 packages, 3 apps, ~35.6k LOC of source, ~5.3k LOC of tests, 876 tests passing** across all four gates (build, test, lint, format).
- **28 ADRs** covering every architectural decision, actively cited from 150+ inline source comments — the doc graph is load-bearing, not narrative scaffolding.
- **All four channels work end-to-end** (CLI-RPC, Discord, Telegram, Web). All four assessor runtimes work end-to-end (Python, Node, Go, Rust). Per-spawn worker sandbox (ADR 0028) enforces fs scoping. Pre-call budget enforcement works.
- **Cross-platform discipline** — Windows + Linux; explicit Windows handling for path comparisons, mojibake, junctions; tests run on Windows under Node 22.
- **Verification-first claim is real** — assessor uses real subprocesses, the worker sandbox lights up zero-deny under live builds, the migration runner is idempotent and tested.
- **Coherent retirements** — GitHub integration was scaffolded then dropped via ADR 0019 with the doctrine documented; the right way to back out a feature.

## Where it falls short

The system "works" but isn't first-class. Six surfaces need work.

### 1. Web UI — capable but very thin

**What's actually built**: 9 Astro pages (`index`, `build`, `projects/{index,detail}`, `directives/{index,detail}`, `questions/{index,detail}`, `spend`, `findings`) plus one `Dashboard.astro` layout, all rendered by **vanilla DOM-in-Astro** (`<script>` tags that `document.getElementById('mount')` and build the page via an `el()` helper inside `lib/api.ts`).

| Issue                            | Today                                                                                                                         | First-class                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **No live updates**              | `directives/detail.astro` loads once. After kicking off a build the SPA redirects to it but nothing refreshes.                | SSE stream from `factoryd` for the active directive (tasks, findings, spend, log tail).                                         |
| **No chat surface**              | Web UI has zero conversational affordance. Must drop to `factory chat` (terminal) or Discord/Telegram.                        | A `/app/chat` page with the same intent surface.                                                                                |
| **No cancel**                    | A running build can only be stopped by `factory directive mark-blocked <id>` (manual; flips status, doesn't kill the worker). | Cancel button on directive detail → `POST /api/v1/directives/:id/cancel` → daemon stops the worker pool task.                   |
| **No new project**               | Build form explicitly says _"the UI does not create projects from scratch"_ — must drop to CLI.                               | `/app/projects/new` walks language + workspace + budget defaults.                                                               |
| **No mobile design**             | Header has horizontal nav with no responsive collapse; tables and forms aren't tested below 600 px.                           | Hamburger / drawer nav at narrow widths; stacked form rows.                                                                     |
| **No charts**                    | Spend page is a table.                                                                                                        | Sparklines per project + a per-day stacked bar over 30 days.                                                                    |
| **`el()` instead of components** | Each page hand-builds DOM via `mount.appendChild(el('div', {}, ...))`. No shared header/nav/empty/error/loading components.   | A small set of Astro components (`Card`, `Table`, `EmptyState`, `Alert`, `LoadingShell`, `Form` primitives) used by every page. |
| **Token UX**                     | `sessionStorage` only — token survives reload but dies on tab close. No explicit logout.                                      | Optional `localStorage` mode + `factory ui-token --rotate` to invalidate prior sessions; a "Connected" strip in the header.     |

**The structural call**: the Astro app is doing about 10% of what Astro is for. Rebuild around proper Astro components + a thin Solid/Preact island per interactive page. Today it has the dev-cost of an SPA without the productivity of one.

### 2. Channel parity — Discord and Telegram are read-only-ish

The brain understands eight intents (`build`, `fix`, `review`, `investigate`, `chat`, `status`, `resume`, `cancel`). **Discord and Telegram only emit two of them — `build` and `chat`.** Everything else requires the CLI. Web has slightly more (build form, budget form, question-answering) but no chat.

| Capability                | CLI                                             | Discord                 | Telegram           | Web UI  |
| ------------------------- | ----------------------------------------------- | ----------------------- | ------------------ | ------- |
| Kick off build            | ✅ `factory build`                              | ✅ `@bot /build <name>` | ✅ `/build <name>` | ✅ form |
| Free-form chat            | ✅ `factory chat`                               | ✅ thread reply         | ✅ DM / @mention   | ❌      |
| Answer pending question   | ✅ `factory answer`                             | ✅ thread reply         | ✅ reply-to-bot    | ✅ form |
| List directives           | ✅ `factory status`                             | ❌                      | ❌                 | ✅      |
| List findings             | ✅ `factory findings`                           | ❌                      | ❌                 | ✅      |
| Spend report              | ✅ `factory spend`                              | ❌                      | ❌                 | ✅      |
| Resume a stopped build    | ✅ `factory resume`                             | ❌                      | ❌                 | ❌      |
| Cancel a running build    | ⚠️ `mark-blocked` (manual; doesn't kill worker) | ❌                      | ❌                 | ❌      |
| Set per-project budget    | ⚠️ via `--max-*` flags only                     | ❌                      | ❌                 | ✅      |
| Init / configure / doctor | ✅                                              | ❌                      | ❌                 | ❌      |

**Mechanism gaps**:

- **Discord**: schema field `applicationId` exists (`packages/channels/src/discord.ts:69`) marked _"used by future slash-command wiring"_. Today it's unused. Slash commands aren't registered.
- **Telegram**: doesn't call `setMyCommands`. The Telegram `/` menu doesn't autocomplete factory commands.
- **Both**: no rich UI affordances for pending-question answering (Discord embeds + buttons; Telegram inline keyboards). Today both are plain-text round-trips.
- **Triage prompt**: routes everything from channels to `intent=chat` rather than classifying across the eight-intent vocabulary. _"What's the budget?"_ in Telegram should run `intent=status`, not `intent=chat`.

### 3. Onboarding — three-quarters complete

`docs/ONBOARDING.md` (380 lines) covers: prereqs → clone+build → instance config → `factory doctor` → first build → Discord setup → Telegram setup → multi-instance → backups → troubleshooting.

**What's missing**:

- **No web UI walkthrough.** The dashboard URL is printed once at daemon startup and never explained. There's no §X "Web dashboard" section that walks the operator through `factoryd` → opening the URL → what each page is for.
- **No `factory chat` walkthrough.** The most natural ongoing-use surface (a REPL) has no onboarding section.
- **No "day 2" guide.** First-build is one paragraph. Nothing about the loop: write CLAUDE.md → `factory build` → answer questions → review findings → resume / iterate.
- **Discord and Telegram setup is heavy and manual.** Both require ~6 portal steps. No automation, no walkthrough video, no `factory init --discord-bot` flow that opens a browser to the OAuth URL.
- **No troubleshooting for active builds.** What if a build hangs? Stuck on a question? The pending-question UX is real but undocumented in the onboarding doc.

### 4. CLI — coherent but underexposed

The CLI is the strongest surface. **14 user-facing commands** under `packages/cli/src/commands/`: `answer`, `build`, `chat`, `daemon`, `directive`, `doctor`, `findings`, `init`, `questions`, `resume`, `spend`, `status`, `ui-token`. All shipped, all real.

**Gaps relative to first-class**:

- No `--help` examples beyond Commander defaults (e.g. `factory build --help` lists flags but doesn't show _"factory build my-app --autonomy autonomous --max-usd 5"_).
- No `factory cancel <directive-id>` — `directive mark-blocked` is the manual workaround. The brain doesn't truly kill the worker, just flips status.
- No `factory budget set <project> --max-usd 5` — budget changes go through the web UI; the CLI doesn't have a sibling.
- No `factory project list / show / delete`. Project management is implicit (a side-effect of `factory init` and `factory build`).
- No `factory ask "<question>"` — the easy way to fire one chat directive without the REPL.
- No tab completion (Commander supports it; not wired).

### 5. Documentation accuracy — three real staleness hits

After the 2026-05-02 cleanup, the top-level docs are current. The package READMEs are uneven:

| File                          | Status                     | Fix                                                                                                                                                                                                                                                                        |
| ----------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/README.md`      | **Stale**                  | "Phase" column is now meaningless (Control gone). Table missing `factory spend`, `factory findings`, `factory questions cleanup`. `factory logs` listed as "stub" but is actually planned-only; `inspect` and `push` still listed as planned. Whole table needs a refresh. |
| `packages/channels/README.md` | **Catastrophically stale** | Says _"`telegram` channel — future (Phase 5+)"_, _"`web` channel — future"_, _"`discord` channel — phase-4 (this release)"_. Telegram is fully shipped; web is fully shipped. The Discord plugin section is OK; needs Telegram + web sections.                             |
| `apps/factory-web/README.md`  | Light staleness            | References "(wired in 9.3)". Otherwise OK.                                                                                                                                                                                                                                 |

Plus: `docs/SKILLS.md` and `docs/AGENTS.md` were last touched at scaffold time. Their content matches what's in code (skill list and agent list correct), but neither was updated as agents/skills grew. Worth a single-pass audit.

### 6. Workflow clarity — there's no canonical "this is how you use factory5" doc

The user's most pointed observation. Today a new operator follows ONBOARDING for setup and is then on their own. There is no equivalent of:

- A **`docs/WORKFLOWS.md`** showing the four canonical loops:
  1. **One-shot autonomous build**: write CLAUDE.md → `factory build name --autonomy autonomous --max-usd 5` → wait for completion or pending question → answer → repeat.
  2. **Chat-driven exploration**: `factory chat` (or Discord/Telegram) → "build me an X with Y" → assistant clarifies → confirm → run.
  3. **Iterative fix loop**: existing project → `factory findings show <id>` → request fix → `factory build name --intent fix --finding <id>`.
  4. **Resume after pause**: long autonomous run → operator gets a notification → answers via Discord/web → run continues.
- A **decision matrix**: when do I use chat vs web vs CLI vs Discord/Telegram?
- A **CLAUDE.md authoring guide**: what does a good spec look like? The factory consumes CLAUDE.md from `<workspace>/<project>/CLAUDE.md`; without examples, new users don't know how to write one.

## What "first-class" looks like

Roughly four chunks of work, each shippable independently. None require new architecture; they're polish + completion. See [`ROADMAP.md`](ROADMAP.md) for status and [`plans/`](plans) for per-tier detail.

- **Tier 1** — Doc + UX cleanup (~1 session)
- **Tier 2** — Channel parity (~2 sessions)
- **Tier 3** — Web UI live and complete (~2-3 sessions)
- **Tier 4** — CLI completion (~1 session)

Tier 1 + 2 together close the gaps the operator most directly asked about.
