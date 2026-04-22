# Phase 7 — progress & roadmap

> Phase-level overview of the Phase 7 arc. `docs/PROGRESS.md` has the
> session-by-session history; this file tracks the _shape_ of Phase 7
> (what's done, what's next, what "done" looks like).

## Where we were, end of Phase 6

Phase 6 closed 2026-04-21 (Phase6_Progress.md). 6c (verifier advisory,
ADR 0018) and 6a (findings registry) shipped; 6b (GitHub channel) was
dropped per ADR 0019 with the durable doctrine "factory's effects in
the world are operator-directed per-directive, not pattern-driven."
309 tests green; 19 ADRs; Phase 6 exit criteria #1, #3, #4, #5
satisfied, #2 amended.

Operating surface at Phase 6 close:

- **No hard ceiling on cost or step count.** Phase 6c's live build
  cost $7.71 against a $4–6 envelope (28–92% overshoot). Only bound
  on runaway loops was `claude-cli --max-turns` (per-stream) and the
  planner's own task cap. Retry loops and stall-grind loops had no
  ceiling at all.
- **Verifier signal is now advisory (ADR 0018)** and the findings
  registry gives cross-project visibility, but neither touches spend.
- **`CompleteArchitecture.md` §12 line 454** flagged `max_usd` /
  `max_steps` as "anti-loop guardrails lifted from OmO" from day 1.
  Deferred since scaffold time.

## Phase 7 scope

Three sub-phases, strict order, each a cohesive chunk (see
`.control/phases/phase-7-budget-discipline/README.md`):

| Order | Sub-phase | Name                                         | Pitch                                                                                                                                               | Est. sessions | Status                    |
| ----- | --------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------- |
| 1st   | **7a**    | Budget enforcement (`max_usd` / `max_steps`) | Pre-call ceilings enforced before each LLM call. CLI flags + config defaults. Graceful escalation when exceeded.                                    | 1             | 🟢 closed (this document) |
| 2nd   | **7b**    | Cross-session spend dashboard                | `factory spend` subcommand — per-project / per-directive / per-day spend aggregations over `model_usage`.                                           | 1–2           | 🟢 closed (this document) |
| 3rd   | **7c**    | Telegram channel                             | Third `ChannelPlugin` (after CLI + Discord). Long-polling event source. Discord is the reference channel (GitHub was dropped Phase 6 per ADR 0019). | 1–2           | 🟢 closed (this document) |

Each sub-phase closes independently (`phase-7a-budget-enforcement-closed`,
etc.). Phase 7 as a whole closes when all three ship, with tag
`phase-7-closed`.

## Phase 7a — budget enforcement (shipped 2026-04-21)

### Decision: rolling average + fail-closed pre-call check

ADR 0020 picked approach (3) + (2) as fallback — rolling average of
observed `cost_usd` from `model_usage` per `(category, mode)`, falling
back to a baked-in `DEFAULT_CATEGORY_COST` table during cold-start.
Enforcement lives in `packages/brain/src/budget.ts` via a single
`assertBudget(...)` check; providers stay dumb about budgets. The
check fires **before** the provider call, so a tripped ceiling leaves
no in-flight subprocess to kill and no orphan `tasks_inflight` rows.

Two new database columns (migration 005) on `directives`:
`max_usd REAL` + `max_steps INTEGER`, both nullable (absent =
unlimited — pre-Phase-7 behaviour). One schema addition (migration 004)
on `model_usage`: `mode TEXT CHECK (mode IN ('call','stream'))` so the
rolling-average estimator can bucket by invocation mode (tool-using
streams cost an order of magnitude more than one-shot calls and must
not pool).

Three new state queries:

- `modelUsage.countForDirective` — feeds `max_steps` check; counts
  errors too (retry loops must count).
- `modelUsage.averageCostByCategory(db, category, mode, sampleSize=20)`
  — rolling-average estimator; excludes error + NULL-mode rows.
- `totalCostForDirective` (pre-existing) feeds the `max_usd` check.

Escalation shape: on `BudgetExceededError`, the outer `loop.runInline`
marks the directive `blocked` with `directives.blocked_reason =
'budget_exceeded_usd: spent=$… ceiling=$… est=$… calls=… agent=…'`
(or `budget_exceeded_steps: calls=N/M agent=…`), queues a structured
outbound message on the originating channel with a
`factory resume <directive> --max-usd <higher>` hint, and returns a
minimal `InlineResult` with `terminalStatus='blocked'`.

