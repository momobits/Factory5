# Issues — upgrade work

Issues discovered during audit + ongoing upgrade work. New issues append to "Open" at the bottom; resolved issues move to "Resolved" at the bottom of the file with a date.

## Format

```markdown
### UNNN — Short title

- **Severity**: low | medium | high | blocker
- **Tier**: 1 | 2 | 3 | 4 | out-of-scope
- **Area**: cli | channels | web | brain | docs | etc.
- **Description**: what's wrong / missing
- **Hypothesis**: best guess at root cause / approach
- **Resolution**: (filled when work begins / completes)
```

Severity:

- **blocker** — actively preventing other work
- **high** — material UX or correctness gap
- **medium** — notable but not load-bearing
- **low** — polish / nice-to-have

## Open

### U005 — `factory chat` REPL turn timeout is 120 s

- **Severity**: medium
- **Tier**: 2 or 4 (now Tier 9 candidate)
- **Area**: cli
- **Description**: `packages/cli/src/commands/chat.ts:55` — `DEFAULT_TURN_TIMEOUT_MS = 120_000`. For chat directives that route through architect / planner / builder agents, 2 minutes is often too short and the user sees _"(no reply within 2 min — directive may still be running)"_.
- **Hypothesis**: Path (a+) bumps the timeout to ~10 min AND prints the directive id when minted AND adds a periodic "still working..." heartbeat AND adds a SIGINT handler so first Ctrl-C cancels just the in-flight directive (returns to `you>`) and second Ctrl-C exits the REPL AND prompts before exiting if a directive is still in flight. Bare path (a) — bump only — would actually make UX worse (longer staring at a dead prompt). Path (b) — daemon-side streaming partial responses — is the better UX but requires daemon-side support and is a multi-step tier.
- **Resolution**: Tier 9 candidate. Twice-deferred (Phase 2 → Phase 4 → still open). Parked at Phase 8 scaffold time per operator decision; promote when the false-timeout pain surfaces in real use.

### U031 — Activity panel empty after refresh; multi-tab event split

- **Severity**: medium
- **Tier**: 11
- **Area**: state + daemon + web
- **Description**: Two operator-felt failure modes surfaced 2026-05-16 by Tier 10's post-close smoke. (1) Refresh forgets everything: opening a directive's detail page mid-run, then refreshing, returns an empty activity panel — the `log.line` events the FE was rendering are SSE-only and dropped on disconnect. (2) Multi-tab event split: two dashboard tabs subscribed to the same directive see different event sets because events emitted before a tab's subscribe time aren't replayed to that tab. Both fail modes also imply post-mortem invisibility: opening a `failed` directive a session later shows nothing in the activity panel even though the daemon log file contains the full narrative. ADR 0031 explicitly noted persistence as the Tier 11+ follow-up.
- **Hypothesis**: Migration 010 adds a `directive_log_lines` table; daemon `DirectiveStreamHub.emit` tees `log.line` events to DB before fanning out (synchronous insert, log+continue on failure); new `GET /api/v1/directives/:id/logs?since=<iso>&limit=<n>` route returns historic events for a directive; FE on directive-detail boot fetches historic first, captures the latest ts as a `joinCursor`, then attaches SSE — log.line events with `ts <= joinCursor` are dropped to avoid double-render at the join boundary. Sizing: ~750 KB/day at 100 directives/day × 50 events/directive × 150 bytes; ~275 MB/year unchecked. Retention policy deferred.
- **Resolution**: (filled when 11.6 lands and the browser smoke proves refresh-survives + multi-tab + terminal-post-mortem).

### U032 — Operator-invisible turn budgets; hard-fail without retry-question escalation

- **Severity**: high
- **Tier**: 12
- **Area**: cli + web + brain
- **Description**: The codebase has 15 hardcoded budgets and timeouts; operators control only `maxUsd` and `maxSteps`. Per-task `maxTurns` (default 80 post-Tier-10-fix) is planner-emitted and never surfaced. When `error_max_turns` trips mid-stream, the worker reports the failure, the task is marked failed, and the brain raises a generic `askUser("what next?")` that doesn't carry the bump-suggestion context. Operator complaint 2026-05-16: _"why are we failing instead of asking the user if we should continue over the budget? why do we have a max cost and max steps that we ask the user and have other limits the user does not see?"_ The driving incident: an automl scaffolder hit the 40-turn cap with 13 modules to scaffold; operator saw "Task failed" with no diagnostic and no recovery path (Tier 10 post-close smoke).
- **Hypothesis**: Six operator-facing budgets identified in the Tier 12 audit (maxUsd, maxSteps, askUserDeadlineMs, maxTurnsScaffolder, maxTurnsBuilder, maxTurnsFixer); the rest stay internal pacing. New `BUDGET_DEFAULTS` constant + Zod schema in `@factory5/core` becomes the single source of truth read by CLI / Web / project-metadata parsers — defaults + explainers can't drift. Web Build form gets an "Advanced budgets" accordion (collapsed by default); CLI gets matching flags with `--help` quoting the explainers verbatim. Directive payload carries `budgets`; Tier 10 resume route inherits the full set. Brain `pool.ts` detects `error_max_turns` subtype and raises a typed askUser with task title + current cap + suggested bump; on accept-bump, relaunches the task with the new budget; on abort, current failed-task behaviour. Tier 8 auto-answer adapter recognises the budget-escalation prompt: bump-by-one-bucket on first failure, abort on second. ADR 0033 pins the budget UX paradigm: operator-facing vs internal-pacing budgets, default-publication contract, escalation rule, persistence contract.
- **Resolution**: (filled when 12.8 lands and the browser smoke proves a budget-tripping task escalates via askUser → accept → retry → success).

