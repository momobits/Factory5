# Phase 13 — budget-followups

**Dependencies:** Phase 12 closed (`phase-12-budget-ux-closed`)
**Estimated duration:** 2-3 sessions
**Status:** scaffolded, not started

## Goal

Close the operator-felt budget loop that Phase 12 structurally built but couldn't demonstrate end-to-end. The Phase 12 promise ("set a low maxTurns in the UI → see the brain ask before failing → accept → watch the retry") doesn't fire today because `resolveTaskMaxTurns` prefers the planner-emitted per-task value over the operator's directive budget. Phase 13 fixes that, polishes the Windows pidfile sloppy-shutdown bug discovered at the Phase 12 close arc, extends per-project default overrides to cover the new budget axes, and ships the per-task USD cap that Phase 12 carry-forwarded.

## Outcome

- **U033 closes** — `resolveTaskMaxTurns` returns `min(planner_emit, operator_ceiling)`. Operator's `payload.budgets[axis]` is now a CEILING the planner refines downward (matches ADR 0032's stated intent). Smoke from Phase 12 finally fires.
- **U034 closes** — `factory daemon stop` on Windows leaves no stale pidfile. CLI-side belt-and-suspenders post-`waitPidGone()` unlinks if PID still matches.
- **Per-project budget defaults** — `<project>/.factory/project.json` `metadata.budgetDefaults` widens from `maxUsd|maxSteps` (Tier 8) to all six (eventually seven) axes including `askUserDeadlineMs` + `maxTurns(Scaffolder|Builder|Fixer)` + `maxUsdPerTask`. Three-tier resolution (instance config → project metadata → body flags) preserved.
- **Per-task USD cap** — new seventh `maxUsdPerTask` axis in `BUDGET_DEFAULTS`. Pool pre-launch check; typed `[BUDGET]` askUser on over-cap; auto-answer recognises across axes.
- **ADR 0032 amendment OR ADR 0033** — clarifies the "operator override" → "operator ceiling" semantic. Decision at 13.3 implementation time; default to amendment if the fix matches ADR 0032's stated intent.
- Browser smoke confirms the full Phase 12 + 13 surface end-to-end.

Full plan: [`../../../UPGRADE/plans/tier-13-budget-followups.md`](../../../UPGRADE/plans/tier-13-budget-followups.md).

## Where we were, end of Phase 12

Phase 12 closed cleanly with all structural plumbing in place — the BUDGET_DEFAULTS single source of truth, the Web UI Advanced budgets accordion, the CLI flags, the `payload.budgets` persistence, the typed `[BUDGET]` askUser escalation, the auto-answer bump-then-abort policy. 1216 → 1292 tests; 9 of 11 done-criteria green at close. The deferred live browser smoke ran the next day in a follow-on session and FAILED the operator-felt gate: a build with `maxTurnsScaffolder=10` in the UI persisted the budget correctly daemon-side but the scaffolder ran 40 turns (planner-emitted) with no `[BUDGET]` askUser. Investigation pinpointed the propagation gap in `resolveTaskMaxTurns`. Filed as U033.

Operational discovery same day: the running daemon at session-start was pre-Phase-12 dist and silently dropped `body.budgets`. Restarted to current dist; smoke ran against the right code. Then stopping the daemon at session-end revealed U034 — `factory daemon stop` on Windows leaves the pidfile on disk because Node maps SIGTERM to TerminateProcess and the shutdown handler never runs.

## Why this phase exists

Phase 12 was the structural budget-UX work; Phase 13 is the propagation-and-polish work that makes the operator-felt loop real. U033 is high-severity because it nullifies the Phase 12 promise; U034 is low-severity polish that's natural to bundle. The per-project default overrides + per-task USD cap are the two cheapest Phase 12 carry-forwards — both modest scope, both reuse Phase 12's escalation pattern. Mid-task escalation + budget audit dashboard remain deferred to a future tier (Tier 14+); they need bigger surfaces (worker-side runtime polling for mid-task; multi-build telemetry foundation for the dashboard) that aren't on the critical path.

Issues addressed: U033 (open from 2026-05-17 Phase 12 smoke; high), U034 (open from 2026-05-17 Phase 12 session-end; low).

## Steps

See [`steps.md`](steps.md).

## Done criteria

- [x] All four `pnpm` gates green
- [x] ADR 0032 amendment lands (13.3 — clarifies §6 operator-as-ceiling semantic)
- [x] `resolveTaskMaxTurns` returns `min(planner_emit, operator_ceiling)`; docstring updated; 6 new tests (13.3)
- [x] `factory daemon stop` on Windows leaves no stale pidfile (13.4 — `reapStalePidFile` helper; verified LIVE at phase-close)
- [x] `<project>/.factory/project.json` `metadata.budgetDefaults` accepts all seven axes; three-tier resolution preserved (13.5)
- [x] `BUDGET_DEFAULTS` gains `maxUsdPerTask`; pool pre-launch check; CLI flag + Web accordion field (13.6)
- [x] Auto-answer's `[BUDGET]` recognition is axis-agnostic at the marker-prefix level (was already; 13.6 confirmed by reusing the marker for the new USD path)
- [x] Browser smoke (Playwright MCP, `smoke-demo`, $1.09 / $1.50 cap, status=complete) — propagation verified end-to-end via API: `directive.payload.budgets.maxTurnsScaffolder = 10` persisted from UI form. Live `[BUDGET]` askUser firing NOT demonstrated because `smoke-demo` is small enough that the scaffolder completed within 10 turns; the trip path is unit-test-covered (36 + 4 + 4 brain tests, all green)
- [x] U033 closes (13.3 — `46198b4`)
- [x] U034 closes (13.4 — `31afcb9`; verified LIVE at phase-close)

## Rollback

`git reset --hard phase-12-budget-ux-closed`. No DB schema changes; no migrations. ADR 0032 amendment (if used) is reversible via git revert; ADR 0033 (if supersedes) follows the standard "supersede-with-a-follow-up" pattern.

## ADRs decided in this phase

- ADR 0032 amendment block (default path) — clarifies the operator-as-ceiling semantic. Decision at 13.3.
- ADR 0033 (alternate path) — only if the fix shape shifts ADR 0032's paradigm meaningfully; supersedes 0032 per CLAUDE.md.

## Deferred to Tier 14 (or later)

- **Mid-task budget escalation** — proactive warning before the worker trips. Bigger surface; defer until post-failure escalation proves out.
- **Budget audit dashboard** — multi-build telemetry view ("you've burned $X across the last N directives"). Needs telemetry foundation.
- **Daemon-side `POST /shutdown` IPC route** (U034 candidate (2)) — richer shutdown lifecycle hooks (draining in-flight directives). ADR-amend candidate when lifecycle hooks become needed.
- **Planner prompt honors operator budgets** (U033 candidate (2)) — belt-and-suspenders for the `min()` fix. Defer.
