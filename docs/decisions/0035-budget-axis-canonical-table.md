# ADR 0035 — Budget Axis Canonical Table

- **Status:** Accepted
- **Date:** 2026-05-25
- **Supersedes:** [ADR 0032](0032-budget-ux-paradigm.md), [ADR 0034](0034-budget-pool-paradigm.md)
- **Builds on:** [ADR 0020](0020-pre-call-budget-enforcement.md) — `maxUsd` / `maxSteps` directive-wide pool semantics. [ADR 0030](0030-pending-question-auto-answer.md) — `askUserDeadlineMs` auto-answer deadline. [ADR 0033](0033-wiki-readiness-critique-loop.md) — `maxWikiReadinessAttempts` critic retry cap.

## Context

The eight operator-facing budget axes evolved across Tiers 8-15 with no single document describing them all. Four different semantic models coexist, documented across ADRs 0020, 0030, 0032, 0033, and 0034. Operators don't know what each axis means or how they interact. The codebase itself references the axes by scattered comments pointing at different ADRs.

The forcing function: the 2026-05-23 budget axis unification brainstorm identified that every surface (CLI, Web, Discord, Telegram, docs) needs ONE table to reference. Additionally, four new axes (`maxTotalTurns`, `maxRetriesPerTask`, `maxWallClockMinutes`, `maxConcurrentTasks`) are needed to complete the operator-facing budget model.

This ADR establishes the single authoritative table for all 12 budget axes: name, enforcement type, default value, explainer text, and auto-increase eligibility.

## Decision

### 1. The canonical 12-axis table

| Axis                       | Type          | Default        | Explainer                                                     | Auto-increase |
| -------------------------- | ------------- | -------------- | ------------------------------------------------------------- | ------------- |
| `maxUsd`                   | pool          | 0 (unlimited)  | Total USD spend for the entire build across all agent calls   | yes           |
| `maxSteps`                 | pool          | 0 (unlimited)  | Total LLM calls for the entire build across all agents        | yes           |
| `maxTurnsScaffolder`       | pool          | 120            | Total tool-use turns across all scaffolder tasks              | yes           |
| `maxTurnsBuilder`          | pool          | 80             | Total tool-use turns across all builder tasks                 | yes           |
| `maxTurnsFixer`            | pool          | 80             | Total tool-use turns across all fixer tasks                   | yes           |
| `maxTotalTurns`            | pool          | 0 (unlimited)  | Total tool-use turns across ALL agent classes combined        | yes           |
| `maxUsdPerTask`            | per-task      | 0 (unlimited)  | Maximum USD a single task may spend before it fails           | no            |
| `maxRetriesPerTask`        | per-task      | 3              | Maximum times a single task is retried (including auto-bumps) | no            |
| `askUserDeadlineMs`        | per-question  | 300000 (5 min) | Time before auto-answer fires on a pending question           | no            |
| `maxWikiReadinessAttempts` | per-directive | 3              | Architect-critic retry cycles before escalation               | yes           |
| `maxWallClockMinutes`      | per-directive | 0 (unlimited)  | Total wall-clock time for the build before directive parks    | yes           |
| `maxConcurrentTasks`       | per-directive | 4              | Concurrent task slots in the pool dispatcher                  | no            |

### 2. Enforcement types

- **`pool`** — budget is shared across all tasks within a directive. Each task draws from the pool; pool exhaustion is the trigger event.
- **`per-task`** — enforced independently per task. Each task has its own budget instance.
- **`per-question`** — enforced per pending-question instance.
- **`per-directive`** — enforced once for the entire directive lifecycle.

### 3. Auto-increase policy

Axes marked `autoIncreaseEligible: true` participate in the ADR 0034 auto-increase flow when `project.json` `metadata.autoIncreaseBudgets` is `true`. The pool dispatcher bumps exhausted axes by one project-default increment (linear bump). The safety ceiling is `projectDefault * autoIncreaseCeilingMultiplier` (default 5x).

Per-task and per-question axes are never auto-increased because they govern per-instance behavior, not directive-wide capacity.

### 4. Resolution rule

Stated once: for every axis, the effective cap is:

```
effectiveCap[axis] = max(project.json.budgetDefaults[axis], payload.budgets[axis], BUDGET_DEFAULTS[axis].value)
```

Caps can only rise during a directive's lifetime (monotonic-up guarantee). Feature F2 (budget_unified_resolution) implements this rule.

### 5. Single source of truth

The code-level truth is `BUDGET_DEFAULTS` in `@factory5/core` (`packages/core/src/budget-defaults.ts`). Every surface reads from this constant:

- CLI `--help` post-text
- Web Build form accordion hints
- Discord/Telegram `/budget` command display
- Project metadata schema validation

### 6. Sentinel conventions

- `0` means "unlimited / no ceiling" for: `maxUsd`, `maxSteps`, `maxTotalTurns`, `maxUsdPerTask`, `maxWikiReadinessAttempts`, `maxWallClockMinutes`.
- Positive-only (0 would be nonsensical): `askUserDeadlineMs` (instant auto-answer), `maxTurnsScaffolder|Builder|Fixer` (skip agent class entirely), `maxConcurrentTasks` (zero slots = deadlock).
- `maxRetriesPerTask` uses `0` = unlimited retries (operator trusts the system to retry indefinitely).

## Consequences

1. **All 12 axes are documented in one place.** No more scattered references across ADRs 0020/0030/0032/0033/0034.
2. **The `type` field classifies enforcement granularity.** Consumers can programmatically discover which axes are pools vs per-task vs per-directive.
3. **The `autoIncreaseEligible` field is machine-readable.** The auto-increase dispatcher no longer hardcodes which axes to bump.
4. **Four new axes are surfaced.** `maxTotalTurns`, `maxRetriesPerTask`, `maxWallClockMinutes`, `maxConcurrentTasks` move from hardcoded constants to the operator-facing budget model.
5. **ADRs 0032 and 0034 are superseded.** Their decisions carry forward under this unified model; this ADR is the new canonical reference.

## Alternatives considered

1. **Keep 0032 + 0034 and add a "0035 addendum".** Rejected — the table-split across three ADRs was the problem; a fourth doesn't help.
2. **Fewer axes (keep at 8, add new ones later).** Rejected — the four new axes are already hardcoded in the codebase; making them operator-facing is the whole point of unification.
3. **More axes (expose internal pacing constants).** Rejected — poll intervals, heartbeat timeouts, and retry backoffs are implementation details. The criterion is: "would an operator ever want to tune this at build-mint time?" If no, it stays internal.
