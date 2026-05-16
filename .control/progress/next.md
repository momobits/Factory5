# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at this phase-close.
> Edit STATE.md's "Next action" or "Notes for next session" to influence
> this prompt; **do not edit next.md by hand** — it's overwritten on
> every session end.

## Phase

Phase 12 (budget-ux) active, scaffolded but not started.

## Next action

**Phase 12 (budget-ux) active — start at 12.1 (open U032).**

Phase 11 closed cleanly with `phase-11-directive-log-persistence-closed`.
All 10 done-criteria green: 4 `pnpm` gates clean; migration 010 + state
queries (+7 tests) + daemon hub tee (+4 tests) + GET /logs route (+5
tests) + FE replay all shipped; live browser smoke confirmed
refresh-survives + multi-tab consistency + terminal directive
post-mortem visibility on a $0.6238 smoke-demo build. U031 closed.
Workspace 1200 → 1216 + 3 skipped.

**Tier 12 sub-steps** (per `.control/phases/phase-12-budget-ux/steps.md`):

1. **12.1** — Open U032 in `UPGRADE/ISSUES.md` Open section.
2. **12.2** — ADR 0033 (budget UX paradigm).
3. **12.3** — `BUDGET_DEFAULTS` exported from `@factory5/core`.
4. **12.4** — Web UI Build form "Advanced budgets" accordion.
5. **12.5** — CLI flags on `factory build` + `factory resume`.
6. **12.6** — Directive payload `budgets` field; resume inheritance.
7. **12.7** — Brain escalation on `error_max_turns` via typed askUser.
8. **12.8** — Tier 8 auto-answer adapts.
9. **12.9** — Tests across the escalation path.
10. **12.10** — `/phase-close` + live browser smoke.

**Driving operator quote 2026-05-16:** *"why are we failing instead of
asking the user if we should continue over the budget? why do we have
a max cost and max steps that we ask the user and have other limits
the user does not see?"*

**Read first** when next session resumes:

- `UPGRADE/plans/tier-12-budget-ux.md` — full Tier 12 plan.
- `.control/phases/phase-12-budget-ux/steps.md` — per-step checklist.
- `UPGRADE/ISSUES.md` — U032 description + hypothesis.
- ADR 0030 (auto-answer contract) — 12.7/12.8 adapt the dispatcher.
- `UPGRADE/LOG.md` — Tier 11 entry at the top.

## Notes for next session

See STATE.md's "Notes for next session" section for the full Tier 12
plan, long-standing carry-forwards, frontend-design judgement calls,
and per-tier retrospectives.