## Resolved

### U030 — No UI surface for resume; directive-detail activity panel silent on build directives

- **Severity**: medium
- **Tier**: 10
- **Area**: web + brain
- **Description**: Two operator-feels-blind gaps surfaced by an `automl` build failure on 2026-05-16 (`01KRQ1RPE5SM6Q8AYSRHHAPG39`). (1) `factory resume <project>` exists as a CLI command (`packages/cli/src/commands/resume.ts`) but the daemon has no HTTP mirror, so the web UI cannot offer recovery. Operator viewing the failed directive from a phone has no action available except walking to a terminal. (2) The directive-detail page's activity panel is silent on `build` directives because the brain emits one `log.line` SSE event today (`packages/brain/src/loop.ts:258`, chat reply only). The `automl` directive sat in `running` for ~14 minutes (architect ~3 min, planner ~10 min) before flipping to `failed`; nothing about that progression surfaced on `/app/directives/detail`. The planner Zod schema-parse failure that ended the run (`packages/brain/src/planner.ts:335`) was logged at `error` level in the daemon's pino stream but never reached the dashboard.
- **Hypothesis**: SSE plumbing already exists from Phase 3 (ADR 0029 — `directive-stream-protocol`); only the emission side is sparse. Three workstreams: (1) `POST /api/v1/directives/:id/resume` daemon route mirrors `resume.ts` logic — find the prior directive, mint a child with `parentDirectiveId` + `payload.resumeFrom`, doorbell event. Bearer-auth + Zod body validation; refuses 404 / 409 / 422 per status of the prior. (2) Brain emits `emitLogLine` at every narrative breakpoint — triage / architect entry+wiki-written+readiness / planner entry+parse-fail+zod-fail+plan-written / pool task lifecycle / assessor / terminal. Error-level lines carry the first 500 chars of any offending LLM output in `attrs.detail`. (3) FE surfaces — Resume button on directive-detail when status terminal; per-row Resume link on Projects index; level-badge pills (info / warn / error) on log-tail lines using design tokens; empty-state hint when no events arrived. ADR 0031 pins the log-forwarder design (manual emit sites first-ship; pino-transport-tap deferred to Tier 11+).
- **Resolution**: Resolved 2026-05-16 — Tier 10. ADR 0031 pins the log-forwarder design with manual `emitLogLine` sites at every brain stage entry/exit/error path (`docs(10.2)` `bb2bca9`). Brain emit sites in `architect.ts` / `planner.ts` / `pool.ts` / `loop.ts` / `serve.ts` cover triage → architect (calling / wiki written / readiness) → planner (calling / parse-fail / Zod-fail / plan written) → pool (dispatching / task error / complete) → terminal; planner parse-fail and Zod-fail carry first 500 chars of LLM response in `attrs.detail` + truncated Zod issues (`feat(10.3)` `585f172` + 4 regression tests in `planner-emit.test.ts` locking the automl Zod-fail shape). New `POST /api/v1/directives/:id/resume` daemon route mirrors `resume.ts` logic, refusing 404/409/422 per prior status (`feat(10.4)` `e83c3c1` + 8 integration tests). UI Resume pill on directive-detail when status terminal + per-row Resume link on Projects index with one `/api/v1/directives?limit=100` fetch (`feat(10.5)` `f100910`). Activity panel rendered with level-badge pills using Tier 9 design tokens + empty-state "Waiting for the brain to narrate…" hint + log-tail style block lifted to `Dashboard.astro`'s global block (Astro scoped rules don't reach JS-created elements — same gap fixed `.cancel-btn` in passing) (`feat(10.6)` `9289aff`). Live browser smoke (Playwright MCP) confirmed end-to-end: clicked Resume on the original failed `01KRQ1RPE5SM6Q8AYSRHHAPG39`, child `01KRR9RGFN10YMDX5C16TXK91Y` minted, activity panel narrated 5 events live (triage → architect calling → wrote 13 wiki pages → readiness all passed → planner calling). Architect on resume produced a proper `modules/` directory split this time so `checkModules` passed — the `modules-documented` warn from the original incident was an Opus-non-determinism artifact, not a load-bearing gate bug. Tier 11 carry-forwards: pino transport tap, per-directive log persistence (today SSE-only), resume-after-edit, bulk resume, `checkModules` h1 acceptance.

### U029 — Unanswered `ask_user` blocks directive; no auto-answer fallback

