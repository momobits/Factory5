# Phase 7 Steps — Budget discipline

> **Placeholder.** Detailed 7a sub-step bodies are authored at the start
> of the 7a session, after the pre-call cost-estimate ADR is decided.
> 7b and 7c placeholders expand when their sessions open.

## Phase 7a — Budget enforcement

- [x] 7a.1 — ADR: pre-call cost estimate approach (how `brain` knows whether the next LLM call will exceed `max_usd`) — [ADR 0020](../../../docs/decisions/0020-pre-call-budget-enforcement.md)
- [x] 7a.2 — `@factory5/state` — running-total query over `model_usage` by directive (`countForDirective` + `averageCostByCategory` + `mode` column via migration 004)
- [x] 7a.3 — `@factory5/providers` — expose per-call cost estimate — **closed as no-op per ADR 0020** (estimator lives in `@factory5/state` + `@factory5/brain`; providers stay dumb about budgets)
- [x] 7a.4 — `@factory5/brain` — pre-call ceiling check in the main loop; halt + escalate when exceeded — migration 005 for `directives.max_usd` / `max_steps`; `budget.ts` module with `assertBudget` / `BudgetExceededError` / `DEFAULT_CATEGORY_COST`; wrappers wired into triage / architect / planner / pool; `loop.ts` catches + flips directive to `blocked` with `formatBlockedReason`
- [x] 7a.5 — `@factory5/cli` — `--max-usd <N>` / `--max-steps <N>` flags on `factory build` write through to `directive.limits`
- [x] 7a.6 — Config defaults in `~/.factory5/config.toml` `[budget.defaults]` (maxUsd / maxSteps). CLI flag wins over config default; both absent = unlimited
- [x] 7a.7 — Regression test: synthetic build hits `max_usd` → clean escalation (not mid-task half-failure). `packages/brain/src/budget-regression.test.ts` covers maxUsd trip (pre-seeded model_usage), maxSteps trip, and the under-budget happy path
- [x] 7a.8 — Live validation: `factory build example --max-usd 3` tripped cleanly at builder-2 dispatch. Directive `01KPRHNEX1T3VR3S4ZTTSJ8F0M`, spent $1.9151 of $3 ceiling, blocked_reason `budget_exceeded_usd: ...`, 5 model_usage rows recorded. Phase 6c $7.71 overshoot not reproducible.
- [x] 7a.9 — Close Phase 7a (tag `phase-7a-budget-enforcement-closed`)

## Phase 7b — Cross-session spend dashboard

- [ ] 7b.1 — Data-model prep: [ADR 0021](../../../docs/decisions/0021-first-class-project-identity.md) — first-class project identity via `<project>/.factory/project.json` (ULID, stable across path moves) + migration 006 (`projects.id` PK; `directives.project_id`; `findings_registry` PK rebased on ULID; `learnings.source_project` migrated) + `loadOrCreateProjectMetadata` helper + insert-path wiring + backfill + tests. Closes [I008](../../../docs/issues/I008-findings-registry-project-id-collision.md) as a beneficial side-effect.
- [ ] 7b.2 — `@factory5/state.queries.spend` — aggregations by project / directive / day / model (joins `model_usage → directives.project_id`)
- [ ] 7b.3 — `factory spend` CLI subcommand with filters (`--since`, `--project`, `--group-by`)
- [ ] 7b.4 — Round-trip test: seed two builds in separate workspaces sharing project basename `example` (each with its own `.factory/project.json`) → query dashboard → both projects appear distinctly with correct totals; raw `model_usage` matches per-project rollup
- [ ] 7b.5 — Close Phase 7b (tag `phase-7b-spend-dashboard-closed`)

## Phase 7c — Telegram channel

- [ ] 7c.1 — **[HALT] secret_needed** — user provides Telegram bot token + target chat-id
- [ ] 7c.2 — `packages/channels/src/telegram.ts` implementing `ChannelPlugin` (Discord is the reference — ADR 0019 dropped the GitHub channel)
- [ ] 7c.3 — Long-polling event source in `@factory5/events` (Telegram's preferred transport; no webhook server needed)
- [ ] 7c.4 — State config for bot-token + allowed-chats allowlist
- [ ] 7c.5 — Round-trip integration test using recorded fixtures
- [ ] 7c.6 — Live run against user-provided test chat
- [ ] 7c.7 — Close Phase 7c (tag `phase-7c-telegram-channel-closed`)

## Phase 7 close

- [ ] Phase-level close: `docs/Phase7_Progress.md` charter complete, 3 sub-phases ✅, tag `phase-7-closed`
