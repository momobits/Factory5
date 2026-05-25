# Implemented: Budget Observability (F5)

*Implemented: 2026-05-25*
*Feature: [budget_observability.md](../features/budget_observability.md)*

## Summary

Added per-project budget usage statistics endpoint and web UI Stats tab, enabling
operators to view p50/p90/max aggregated usage across all completed builds and make
data-informed budget default decisions.

## Changes

| File | Change |
|------|--------|
| `packages/ipc/src/schemas.ts` | Added `apiV1ProjectBudgetStatsResponseSchema` with per-axis p50/p90/max/currentCap/builds |
| `packages/daemon/src/server.ts` | Added `GET /api/v1/projects/:id/budget-stats` endpoint + `percentile()` helper |
| `packages/daemon/src/server.test.ts` | 4 tests: auth, 404, empty project, stats computation with model_usage data |
| `apps/factory-web/src/pages/projects/detail.astro` | New Stats tab (5th tab) with table rendering, lazy-load on tab activation |

## Endpoint

`GET /api/v1/projects/:id/budget-stats` — bearer-gated, returns aggregated per-axis
usage stats (p50/p90/max/currentCap/builds) across all terminal (complete/failed/blocked)
directives for the project. Uses `computePoolUsage` per directive then computes
percentiles server-side.

## Dependencies satisfied

- F1 (Budget Canonical Table) — axis taxonomy used for table headers
- F2 (Budget Unified Resolution) — `computePoolUsage` provides per-build data
- F3 (Budget New Axes) — new axes appear in stats
- F4 (Provider maxTurns Fix) — correct turn counting
