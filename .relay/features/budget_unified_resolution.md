# Feature: Budget Unified Resolution

*Created: 2026-05-24*
*Brainstorm: [budget_axis_unification_brainstorm.md](budget_axis_unification_brainstorm.md)*
*Status: IMPLEMENTING*

## Summary

Make every budget axis follow ONE resolution rule: `effectiveCap[axis] = max(project.json, payload.budgets, BUDGET_DEFAULTS)` with live re-resolve. Retire the 3 alternative resolution paths (ADR 0020 first-wins chain, daemon-config-only, payload-only). Resurrect `maxUsdPerTask` enforcement under the unified model.

## Motivation

The relay-discover audit found 4 different resolution rules coexisting across 12 axes. Operators couldn't predict which override would take effect. Relay issues closed by this feature:
- **#1 (P1)**: `maxUsdPerTask` enforcement deleted — resurrected here
- **#3 (P1)**: `askUserDeadlineMs` per-project/per-build overrides are placebo — honored here
- **#5 (P1)**: `directive.limits` not live-resolved — switched to unified rule
- **#6 (P2)**: `maxWikiReadinessAttempts` ignores project defaults — honored here

## Design

### Architecture

A single resolution function handles ALL axes:

```ts
// packages/brain/src/pool-usage.ts (extend existing)
export function resolveEffectiveCap(
  axis: BudgetAxis,
  projectBudgets: Partial<Record<BudgetAxis, number>>,
  payloadBudgets: Partial<Record<BudgetAxis, number>>,
): number {
  const project = projectBudgets[axis] ?? 0;
  const payload = payloadBudgets[axis] ?? 0;
  const fallback = BUDGET_DEFAULTS[axis].value;
  return Math.max(project, payload, fallback);
}
```

Every consumer that today reads caps from ad-hoc sources switches to calling this function with the directive's project.json + payload.budgets as inputs.

### Interfaces

**Extended `computePoolUsage`** — already covers the 5 pool axes. Extend to compute effective caps for ALL 12 axes (even non-pool ones) so the telemetry surface (Feature 5) has one data source.

**New `resolveAxisCap(db, directiveId, axis)`** — convenience wrapper for consumers that need a single axis's cap without the full pool aggregation. Reads project.json + payload.budgets + BUDGET_DEFAULTS. Used by `ask-user.ts` (per-question deadline) and `loop.ts` (wiki readiness attempts).

**Retired `directive.limits`** as a runtime read path. The `limits` field stays in the `directives` DB table and API response for audit history ("what were the ADR 0020 limits when this directive was created"). No runtime consumer reads it. The `assertBudget` pre-call check in triage/architect/critic/planner switches to reading `computePoolUsage` for `maxUsd` and `maxSteps`.

### Data Flow

**Before (4 rules):**
```
maxTurns*           → max(project.json, payload, defaults) — live re-resolve [ADR 0034]
maxUsd, maxSteps    → directive.limits ?? project ?? defaults — snapshot at creation [ADR 0020]
askUserDeadlineMs   → config.json only [ADR 0030]
maxWikiAttempts     → payload.budgets only [Tier 14 code]
maxUsdPerTask       → DEAD CODE [Tier 15.8 deletion]
```

**After (1 rule):**
```
ALL 12 axes → max(project.json, payload.budgets, BUDGET_DEFAULTS) — live re-resolve
```

Every check-point reads from the same resolution function. The enforcement differs by axis type (pool sums, per-task checks individually, per-question applies per question, per-directive checks once), but the CAP COMPUTATION is identical.

### Integration Points

