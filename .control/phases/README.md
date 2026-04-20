# Phase directories

One directory per active or queued phase. Each directory contains `README.md` (goal, outcome, done criteria, rollback) and `steps.md` (per-step checklist).

## Current state (2026-04-21)

| Phase | Directory | Status |
|---|---|---|
| 0–5 | — (closed pre-Control) | See [`phase-1-through-5-closed.md`](phase-1-through-5-closed.md) for summaries + pointers into `docs/` |
| 6c — Verifier overhaul | [`phase-6c-verifier-overhaul/`](phase-6c-verifier-overhaul/) | 🟢 active (execution order 1 of 3 within Phase 6) |
| 6a — Findings registry | [`phase-6a-findings-registry/`](phase-6a-findings-registry/) | ⏸ queued (execution order 2 of 3) |
| 6b — GitHub channel | [`phase-6b-github-channel/`](phase-6b-github-channel/) | ⏸ queued (execution order 3 of 3) |
| 7a/b/c | — (scaffolded at 6b close) | Charter in [`.control/architecture/phase-plan.md`](../architecture/phase-plan.md) |

## Why Phases 0–5 don't have dirs

Those phases shipped before Control was installed (2026-04-21). Reconstructing their step checklists and done criteria would be fabrication — they closed without Control's mechanical gates. Their narrative history lives in:

- [`docs/PROGRESS.md`](../../docs/PROGRESS.md) — session-by-session log (2554 lines; covers Phases 0–5)
- [`docs/Phase5_Progress.md`](../../docs/Phase5_Progress.md) — Phase 5 arc narrative (5a → 5f)
- [`docs/Phase6_Progress.md`](../../docs/Phase6_Progress.md) — Phase 6 charter (drafted at Phase 5 close)

`phase-1-through-5-closed.md` here summarizes each closed phase and points into those sources.

## Why Phase 6 has sub-phase dirs (6a, 6b, 6c) rather than one `phase-6/` dir

Phase 6 runs as three independent sub-phases (**6c → 6a → 6b** execution order). Each closes with its own tag (`phase-6c-verifier-overhaul-closed` etc.) and can be rolled back independently. Control's phase-plan guidance explicitly supports `phase-Na` / `phase-Nb` subdivision. Phase 6 as a whole closes when all three sub-phases ship (or the charter is narrowed — see `docs/Phase6_Progress.md` exit criteria).