- **Severity**: medium
- **Tier**: 8
- **Area**: brain
- **Description**: When the brain emits an `ask_user` pending-question, the parent directive blocks waiting for a human reply. Today there's no "the human isn't coming back" path — the question sits open until the parent directive itself terminates, at which point `factory questions cleanup` retroactively writes a `[orphaned by ...]` synthetic answer (`packages/state/src/queries/pending-questions.ts:272`'s `markOrphanAnswered`). That's forensic cleanup, not progress. Autonomous runs stall waiting on a human who isn't there. The schema already has a `deadline_at` field on `pending_questions` but nothing reads it, and there's no provenance column to distinguish a user answer from an agent answer beyond a `[bracketed]` text-prefix convention used only by the orphan sweep.
- **Hypothesis**: Pure composition + one schema migration + one ADR + one new dispatcher. (1) Add `pending_questions.answered_by` column (`'user' | 'agent' | 'agent-failed' | 'orphan-sweep'`) via migration 009 with backfill for pre-existing rows. (2) New `<dataDir>/config.json` with `askUserDeadlineMs` (default 5 min, configurable without code changes) read via new `loadConfig()` in `@factory5/core`. (3) Brain stamps `deadline_at = now() + askUserDeadlineMs` on every `ask_user`. (4) New brain tick-loop sweep `findOpenPastDeadline` selects open questions with elapsed deadlines whose parent directive is still active; for each, dispatcher in `packages/brain/src/auto-answer.ts` builds a prompt (question + options + parent directive + project CLAUDE.md + linked task log + recent findings + past Q&A in this directive) → dispatches via the existing model/provider abstraction → writes `answered_by = 'agent'` on success or `'agent-failed'` after one retry. (5) Sentinel race-mitigation write before LLM dispatch so a concurrent human reply hits a no-op UPDATE. (6) Spend recorded against parent directive on success. (7) ADR 0030 pins the contract. (8) CLI + web surfaces render the answerer.
- **Resolution**: Resolved 2026-05-08 — Tier 8. Migration 009 added the `pending_questions.answered_by` column with a four-value enum CHECK constraint and idempotent backfill (`feat(8.2)` `cd08976`). ADR 0030 pinned the contract (`docs(8.3)` `8365b6a`). New `loadConfig()` in `@factory5/state` reads `<dataDir>/config.json` (`feat(8.4)` `d894aaa`). Brain stamps `deadline_at` from config on every new `ask_user` (`feat(8.5)` `dd25d78`). New `packages/brain/src/auto-answer.ts` dispatcher — `findOpenPastDeadline` query + `claimForAutoAnswer`/`finalizeAutoAnswer` race-mitigation helpers + sweep wired into `runServe` with a 5-second throttle; LLM call retries once on transient failure, otherwise writes a `'agent-failed'` synthetic; spend recorded against the parent directive on success only (`feat(8.6)` `89f58c8`). Web UI surfaces the answerer in `/app/questions/index` (new column) and `/app/questions/detail` (new meta row, only shown on answered rows). CLI `factory questions list` / `show <id>` are deferred — those subcommands don't exist today; the cleanup command's orphan output is unaffected because orphan rows have `answered_by IS NULL` until the sweep claims them.

### U001 — packages/cli/README.md is stale

- **Severity**: medium
- **Tier**: 1
- **Area**: docs / cli
- **Description**: Has a "Phase" column from the Control era; missing rows for `factory spend`, `factory findings`, `factory questions cleanup` (all shipped); `factory logs` shown as "stub" but is planned-only today; `factory inspect` and `factory push` still listed as planned and may stay that way.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.1, commit `d33635a`. Dropped Phase column; added `spend` / `findings list|show|backfill` / `questions cleanup` rows with per-command sections; removed `inspect` (never shipped) and `push` (ADR 0019 retired GitHub); reworded `logs` row to clarify it's a stub that prints a directory hint.

### U002 — packages/channels/README.md is catastrophically stale

- **Severity**: high
- **Tier**: 1
- **Area**: docs / channels
- **Description**: Said _"`telegram` channel — future (Phase 5+)"_; _"`web` channel — future"_; _"`discord` channel — phase-4 (this release)"_. Telegram is fully shipped (ADR 0022); web is fully shipped (ADRs 0025, 0027); Discord is matured beyond phase-4. Doc misled any reader trying to understand the channel layer.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.2, commit `c53f8d9`. Rewrote Status section to reflect what's shipped (`cli-rpc`, `discord`, `telegram` are all shipped; web UI is a Fastify mount, not a `ChannelPlugin`); added Telegram plugin section mirroring the Discord one; added "Web — not a `ChannelPlugin`" section that explicitly calls out the boundary.

### U003 — apps/factory-web/README.md has minor staleness

- **Severity**: low
- **Tier**: 1
- **Area**: docs / web
- **Description**: Referenced "(wired in 9.3)" — phase-number scaffolding from Control era. Otherwise OK.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.3, commit `30293ff`. Dropped the `(wired in 9.3)` parenthetical and reworded the Auth section to describe what `factory ui-token` does. Replaced the placeholder Routing section with a Pages table mapping URL → file → purpose for all ten SPA pages.

### U014 — No `docs/ONBOARDING.md` section for the web UI

- **Severity**: high
- **Tier**: 1
- **Area**: docs
- **Description**: Dashboard URL was printed once at daemon startup and never explained in onboarding. New operators didn't discover the dashboard.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.4, commit `0ffdd8d`. Added §5 "Web dashboard" with subsections covering open / recover URL / page tour / today's limitations; renumbered Discord / Telegram / multi-instance / backups / troubleshooting from §5–§9 to §6–§10 with inline §-reference updates; added two dashboard troubleshooting bullets and ADRs 0025 + 0027 to the Pointers section.

### U015 — No `docs/ONBOARDING.md` section for `factory chat`

- **Severity**: high
- **Tier**: 1
- **Area**: docs
- **Description**: The most natural ongoing-use surface (a REPL) had zero onboarding mention. New users who didn't pick up Discord/Telegram never discovered it.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.5, commit `010843b`. Added §6 "Chat — CLI / Discord / Telegram" with subsections for `factory chat` (sample transcript, `/quit`, 120 s timeout), Discord chat (mention → thread → `/build`), Telegram chat (DM-vs-group, reply-to-bot for pending questions), and the shared-Directive model that lets a conversation cross surfaces. Renumbered remaining sections by +1 with inline §-ref updates.

### U016 — No `docs/WORKFLOWS.md` exists

