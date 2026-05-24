# Feature: Provider maxTurns Fix

*Created: 2026-05-25*
*Brainstorm: [budget_axis_unification_brainstorm.md](budget_axis_unification_brainstorm.md)*
*Status: IMPLEMENTED*

## Summary

Finish the half-migration that caused the pythonetl dual-cap failures: worker stops passing per-task `task.maxTurns` to claude-cli, planner materializer strips the field, planner prompt adds explicit negative instruction, provider drops hardcoded `maxTurns=80` default. Worker instead passes the pool's remaining headroom so claude-cli's `--max-turns` aligns with the pool watchdog.

## Motivation

The 2026-05-23/24 pythonetl incident: planner LLM volunteered `maxTurns: 60` despite the Tier 15.7 prompt-drop. Worker passed it to claude-cli as `--max-turns 60`. Claude-cli crashed at turn 61 (`error_max_turns`) before the pool watchdog could fire. Pool showed 11% usage (33/300) — the pool model was correct but never got to enforce.

Additionally, Relay issue #4: `claude-cli.ts:622` has `maxTurns = 80` as the provider default. Even with the planner fix, this default would cap every tool-using call at 80 turns — defeating pool headroom above 80.

Both must be eliminated for the pool model to be the sole turn authority.

## Design

### Architecture

Four surgical edits, each removing a layer of the old per-task cap:

```
Layer 1: Planner prompt         — "do NOT emit maxTurns"     (belt)
Layer 2: Planner materializer   — strip maxTurns from output (suspenders)
Layer 3: Worker pass-through    — delete task.maxTurns line   (the actual bug)
Layer 4: Provider default       — delete hardcoded 80         (hidden second cap)
```

Plus one new mechanism:
```
Layer 5: Worker pool-headroom   — pass remaining pool turns as --max-turns (safety ceiling)
```

### Interfaces

**Worker** (`packages/worker/src/run-worker.ts`):

```ts
// Before (today):
...(opts.task.maxTurns !== undefined ? { maxTurns: opts.task.maxTurns } : {}),

// After:
// Pool remaining headroom passed by brain's pool dispatcher
...(opts.poolRemainingTurns !== undefined ? { maxTurns: opts.poolRemainingTurns } : {}),
```

New optional field on `RunWorkerOpts`:
```ts
poolRemainingTurns?: number;  // pool.perAxis[axis].cap - pool.perAxis[axis].used
```

**Pool dispatcher** (`packages/brain/src/pool.ts`):

```ts
// In executeTaskWithBudgetGuard, before calling runWorker:
const axis = axisForAgent(task.agent);
const poolRemaining = axis !== undefined
  ? pool.perAxis[axis].cap - pool.perAxis[axis].used
  : undefined;

const outcome = await runWorker({
  task,
  poolRemainingTurns: poolRemaining,
  onTurnComplete: ...,
  ...
});
```

**Planner materializer** (`packages/brain/src/planner.ts:~132`):

```ts
// Before:
...(t.maxTurns !== undefined ? { maxTurns: t.maxTurns } : {}),

// After: (line deleted — maxTurns stripped from LLM output)
```

**Planner prompt** (`packages/brain/src/planner.ts:~247`):

Add to the system prompt instructions:
```
Do NOT emit a maxTurns field on any task. Turn budgets are managed by the
directive-level pool (ADR 0035); per-task caps are not used.
```

**Provider** (`packages/providers/src/claude-cli.ts:622`):

```ts
// Before:
const maxTurns = req.maxTurns ?? 80;

// After:
const maxTurns = req.maxTurns;  // undefined = no --max-turns flag = claude-cli internal default
```

When `maxTurns` is undefined, the `--max-turns` flag is not passed to claude-cli at all. Claude-cli has its own internal default (currently varies by model). For tool-using agents, the worker always passes `poolRemainingTurns` so `maxTurns` is never undefined in practice. For read-only agents (no pool axis), `maxTurns` is undefined and claude-cli uses its internal default — acceptable since read-only calls are short.

### Data Flow

```
Pool dispatcher computes remaining headroom → passes as poolRemainingTurns
  → worker passes as --max-turns to claude-cli
    → claude-cli uses it as safety ceiling
      → pool watchdog (onTurnComplete) is the actual interrupt mechanism
        → watchdog fires FIRST (checks live pool) before --max-turns trips
```

The `--max-turns` value from the pool headroom is a BELT — the watchdog is the SUSPENDERS. Both should fire at roughly the same point. The watchdog is slightly ahead because it checks AFTER each turn (turn N completes → check pool → if exhausted, interrupt before turn N+1). The `--max-turns` flag is a hard stop if the watchdog somehow fails.

### Integration Points

| File | Change |
|------|--------|
| `packages/worker/src/run-worker.ts` | Delete `task.maxTurns` pass-through; add `poolRemainingTurns` field to opts; pass as `maxTurns` to provider |
| `packages/worker/src/run-worker.test.ts` | Test: poolRemainingTurns flows to provider; task.maxTurns is ignored |
| `packages/brain/src/pool.ts` | Compute `poolRemainingTurns` from pool-usage and pass to runWorker |
| `packages/brain/src/pool.test.ts` | Test: remaining headroom computed correctly |
| `packages/brain/src/planner.ts` | Strip maxTurns in materializer; add negative prompt instruction |
| `packages/brain/src/planner-emit.test.ts` | Test: emitted plan has no maxTurns on any task |
| `packages/providers/src/claude-cli.ts` | Delete `?? 80` default on maxTurns |
| `packages/providers/src/claude-cli.test.ts` (if exists) | Test: no --max-turns when req.maxTurns is undefined |

## Affected Files

- Modify: `packages/worker/src/run-worker.ts`
- Modify: `packages/worker/src/run-worker.test.ts`
- Modify: `packages/brain/src/pool.ts`
- Modify: `packages/brain/src/pool.test.ts`
- Modify: `packages/brain/src/planner.ts`
- Modify: `packages/brain/src/planner-emit.test.ts`
- Modify: `packages/providers/src/claude-cli.ts`

## Dependencies

- Depends on: [budget_unified_resolution.md](budget_unified_resolution.md) (Feature 2 — `computePoolUsage` provides the headroom calculation)
- Brainstorm: [budget_axis_unification_brainstorm.md](budget_axis_unification_brainstorm.md)
- Related features: [budget_canonical_table.md](budget_canonical_table.md), [budget_new_axes.md](budget_new_axes.md), [budget_observability.md](budget_observability.md)

## Development Order

4 of 5 — build fourth. Requires the unified resolution (Feature 2) so `computePoolUsage` provides the headroom for the `poolRemainingTurns` calculation. Can be built in parallel with Feature 3 (new axes) since they touch different files, but ordering after Feature 3 is safer.

## Open Questions

1. **Claude-cli internal default when `--max-turns` is omitted**: varies by model. For read-only agents this is acceptable. For tool-using agents we always pass `poolRemainingTurns`. But if a tool-using agent somehow gets `poolRemainingTurns = undefined` (no axis mapped), should the worker fall back to a high hardcode (e.g., 500) or omit the flag? Recommend: fall back to `BUDGET_DEFAULTS.maxTotalTurns.value` if set, else omit.

2. **`task.maxTurns` field in schema**: `taskSchema.maxTurns` stays optional for backward read-back of historical plans. The materializer strips it from new plans. Historical plans (pre-unification) that are resumed may still carry `maxTurns` values — the worker ignores them (the per-task pass-through is deleted). No schema deletion needed.
