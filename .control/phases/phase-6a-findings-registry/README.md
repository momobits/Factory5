# Phase 6a — Cross-project findings registry

**Dependencies:** Phase 6c closed (`phase-6c-verifier-overhaul-closed` tag)
**Estimated duration:** 1–2 sessions
**Execution order within Phase 6:** 2nd (after 6c, before 6b)
**Status:** ⏸ queued — detailed steps to be authored at `/phase-close` time for 6c, or at start of the 6a session

## Goal

Aggregate every project factory5 has ever built into a single index the operator can query. Today findings live per-project at `<workspace>/<project>/.factory/findings.json` — fine for one build, useless for "what HIGH findings are open across my last month of builds."

## Outcome

`factory findings list --severity HIGH --status OPEN` returns real rows from ≥2 projects without shell-spelunking. `factory findings show <id>` shows the full finding content, the originating directive, and the project path.

## Sub-steps (preview — expand at phase start)

- `state` migration for `findings_registry` table
- `wiki.addFinding` writes to registry in addition to per-project file
- `cli` subcommand `findings list|show` with filters
- Backfill script for pre-Phase-6a projects
- Regression tests for the registry schema + CLI round-trip
- Live validation: run `factory findings list` after a build completes, see the build's findings

## Done criteria

Full list to be authored when this phase activates. Must include at minimum:

- [ ] All steps checked off with commit references
- [ ] Test suite green (target: `state`, `wiki`, `cli` packages)
- [ ] `pnpm build && pnpm lint` clean
- [ ] ADR (if one emerges — likely only for schema-design choice)
- [ ] Live smoke: `factory findings list --severity HIGH` returns rows from the Phase 5 `example` corpus after running the backfill
- [ ] `docs/PROGRESS.md` entry + `docs/Phase6_Progress.md` 6a row flipped ✅
- [ ] Working tree clean
- [ ] Tag `phase-6a-findings-registry-closed`

## Rollback plan

`git reset --hard phase-6c-verifier-overhaul-closed`. The `findings-registry.sqlite` is a derived artifact and can be rebuilt via backfill — no data loss if rolled back.

## ADRs decided in this phase

TBD — possibly an ADR on registry schema if a non-trivial choice (e.g. dedup strategy across project rebuilds).