- **Severity**: high
- **Tier**: 1
- **Area**: docs
- **Description**: No canonical "this is how you use factory5" doc. Four loops (one-shot autonomous, chat-driven, fix loop, resume after pause) were unspecified. No decision matrix for "when do I use which surface?".
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.6, commit `b813037`. Wrote `docs/WORKFLOWS.md` with §1 four canonical loops (each with a worked example), §2 surface decision matrix ("best for" + "avoid for" per surface), §3 CLAUDE.md authoring guide (see U017), and §4 see-also pointers. Added cross-references from `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, and `docs/ONBOARDING.md` (4 of 4 anchor docs; the Phase 1 done-criterion required at least 3).

### U017 — No CLAUDE.md authoring guide

- **Severity**: medium
- **Tier**: 1
- **Area**: docs
- **Description**: factory consumes `<workspace>/<project>/CLAUDE.md` as the spec, but there was no doc explaining what makes a good spec. New users guessed.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.6, commit `b813037`. Folded into `docs/WORKFLOWS.md` §3 ("Authoring `CLAUDE.md` — what makes a good spec") with principles, anti-patterns, a worked 30-line example for a small CLI tool, and a brief "what the brain does with it" walkthrough mapping to the triage→architect→plan→assess→verify loop.

### U004 — `factory cancel` does not exist; `mark-blocked` is the workaround

- **Severity**: high
- **Tier**: 2 (brain hook + IPC route + CLI command)
- **Area**: cli / brain
- **Description**: A running build can only be stopped via `factory directive mark-blocked <id>`, which flips the directive status to `blocked` but does not signal the worker pool to abort tasks. Workers continue burning budget until they finish or hit their own limits.
- **Resolution**: Resolved 2026-05-02 — Tier 2 step 2.4, commit `67fb998`. Shipped `factory cancel <id>` end-to-end: state-side `cancelDirective` flips the row to `failed` with `blocked_reason = 'cancelled'`, brain registers a per-directive `AbortController` registered at claim time and fired by the daemon's new `POST /directives/:id/cancel` route, the existing pool→worker→provider abort plumbing kills the `claude -p` subprocess (SIGTERM-then-SIGKILL with a 5 s grace), and the worker's worktree cleanup gained a `cancelled` outcome that removes the worktree without merging. CLI is IPC-first with a DB-direct fallback when the daemon's down. `factory directive mark-blocked` docstring updated to call out the distinction.

### U011 — Discord plugin schema reserves `applicationId` for slash commands but never wires them

- **Severity**: high
- **Tier**: 2
- **Area**: channels / discord
- **Description**: `packages/channels/src/discord.ts:69` — `applicationId` is in the config schema with comment _"used by future slash-command wiring"_. Today the field is read but never used. Discord users see only `@bot /build` mentions, not native slash-command autocomplete.
- **Resolution**: Resolved 2026-05-02 — Tier 2 step 2.1, commit `8ea8e4a`. `client.application.commands.set([factorySlashCommand], guildId?)` runs on `Events.ClientReady`; guild-scoped when `config.guildId` is set, global otherwise. `interactionCreate` dispatches the seven subcommands (`status / spend / findings / resume / cancel / budget / build`) via the shared `runSubcommand` → `embed<Cmd>` pipeline that 2.2 then split into `command-handlers.ts`.

### U012 — Telegram does not call setMyCommands

- **Severity**: high
- **Tier**: 2
- **Area**: channels / telegram
- **Description**: Telegram supports a bot-command menu via the `setMyCommands` API. factory5's Telegram plugin doesn't call it. The Telegram `/` autocomplete shows nothing for the bot.
- **Resolution**: Resolved 2026-05-02 — Tier 2 step 2.2, commit `22e0e54`. `start()` calls `setMyCommands` with the seven-command list shared with Discord (`FACTORY_TELEGRAM_COMMANDS`); the parser dispatches `/cmd args` through the new transport-agnostic `command-handlers.ts` module so Discord and Telegram can never drift. HTML `<pre>` tables for tabular replies (status, spend, findings).

### U013 — No inline-keyboard / button affordances for pending-question UX

- **Severity**: medium
- **Tier**: 2
- **Area**: channels / discord / telegram
- **Description**: Pending-question round-trip is plain text on both Discord and Telegram. Discord supports buttons; Telegram supports inline keyboards. _"Answer / Skip / Escalate"_ buttons would be a meaningful UX upgrade.
- **Resolution**: Resolved 2026-05-02 — Tier 2 step 2.3, commit `682afd3`. Brain already stamps `metadata: { kind: 'ask_user', questionId }` on `ask_user` outbounds; channel `send()` reads the metadata and attaches buttons (`ActionRowBuilder` for Discord, `reply_markup.inline_keyboard` for Telegram). Discord Answer button opens a `ModalBuilder`; modal submit records the operator-typed text. Telegram poll loop widens `allowed_updates` to `['message','callback_query']`; Skip/Escalate write synthetic answers; Answer fires `answerCallbackQuery` directing the operator to use Telegram's native Reply feature (existing reply path then routes the answer). The legacy thread-reply / reply-to-bot answer path is preserved as a fallback.

### U023 — Brain triage routes channel chat to `intent=chat` rather than the eight-intent vocabulary

- **Severity**: high
- **Tier**: 2
- **Area**: brain / channels
- **Description**: The brain understands `build / fix / review / investigate / chat / status / resume / cancel`. Today, channel-originated chat (Discord thread reply, Telegram DM) becomes `intent=chat` regardless of content. A user asking _"what's the budget?"_ in Telegram gets a chat-intent LLM round-trip rather than a structured status response.
- **Resolution**: Resolved 2026-05-02 — Tier 2 step 2.5, commit `72c45e3`. Triage prompt expanded with 8-intent guidance, ten worked examples, and the `<0.7` confidence floor for non-chat. New `ChannelContext.classifyIntent` callback bound by the daemon to `brain.triageDirective`. Channel handlers (Discord + Telegram) call `routeChatIntent` which maps `status` (+ keyword pass for spend/findings) → `runStatus`/`runSpend`/`runFindings`, and `resume` (+ project token extract) → `runResume`. `cancel` stays explicit-only (needs a ULID); `build`/`fix`/`review`/`investigate`/`chat` fall through to the legacy chat-directive path. Intent enum kept at 8 to avoid a SQLite CHECK-constraint migration; the channel-side keyword sub-router picks spend vs findings within `intent=status`.

### U006 — Web UI directive detail has no live updates

- **Severity**: high
- **Tier**: 3
- **Area**: web
- **Description**: After kicking off a build, the SPA redirects to `directives/detail?id=...`. The page loads once and never refreshes. Tasks transitioning, findings appearing, spend ticking up — none of it is visible without a manual reload.
- **Resolution**: Resolved 2026-05-06 — Tier 3 step 3.1 (route/hub) + 3.2 (page wiring), `phase-3-web-ui-closed`. SSE on `GET /api/v1/directives/:id/stream` with six event types (`task.started/completed`, `finding.created`, `spend.updated`, `log.line`, `directive.completed`); per-directive `DirectiveStreamHub` subscription map, 15 s `:keepalive` heartbeats, backfill burst on connect that makes connect-after-build idempotent. `directives/detail.astro` consumes via `EventSource` with token-via-`?t=` accommodation; polling fallback for SSE-stripped proxies. ADR 0029 pins the protocol; live-verification record completed in 3.7's `node-sse-smoke` build (six event types confirmed end-to-end).

### U007 — Web UI has no chat surface

- **Severity**: high
- **Tier**: 3
- **Area**: web
- **Description**: To talk to the brain conversationally, the operator must drop to `factory chat` (terminal) or use Discord/Telegram. The dashboard has zero conversational affordance.
- **Resolution**: Resolved 2026-05-06 — Tier 3 step 3.5, `phase-3-web-ui-closed`. New `apps/factory-web/src/pages/chat.astro` mirrors `factory chat` end-to-end against a real factoryd; new `POST /api/v1/chat/messages` route mints `intent=chat` directives; the page subscribes to the same SSE stream from 3.1 for token-by-token reply rendering. Slash-prefixed reads (`/status`, `/spend`, `/findings`) re-route through Phase 2's shared `command-handlers.ts` so Discord, Telegram, and web-chat never drift.

### U008 — Web UI uses `el()` builder pattern instead of Astro components

- **Severity**: medium
- **Tier**: 3
- **Area**: web
- **Description**: Each page in `apps/factory-web/src/pages/` hand-builds DOM with `mount.appendChild(el('div', {}, ...))`. No shared components; no reuse beyond the `el()` helper in `lib/api.ts`. Astro's component model is not used.
- **Resolution**: Resolved 2026-05-03 — Tier 3 step 3.3 (component library) + 3.4 (page conversion), commit `dfd1a07` closed 3.4. Astro component library shipped: `<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>`, `<Field>`, `<Submit>`, `<PageShell>`. All 10 pages converted; `el()` and `loadInto()` retired from `lib/api.ts`. Migration map covered list pages, detail pages, the build form, and `directives/detail`'s per-page DOM helper for the live SSE render path. Dashboard's class-based primitives (`.btn*`, `.alert*`, `.form-*`, table base) survive intentionally — slot-content scoping discovery captured in `apps/factory-web/src/components/README.md`; full PageShell adoption + `<style is:global>` migration deferred to Phase 4.

### U009 — Web UI has no mobile-specific design

- **Severity**: medium
- **Tier**: 3
- **Area**: web
- **Description**: `Dashboard.astro` has horizontal nav with no responsive collapse; tables and forms aren't tested below ~600 px. `viewport` meta is set but layout doesn't adapt.
- **Resolution**: Resolved 2026-05-05 — Tier 3 step 3.9, commit `5a15b1a`. `Dashboard.astro` gains a `<details>`-based hamburger drawer at ≤768px (zero JS, native a11y, keyboard- and screen-reader-friendly); 44×44px tap target per Apple HIG; `@media (max-width: 640px)` stacks paired-column `.form-row` to single column; `Table.astro` wraps `<table>` in a `.table-wrap` div with `overflow-x: auto` for horizontal scrolling on wide data tables. Operator visual verification across desktop, ≤768px, 375px (iPhone SE), <640px breakpoints + keyboard nav + light/dark.

### U010 — Web UI sessionStorage token UX is fragile

- **Severity**: low
- **Tier**: 3
- **Area**: web
- **Description**: Token in `sessionStorage` survives reload but dies on tab close. No explicit logout. No "your session is fresh" indicator. If the operator closes the tab they have to re-fetch the URL via `factory ui-token`.
- **Resolution**: Resolved 2026-05-05 — Tier 3 step 3.10, commits `d544192` (feat) + `3cecb72` (follow-up fix). Header gains a connection-status pip + Sign out button; layout-level heartbeat (30 s poll on `/api/v1/status`) drives the pip across all pages; state machine 0 failures → green `Connected` / 1-2 → amber `Reconnecting…` / 3+ → red `Disconnected`; no token in store → red `Signed out`. Theme-independent traffic-light colors (`#2a8` / `#d80` / `#c24`); `aria-live="polite"` announces transitions. Logout flow: `clearToken()` + redirect to `/app/?logged-out=1`; logged-out banner unhides on the URL param then strips it via `history.replaceState`. Stale-token (401) short-circuits to red `Session expired` with a hover tooltip naming `factory ui-token` as the recovery command — error-class differentiation that the generic 3-failure cycle hid.

