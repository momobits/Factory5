# Feature: Budget New Axes (4)

*Created: 2026-05-24*
*Brainstorm: [budget_axis_unification_brainstorm.md](budget_axis_unification_brainstorm.md)*
*Status: IMPLEMENTED*

## Summary

Add 4 new budget axes (`maxTotalTurns`, `maxRetriesPerTask`, `maxWallClockMinutes`, `maxConcurrentTasks`) born compliant with the unified resolution rule. Each gets schema, default, enforcement, CLI flag, Web UI field, and Discord/Telegram option.

## Motivation

Operator identified concrete control gaps: no aggregate turn cap across classes, no retry cap, no wall-clock limit, no concurrency override. All 4 axes were confirmed during brainstorming. Adding them under the unified model (Feature 2) means they're consistent from day one — no future unification needed.

## Design

### Architecture

Each new axis follows the exact same 6-layer pattern as existing axes:

```
BUDGET_DEFAULTS entry (core)
  → budgetsSchema field (core)
    → project.json.metadata.budgetDefaults (wiki)
      → directive.payload.budgets (daemon)
        → CLI flag (cli)
          → Web UI field (factory-web)
            → Discord/Telegram option (channels)
```

Resolution: `max(project.json, payload, BUDGET_DEFAULTS)` — same as all other axes.

### Per-axis design

#### `maxTotalTurns` (pool type)

- **Default**: 0 (unlimited)
- **Enforcement**: `computePoolUsage` gains a new aggregation: `SUM(turnsUsed)` across ALL tasks regardless of agent class. Checked alongside per-class pools. Whichever fires first (class pool or total pool) parks the directive.
- **Interaction with per-class pools**: both active simultaneously. If `maxTotalTurns=300` and `maxTurnsBuilder=200`, a builder task can use at most 200 (its class pool), AND the sum across all classes can use at most 300. The operator effectively says "builder can have 200 of the 300 total."
- **Auto-increase eligible**: yes
- **Code**: `packages/brain/src/pool-usage.ts` — add a `maxTotalTurns` entry to `perAxis` that sums `turnsUsed` from ALL `tasks_inflight` rows for the directive (no agent filter).

#### `maxRetriesPerTask` (per-task type)

- **Default**: 3
- **Enforcement**: pool dispatcher checks `task.attempts >= effectiveCap['maxRetriesPerTask']` before retrying a failed task (auto-bump, pool-exhaustion-retry, or any future retry mechanism). On trip: task stays failed; no more retries for THIS task; other tasks and the directive proceed normally.
- **What counts as a retry**: any re-dispatch of the same task ID. Auto-bumps (pool cap raised → task re-runs) count. The `attempts` field on `tasks_inflight` already tracks this.
- **Auto-increase eligible**: no — retries are a safety valve against infinite loops, not a budget to raise.
- **Code**: `packages/brain/src/pool.ts` — add retry-cap check in `executeTaskWithBudgetGuard` before the recursion path.

#### `maxWallClockMinutes` (per-directive type)

- **Default**: 0 (unlimited)
- **Enforcement**: serve loop gains a wall-clock check per tick:
  ```ts
  const wallClockCap = resolveAxisCap(db, directive.id, 'maxWallClockMinutes');
  if (wallClockCap > 0) {
    const elapsedMin = (Date.now() - new Date(directive.createdAt).getTime()) / 60_000;
    if (elapsedMin >= wallClockCap) {
      parkDirective(directive, 'maxWallClockMinutes', elapsedMin, wallClockCap);
    }
  }
  ```
  Checked via periodic poll against `directive.createdAt + cap`. Poll approach (not setTimeout) chosen because it survives daemon restarts — the createdAt timestamp is in the DB.
- **Auto-increase eligible**: yes — operator can raise from project page to extend a long-running build.
- **Code**: `packages/brain/src/pool.ts` or `serve.ts` — whichever owns the per-directive lifecycle check. Recommend `pool.ts` since it already owns the pool-exhaustion park path.

#### `maxConcurrentTasks` (per-directive type)

- **Default**: 4
- **Enforcement**: pool dispatcher reads `effectiveCap['maxConcurrentTasks']` at plan-dispatch time and uses it as the `concurrency` parameter. Today this is hardcoded `const DEFAULT_CONCURRENCY = 4` in `pool.ts`.
- **Live re-resolve**: if operator changes concurrency mid-build via project page, the dispatcher picks it up on the next task-dispatch cycle. Already-running tasks aren't interrupted; the new concurrency applies to the next batch.
- **Auto-increase eligible**: no — raising concurrency mid-build is a resource decision, not a budget decision. Operator can still edit it manually.
- **Code**: `packages/brain/src/pool.ts` — replace `DEFAULT_CONCURRENCY` with `resolveAxisCap(db, directive.id, 'maxConcurrentTasks')`.

