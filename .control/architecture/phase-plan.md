# Phase Plan — factory5

> Phases 1–5 are **closed pre-Control** — they shipped before the framework was installed, so there are no `phase-N-closed` git tags for them. The authoritative record of each closed phase is in `docs/PROGRESS.md` and `docs/Phase5_Progress.md`. Phases from 6 onward are Control-managed (commit-per-step, `phase-<N>-<name>-closed` tags).

## Phase ordering

| #     | Name                                     | Status                                | Depends on | Est. sessions             | Outcome                                                                                                                                                     |
| ----- | ---------------------------------------- | ------------------------------------- | ---------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Scaffold                                 | ✅ closed pre-Control                 | —          | 1                         | Workspace skeleton — 13 packages + 2 apps + 148 files                                                                                                       |
| 1     | Foundations + inline pipeline            | ✅ closed pre-Control                 | 0          | ~3                        | `@factory5/{core,logger,state,ipc,providers,brain}` implemented; inline triage → plan → build                                                               |
| 2     | Tool-using worker subprocess             | ✅ closed pre-Control                 | 1          | ~4                        | scaffolder/builder/fixer as real tool-using subprocesses; worker streams NDJSON                                                                             |
| 3     | Daemon + channels + assisted mode        | ✅ closed pre-Control                 | 2          | ~3                        | `factoryd`, Discord channel, assisted-mode checkpoints, `ask_user`/`escalate_blocked`                                                                       |
| 4     | Phase 2 finale + autonomy modes          | ✅ closed pre-Control                 | 3          | ~3                        | Category routing, autonomy-mode end-to-end, 201 tests                                                                                                       |
| 5     | Green-verify end-to-end                  | ✅ closed pre-Control (2026-04-19)    | 4          | ~5 (5a–5f)                | Autonomous loop proven end-to-end; I001–I007 all resolved; `factory build example` fully green; 255 tests                                                   |
| **6** | **Operator-trust + multi-surface**       | ✅ closed 2026-04-21                  | 5          | 2 of 3 sub-phases shipped | 6c ✅ verifier advisory; 6a ✅ findings registry; 6b ❌ dropped per [ADR 0019](../../docs/decisions/0019-drop-github-integration.md). Tag `phase-6-closed`. |
| **7** | **Operator-control + budget discipline** | 🟢 **active** (7a shipped 2026-04-21) | 6          | 3–5 (7a+7b+7c)            | Budget enforcement ✅ + cross-session spend dashboard + Telegram channel                                                                                    |
| 8     | (TBD)                                    | ⏸ not yet charted                     | 7          | —                         | Options: Web UI, assessor tier-3 pluggable runtimes, worker-subprocess `ask_user`                                                                           |

## Phase 6 — sub-phase schedule

Phase 6 has three independently-shippable sub-phases. They are executed **out of alphabetical order** — 6c first because its forcing function (F001 verifier hallucination) is concrete and scoped; 6a second because Phase 5's corpus of built projects now justifies the registry; 6b last because the GitHub channel is the biggest build and benefits from the patterns laid down by 6c+6a.

