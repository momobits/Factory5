# Phase 12 — budget-ux

**Dependencies:** Phase 11 closed (`phase-11-directive-log-persistence-closed`)
**Estimated duration:** ~2 sessions
**Status:** scaffolded, not started

## Goal

Stop the app from silently picking budget defaults the operator never sees, and stop the app from hard-failing tasks when a budget can be cheaply extended. Surface every operator-felt budget at build time with defaults + explainers; persist them on the directive; resume inheritance; escalate on `error_max_turns` via typed askUser instead of hard-fail.

## Outcome

- Web UI Build form gains an "Advanced budgets" accordion with all six operator-facing budgets (maxUsd, maxSteps, askUserDeadlineMs, maxTurnsScaffolder/Builder/Fixer) + defaults + explainers.
- CLI `factory build` and `factory resume` gain matching flags; `--help` quotes the explainers from a single source.
- New `@factory5/core/src/budget-defaults.ts` is the source of truth for defaults + explainers; CLI/web/project-metadata parsers all read it.
- Directive `payload.budgets` carries the full set; resumes inherit it.
- Brain `pool.ts` catches `error_max_turns` subtype, raises a typed askUser ("Task X ran out of turns; bump to Y?"), and relaunches the task on accept. Tier 8 auto-answer accepts the bump on first failure, aborts on second.
- ADR 0032 pins the budget UX paradigm: operator-facing vs internal-pacing budgets; escalation rule; default-publication contract; persistence contract.

Full plan: [`../../../UPGRADE/plans/tier-12-budget-ux.md`](../../../UPGRADE/plans/tier-12-budget-ux.md).

## Where we were, end of Phase 11

Phase 11 closed by persisting `log.line` events so the activity panel survives reloads and multi-tab. Tier 10's post-close smoke surfaced the deeper issue: even with a persistent activity feed, the operator can't ACT on the visible failure unless they know which knob to turn — and most of the knobs aren't exposed. Tier 12 closes that loop.

## Why this phase exists

Carried forward from Phase 11:
- **Auto-prune retention policy** — sweep that drops log lines older than N days (configurable). Defer-until-signal that the table is growing meaningfully.
- **Search / filter in the activity panel** — free-text grep + level + component filters. UX polish, not load-bearing.
- **Persist task / finding / spend events too** — unify replay across all six SSE event types. Today the snapshot route handles those; would unify the code path.
- **CLI tail** — `factory directive tail <id>` consumes the new logs endpoint and prints live. Composition.

Operator complaint, verbatim 2026-05-16: *"why are we failing instead of asking the user if we should continue over the budget? why do we have a cost limit? why do we have a max cost and max steps that we ask the user and have other limits the user does not see?"*

The codebase has at least 15 hardcoded budgets and timeouts. Operators control 2 (maxUsd, maxSteps). Per-task `maxTurns` failures surface as silent "Task failed" with a generic askUser that doesn't carry the bump-suggestion context. The `error_max_turns` from claude-cli on the automl scaffolder (Tier 10 close smoke) was the canonical example.

Issues addressed: U032 (to be opened in 12.1).

## Steps

See [`steps.md`](steps.md).

## Done criteria

- [ ] All four `pnpm` gates green
- [x] ADR 0032 lands; INDEX.md + ARCHITECTURE.md ADR count bumped
- [x] `BUDGET_DEFAULTS` exported from `@factory5/core`; CLI + Web read from the same source
- [x] Web UI Build form: Advanced budgets accordion (collapsed by default); six fields + defaults + explainers
- [x] CLI: six new flags on `factory build` AND `factory resume`; `--help` post-text quotes explainers
- [ ] Directive payload `budgets` field; resume route inherits it
- [ ] Brain escalation: `error_max_turns` → typed askUser → on accept, relaunch task with bumped budget; on abort, mark failed (current behaviour)
- [ ] Tier 8 auto-answer: bump-by-one-bucket on first failure, abort on second
- [ ] Tests across the escalation path + ipc / cli / fe surfaces
- [ ] Browser smoke: budget-tripping task escalates via askUser; accept → retry → success
- [ ] U032 closes

## Rollback

`git reset --hard phase-11-directive-log-persistence-closed`. No schema changes; no migrations.

## ADRs decided in this phase

- ADR 0032 — Budget UX paradigm (operator-facing vs internal-pacing budgets; escalation rule; default-publication contract; persistence contract). To be authored in 12.2.

## Deferred to Phase 13 (or later)

- **Per-task USD cap** — today only directive-level `maxUsd` exists. Per-task USD ceiling lets the planner say "this scaffolder shouldn't cost more than $1; if it would, escalate." New budget axis; same escalation pattern.
- **Mid-task escalation** — proactive warning when a budget is about to trip, before the worker actually fails. Bigger surface; defer until the post-failure escalation proves out.
- **Per-project default overrides for the new budget axes** — extend `<project>/.factory/project.json` `metadata.budgetDefaults` to cover maxTurns + askUserDeadlineMs. Small; bundle with 12.7 if convenient or carry forward.
- **Budget audit dashboard** — multi-build telemetry view of "you've burned $X across the last N directives; here's where it went." Needs the telemetry foundation first.
