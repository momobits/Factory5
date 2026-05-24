# Feature: Budget Canonical Table (ADR 0035)

*Created: 2026-05-24*
*Brainstorm: [budget_axis_unification_brainstorm.md](budget_axis_unification_brainstorm.md)*
*Status: DESIGNED*

## Summary

Establish the single authoritative table for all 12 budget axes — name, type, default, enforcement behavior, explainer text — via ADR 0035 (supersedes both ADR 0032 and ADR 0034). Expand `BUDGET_DEFAULTS` from 8 to 12 entries with a new `type` classification field. Rewrite all explainers to reflect the unified model.

## Motivation

The 8 existing axes evolved across Tiers 8-15 with no single document describing them all. Four different semantic models coexist, documented across 5 ADRs. Operators don't know what each axis means or how they interact. This feature produces ONE table that is the canonical reference for every surface (CLI, Web, Discord/Telegram, docs).

## Design

### Architecture

**ADR 0035 — Budget Axis Canonical Table** supersedes ADR 0032 (Budget UX Paradigm) and ADR 0034 (Budget Pool Paradigm). Both prior ADRs' Status lines flip to `Superseded by ADR 0035`. ADR 0035 contains:

- The canonical 12-axis table (the primary artifact)
- The ONE resolution rule (stated once; Feature 2 implements it)
- The 4 enforcement types (pool / per-task / per-question / per-directive)
- The auto-increase policy (which axes are eligible)
- Cross-references to ADR 0020 (limits — amended), ADR 0030 (auto-answer — amended), ADR 0033 (wiki critique — unaffected)

### Interfaces

Extend `packages/core/src/budget-defaults.ts`:

```ts
export type AxisType = 'pool' | 'per-task' | 'per-question' | 'per-directive';

export interface BudgetAxisDefinition {
  value: number;
  explainer: string;
  type: AxisType;
  autoIncreaseEligible: boolean;
}

export const BUDGET_DEFAULTS: Record<BudgetAxis, BudgetAxisDefinition> = {
  // ... 12 entries
};
```

Extend `packages/core/src/schemas.ts`:
- `budgetsSchema` gains 4 new optional fields (`maxTotalTurns`, `maxRetriesPerTask`, `maxWallClockMinutes`, `maxConcurrentTasks`)
- `BudgetAxis` type union widens from 8 to 12

Extend `packages/core/src/types.ts`:
- `Budgets` type widens to include the 4 new axes

### Data Flow

No runtime data flow — this feature is schema + constants + ADR + docs. The data model is:

```
ADR 0035 (canonical table)
    ↓ mirrors
BUDGET_DEFAULTS (code constant, packages/core/src/budget-defaults.ts)
    ↓ consumed by
budgetsSchema (Zod, packages/core/src/schemas.ts)
    ↓ consumed by
CLI flags, Web UI accordion, Discord/Telegram options, project.json schema
```

### Integration Points

| File | Change |
|------|--------|
| `packages/core/src/budget-defaults.ts` | Expand from 8 to 12 entries; add `type` + `autoIncreaseEligible` fields; rewrite all explainers |
| `packages/core/src/schemas.ts` | `budgetsSchema` gains 4 new optional fields; `BudgetAxis` widens |
| `packages/core/src/types.ts` | `Budgets` type widens |
| `packages/core/src/budget-defaults.test.ts` | Tests for 12 entries, type field, schema acceptance |
| `docs/decisions/0035-budget-axis-canonical-table.md` | New ADR |
| `docs/decisions/0032-budget-ux-paradigm.md` | Status line → `Superseded by ADR 0035` |
| `docs/decisions/0034-budget-pool-paradigm.md` | Status line → `Superseded by ADR 0035` |
| `docs/decisions/INDEX.md` | Add 0035; update 0032 + 0034 status notes |
| `docs/ARCHITECTURE.md` | Budget section gains canonical table reference; ADR count 34 → 35 |

### The canonical table