Each sub-phase closes with its own tag: `phase-6c-verifier-overhaul-closed`, `phase-6a-findings-registry-closed`. 6b was dropped before shipping (see ADR 0019) so there is no `phase-6b-github-channel-closed` tag. Phase 6 as a whole closes under the charter amendment path (see `docs/Phase6_Progress.md` "exit criteria" — criterion #2 struck through and amended).

| Order | Sub-phase | Name                            | Charter pitch                                                                                                                                                                                                                                                                                                       | Key package(s)                                  | Est. sessions | Outcome                                                                                               |
| ----- | --------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| 1st   | **6c**    | Verifier overhaul               | Fix the verifier hallucination surface — either give it fs tools (Read/Glob/Grep) and keep its gate contribution, or formally downgrade it to advisory (never blocks, always informational). F001 on directive `01KPKRNB2V08QZZD02SKTK6MWP` is the forcing function. Pair with a regression test that replays F001. | `brain`, `worker`, `prompts/agents/verifier.md` | 1             | ✅ Shipped (ADR 0018; advisory path)                                                                  |
| 2nd   | **6a**    | Cross-project findings registry | Aggregate per-project `<workspace>/.factory/findings.json` into a factory-home index (`~/.factory5/findings-registry.sqlite`). Expose `factory findings list [--severity HIGH] [--status OPEN] [--project <glob>]` and `factory findings show <id>`.                                                                | `wiki`, `state`, `cli`                          | 1–2           | ✅ Shipped                                                                                            |
| 3rd   | **6b**    | GitHub channel                  | Parallel `github` implementation to the existing `discord` channel. GH issues / PR comments become directives; `finding:raise` / `terminalStatus` events post back as comments.                                                                                                                                     | `channels`, `events`, `daemon`                  | 2–3           | ❌ Dropped — see ADR 0019. No concrete operator workflow for a solo dev-box user; scaffolding pruned. |

## Per-sub-phase summary

### Phase 6c — Verifier overhaul _(active, execution order #1)_

**Goal:** the verifier's claims never contradict reality again. Today its read-only LLM context makes it hallucinate file absence; on the I007 live run it raised F001 CRITICAL claiming six files missing that all existed on main.

**Decision to land as ADR 0018:** _Authoritative verifier_ (give it Read/Glob/Grep tools, keep it in the gate) vs _Advisory verifier_ (strip its gate contribution, surface findings as informational only).

**Done criteria highlights:**

- ADR 0018 written + accepted
- `prompts/agents/verifier.md` rewritten (it's 6 lines today)
- `packages/worker/src/runWorker.ts` (or relevant) reflects the new verifier shape
- Regression test replays F001: same workspace state, verifier produces correct finding (no hallucination)
- Live rerun of `factory build example` ends `complete`, no spurious CRITICAL findings

Detailed plan: `.control/phases/phase-6c-verifier-overhaul/README.md` + `steps.md`.

### Phase 6a — Cross-project findings registry _(queued, execution order #2)_

**Goal:** operator can see `factory findings list --severity HIGH --status OPEN` across every project ever built, without shell-spelunking.

**Key sub-steps (expanded in `phase-6a-findings-registry/steps.md` when scheduled):**

- `state` migration for `findings_registry` table (project_id, finding_id, severity, status, created, updated, raw)
- `wiki` writes to registry on `addFinding` (in addition to per-project file)
- `cli` subcommand `findings list|show` with filters
- Backfill script for existing projects

### Phase 6b — GitHub channel _(❌ dropped 2026-04-21, before implementation)_

Dropped wholesale per [ADR 0019](../../docs/decisions/0019-drop-github-integration.md). Session transcript: Phase 6b opened cleanly, committed 6b.1 (PAT + test repo scaffolding, commit `c780180`); at 6b.2 the event-source design session surfaced that neither the channel framing (what the Phase 6 charter specified) nor the observer framing (what `CompleteArchitecture.md`'s original scaffold intent described) earned its keep for a solo-operator dev-box user. Channel duplicates the CLI; observer needs factory outputs to live on GitHub first, a prerequisite no phase has built. Dropped wholesale with scaffolding pruned. Durable doctrine recorded in ADR 0019: factory's effects in the world are operator-directed per-directive, not pattern-driven.

## Phase 7 — sub-phase schedule

Three sub-phases, execution order **7a → 7b → 7c**. Each closes independently with its own tag.

| Order | Sub-phase | Name                                         | Charter pitch                                                                                                                                                                             | Key package(s)                       | Est. sessions |
| ----- | --------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------- |
| 1st   | **7a**    | Budget enforcement (`max_usd` / `max_steps`) | Per-build cost + step ceilings enforced before each LLM call. Today a runaway build can burn $20+ silently. `CompleteArchitecture.md §12` line 454 flags this as deferred.                | `brain`, `state`, `providers`, `cli` | 1             |
| 2nd   | **7b**    | Cross-session spend dashboard                | `factory spend` subcommand — per-project, per-directive, per-day spend. Aggregates `model_usage` table. Makes expensive rebuilds visible.                                                 | `state`, `cli`, `wiki`               | 1             |
| 3rd   | **7c**    | Telegram channel                             | Third `ChannelPlugin` implementation after CLI (shipped) and Discord (shipped). Discord is the reference channel — 6b GH channel was dropped per ADR 0019 before its patterns could lock. | `channels`, `events`, `daemon`       | 1–2           |

### Phase 7a — Budget enforcement _(✅ shipped 2026-04-21, tag `phase-7a-budget-enforcement-closed`)_

**Outcome:** pre-call `max_usd` / `max_steps` enforcement in the brain. ADR 0020 picked approach (3) + (2) fallback: rolling average from `model_usage` per `(category, mode)` with a baked-in `DEFAULT_CATEGORY_COST` cold-start table. Enforcement via `assertBudget` in `packages/brain/src/budget.ts`; providers stay dumb about budgets.

**Proved end-to-end:** `factory build example --max-usd 3` tripped cleanly at $1.9151 / $3.00 ceiling (builder-2's pre-call check), directive ended `blocked` with `blocked_reason='budget_exceeded_usd: spent=$1.9151 ceiling=$3.00 est=$2.0000 calls=5 agent=builder'`. No orphan `tasks_inflight` rows. Phase 6c's silent $7.71-over-$4-6 overshoot is not reproducible.

**Schema additions:** migration 004 (`model_usage.mode`) + migration 005 (`directives.max_usd` / `max_steps`). Both nullable — absent = unlimited, pre-ADR-0020 behaviour.

**ADR 0020** — pre-call budget enforcement estimator + escalation shape.

Detailed narrative: `docs/Phase7_Progress.md` §"Phase 7a".

### Phase 7b — Cross-session spend dashboard _(queued, execution order #2 of Phase 7)_

**Goal:** operator can see where their factory5 budget goes. `factory spend` returns rows across all projects and directives.

**Depends on:** 7a's telemetry completeness (running total per build, reliably populated).

**Key sub-steps (expand at phase start):**

- `state.queries.spend` — aggregations by project, directive, day, model.
- `cli spend [--since <date>] [--project <glob>] [--group-by <field>]`.
- Round-trip test: run two builds, query dashboard, verify rows match `model_usage` raw data.

### Phase 7c — Telegram channel _(queued, execution order #3 of Phase 7)_

**Goal:** a Telegram message produces a `directive:new`, runs through the pipeline, replies with terminal status. Parallel to Discord + GitHub.

**Depends on:** Discord's channel-shape validation (the reference channel since 6b was dropped per ADR 0019). If Telegram's long-poll transport surfaces gaps in the `ChannelPlugin` abstraction, fix those in 7c's close-out before promoting the plugin to a published pattern.

**Pause-for-human at start:** Telegram bot token + target chat-id required from user. `[HALT] secret_needed` per Control halt conditions.

**Key sub-steps (expand at phase start):**

- `packages/channels/src/telegram.ts` implementing `ChannelPlugin`.
- Long-polling event source (Telegram's preferred transport; no webhook server needed).
- State config for bot-token + allowed-chats allowlist.
- Round-trip integration test using recorded fixtures.
- Live run against a user-provided test chat.

## Phase 8+ deferred

Items logically beyond Phase 7, parked until a demand signal surfaces:

- **Web UI** — multi-session build, its own phase (probably multi-phase). Requires a non-trivial front-end stack decision (ADR-level). Wait until CLI + channel surfaces are fully mature.
- **Assessor tier-3 — pluggable runtimes** (Go / Rust / JS provisioners). Flagged in ADR 0017. Wait until a non-Python project actually surfaces the need; today's Python-only builds make tier-2 sufficient.
- **Worker-subprocess `ask_user`** (ADR 0015 shape 1) — no evidence yet of mid-tool blocking need; current brain-level `askUser` is holding.

These don't have phase numbers yet. When one activates, charter it as Phase 8 / 9 / etc. via the existing phase-plan.md update flow (edit at end of preceding phase or at start of its session).

## Guidance

- Each sub-phase closes independently — pick one per session, don't try to land multiple.
- If a sub-phase starts expanding beyond estimate, subdivide into `phase-6cN.1` etc. rather than letting the scope creep.
- Every sub-phase has a rollback target: `git reset --hard phase-<prev>-closed` (or `git reset --hard 2a9dbd0` for the first Phase 6 step, since Phase 5 has no tag).
- Out-of-scope for Phase 6 (see `docs/Phase6_Progress.md`): Telegram channel, Web UI, assessor tier-3 pluggable runtimes, worker-subprocess `ask_user`, `max_usd`/`max_steps` enforcement, cross-session spend dashboard.