### Sub-steps shipped

Full checklist: `.control/phases/phase-7-budget-discipline/steps.md`.
Commits in order:

- **7a.1** — `d295dd3` docs(7a.1): ADR 0020 — pre-call cost estimate approach
- **7a.2** — `9a22cc1` feat(7a.2): state queries for budget enforcement
- **7a.3** — closed as no-op per ADR 0020 (no commit; checkbox flipped in 7a.4)
- **7a.4** — `194ef4f` feat(7a.4): pre-call budget enforcement in the brain
- **7a.5** — `d7b250c` feat(7a.5): CLI flags --max-usd / --max-steps on factory build
- **7a.6** — `56aaafb` feat(7a.6): config defaults for budget ceilings
- **7a.7** — `3dafa13` test(7a.7): synthetic-build budget-exceeded regression
- **7a.8** — live validation (see below)
- **7a.9** — phase-7a close commit + tag

### Test coverage

347 tests across 13 packages at 7a close (was 309 at Phase 6 close;
+38 across 7a: 3 migration 004 shape, 14 model-usage queries, 3
migration 005 shape, 12 budget unit tests, 3 budget integration
regression tests, 2 config budget-defaults tests, with one adjustment
to an existing migration idempotency assertion).

Per-package counts at close: core 14, logger 5, ipc 5, providers 37,
state 54, assessor 42, channels 25, wiki 27, events 3, worker 24,
brain 59, daemon 28, cli 24.

### Live validation (step 7a.8) — passed 2026-04-21

`factory build example --max-usd 3 --autonomy autonomous --inline`
against a fresh `C:\Users\Momo\factory5-v7a-example` workspace.
Directive `01KPRHNEX1T3VR3S4ZTTSJ8F0M`. Ran for ~7 minutes 44 seconds
(17:33:32Z → 17:41:16Z), tripped the ceiling mid-build as designed,
exited `0` with `status=blocked`.

Per-call breakdown from `model_usage`:

| #   | Agent      | Category / mode      | Model             | Spend   | Cumulative |
| --- | ---------- | -------------------- | ----------------- | ------- | ---------- |
| 1   | triage     | `quick` / `call`     | claude-haiku-4-5  | $0.0157 | $0.0157    |
| 2   | architect  | `reasoning` / `call` | claude-opus-4-7   | $0.4749 | $0.4906    |
| 3   | planner    | `planning` / `call`  | claude-sonnet-4-6 | $0.1040 | $0.5946    |
| 4   | scaffolder | `planning` / stream  | claude-sonnet-4-6 | $0.1438 | $0.7384    |
| 5   | builder #1 | `deep` / stream      | claude-opus-4-7   | $1.1767 | $1.9151    |