| File | Change | Relay issue |
|------|--------|-------------|
| `packages/brain/src/pool-usage.ts` | Extend `computePoolUsage` to cover all 12 axes; export `resolveAxisCap` convenience helper | Foundation |
| `packages/brain/src/pool-usage.test.ts` | Tests for all 12 axes resolving via the unified rule | Foundation |
| `packages/brain/src/pool.ts` | `assertBudget` reads maxUsd/maxSteps from `computePoolUsage` instead of `opts.limits`; resurrect `maxUsdPerTask` pre-launch check | #1, #5 |
| `packages/brain/src/pool.test.ts` | Tests for resurrected maxUsdPerTask enforcement + assertBudget switch | #1, #5 |
| `packages/brain/src/ask-user.ts` | Deadline resolves via `resolveAxisCap(db, directiveId, 'askUserDeadlineMs')` instead of `loadConfig(dataDir).askUserDeadlineMs` | #3 |
| `packages/brain/src/ask-user.test.ts` | Tests proving per-project + per-build deadline overrides work | #3 |
| `packages/brain/src/loop.ts` | `maxWikiReadinessAttempts` resolves via `resolveAxisCap` instead of `directive.payload.budgets` only | #6 |
| `packages/brain/src/loop.test.ts` | Tests proving project-default maxWikiReadinessAttempts is honored | #6 |
| `packages/brain/src/triage.ts`, `architect.ts`, `critic.ts`, `planner.ts` | `assertBudget` calls gain live maxUsd/maxSteps from pool-usage instead of directive.limits | #5 |
| `docs/decisions/0020-pre-call-budget-enforcement.md` | Amendment: `directive.limits` retired as runtime read; cross-ref ADR 0035 | #5 |

### maxUsdPerTask resurrection (Relay issue #1)

Tier 15.8 deleted `escalateMaxUsdPerTaskTrip` (the askUser-based enforcement). Under the unified model, enforcement is simpler:

```ts
// In pool.ts, before launching a tool-using worker:
const cap = resolveAxisCap(db, directive.id, 'maxUsdPerTask');
if (cap > 0 && task.estimatedUsd !== undefined && task.estimatedUsd > cap) {
  // Per-task safety: task FAILS (not directive parks)
  return {
    result: {
      exitCode: 1,
      errorSubtype: 'per-task-usd-exceeded',
      error: `Task "${task.title}" estimated $${task.estimatedUsd} exceeds maxUsdPerTask cap $${cap}`,
      filesChanged: [], findingsRaised: [], signalsEmitted: [], durationMs: 0,
    },
  };
}
```

No askUser, no parser, no auto-answer policy. Task fails cleanly; operator raises the cap on the project page and resumes. Matches the pool exhaustion UX pattern but at the per-task level.

### askUserDeadlineMs per-project + per-build (Relay issue #3)

```ts
// In ask-user.ts, replacing the current loadConfig() path:
const deadline = resolveAxisCap(db, directiveId, 'askUserDeadlineMs');
// deadline is now max(project.json, payload, 300000ms default)
```

This means operators can set `askUserDeadlineMs: 60000` (1 min) per project for fast-turnaround projects, or `askUserDeadlineMs: 600000` (10 min) for projects where builds are long and human response is expected. The per-build override on the Build form works too.

### directive.limits retirement

The `_limits` parameter that Tier 15.7 renamed (but kept threading from loop.ts) is fully deleted. `assertBudget` calls in triage/architect/critic/planner switch from reading `opts.limits?.maxUsd` to reading `computePoolUsage(db, directiveId, projectBudgets).perAxis.maxUsd.cap`. The live-resolve means operator edits mid-build take effect on the next agent call.

## Affected Files

- Modify: `packages/brain/src/pool-usage.ts` (extend to 12 axes + convenience helper)
- Modify: `packages/brain/src/pool-usage.test.ts`
- Modify: `packages/brain/src/pool.ts` (assertBudget switch + maxUsdPerTask resurrection)
- Modify: `packages/brain/src/pool.test.ts`
- Modify: `packages/brain/src/ask-user.ts` (deadline resolution)
- Modify: `packages/brain/src/ask-user.test.ts`
- Modify: `packages/brain/src/loop.ts` (maxWikiReadinessAttempts + _limits removal)
- Modify: `packages/brain/src/loop.test.ts`
- Modify: `packages/brain/src/triage.ts`, `architect.ts`, `critic.ts`, `planner.ts` (assertBudget live-resolve)
- Modify: `docs/decisions/0020-pre-call-budget-enforcement.md` (amendment)