### Interfaces

All 4 axes extend the existing typed surfaces:

```ts
// packages/core/src/budget-defaults.ts (from Feature 1)
maxTotalTurns:       { value: 0,   explainer: '...', type: 'pool',          autoIncreaseEligible: true  },
maxRetriesPerTask:   { value: 3,   explainer: '...', type: 'per-task',      autoIncreaseEligible: false },
maxWallClockMinutes: { value: 0,   explainer: '...', type: 'per-directive', autoIncreaseEligible: true  },
maxConcurrentTasks:  { value: 4,   explainer: '...', type: 'per-directive', autoIncreaseEligible: false },
```

### Data Flow

Each new axis:
1. Operator sets via Web/CLI/Discord/Telegram → writes to `project.json.budgetDefaults` OR `directive.payload.budgets`
2. Brain resolves via `resolveAxisCap` (Feature 2) → `max(project, payload, defaults)`
3. Enforcement point checks per the axis's type
4. On exhaustion: pool axes park, per-task axes fail the task, per-directive axes park
5. Telemetry (Feature 5) shows usage for the axis

### Integration Points

| File | Change |
|------|--------|
| `packages/core/src/budget-defaults.ts` | 4 new entries in `BUDGET_DEFAULTS` (done in Feature 1) |
| `packages/core/src/schemas.ts` | 4 new fields in `budgetsSchema` (done in Feature 1) |
| `packages/brain/src/pool-usage.ts` | `maxTotalTurns` cross-class aggregation |
| `packages/brain/src/pool.ts` | `maxRetriesPerTask` check before retry; `maxWallClockMinutes` poll check; `maxConcurrentTasks` replaces hardcoded 4 |
| `packages/brain/src/pool.test.ts` | Tests for all 4 enforcement paths |
| `packages/cli/src/commands/budget-flags.ts` | 4 new `--max-*` CLI flags |
| `packages/cli/src/commands/budget-flags.test.ts` | Tests for new flags |
| `apps/factory-web/src/pages/projects/detail.astro` | Defaults tab: 4 new fields |
| `apps/factory-web/src/pages/build.astro` | Accordion: 4 new fields |
| `packages/channels/src/discord-commands.ts` | 4 new Discord slash-command options |
| `packages/channels/src/telegram.ts` | 4 new `--flag` parsers in `parseBudgetArgs` |
| `packages/channels/src/command-handlers.ts` | `BudgetInput` type widens |
| `packages/channels/src/command-handlers.test.ts` | Tests for new axes |

## Affected Files

- Modify: 13 files across 5 packages (core, brain, cli, factory-web, channels)
- No new files (enforcement logic added to existing pool.ts + pool-usage.ts)

## Dependencies

- Depends on: [budget_canonical_table.md](budget_canonical_table.md) (Feature 1 — axis definitions)
- Depends on: [budget_unified_resolution.md](budget_unified_resolution.md) (Feature 2 — resolution function)
- Brainstorm: [budget_axis_unification_brainstorm.md](budget_axis_unification_brainstorm.md)
- Related features: [budget_provider_maxturns_fix.md](budget_provider_maxturns_fix.md), [budget_observability.md](budget_observability.md)

## Development Order

3 of 5 — build third. Requires both the canonical table (Feature 1) and the unified resolution function (Feature 2). The new axes are additive — they don't break existing behavior and can be shipped incrementally (one axis at a time if desired).

## Open Questions

1. **`maxTotalTurns` vs per-class pool interaction** (from brainstorm): both caps active; whichever fires first parks. Confirmed as the right behavior during brainstorming. No change needed.
2. **`maxRetriesPerTask` + auto-increase interaction** (from brainstorm): recommend auto-bumps count as retries. If operator wants unbounded retries, set `maxRetriesPerTask: 0`.
3. **`maxWallClockMinutes` precision**: poll-based (250ms tick) gives ±250ms precision. Acceptable for a minutes-scale cap.
4. **`maxConcurrentTasks` minimum value**: should `maxConcurrentTasks: 1` be the minimum (serial execution), or allow 0 (which would mean "don't dispatch any tasks" — probably a mistake)? Recommend minimum 1; schema enforces `z.number().int().min(1)`.