At the 6th dispatch (builder #2), the pre-call check fired:

`spentSoFar=$1.9151, estimatedCost=$2.00 (cold-start default for
  deep/stream — only one stream sample in history, below the 2-sample
  floor), ceiling=$3.00 → $1.9151 + $2.00 = $3.9151 > $3.00 → trip.`

Persisted state after the run (direct SQLite query via
`modelUsage.totalCostForDirective` + `directives.getById`):

- `directive.status` = `'blocked'`
- `directive.blockedReason` =
  `budget_exceeded_usd: spent=$1.9151 ceiling=$3.00 est=$2.0000 calls=5 agent=builder`
- `directive.limits` = `{ maxUsd: 3 }`
- `model_usage` rows: 5, all with `mode` populated
  (triage/architect/planner = `'call'`; scaffolder/builder-1 = `'stream'`)

What the run proved:

1. **Per-call enforcement lands before the provider.** No claude-cli
   subprocess for builder-2; no orphan `tasks_inflight` row for the
   refused task.
2. **The $3 ceiling holds — $1.08 of headroom at the halt.** Phase 6c's
   $7.71-vs-$4-6 overshoot (the forcing function for Phase 7) is not
   reproducible.
3. **Cold-start estimator is appropriately conservative.** The builder
   category had only one stream sample after builder-1 finished —
   below the `COLD_START_MIN_SAMPLES = 2` floor — so `estimateCostFor`
   correctly fell back to the $2.00 baked-in default rather than
   under-estimating from a single observation.
4. **Escalation shape works end-to-end.** The `blocked_reason` prefix
   is `budget_exceeded_usd:`, grep-friendly; the loop's outer catch
   queues an outbound message on the originating channel; the CLI
   exits `0` rather than surfacing an error (the build ended cleanly
   in a deliberate blocked state, not a crash).

One follow-up noted, not blocking close:

- `InlineResult.taskResults` is empty when the budget-catch returns
  a minimal result, so the CLI build summary shows `0 passed, 0
failed` even when prior tasks completed. The directive's full
  history is recoverable via `factory status` / direct SQL, but the
  in-command summary loses signal. A future polish can propagate the
  partial task outcomes through the catch block.

### Done criteria — all met at close

- [x] All steps checked off with commit references (above)
- [x] `pnpm build` clean, `pnpm test` green
- [x] Regression test: synthetic build hits `max_usd` → clean
      escalation (`packages/brain/src/budget-regression.test.ts`)
- [x] Live validation: `factory build example --max-usd 3` either
      lands early clean or escalates cleanly
- [x] Charter criterion: "no build can cost more than its declared
      ceiling" verifiable in a test — the pre-call estimator + running
      total trip before the call; the regression proves no
      `tasks_inflight` row is ever created for a refused task
- [x] `docs/decisions/` has an ADR for the pre-call-vs-post-call
      decision and the escalation shape (ADR 0020)
- [x] `docs/PROGRESS.md` entry + `docs/Phase7_Progress.md` 7a row
      flipped ✅
- [x] Working tree clean
- [x] Tag `phase-7a-budget-enforcement-closed`

### Out of scope for 7a (deliberately deferred)

- **Mid-call enforcement** — if a `stream()` call runs longer than
  expected and overshoots its own estimate, factory5 sees it only
  after the subprocess terminates. The next call trips; the
  overshooting call itself is not killed mid-flight. ADR 0020 flags
  this; a future watchdog phase can address.
- **Cumulative (cross-directive) ceilings** — Phase 7a ceilings are
  per-directive. Phase 7b's spend dashboard is the natural home for
  cumulative views.
- **Per-model bucketing for the rolling average** — at Phase 7a scale
  each category resolves to one model per session; a category-level
  bucket is correct in practice.
- **Cold-start defaults via config** — the baked-in `DEFAULT_CATEGORY_COST`
  table is tunable via `~/.factory5/config.toml` `[budget.defaults]`
  (the maxUsd / maxSteps defaults). Future refinement: let operators
  override the per-category defaults as well.

## Phase 7b — cross-session spend dashboard (shipped 2026-04-22)

### Decision arc

7b ran two sessions. The first (2026-04-21) opened with what looked
like a small query-layer addition and discovered the I008 pre-condition:
per-project rollup requires a stable project identity, and the existing
`projects.name TEXT PRIMARY KEY` collides on basename across workspaces.
That session pivoted to ADR 0021 + migration 006 (first-class identity
via `<project>/.factory/project.json`) instead of layering on a
known-fuzzy rollup. The second session (2026-04-22) built the
aggregation queries and CLI on top of the now-stable foundation, adding
a round-trip regression that locks the I008 fix end-to-end.

### Data-model prep (7b.1)

ADR 0021 — first-class project identity. Every project carries a
stable ULID in `<project>/.factory/project.json`, written by
`wiki.loadOrCreateProjectMetadata` at first sight and adopted thereafter.
Migration 006 rebased `projects.id` from `name` to the ULID,
demoted `name` to a non-unique column, and added
`directives.project_id TEXT` so spend queries can join without
re-parsing `payload_json`. `findings_registry.project_id` and
`learnings.source_project` were translated from basenames to ULIDs by
the migration's post-hook. I008 (findings-registry basename collision)
closed in the same commit set.

Non-trivial migration — rebuilds three tables and touches the
filesystem. Adopt-or-write semantics for `project.json` keep the
migration idempotent even under retries (re-runs on an identity file
left over from a rolled-back attempt adopt the existing id rather than
overwriting).

### Query layer (7b.2)

`packages/state/src/queries/spend.ts` — four rollup shapes over
`model_usage`, all joined through `directives.project_id`:

- `perProject` — GROUP BY `directives.project_id`; LEFT JOIN
  `projects` for display `name`; orphan / project-less rows collapse
  into a single `(unassigned)` bucket rather than vanishing.
- `perDirective` — GROUP BY `directive_id`; excludes `directive_id IS
NULL` rows (can't attribute a build without a directive). Carries
  project context + first/last `called_at` for timeline display.
- `perDay` — GROUP BY `date(called_at)` (UTC).
- `perModel` — GROUP BY `(provider, model)`.

Shared `SpendFilter { since, until, projectId }` applies uniformly;
`since` inclusive, `until` exclusive, `projectId` narrows through the
directives join. Exported helper `formatProjectDisplay(name, id)`
canonises the ADR 0021 §5 `name (…xxxx)` label in one place.

### CLI surface (7b.3)

`packages/cli/src/commands/spend.ts` — `factory spend` subcommand
following the findings.ts pattern (pure `runSpend(db, opts)` handler +
Commander wrapper). Default view is per-project; `--group-by` switches
between `project | directive | day | model`. `--since` / `--until`
accept relative durations (`7d`, `24h`, `30m`) or strict ISO8601 —
bare numeric strings rejected (`Date.parse('5')` quietly yields year 5
on v8, so the ISO fallback requires a `T` separator). `--project`
accepts full ULID, name, or ULID suffix (case-insensitive via
`projects.id LIKE '%ref'`); ambiguous refs exit 2 with a disambiguation
list. `--json` emits NDJSON; `--limit` clamps 1–1000.

Every tabular view emits a trailing `TOTAL  N calls  $X.XXXX` line.
NDJSON emits rows only — scripts derive totals via `jq`, no
discriminator needed.

### Round-trip regression (7b.4)

`packages/cli/src/commands/spend-roundtrip.test.ts` — the I008
end-to-end regression. Two tmp workspaces, both with basename
`example`. `loadOrCreateProjectMetadata` writes distinct-ULID identity
files; directives + `model_usage` rows seed each; `runSpend` asserts
both `example` projects appear as distinct rows with different ULID
suffixes in the `display` label, per-project `totalUsd` matches
`totalCostForDirective` ground truth, `--project <ulid>` /
`--project <suffix>` isolate individually, `--project example` (the
bare basename) hits the ambiguity path and exits 2. If any layer
reverts to basename-keying — migration rollback, query layer, or CLI
assuming unique names — one of the six assertions fails immediately.

### Sub-steps shipped

Full checklist: `.control/phases/phase-7-budget-discipline/steps.md`.
Commits in order:

- **7b.1** — `71b36ff` docs(7b.1) ADR 0021 scope; `92bebf4`
  feat(7b.1) migration 006 + project-identity helper + insert-path
  wiring; `786698a` prettier format-pass; `1999a14` docs(7b.1) close
  I008 + flip checkbox. I008 closed in the same commit set.
- **7b.2** — `beb540a` feat(7b.2) `@factory5/state` spend aggregation
  queries (`perProject` / `perDirective` / `perDay` / `perModel` +
  `SpendFilter` + `formatProjectDisplay`).
- **7b.3** — `87ef9dd` feat(7b.3) `factory spend` CLI subcommand.
  Live smoke against the real local DB returned 116 model_usage rows
  rolled up across 2 projects (`example (…SG6H)` + `parallel-example
(…9PR3)`) + 2 `(unassigned)` calls, totalling $63.17 — migration 006
  ran on the real DB for the first time and the dashboard rendered
  both projects cleanly.
- **7b.4** — `6743ee3` test(7b.4) round-trip regression for I008 under
  ADR 0021.
- **7b.5** — phase-7b close commit + tag.

### Test coverage

- 7a close: 347 tests
- 7b.1 close: 375 tests (+28: migration 006 shape + backfill,
  project-metadata helper, state.projects id-keyed CRUD, CLI findings
  backfill skip-on-missing-identity, wiki dual-write propagation)
- **7b close: 428 tests** (+53 over 7a close: +28 for 7b.1 above, +23
  for 7b.2 spend aggregations, +24 for 7b.3 CLI handler + window
  parser + project resolver, +6 for 7b.4 round-trip — minus
  double-counting the CLI test count that's already in the +24).

Per-package counts at close: core 14, logger 5, ipc 5, providers 37,
state 92, assessor 42, wiki 39, channels 25, events 3, worker 24,
brain 59, daemon 28, cli 55.

### Done criteria — all met at close

- [x] All steps 7b.1 → 7b.5 checked off with commit references (above)
- [x] `pnpm build` clean, `pnpm test` green (428 tests across 13 packages)
- [x] `pnpm lint` clean, `pnpm format:check` clean
- [x] Round-trip test: two `example` workspaces with distinct
      identities surface distinctly in the dashboard; raw
      `model_usage` sum matches per-project rollup sum
      (`packages/cli/src/commands/spend-roundtrip.test.ts`)
- [x] Live validation: `factory spend` against the real local DB
      renders 2 projects + `(unassigned)` bucket totalling $63.17
      across 116 calls (migration 006 auto-ran and the first-class
      identity propagated through to the dashboard)
- [x] Charter criterion: "operator can see where their spend went
      per-project, per-directive, per-day, per-model without parsing
      `payload_json` by hand" — verifiable in `--group-by` views +
      round-trip test
- [x] I008 closed with regression test (ADR 0021 + migration 006
      covered by 7b.1 tests + 7b.4 end-to-end)
- [x] ADR 0021 authored and accepted (`docs/decisions/0021-first-class-project-identity.md`)
- [x] `docs/PROGRESS.md` entry + this document's 7b row flipped ✅
- [x] Working tree clean
- [x] Tag `phase-7b-spend-dashboard-closed`

### Out of scope for 7b (deliberately deferred)

- **Per-project default budgets** — the `.factory/project.json`'s
  `metadata` extension point would hold per-project `maxUsd` /
  `maxSteps` defaults, but wiring them through CLI / config
  precedence is a follow-up, not a 7b lane.
- **Timezone-aware per-day bucketing** — `perDay` uses SQLite's
  `date()` which yields UTC. Operators in other zones see UTC dates;
  a future `--tz <zone>` flag can render locally without changing
  storage.
- **Totals in NDJSON** — deliberate omission. Consumers derive via
  `jq 'map(.totalUsd) | add'`. Adding a discriminator row would
  force every script to pattern-match.
- **Per-task rollup** — `model_usage.task_id` is populated but not
  surfaced. A future `--group-by task` lane is trivial to add if an
  operator asks.

## Phase 7c — Telegram channel (shipped 2026-04-22)

### Decision: plugin-owned polling loop (ADR 0022)

The handoff from 7b-close envisioned `@factory5/events` growing a
Telegram long-polling `EventSource` that emits `Event` rows the daemon
materialises into directives — matching how `FsWatcher` works.

Once the plugin was implemented that split turned out to be premature.
All the scoping Telegram needs (private-chat vs group, chat allowlist,
`@<username>` mention detection via `entities[]`, `/build` prefix
parsing, bot-identity-aware reply handling) depends on the plugin's
config and `getMe` response. Splitting that across two modules would
duplicate lifecycle and leak state.

Discord's reference plugin shows the alternative: the `discord.js`
websocket lives _inside_ `DiscordChannel`, not as a separate event
source. `TelegramChannel` follows suit — the long-poll loop is an
internal detail of `start()`. `@factory5/events` keeps its tight
charter (observing state changes that may or may not become
directives; `FsWatcher` today, `GitWatcher` / `TmuxWatcher` plausibly
next).

ADR 0022 documents this and closes 7c.3 as a no-op. Reversible if
future Telegram signals need `Event` rather than `Directive`
treatment.

### Plugin design

`packages/channels/src/telegram.ts` — `TelegramChannel` implements
`ChannelPlugin` with id `'telegram'`. Raw HTTP against
`api.telegram.org` (no SDK — `discord.js` is Discord's huge, dedicated
library; Telegram's Bot API is small enough to hit with `fetch`).

- **Config** — `telegramConfigSchema` (`botToken` required,
  `allowedChatIds` integer[] default `[]` = accept-any,
  `buildPrefix` default `/build`, `pollTimeoutSec` 0–60 default 30,
  `testChatId` optional live-run target).
- **Test seam** — `TelegramApi` interface wraps `getMe` / `getUpdates`
  / `sendMessage`. `apiFactory` constructor option lets unit tests
  feed a stub; `autoPoll: false` disables the loop for deterministic
  handler tests. `defaultTelegramApiFactory(botToken)` returns the
  real `fetch`-backed implementation with abort-signal plumbing and
  a network timeout separate from Telegram's long-poll timeout.
- **Lifecycle** — `start()` verifies identity via `getMe` then
  launches the poll loop on a background promise. `stop()` aborts
  the `AbortController`, awaits the loop, closes the owned db handle
  (if any).
- **Inbound handling** — `handleMessage` mirrors Discord's shape:
  ignore bot-authored messages, enforce chat allowlist, scope group
  chats to `@<username>`-mentions or reply-to-bot (`isDirectedAtBot`),
  route reply-to-bot messages to the pending-question answer path
  when a matching row exists, otherwise normalise to a `Directive`
  with `source='telegram'`, `principal=<from.id>`,
  `channelRef=<chatId>#<messageId>`, intent parsed from `/build`
  prefix.
- **Outbound** — `send()` parses `targetRef` as `<chatId>` or
  `<chatId>#<messageId>` and calls `sendMessage`. The `#<messageId>`
  tail becomes `reply_to_message_id` so replies thread visually
  under the trigger — the closest thing Telegram has to a Discord
  thread.
- **Polling discipline** — `getUpdates` with `timeout=30` and an
  offset cursor that advances past each delivered update. Exponential
  backoff on errors (1s → 2s → 4s, cap 30s). Loop exits cleanly when
  the AbortController fires. Documented: `start()` in exactly one
  daemon instance per token (HTTP 409 otherwise).

### Onboarding wiring (so new clones stay one-shot)

- `factory init` gained `--telegram-token`, `--telegram-allowed-chat`
  (repeatable collector → int[]), `--telegram-test-chat`,
  `--telegram-poll-timeout-sec` flags. Integer flags share a
  `parseIntFlag` helper with explicit error messages;
  `--telegram-poll-timeout-sec` range-checked 0–60. Output line
  added: `telegram: configured / (partial — no token)`.
- `factory doctor` gained a Telegram probe that hits `getMe` via
  `defaultTelegramApiFactory` and reports bot username + `testChatId`.
  `--skip-telegram` flag mirrors `--skip-discord`.
- Daemon's `buildDefaultChannelPlugins` auto-wires `TelegramChannel`
  when `[channels.telegram].botToken` is non-empty. A shared
  `hasStringField` helper unified the Discord + Telegram gates.
- `@factory5/cli` now depends on `@factory5/channels` so `doctor`
  can reach the shared api factory.

### Sub-step commits

- **7c.1** — `74ad146` feat(7c.1) clear HALT — record Telegram
  secrets under `[channels.telegram]`. Operator provided bot token +
  private chat-id for `@Factory5_bot`. Persisted to
  `%LOCALAPPDATA%\factory5\config.toml`. Stale `/start` update
  consumed via `getUpdates?offset=<id+1>` so it wouldn't replay at
  the 7c.6 live run. No code change — cursor advance only; secrets
  live outside the repo.
- **7c.2** — `ef650af` feat(7c.2) Telegram `ChannelPlugin` at
  `packages/channels/src/telegram.ts`. 29 new tests (54 channels /
  457 workspace).
- **7c.3** — `63aa80c` docs(7c.3) closed as no-op per ADR 0022.
  Long-polling lives in the plugin; `@factory5/events` stays focused
  on state-observation sources.
- **7c.4** — `784e41b` feat(7c.4) formalise `[channels.telegram]`
  shape + wire init / doctor / daemon. `factory doctor --skip-call
--skip-discord` against the real token returned `getMe: ok (token
accepted)`, `bot: @Factory5_bot`, `testChatId: 1225367797`.
- **7c.5** — `e770815` test(7c.5) round-trip integration tests using
  realistic-shape fixtures modelled on real `getUpdates` responses.
  6 new tests (60 channels / 463 workspace).
- **7c.6** — `b712a09` test(7c.6) live smoke against `@Factory5_bot`.
  `scripts/telegram-smoke.ts` drives the real HTTP path using the
  operator's real config — no stubs, no daemon, no brain, no LLM
  spend. Round-trip passed end-to-end: identity verified, kickoff
  sent as `message_id 5`, operator reply captured 22s later as
  directive `01KPV4AQVDSPA24ZMRP944QYDG`, echo sent as `message_id
7` with `reply_to_message_id=6`, poll loop exited cleanly.

### Test coverage at close

- Per-package: core 14, logger 5, ipc 5, providers 37, state 92,
  assessor 42, wiki 39, **channels 60 (+35 over 7b close, from the
  new Telegram unit + round-trip suites)**, events 3, worker 24,
  brain 59, daemon 28, cli 55.
- **Total: 463 tests (+35 over 7b close at 428).**

### Done criteria — all met at close

- [x] All steps 7c.1 → 7c.6 checked off with commit references (above)
- [x] `pnpm build` clean, `pnpm test` green (463 tests across 13
      packages)
- [x] `pnpm lint` clean, `pnpm format:check` clean
- [x] Unit + integration coverage of the plugin handler (60 tests)
- [x] Live validation: operator's real chat receives a kickoff,
      inbound becomes a `Directive`, outbound echoes back with
      `reply_to_message_id` (7c.6 above)
- [x] Charter criterion: "factory can receive directives and send
      replies via Telegram as a third channel after CLI + Discord" —
      verifiable via `scripts/telegram-smoke.ts` and the round-trip
      test suite
- [x] ADR 0022 authored and accepted
      (`docs/decisions/0022-telegram-polling-in-plugin.md`)
- [x] `docs/PROGRESS.md` entry + this document's 7c row flipped ✅
- [x] Working tree clean
- [x] Tag `phase-7c-telegram-channel-closed`

### Out of scope for 7c (deliberately deferred)

- **Webhook transport** — Telegram supports it but requires a public
  HTTPS endpoint. Long-polling works from anywhere (dev laptop, home
  server without ingress). If a factory5 deployment ever sits behind
  a reachable domain we can add a webhook variant of the event source.
- **File attachments** — `capabilities.fileAttachments = false`.
  Photos / documents arrive on `message` with their own fields; the
  plugin ignores them today because there's no design for
  surfacing a binary payload as part of a `Directive.payload`.
- **Edited messages** — `edited_message` updates are typed in
  `TelegramUpdate` but not processed; a future lane can mutate the
  original `Directive` or emit a correction `Event`.
- **Forum-topic scoping in supergroups** — Telegram's
  `message_thread_id` for forum topics is ignored; all topics in an
  allowed supergroup map to the same logical chat. If operators ask,
  we can surface the topic id in `channelRef`.
- **Slash-command menu via `setMyCommands`** — the UX nicety where
  Telegram auto-completes `/build`. Trivial to add in a follow-up
  `factory telegram sync-commands` subcommand.

## Phase 7 close

All three sub-phases shipped in strict order:

1. **7a — budget enforcement** (`phase-7a-budget-enforcement-closed`)
2. **7b — cross-session spend dashboard**
   (`phase-7b-spend-dashboard-closed`)
3. **7c — Telegram channel**
   (`phase-7c-telegram-channel-closed`)

Phase 7 tag: `phase-7-closed`.

Operating surface at Phase 7 close:

- **Pre-call budget enforcement** on every LLM call — a build can't
  exceed its `max_usd` / `max_steps` ceiling without escalating
  cleanly (ADR 0020). Phase 6c's $7.71-vs-$4-6 overshoot is no
  longer reproducible.
- **Cross-session spend visibility** — `factory spend` rolls up
  `model_usage` per project / directive / day / model with
  first-class project identity (ADR 0021) so the same project name
  in two workspaces surfaces as two distinct rows.
- **Three operator channels** — CLI-RPC, Discord, Telegram — with
  symmetric `ChannelPlugin` lifecycle and config shape.
- **22 ADRs**, 463 tests across 13 packages. No open blockers.

## Pointers

- `docs/Phase6_Progress.md` — predecessor phase, including the
  forcing-function $7.71-vs-$4-6 overshoot that justified Phase 7.
- `docs/decisions/0020-pre-call-budget-enforcement.md` — the
  estimator + escalation decision.
- `docs/decisions/0019-drop-github-integration.md` — the durable
  doctrine that shaped Phase 7c's framing (Discord as the reference).
- `CompleteArchitecture.md` §12 line 454 — the original `max_usd` /
  `max_steps` flag that Phase 7a finally wires.