## Dependencies

- Depends on: [budget_canonical_table.md](budget_canonical_table.md) (Feature 1 — needs the 12-axis table + `AxisType` classification)
- Brainstorm: [budget_axis_unification_brainstorm.md](budget_axis_unification_brainstorm.md)
- Related features: [budget_new_axes.md](budget_new_axes.md), [budget_provider_maxturns_fix.md](budget_provider_maxturns_fix.md), [budget_observability.md](budget_observability.md)

## Development Order

2 of 5 — build second. Requires the canonical table (Feature 1) to exist. Every downstream feature (3, 4, 5) references the unified resolution function this feature establishes. Relay issues #1, #3, #5, #6 close here.

## Open Questions

1. **`assertBudget` call frequency**: pre-call checks fire before every LLM call (triage, architect, critic, planner). With live re-resolve, each check reads project.json. Is the I/O acceptable at ~4 calls per directive lifecycle? Yes — `loadOrCreateProjectMetadata` is cached in Node's fs module cache for the same path within a tick; the serve loop is 250ms anyway. But worth a comment.

2. **`maxUsdPerTask` — task.estimatedUsd is planner-emitted**: the planner may not emit `estimatedUsd` (Relay issue #11 noted it's dead code). If the planner stops emitting it AND no task has `estimatedUsd`, the `maxUsdPerTask` cap never fires (cap > 0 but `task.estimatedUsd === undefined` → skip check). Is this acceptable? Alternative: check actual spend DURING the task (post-turn, via model_usage SUM for this task_id). More accurate but adds I/O per turn.

3. **`directive.limits` backward compat**: existing directives have `limits: { maxUsd: 100, maxSteps: 500 }`. After this feature, no consumer reads it. Old directives resumed via `factory resume` — the resume path inherits `limits` from the parent. Should the resume path stop inheriting `limits` (since they're dead) or continue (for audit trail)?

## Implementation Deviations

1. **`resolveAxisCap` requires `projectBudgets` param**: The spec envisioned `resolveAxisCap(db, directiveId, axis)` as a self-contained wrapper. Implementation adds a `projectBudgets: ProjectBudgetsLike` parameter because reading `project.json` is async (requires `loadOrCreateProjectMetadata`) and the function is synchronous. Callers (loop.ts, ask-user.ts) load projectBudgets separately and pass it in. No semantic difference — same three-way max rule applies.

2. **`ask-user.ts` unified resolution is opt-in via `projectBudgets` option**: Rather than refactoring `askUser` to always async-load project metadata, the unified resolution path activates when the caller passes `opts.projectBudgets`. The loop.ts callsite has `projectPath` available and passes it. External callers (tests, standalone scripts) continue using the config.json fallback. This preserves backward compat without breaking the existing test surface.

3. **`assertBudget` interface unchanged**: Instead of modifying `assertBudget` in budget.ts or the triage/architect/critic/planner interfaces, the live resolution is done once in `loop.ts`'s `runInline` function, which constructs a `DirectiveLimits` object from `resolveAxisCap('maxUsd')` and `resolveAxisCap('maxSteps')`. This is then passed as `limits` to each agent. The agents don't need to know about the unified resolution — they just receive limits as before, but now those limits are live-resolved rather than snapshotted at directive creation.

4. **`_limits` parameter in `runPlanTasks` retained**: The already-deprecated `_limits` parameter (prefixed with `_` by Tier 15) continues to exist for API stability. It is still passed from `loop.ts` but never read by the pool.

5. **`projectBudgets` loaded unconditionally in `executeTaskWithBudgetGuard`**: Previously only loaded for tool-using agents (inside `if (axis !== undefined)`). Now loaded for all agents so the `maxUsdPerTask` pre-launch check works for any task type that has `estimatedUsd`.
