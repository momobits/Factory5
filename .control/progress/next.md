# Next session — paste this to start

Open Phase 7, sub-phase 7b — cross-session spend dashboard.

Read `CLAUDE.md`, then `.control/progress/STATE.md`, then
`.control/phases/phase-7-budget-discipline/README.md` and
`.control/phases/phase-7-budget-discipline/steps.md` for the 4-step
7b checklist + 7c preview.

Also read:

- `docs/decisions/0020-pre-call-budget-enforcement.md` — confirms the
  `model_usage` shape 7b aggregates over. No schema change in 7b;
  `mode` / `category` / `directive_id` / `task_id` / `model` /
  `provider` / `cost_usd` / `called_at` are all populated.
- `docs/Phase7_Progress.md` §"Phase 7a" — what shipped in 7a and
  why (the live validation result sets the expectation that per-
  directive totals are accurate to the cent).

**No pause-for-human.** 7b needs no secrets; it's a pure query +
CLI formatting phase. The first concrete work is **7b.1** — add a
spend-aggregation query module to `@factory5/state`. Natural
aggregations (per-project, per-directive, per-day, per-model) are
all straightforward SQL over `model_usage`.

Report back a 5-line status in this shape:

```
Phase 7 — Operator-control + budget discipline, sub-phase 7b — cross-session spend dashboard, step 7b.1
Last action: Phase 7a closed (tag phase-7a-budget-enforcement-closed; commit <sha>)
Git: branch=main, last=<sha> <subject>, uncommitted=<yes/no>, tag=<last>
Open blockers: 1 (I008, MEDIUM, findings-registry collision — may matter if 7b groups by project_id)
Proposed next action: 7b.1 — @factory5/state spend aggregation queries (per-project, per-directive, per-day, per-model)
Ready to proceed?
```

Budget for 7b: ~1 session, near-zero LLM spend (pure TypeScript +
SQLite work + a round-trip test that seeds two fake builds).

Execution order for Phase 7: **7a → 7b → 7c** (strict). 7a is done.
After 7c closes, Phase 7 as a whole closes with tag
`phase-7-closed`, and Phase 8 opens (not yet charted).

Known consideration for 7b: I008 (findings-registry `project_id` as
`basename(path)` collision) may affect how 7b groups "per-project."
Two options at design time: (a) resolve I008 first with a
`(project_path, finding_id)` PK and apply the same principle to spend,
(b) group spend by `directive_id` primarily and expose project as a
secondary view. Decide early in 7b.1.

**Operator follow-up from Phase 6 close, out-of-band whenever
convenient:** revoke the `env:GITHUB_TOKEN` PAT at
https://github.com/settings/tokens, delete the throwaway repo
(`gh repo delete momobits/factory5-6b-smoke --yes`), clear the env
var (`reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`). None of
these block Phase 7b.
