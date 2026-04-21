# Next session — paste this to start

Continue Phase 7, sub-phase 7b — cross-session spend dashboard.
7b.1 (data-model prep) is done; **7b.2** is next.

Read `CLAUDE.md`, then `.control/progress/STATE.md`, then
`.control/phases/phase-7-budget-discipline/README.md` and
`.control/phases/phase-7-budget-discipline/steps.md` for the 5-step
7b checklist (7b.1 ✅, 7b.2 → 7b.5 remain).

Also read:

- `docs/decisions/0021-first-class-project-identity.md` — accepted
  last session. Per-project rollups now join through
  `directives.project_id` (ULID); no basename collision risk left.
- `docs/decisions/0020-pre-call-budget-enforcement.md` — confirms
  the `model_usage` shape 7b.2 aggregates over (no schema change in
  7b.2).

**No pause-for-human.** 7b.2 needs no secrets; it's pure query work.
The first concrete work is **7b.2** — add a spend-aggregation query
module to `@factory5/state`. Aggregations:

- **per-project** — JOIN `model_usage → directives` on `directive_id`,
  GROUP BY `directives.project_id`, JOIN `projects` for the display
  `name`. Surface as `name (…id-suffix)` per ADR 0021 §5.
- **per-directive** — `totalCostForDirective` exists; expose alongside
  the new aggregations as the canonical per-build entry.
- **per-day** — GROUP BY `date(called_at)`.
- **per-model** — GROUP BY `model`.

All return JSON-friendly rows; the CLI subcommand in 7b.3 formats them.

Report back a 5-line status in this shape:

```
Phase 7 — Operator-control + budget discipline, sub-phase 7b — cross-session spend dashboard, step 7b.2
Last action: Phase 7b.1 shipped (commits 71b36ff → 1999a14; ADR 0021 accepted; I008 resolved; 375 tests green)
Git: branch=main, last=<sha> <subject>, uncommitted=<yes/no>, tag=phase-7a-budget-enforcement-closed
Open blockers: 0 (I008 closed this session)
Proposed next action: 7b.2 — @factory5/state spend aggregation queries (per-project / per-directive / per-day / per-model)
Ready to proceed?
```

## Decisions awaiting your input

_(none — 7b.2 is straightforward query work; the only design call left to make is which file the helper module lives in (`spend.ts` is the natural choice) and whether per-project rollup includes a `JOIN projects` for display name vs returning the raw ULID — both small enough to decide inline at implementation time without operator input)_

Budget for 7b.2: ~half a session, near-zero LLM spend (pure TypeScript

- SQLite + unit tests on an in-memory DB seeded with synthetic
  `model_usage` + `directives` + `projects` rows).

Execution order for Phase 7: **7a → 7b → 7c** (strict). 7a closed,
7b.1 done. After 7c closes, Phase 7 as a whole closes with tag
`phase-7-closed`, and Phase 8 opens (not yet charted).

**Operator follow-up from Phase 6 close, out-of-band whenever
convenient:** revoke the `env:GITHUB_TOKEN` PAT at
https://github.com/settings/tokens, delete the throwaway repo
(`gh repo delete momobits/factory5-6b-smoke --yes`), clear the env
var (`reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`). None of
these block Phase 7b.2.
