*Created: 2026-05-24*

# `directive.limits` (ADR 0020 maxUsd/maxSteps) skips the ADR 0034 three-tier max-resolution rule

**Severity:** P2 medium — Tier 15 created the dual `directive.limits` (2 axes, ADR 0020 pre-call enforcement) and `directive.payload.budgets` (8 axes, ADR 0032/0034 pool model) split intentionally. The `payload.budgets` axes follow ADR 0034 §1's `max(project, payload, BUDGET_DEFAULTS)` rule live; `directive.limits` uses a STATIC resolve-once-at-mint pattern that doesn't see post-mint project.json edits.

## Problem statement

ADR 0034 §1 establishes the cap-resolution rule:

```
effectiveCap[axis] = max(
  project.json.budgetDefaults[axis],
  directive.payload.budgets[axis],
  BUDGET_DEFAULTS[axis].value
)
```

For pool axes this is enforced live via `computePoolUsage` on every pool tick (~250 ms). Tier 15.9 retired the daemon-side per-axis merge precisely so operator edits to `project.json` flow through to running directives.

But `directive.limits.maxUsd` and `directive.limits.maxSteps` (ADR 0020's 2-axis pre-call enforcement) are STILL resolved once at directive mint time via `wiki.resolveDirectiveLimits` (`packages/wiki/src/project-metadata.ts:215-232`) using a three-tier first-wins chain (`explicitFlags ?? projectDefaults ?? configDefaults`), NOT a `max()` rule. The result is stored on the directive row and never re-resolved.

Two symptoms:

**Symptom A — Operator can't raise mid-build.** Operator builds with `--max-usd 5`; mid-build realizes 5 is too tight; raises project default to 20 in the Web UI Defaults tab. `directive.limits.maxUsd` is still 5; the pool's USD axis (`maxUsd`, derived from `model_usage.cost_usd`) would also be 5 because `pool-usage.ts:191-200` reads `payload.budgets.maxUsd` not `directive.limits.maxUsd`. (Wait — let me re-verify the read path.)

Actually `pool-usage.ts:191-200` uses the same max rule for `maxUsd` axis:

```ts
function resolveEffectiveCap(...) {
  const project = projectBudgets.budgetDefaults[axis] ?? 0;
  const payload = payloadBudgets[axis] ?? 0;
  const fallback = BUDGET_DEFAULTS[axis]?.value ?? 0;
  return Math.max(project, payload, fallback);
}
```

This is the LIVE rule. But `directive.limits.maxUsd` is a SEPARATE field that ADR 0020's pre-call enforcer reads (`packages/brain/src/budget.ts` `assertBudget` consumers). When the planner/architect/critic/triage call `assertBudget({maxUsd: opts.limits?.maxUsd, ...})` they're reading the static directive.limits, not the live max-resolved cap.

So both axes (USD and steps) have a dual-cap problem:
- The pool view (web UI Live tab + the pool watchdog) uses the live max
- The pre-call enforcer (architect/planner/critic) uses the static directive.limits

Result: an operator who raises the project default mid-build sees the pool tally update to the new cap (Web UI updates correctly per `pool.tally` SSE), but the next planner or architect call still trips at the OLD cap because `assertBudget` reads `directive.limits`.

**Symptom B — Operator lowering means nothing.** Conversely, if the operator LOWERS the project default mid-build (intent: "this is costing too much; cap it"), the pool view shows the new lower cap but `directive.limits` retains the original value. Pre-call enforcer continues against the OLD higher cap. The operator's lowering is partly effective (pool watchdog enforces it live for tool-using turn axes) but not for USD-axis pre-call gates.

## Current state

Sites that read `directive.limits`:
- `packages/brain/src/planner.ts:325-326` — `assertBudget({maxUsd: opts.limits?.maxUsd, ...})`
- `packages/brain/src/architect.ts:167-168` — same shape
- `packages/brain/src/critic.ts:137-138` — same shape
- `packages/brain/src/triage.ts:121-122` — same shape
- `packages/brain/src/architect-loop.ts:163,177` — passes through to architect/critic

Sites that derive cap from live max-rule (correct ADR 0034 behavior):
- `packages/brain/src/pool-usage.ts:191-200` for the maxUsd/maxSteps axes
- `packages/brain/src/pool.ts:516-520` pre-launch pool check

The DB schema separates them: `directives.limits_json` (TEXT) holds the 2-axis ADR 0020 ceilings; `directives.payload_json` (TEXT) holds the 8-axis ADR 0034 payload.budgets. Two columns, two readers, two semantics.

## Impact

1. **Inconsistent operator experience for USD axis.** Operator can raise project.json's `metadata.budgetDefaults.maxUsd` mid-build and see the pool view update — but agent calls still trip at the OLD `directive.limits.maxUsd`. Confusing.
2. **Test coverage missing.** Daemon tests verify body.limits → directive.limits persistence (`server.test.ts`) but not the dynamic mid-build edit case for `maxUsd` specifically.
3. **Live re-resolve was supposed to apply to ALL operator-facing axes.** ADR 0034 says the live-rule "monotonic-up" applies broadly; the doc doesn't carve out an exception for `directive.limits`. The implementation does (silently).
4. **Tier 13.4 dual-write** — when an operator updates a per-project budget, the daemon writes `metadata.budgetDefaults` on disk via PUT /api/v1/projects/:id/budget. Mid-build directives' `directive.limits` is not updated. The operator's intent ("raise/lower this project's cap") only partially flows to in-flight directives.

## Proposed fix

Treat `directive.limits` as a snapshot-at-mint-time CONVENIENCE but resolve the live cap on every `assertBudget` call:

Option A — Replace `opts.limits` consumers' static read with a live `max(project.budgetDefaults[axis], payload.budgets[axis], directive.limits[axis], BUDGET_DEFAULTS[axis].value)` resolver. Threads project.json read into each of triage/architect/planner/critic. More uniform; threading work to do.

Option B — Periodically refresh `directive.limits` from project.json (daemon-side, e.g., on the doorbell tick). Lower blast radius but introduces an eventual-consistency window.

Option C — Document the asymmetry: `directive.limits` is mint-time-snapshot; only pool-axis caps re-resolve live. Add an "Operator surprise" callout to ADR 0034 §1.

Recommend Option A long-term; Option B is the pragmatic-short-term; Option C is acceptable if the operator-surprise data shows no one cares.

## Affected files

- `packages/brain/src/{triage,architect,planner,critic,architect-loop}.ts` — `assertBudget` call sites
- `packages/brain/src/budget.ts` — possibly add a new `resolveLiveBudgetLimits(db, directiveId, projectPath)` helper that consumers call instead of reading static opts.limits
- `packages/brain/src/loop.ts` — passes opts.limits to all the above; possibly intercepts and live-resolves
- `docs/decisions/0034-budget-pool-paradigm.md` — clarify the §1 rule's scope

## Related

- ADR 0020 — the originating "pre-call enforcement" pattern
- ADR 0034 §1 — the max-resolution rule
- Issue `askUserDeadlineMs-axis-not-honored-per-project-per-build.md` — sibling for non-pool axis
- Issue `maxWikiReadinessAttempts-ignores-project-defaults.md` — sibling for non-pool axis
