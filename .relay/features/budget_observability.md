# Feature: Budget Observability

*Created: 2026-05-25*
*Brainstorm: [budget_axis_unification_brainstorm.md](budget_axis_unification_brainstorm.md)*
*Status: DESIGNED*

## Summary

Per-axis telemetry on the project page: per-build summary table, p50/p90/max aggregated stats, and historical per-task drill-down. Enables operators to set budget defaults from observed data ("my last 10 builds averaged 85 builder turns; 120 is a good default") rather than guessing.

## Motivation

Operator request: "we need to be able to see the telemetry counts metrics for each axis to understand the natural behaviour and thus better inform what the acceptable defaults are for new projects."

Today the Live tab (Tier 15.10) shows real-time pool usage for the in-flight directive only. Historical builds show spend USD in the History tab but no per-axis breakdown. The data already exists in the DB (`tasks_inflight.result_json.turnsUsed`, `model_usage.cost_usd`) — it just isn't surfaced historically.

## Design

### Architecture

Three views, all on the project page:

```
Project page
  ├── [Live]       — (existing) real-time pool tally for in-flight directive
  ├── [History]    — (extend) per-build row gains expandable per-axis mini-tally
  ├── [Stats]      — (NEW tab) aggregated p50/p90/max per axis across all builds
  └── [Defaults]   — (existing) budget defaults form
  └── [Settings]   — (existing) auto-increase toggle
```

### View 1: Per-build summary (extend History tab)

Each historical directive row in the History tab gains a click-to-expand panel showing the same bar treatment as the Live tab:

```
▶ Directive 01KSD... · 2026-05-24 · complete · $2.61  [click to expand]
  ┌─────────────────────────────────────────────────────────────────┐
  │ maxUsd          $2.61 / $100.00     [■─────────] 2.6%          │
  │ maxSteps        4 / 500             [■─────────] 0.8%          │
  │ turnsScaffolder 17 / 120            [■■────────] 14.2%         │
  │ turnsBuilder    33 / 300            [■─────────] 11.0%         │
  │ turnsFixer      0 / 80             [──────────] 0%             │
  └─────────────────────────────────────────────────────────────────┘
```

**Data source**: `GET /api/v1/directives/:id/pool-usage` — already works for any directive (not just in-flight). The endpoint calls `computePoolUsage` which reads `tasks_inflight` + `model_usage` for the directive. Lazy-loaded on row expand to avoid N+1 on page load.

**Cap resolution for historical builds**: uses the CURRENT project.json defaults (not what the defaults were at build time). This means the bars show "how would this build look against today's caps" — useful for deciding if current caps are right. The per-build floor (`payload.budgets` from that directive) is factored in via the `max(...)` rule.

### View 2: Aggregated stats (new Stats tab)

New tab between History and Settings:

```
[Live] [Defaults] [History] [Stats] [Settings]

Stats · pythonetl · 8 builds
───────────────────────────────────────────────────
Axis                p50     p90     max    Current cap
maxUsd              $1.43   $2.61   $4.20  $100.00
maxSteps            4       6       12     500
turnsScaffolder     17      22      38     120
turnsBuilder        47      112     240    300    ← p90 is 37% of cap
turnsFixer          0       8       24     80
totalTurns          64      142     302    ∞
usdPerTask          $0.18   $0.34   $0.82  ∞
wikiAttempts        1       1       2      3
wallClockMin        4.2     8.1     14.3   ∞
concurrentTasks     4       4       4      4      ← never varied (hardcoded pre-unification)
───────────────────────────────────────────────────
```

**Data source**: SQL aggregation across all directives for the project:

```sql
-- Per-axis per-build usage (virtual table — computed, not stored)
SELECT
  d.id AS directive_id,
  SUM(CASE WHEN mu.directive_id = d.id THEN mu.cost_usd ELSE 0 END) AS used_maxUsd,
  COUNT(CASE WHEN mu.directive_id = d.id THEN 1 END) AS used_maxSteps,
  -- ... per-axis computed columns
FROM directives d
LEFT JOIN model_usage mu ON mu.directive_id = d.id
LEFT JOIN tasks_inflight t ON t.directive_id = d.id
WHERE d.project_id = ? AND d.status IN ('complete', 'failed', 'blocked')
GROUP BY d.id
```

Then client-side (or server-side) percentile computation over the per-build rows.

**Implementation options**:
- **Option A (recommended)**: New daemon endpoint `GET /api/v1/projects/:id/budget-stats` that computes the aggregation server-side and returns the p50/p90/max table. Client renders it.
- **Option B**: Client fetches all historical directives + their pool-usage individually and computes percentiles client-side. More round-trips; doesn't scale past ~50 builds.

