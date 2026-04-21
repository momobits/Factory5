# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-21T17:50:00Z — session `2026-04-21T17` (Phase 7a shipped; `/session-end`)
**Current phase:** 7 — Operator-control + budget discipline
**Current sub-phase:** 7b — Cross-session spend dashboard (queued)
**Current step:** 7b.1 — `@factory5/state.queries.spend` aggregations (not started)
**Status:** queued — Phase 7a shipped and tagged; Phase 7b opens next session.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root (~700 lines) — snapshot at scaffold, canonical design. §12 line 454 (`max_usd` / `max_steps`) now wired per ADR 0020.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological session log), `docs/Phase5_Progress.md`, `docs/Phase6_Progress.md`, `docs/Phase7_Progress.md` (new — 7a close narrative + 7b / 7c previews).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only — do not duplicate content from `docs/` into `.control/`.

---

## Next action

**Step 7b.1 — `@factory5/state` spend aggregations.** Add a new query module (likely `packages/state/src/queries/spend.ts` or expand `model-usage.ts`) with:

- per-project spend (sum by project_id inferred from directive payload or from the `projects` table)
- per-directive spend (already exists as `totalCostForDirective`)
- per-day spend (group by `date(called_at)`)
- per-model spend (group by `model`)

Returns JSON-friendly rows — the CLI subcommand in 7b.2 formats them.

`model_usage` rows are already tagged with `mode`, `category`, `directive_id`, `task_id`, `model`, `provider`, `cost_usd`, `called_at` — everything 7b needs is present. 7b is pure query work on an already-populated table; no schema change needed.

Detailed Phase 7b plan: `.control/phases/phase-7-budget-discipline/README.md` + `steps.md`. 7b has 4 sub-steps (queries → CLI → round-trip test → close). Bodies expand at session start.

**Commit message shape for 7b.1:** `feat(7b.1): @factory5/state spend aggregation queries`.

---

## Git state

- **Branch:** main (ahead of `origin/main` by ~39 commits since Phase 5 close — push at operator discretion)
- **Last commit:** `0923628` — `chore(phase-7a): close Phase 7a — budget enforcement shipped`
- **Uncommitted changes:** no (pending this session-end docs commit)
- **Last phase tag:** `phase-7a-budget-enforcement-closed` (tags `0923628`)

Earlier tags intact: `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`.

---

## Open blockers

- **I008** (MEDIUM, OPEN, state/findings-registry) — `findings_registry` collides when two workspaces share a project name. May surface in Phase 7b's spend dashboard if "per-project" is implemented against `project_id = basename(path)`. Worth resolving or explicitly scoping around when Phase 7b touches project identity.

---

## In-flight work

- None — Phase 7a closed cleanly. Phase 7b opens with no carried work. 7b is pure query work on an already-populated `model_usage`; no schema change needed.

---

## Test / eval status

- **Last test run:** Phase 7a close, 2026-04-21 — 347 tests across 13 packages, all green. (+38 across Phase 7a: migration 004/005 shape, model-usage queries, budget unit + integration tests, config budget-defaults round-trip.)
- **Eval score** (agent phases only): Phase 7a live validation, directive `01KPRHNEX1T3VR3S4ZTTSJ8F0M`, 2026-04-21. $1.9151 of $3.00 ceiling spent; tripped cleanly at builder-2's pre-call check; 5 `model_usage` rows recorded; directive ended `blocked` with `budget_exceeded_usd:` prefix on blocked_reason. Phase 6c's $7.71 silent overshoot not reproducible.
- **Regression tests:** Budget regression in `packages/brain/src/budget-regression.test.ts` (3 scenarios: maxUsd trip, maxSteps trip, happy path). Existing F001 regression in `packages/worker/src/verifier-f001.test.ts`. Registry regression in `packages/state/src/migrations/003-findings-registry.test.ts` + `packages/state/src/state.test.ts` + `packages/cli/src/commands/findings.test.ts`.