| Axis | Type | Default | Explainer | Auto-increase |
|------|------|---------|-----------|---------------|
| `maxUsd` | pool | 0 (unlimited) | Total USD spend for the entire build across all agent calls | yes |
| `maxSteps` | pool | 0 (unlimited) | Total LLM calls for the entire build across all agents | yes |
| `maxTurnsScaffolder` | pool | 120 | Total tool-use turns across all scaffolder tasks | yes |
| `maxTurnsBuilder` | pool | 80 | Total tool-use turns across all builder tasks | yes |
| `maxTurnsFixer` | pool | 80 | Total tool-use turns across all fixer tasks | yes |
| `maxTotalTurns` | pool | 0 (unlimited) | Total tool-use turns across ALL agent classes combined | yes |
| `maxUsdPerTask` | per-task | 0 (unlimited) | Maximum USD a single task may spend before it fails | no |
| `maxRetriesPerTask` | per-task | 3 | Maximum times a single task is retried (including auto-bumps) | no |
| `askUserDeadlineMs` | per-question | 300000 (5 min) | Time before auto-answer fires on a pending question | no |
| `maxWikiReadinessAttempts` | per-directive | 3 | Architect-critic retry cycles before escalation | yes |
| `maxWallClockMinutes` | per-directive | 0 (unlimited) | Total wall-clock time for the build before directive parks | yes |
| `maxConcurrentTasks` | per-directive | 4 | Concurrent task slots in the pool dispatcher | no |

### Explainer rewrites (from → to)

| Axis | Old explainer (pre-unification) | New explainer |
|------|--------------------------------|---------------|
| `maxTurnsScaffolder` | "Per-task tool-conversation cap for the scaffolder" | "Total tool-use turns across all scaffolder tasks" |
| `maxTurnsBuilder` | "Per-task tool-conversation cap for the builder" | "Total tool-use turns across all builder tasks" |
| `maxTurnsFixer` | "Per-task tool-conversation cap for the fixer" | "Total tool-use turns across all fixer tasks" |
| `maxUsdPerTask` | "Pre-launch escalation — the brain escalates via askUser" | "Maximum USD a single task may spend before it fails" |
| `askUserDeadlineMs` | "Daemon-wide auto-answer deadline" | "Time before auto-answer fires on a pending question" |
| `maxWikiReadinessAttempts` | "Architect+critic retry cap" | "Architect-critic retry cycles before escalation" |
| `maxUsd` | (unchanged) | "Total USD spend for the entire build across all agent calls" |
| `maxSteps` | (unchanged) | "Total LLM calls for the entire build across all agents" |

## Affected Files

- Create: `docs/decisions/0035-budget-axis-canonical-table.md`
- Modify: `packages/core/src/budget-defaults.ts`
- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/budget-defaults.test.ts` (or `schemas.test.ts`)
- Modify: `docs/decisions/0032-budget-ux-paradigm.md` (Status line only)
- Modify: `docs/decisions/0034-budget-pool-paradigm.md` (Status line only)
- Modify: `docs/decisions/INDEX.md`
- Modify: `docs/ARCHITECTURE.md`

## Dependencies

- None — this is the foundation.
- Brainstorm: [budget_axis_unification_brainstorm.md](budget_axis_unification_brainstorm.md)
- Related features: [budget_unified_resolution.md](budget_unified_resolution.md), [budget_new_axes.md](budget_new_axes.md), [budget_provider_maxturns_fix.md](budget_provider_maxturns_fix.md), [budget_observability.md](budget_observability.md)

## Development Order

1 of 5 — build first. Every other feature references this table. Without it, the resolution rule (Feature 2) has no canonical list of axes to apply to; the new axes (Feature 3) have no table to extend; the observability (Feature 5) has no taxonomy to aggregate by.

## Open Questions

1. Should `maxConcurrentTasks` default to 4 (matching today's hardcode) or to 0 (unlimited, letting the system decide)? Recommend 4 — matches operator expectations from all prior tiers.
2. Should `maxRetriesPerTask` count auto-bumps? The brainstorm left this for design. Recommend YES — auto-bumps ARE retries from the operator's perspective ("the system tried again"). If the operator wants unbounded retries, they set `maxRetriesPerTask: 0` (unlimited).
3. Does `maxWallClockMinutes: 0` mean unlimited (matching the maxUsd/maxSteps sentinel) or "zero minutes = instant fail"? Recommend 0 = unlimited for consistency with existing zero-sentinel convention.