### U022 — `el()` helper does not escape `setAttribute` arguments

- **Severity**: low
- **Tier**: 3 (folded into the component refactor)
- **Area**: web
- **Description**: `apps/factory-web/src/lib/api.ts:158` — `e.setAttribute(k, v)` is called with raw values from object spreads. Text content is safe (uses `createTextNode`), but attributes are not escaped. Today the only attribute values come from server-trusted strings, so practical risk is low. Still: not a robust pattern.
- **Resolution**: Resolved 2026-05-03 — Tier 3 step 3.4, commit `dfd1a07`. `el()` retired from `lib/api.ts` as part of the 10-page component conversion; the unsafe `setAttribute(k, v)` callsite no longer exists. Component primitives (`<Card>`, `<Table>`, `<Alert>`, `<Form>`, etc.) encode safe rendering by construction (Astro auto-escapes interpolated values).

### U018 — CLI has no `--help` examples beyond Commander defaults

- **Severity**: medium
- **Tier**: 4
- **Area**: cli
- **Description**: `factory build --help` lists flags but doesn't show worked examples. New operators don't know what a real invocation looks like.
- **Hypothesis**: Use Commander's `addHelpText('after', '...')` per command with a worked invocation.
- **Resolution**: Resolved 2026-05-06 — Tier 4 step 4.6, commit `91eebca`. Every command in `packages/cli/src/commands/` gained an `addHelpText('after', ...)` block with worked examples and an `Exit codes:` line; `cli.ts` got `addHelpText('afterAll', ...)` pointing at `docs/WORKFLOWS.md`. New `packages/cli/src/help-coverage.test.ts` walks the Commander tree, captures rendered help via `cmd.outputHelp()` with a stub writer (`helpInformation()` doesn't fire the `addHelpText` events), and asserts every leaf shows `Examples:`. Sonic-boom-on-help flush race fixed in `apps/factory/src/main.ts` via argv-sniff so help/version paths skip the async logger init.

### U019 — CLI has no tab completion

- **Severity**: low
- **Tier**: 4
- **Area**: cli
- **Description**: Commander supports tab completion via `commander.completion()` or shellcomp. Not wired today.
- **Resolution**: Resolved 2026-05-06 — Tier 4 step 4.5, commit `9340cfd`. New `packages/cli/src/commands/completion.ts` emits a static tab-completion script for bash, zsh, or pwsh. Single-source-of-truth pattern: `TOP_LEVEL_COMMANDS` (19 entries) + `NESTED_SUBCOMMANDS` (7 groups) drive all three template generators (bash `compgen -W`; zsh `_describe` / `_values`; pwsh `Register-ArgumentCompleter -Native`). Static surface only — dynamic completion (project names, directive ids) intentionally deferred per the tier-4 plan §4.5 risks-and-decisions ('dynamic requires running `factory` inside the completion script, latency on every tab press'). 9 unit tests pin the structural invariants.

### U020 — CLI has no `factory project ...` command set

- **Severity**: medium
- **Tier**: 4
- **Area**: cli
- **Description**: Project management is implicit (a side-effect of `factory init` and `factory build`). No `factory project list / show <name> / delete <name>`.
- **Resolution**: Resolved 2026-05-06 — Tier 4 step 4.3, commit `9da25ba`. New `packages/cli/src/commands/project.ts` with three pure handlers (`runProjectList` / `runProjectShow` / `runProjectDelete`) + Commander wiring. `list` enriches each registry row with on-disk `language` and a most-recent-build summary; missing or corrupt project.json renders affected fields as `(unavailable)`. `show` resolves a project ref (name-first, full-ULID-second; ambiguous names error with a disambiguation list). `delete` defaults to non-destructive `y/N`-prompted unregister; `--force` skips the prompt; `--purge` adds a typed-name second confirm and `rm -rf`s the workspace dir; order on `--purge` is registry-first-then-rm so a failed rm leaves the registry clean. New `packages/state/src/queries/projects.ts:remove`. 22 unit tests via an injectable `prompt` fn.

### U021 — CLI has no `factory budget set` command (only via flags)

- **Severity**: medium
- **Tier**: 4
- **Area**: cli
- **Description**: Budget changes go through the web UI's `PUT /api/v1/projects/:id/budget`. The CLI has no sibling. Operators must edit `project.json` by hand or use the web UI.
- **Resolution**: Resolved 2026-05-06 — Tier 4 step 4.2, commit `fa28e6d`. New `packages/cli/src/commands/budget.ts` writes `<workspace>/<project>/.factory/project.json` `metadata.budgetDefaults` via `@factory5/wiki`'s `updateProjectMetadata` — the same code path the daemon's `PUT /api/v1/projects/:id/budget` route uses (ADR 0027 §1). **Per-field merge** is the distinguishing CLI semantic: passing only `--max-steps` preserves an existing `maxUsd`, so operators never have to re-state the whole budget block (the web UI's PUT remains full-document replacement; divergence intentional and called out in the README). Project ref resolution is name-first / full-ULID-second; ULID-suffix matching intentionally not supported here. 15 unit tests cover per-field merge in both directions, idempotence, both Wiki error classes, and validation rejections.

### U024 — `prompts/agents/README.md` status table is stale

- **Severity**: low
- **Tier**: 5
- **Area**: docs / brain
- **Description**: `prompts/agents/README.md:14-26` — the Files table lists all nine factory5-native agent prompts as `Status: stub`, but only three are pure stubs (`reviewer.md`, `fixer.md`, `investigator.md` — all 10 lines each). Five have substantive bodies (`triage.md` 99 / `architect.md` 78 / `planner.md` 197 / `scaffolder.md` 177 / `verifier.md` 97 lines), and one is hybrid (`builder.md` 64 lines — Python venv discipline body, no surrounding TDD body). The "Phase 1 work" trailer at lines 46-48 is also stale: Phase 1 long since shipped Tier-1 doc work, not prompt content. Misleads any reader trying to assess prompt completeness.
- **Hypothesis**: Drop the Status column entirely and replace the table columns with `File | Role | Purpose` (purpose = a one-line summary derived from the prompt body or `docs/AGENTS.md`). Drop the "Phase 1 work" section. The legacy/ rows can keep their factory2-provenance note since that's accurate; consider folding it out of the table into a one-line note above or below.
- **Resolution**: Resolved 2026-05-07 — Tier 5 step 5.2, commit `e08f062`. Dropped the Status column entirely; replaced the table columns with `File | Role | Purpose` (one-line role description per row, sourced from `docs/AGENTS.md` so the two docs can't drift). Dropped the "Phase 1 work" trailer. Dropped the "from factory2" provenance language from the legacy/ rows; folded those rows into a single explanatory paragraph below the table that calls out legacy/ is reference-only and not loaded by `packages/brain/src/agents/registry.ts`.

### U025 — `docs/ONBOARDING.md` §5.4 has two stale claims about the web UI

- **Severity**: medium
- **Tier**: 5
- **Area**: docs
- **Description**: `docs/ONBOARDING.md:206` — "The detail pages are **read-once**: they don't refresh as the brain progresses through tasks. … Live updates via SSE land in Tier 3 of the upgrade." Tier 3 shipped (`phase-3-web-ui-closed`); step 3.1 + 3.2 put SSE on `GET /api/v1/directives/:id/stream` and wired `directives/detail.astro` to consume it (closes U006). `docs/ONBOARDING.md:208` — "The build form **refuses to create new projects** — the project must already exist on disk … ADR 0025 / Phase 11 charter put project creation explicitly out of scope for the SPA." But `apps/factory-web/src/pages/projects/new.astro` exists and `/app/projects/new` is wired live. Both claims are stale post-Tier-3.
- **Hypothesis**: Sweep §5.4 to reflect Tier-3 reality — drop the read-once paragraph and describe the SSE live-update path (point at ADR 0029 which pinned the protocol); drop the "build form refuses" paragraph and describe `/app/projects/new` with whatever guardrails actually apply. The "Today's limitations" section title may need a re-think since the limitations enumerated there no longer exist; let 5.3 pick.
- **Resolution**: Resolved 2026-05-07 — Tier 5 step 5.3, commit `27dc6c7`. Re-titled §5.4 from "Today's limitations" to "Live updates + write-mode" (the section now describes capability rather than gaps). New first paragraph confirms SSE live updates on `/api/v1/directives/:id/stream` with the 15 s `:keepalive` heartbeat + connect-time backfill + polling fallback for SSE-stripped proxies, citing ADR 0029. New second paragraph confirms full write-mode (build, projects/new, projects/detail budget edit, questions/detail answer, chat) and notes all writes share the brain-side state package the CLI uses, citing ADR 0027 for the mutation surface. Also added missing rows to §5.3's page tour table (`/app/chat/`, `/app/projects/new/`) and tagged the `directives/detail` row as SSE-live.

### U027 — Fixer agent output → `updateFindingStatus` has no parser path

- **Severity**: medium
- **Tier**: 6
- **Area**: brain / worker
- **Description**: `prompts/agents/fixer.md` (written in Tier 5 5.5) documents `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): <prose>` as the fixer agent's output marker grammar, but no code parsed agent output for those markers. `packages/wiki/src/findings.ts:196` exported `updateFindingStatus(fid, status, resolution)` but it was only invoked from tests. When the fixer agent declared a finding fixed, the operator had to hand-edit `findings.json` (or run a CLI command that didn't exist) to flip the row.
- **Resolution**: Resolved 2026-05-07 — Tier 6 step 6.3, commit `<this commit's sha>`. New parser at `packages/worker/src/parse-resolutions.ts` (line-anchored strict regex matching the canonical grammar; rejects missing parens, missing colon, status outside the enum, FIDs without `F` prefix, and mid-line mentions). New `persistResolutions(...)` in `run-worker.ts` dispatches `updateFindingStatus` for each parsed marker, sequenced after `persistFindings` at both run-worker call-sites to avoid the read-modify-write race on `findings.json`. Unknown FIDs log a warning and skip (no task failure). 9 unit tests in `parse-resolutions.test.ts` cover happy path, all three statuses, case-insensitivity, multi-line capture, malformed rejection, line-anchored anti-prose, whitespace tolerance, and back-to-back resolutions. `prompts/agents/fixer.md` updated to drop the "no parser today" caveat — the marker grammar is now a real runtime contract. Worker package goes from 38 → 47 tests; workspace total 1144 + 3 skipped.

### U028 — `factory findings mark <id> <status>` CLI verb missing

- **Severity**: low
- **Tier**: 7
- **Area**: cli
- **Description**: Tier 6 step 6.3 wired the agent-side `RESOLUTION` parser at `packages/worker/src/parse-resolutions.ts` so fixer agent output like `RESOLUTION F001 (FIXED): <prose>` causes `updateFindingStatus(F001, FIXED, "<prose>")` to fire. The operator-side parallel didn't exist — no `factory findings mark <id> <status>` CLI verb. When a fixer agent doesn't run (or the operator wants to mark something `WONTFIX` directly without invoking the fixer), the only path was hand-editing `<workspace>/<project>/.factory/findings.json`. The existing `factory findings` group had `list` / `show` / `backfill`; `mark` was the missing 4th.
- **Hypothesis**: Pure composition. New `runFindingsMark(db, rawId, rawStatus, opts)` handler in `packages/cli/src/commands/findings.ts` mirrors `runFindingsShow`'s disambiguation pattern (`findingsRegistry.findByFindingId` for bare ids; `getByProjectAndId` for `<project>/<id>` form), then calls `updateFindingStatus(entry.projectPath, finding.id, status, opts.note)` against the existing `packages/wiki/src/findings.ts:196` API. Status enum `OPEN | FIXED | VERIFIED | WONTFIX` matches the runtime; `--note <prose>` flows to the `resolution` parameter the same way the parser populates it from `RESOLUTION` marker prose. No new dependencies; no new ADRs expected.
- **Resolution**: Resolved 2026-05-07 — Tier 7 step 7.2, commit `<this commit's sha>`. New `runFindingsMark` handler in `packages/cli/src/commands/findings.ts` (pure async; takes `Database` + `rawId` + `rawStatus` + `MarkCommandOptions`, returns `{ stdout, exitCode }`). Status normalization is case-insensitive on input; output renders upper-case (`OPEN → FIXED` shape). Bare-id ambiguity emits the same `renderAmbiguity` block `runFindingsShow` uses — operators see one consistent disambiguation pattern across read and write surfaces. `--note <prose>` populates `resolution` via `updateFindingStatus`'s 4th param; `FindingRegistryBinding` is constructed from the resolved entry's `projectId` so both per-project `findings.json` and the cross-project registry stay in sync. Idempotent re-flip succeeds and preserves `resolvedAt` per the runtime contract. 8 unit tests in `packages/cli/src/commands/findings.test.ts` (bare-id happy path / `<project>/<id>` form when bare would be ambiguous / ambiguous bare-id rejection / invalid status / not-found in both bare and `<project>/<id>` forms / `--note` persistence / case-insensitive input / idempotent re-flip preserves resolvedAt). `packages/cli/src/commands/completion.ts` `NESTED_SUBCOMMANDS.findings` grew by `'mark'`. `packages/cli/README.md` findings table row + section text describe the new verb. CLI package: 133 → 141 tests (+8); workspace total 1144 → 1152 + 3 skipped.

### U026 — `skills/*` — 12 ported-from-factory2 skills with no factory5 audit

- **Severity**: low
- **Tier**: 6
- **Area**: docs / skills
- **Description**: All 12 skills in `skills/` carried the "Initial skills ported from factory2/skills/. New skills follow the same shape." provenance line in `docs/SKILLS.md:7` without an audit pass against factory5 architecture. Tier 5 5.4–5.7 prompt rewrites referenced six skills by name without deep-reading their bodies; reference-only inspection at use-site missed body-level drift.
- **Resolution**: Resolved 2026-05-07 — Tier 6 steps 6.2 (audit verdicts) + 6.4..6.9 (per-skill rewrites) + 6.last (provenance drop + hot-fixes), final commit `<this commit's sha>`. 6.2's audit classified the 12 skills as 4 clean (`architect`, `ask-user`, `documentation`, `tdd`), 2 hot-fix (`brainstorming`, `integration-testing`), 6 rewrite (`code-review`, `dependency-install`, `error-recovery`, `progress-tracking`, `scaffolding`, `work-verification`). 6.4..6.9 landed factory5-native rewrites for the 6 (commits `1ea2d82`, `1e5a67e`, `d7a9b7e`, `7b409ac`, `f1e1075`, `a4b51e6`) — common drift addressed: BUILD.md as canonical persistence surface (replaced with findings_registry per ADR 0021); CRITICAL/WARNING/INFO severity terminology (replaced with FINDING [LOW|MEDIUM|HIGH|CRITICAL] grammar); `--break-system-packages` antipattern (replaced with venv discipline); FACTORY_COMPLETE legacy token (replaced with FINDING-as-output + ADR 0018 advisory framing); npm vs pnpm; sparse TypeScript sections (expanded to factory5-equal depth). 6.last applied the two hot-fixes (brainstorming line 14 BUILD.md from source list; integration-testing line 94 BUILD.md completion-marker → tests-green signal + FINDING [HIGH]), dropped the "Initial skills ported from factory2/skills/" provenance line in `docs/SKILLS.md:7` (replaced with "Skills are factory5-native"), updated the `factory2/src/factory/skills.py` historical analog reference at `docs/SKILLS.md:45` (now points at `packages/brain/src/prompts.ts`'s `loadSkill(id)`), and updated `scaffolding.md`'s frontmatter description to drop the BUILD.md-as-project-state-signal framing. Final state: zero `factory2` references in skill bodies or `docs/SKILLS.md`; zero canonical-BUILD.md prescriptions (instructive negative references — "you don't write BUILD.md" — preserved in `progress-tracking.md` + `scaffolding.md` per the runtime reality that the worker auto-appends per-task lines).