Recommend Option A — single endpoint, single SQL query, clean.

### View 3: Per-task drill-down historical

Already works: `GET /api/v1/directives/:id/pool-usage` returns `perAxis[axis].tasks[]` with per-task contributions. The Live tab's drill-down renders this. For historical builds, the same endpoint + same renderer applies. No new code needed — just the History tab's expand panel (View 1) includes the click-to-expand-axis behavior from the Live tab.

### Interfaces

**New endpoint**: `GET /api/v1/projects/:id/budget-stats`

```ts
// Response schema
{
  projectId: string,
  buildCount: number,
  computedAt: string,
  perAxis: {
    [axis: string]: {
      p50: number,
      p90: number,
      max: number,
      currentCap: number,
      builds: number,  // how many builds had data for this axis
    }
  }
}
```

Bearer auth. 404 on missing project. Excludes directives with `status = 'running'` (only completed/failed/blocked builds contribute to stats).

**New IPC schema**: `apiV1ProjectBudgetStatsResponseSchema` in `packages/ipc/src/schemas.ts`.

### Data Flow

```
Operator opens project page → Stats tab
  → Client fetches GET /api/v1/projects/:id/budget-stats
    → Daemon computes: for each completed directive on this project,
      aggregate per-axis usage via SQL
    → Returns p50/p90/max per axis + current caps
  → Client renders the stats table
  → Operator sees "p90 turnsBuilder = 112, current cap = 300"
    → Decides to lower cap to 150 (1.3× p90) for cost efficiency
    → Edits on Defaults tab → saves
    → Future builds get tighter, data-informed defaults
```

### Integration Points

| File | Change |
|------|--------|
| `packages/daemon/src/server.ts` | New `GET /api/v1/projects/:id/budget-stats` route |
| `packages/daemon/src/server.test.ts` | Tests for new endpoint (shape, auth, 404, empty project) |
| `packages/ipc/src/schemas.ts` | `apiV1ProjectBudgetStatsResponseSchema` |
| `apps/factory-web/src/pages/projects/detail.astro` | New Stats tab; History tab gains expandable per-axis panel per build row |
| `apps/factory-web/src/components/Tabs.astro` | Gains 5th tab entry (Stats) — no component change needed, just the caller passes 5 tabs |

### Snapshot at directive completion (future enhancement)

For the p50/p90/max computation, the current approach re-derives pool usage from raw tables on every Stats tab load. For projects with hundreds of builds, this could get slow. A future optimization: snapshot the pool-usage at directive completion into a `directive_pool_snapshot` table (one row per directive per axis). Stats query then aggregates over the snapshot table instead of raw data.

For first ship: derive live from raw tables. The SQL is fast enough for <100 builds per project.

## Affected Files

- Modify: `packages/daemon/src/server.ts` (new endpoint)
- Modify: `packages/daemon/src/server.test.ts`
- Modify: `packages/ipc/src/schemas.ts` (new schema)
- Modify: `apps/factory-web/src/pages/projects/detail.astro` (Stats tab + History expand)

## Dependencies

- Depends on: [budget_canonical_table.md](budget_canonical_table.md) (Feature 1 — axis taxonomy for the table headers)
- Depends on: [budget_unified_resolution.md](budget_unified_resolution.md) (Feature 2 — `computePoolUsage` provides per-build data)
- Depends on: [budget_new_axes.md](budget_new_axes.md) (Feature 3 — new axes appear in the stats table)
- Brainstorm: [budget_axis_unification_brainstorm.md](budget_axis_unification_brainstorm.md)
- Related features: [budget_provider_maxturns_fix.md](budget_provider_maxturns_fix.md)

## Development Order

5 of 5 — build last. Consumes the data model all 4 prior features established. No other feature depends on it. Can be deferred without blocking the correctness work (Features 1-4).

## Open Questions

1. **Data retention for stats**: include ALL historical builds? Last 30 days? Last N builds? Recommend: all builds, no retention window. Operator can judge relevance from the build count ("Stats · 8 builds" → too few to set p90 confidently; "Stats · 47 builds" → reliable).

2. **Stats tab vs extending History tab**: the brainstorm said "History tab or new Telemetry tab." Recommend a separate Stats tab — the History tab already has per-build rows with spend; adding p50/p90 aggregates there would mix individual-build data with cross-build aggregates. Clean separation.

3. **Percentile computation location**: server-side (recommended — single SQL query, no N+1) vs client-side (more flexible, slower). Recommend server-side with the `budget-stats` endpoint.