---

## Recent decisions (last 4 ADRs)

- **ADR 0020** (2026-04-21) — Pre-call budget enforcement: rolling-average estimator per `(category, mode)` with baked-in cold-start defaults; `assertBudget` wrapper in brain; `budget_exceeded_*:` prefix on `directives.blocked_reason`.
- **ADR 0019** (2026-04-21) — Drop GitHub integration from factory5; future output-to-GH is operator-directed per-directive, not pattern-driven. **Durable doctrine.**
- **ADR 0018** (2026-04-21) — Verifier becomes advisory-only (findings don't block the gate).
- **ADR 0017** (2026-04-19) — Assessor project-env provisioning: venv + requires-python + pip install.

All 20 ADRs live under `docs/decisions/` (factory5's authoritative shape — do not fork into `.control/architecture/decisions/`).

---

## Recently completed (last 5 steps)

- **Phase 7a closed** — 2026-04-21 — tag `phase-7a-budget-enforcement-closed`; 9 sub-steps (7a.1 → 7a.9) across commits `d295dd3` → close. Pre-call budget enforcement via `assertBudget` in `@factory5/brain/src/budget.ts`; ADR 0020 records the decision; migrations 004 + 005; CLI flags + config defaults; regression test; live validation passed with $1.08 headroom.
- **7a.8 — Live validation** — 2026-04-21 — directive `01KPRHNEX1T3VR3S4ZTTSJ8F0M`; `factory build example --max-usd 3` tripped at builder-2 dispatch; blocked_reason `budget_exceeded_usd: spent=$1.9151 ...`.
- **7a.7 — Regression test** — 2026-04-21 — commit `3dafa13`. `budget-regression.test.ts` covers maxUsd trip, maxSteps trip, happy path.
- **7a.4 — Brain enforcement** — 2026-04-21 — commit `194ef4f` (19 files). `budget.ts` module, call-site wiring, loop outer catch, migration 005.
- **7a.1 — ADR 0020** — 2026-04-21 — commit `d295dd3`. Rolling-average estimator + escalation shape decided.

---

## Attempts that didn't work (current step only)

- None yet — 7b.1 not started.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest.
- **Model in use:** Claude Opus 4.7 for scaffolding sessions; live builds use category routing per ADR 0004 (quick=Haiku 4.5, planning=Sonnet 4.6, deep/reasoning=Opus 4.7).
- **Other:** Windows + Linux cross-platform mandatory. 13 packages + 2 apps. 347 tests. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` by ADR 0019. Budget enforcement by ADR 0020.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section and the steps.md-checkbox discipline line.
2. Read this STATE.md.
3. Read `.control/phases/phase-7-budget-discipline/README.md` + `steps.md` for Phase 7b checklist.
4. Read `docs/Phase7_Progress.md` for the 7a close narrative + 7b / 7c previews.
5. Read `docs/decisions/0020-pre-call-budget-enforcement.md` if any question arises about why `model_usage.mode` exists, why the rolling average has a 2-sample floor, or how the escalation shape works.
6. Run `/session-start` for the full drift check.
7. **Next concrete work:** 7b.1 — `@factory5/state` spend aggregation queries. No [HALT] gates; no secrets needed. Pure query work over `model_usage`.

**Execution order reminder:** Phase 7 runs **7a → 7b → 7c** in strict order. After 7c, Phase 7 closes and Phase 8 opens (not yet charted — options are Web UI, assessor tier-3, worker-subprocess `ask_user`).

**Budget for 7b:** ~1 session, near-zero LLM spend (pure TypeScript + SQLite work + round-trip test).

**Operator follow-up from Phase 6 close (still out-of-band):**

1. Revoke PAT at https://github.com/settings/tokens.
2. Delete throwaway repo: `gh repo delete momobits/factory5-6b-smoke --yes`.
3. Clear env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.

None of these block Phase 7b.
