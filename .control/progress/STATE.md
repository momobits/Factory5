# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-21T21:51:00Z — session `2026-04-21T21` (Phase 7b.1 shipped; `/session-end`)
**Current phase:** 7 — Operator-control + budget discipline
**Current sub-phase:** 7b — Cross-session spend dashboard (in progress)
**Current step:** 7b.2 — `@factory5/state.queries.spend` aggregations (not started)
**Status:** ready — Phase 7b.1 shipped (data model + helper + integration); 7b.2 opens next session on a clean foundation where `directives.project_id` is first-class for every directive.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root (~700 lines) — snapshot at scaffold, canonical design. §12 line 454 (`max_usd` / `max_steps`) wired per ADR 0020. §3 (project storage layout) gains `<project>/.factory/project.json` per ADR 0021 (in-line pointer landed in 7b.1's commit `92bebf4`).
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological session log), `docs/Phase5_Progress.md`, `docs/Phase6_Progress.md`, `docs/Phase7_Progress.md` (7a close + 7b/7c previews — 7b.1 row addition is a non-blocking follow-up).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only.

---

## Next action

**Step 7b.2 — `@factory5/state` spend aggregation queries.** Add a new query module (likely `packages/state/src/queries/spend.ts`) with:

- per-project spend — JOIN `model_usage → directives` on `directive_id`, GROUP BY `directives.project_id`, optionally JOIN `projects` for the display `name`. Honest now (ULID-keyed) that 7b.1 is done.
- per-directive spend — already exists as `totalCostForDirective`; wrap or expose alongside the new aggregations.
- per-day spend — GROUP BY `date(called_at)`.
- per-model spend — GROUP BY `model`.

Returns JSON-friendly rows; the CLI subcommand in 7b.3 formats them.

Detailed Phase 7b plan: `.control/phases/phase-7-budget-discipline/README.md` + `steps.md`. 7b has 5 sub-steps (7b.1 ✅; 7b.2 → 7b.5 remain). The data layer is now ready — `directives.project_id` is populated by every new directive (CLI build / resume) and was backfilled for legacy rows in migration 006.

**Commit message shape for 7b.2:** `feat(7b.2): @factory5/state spend aggregation queries`.

---

## Git state

- **Branch:** main (ahead of `origin/main` by ~45 commits since Phase 5 close — push at operator discretion)
- **Last commit:** `1999a14` — `docs(7b.1): close I008 + flip 7b.1 checkbox`
- **Uncommitted changes:** no (pending this session-end docs commit)
- **Last phase tag:** `phase-7a-budget-enforcement-closed` (tags `0923628`)

Earlier tags intact: `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`.

---

## Open blockers

- **None.** I008 RESOLVED this session via 7b.1's first-class-identity migration. The open backlog is empty for the first time since Phase 6a opened it.

---

## In-flight work

- None — Phase 7b.1 shipped cleanly. 7b.2 opens with no carried work. Pure SQL aggregation against an already-populated table.

---

## Test / eval status

- **Last test run:** Phase 7b.1 close, 2026-04-21 — 375 tests across 13 packages, all green. (+28 across 7b.1: 11 migration 006 shape + backfill, 11 project-metadata helper, 3 state.projects rewrite for id-keyed CRUD, 1 cli/findings backfill skip-on-missing-identity, 2 wiki dual-write `projectId` propagation.)
- **Eval score** (agent phases only): unchanged from 7a.8 live validation — directive `01KPRHNEX1T3VR3S4ZTTSJ8F0M`, $1.9151 of $3.00 ceiling, tripped cleanly at builder-2.
- **Regression tests:** Migration 006 + project-metadata helper cover the I008 regression (4 explicit tests in `006-project-identity.test.ts` + 11 in `project-metadata.test.ts`). Existing 7a budget regression in `packages/brain/src/budget-regression.test.ts`. F001 verifier regression in `packages/worker/src/verifier-f001.test.ts`. Registry shape regression in `packages/state/src/migrations/003-findings-registry.test.ts`.

---

## Recent decisions (last 4 ADRs)

- **ADR 0021** (2026-04-21) — First-class project identity via `<project>/.factory/project.json` (ULID). Stable across path moves; explicit at fork. Closes I008. Five-part decision: file shape, helper resolve rules, schema migration, backfill, CLI display.
- **ADR 0020** (2026-04-21) — Pre-call budget enforcement: rolling-average estimator per `(category, mode)` + cold-start defaults; `assertBudget` wrapper in brain; `budget_exceeded_*:` prefix on `directives.blocked_reason`.
- **ADR 0019** (2026-04-21) — Drop GitHub integration. Future output-to-GH is operator-directed per-directive, not pattern-driven. **Durable doctrine.**
- **ADR 0018** (2026-04-21) — Verifier becomes advisory-only.

All 21 ADRs live under `docs/decisions/`.

---

## Recently completed (last 5 steps)

- **7b.1 — Data-model prep / first-class project identity** — 2026-04-21 — commits `71b36ff` (ADR + scope) → `92bebf4` (substantive) → `786698a` (format pass) → `1999a14` (I008 close + checkbox flip). ADR 0021 + migration 006 + `loadOrCreateProjectMetadata` helper + insert-path wiring across CLI build/resume/findings + brain pool + wiki findings + 28 new tests. Closes I008.
- **Control framework hygiene** — 2026-04-21 — commit `db87e97` (factory5) + `cee27a1` (Control source). Session-start protocol step 5b: expand design choices in full at bootstrap; never present as labeled footnotes that force the operator to ask in a second turn. Adds matching `## Decisions awaiting your input` slot to next.md template.
- **Phase 7a closed** — 2026-04-21 — tag `phase-7a-budget-enforcement-closed`; 9 sub-steps (7a.1 → 7a.9).
- **7a.8 — Live validation** — 2026-04-21 — directive `01KPRHNEX1T3VR3S4ZTTSJ8F0M`; tripped at builder-2 dispatch with $1.08 headroom.
- **7a.7 — Regression test** — 2026-04-21 — commit `3dafa13`. `budget-regression.test.ts` covers maxUsd trip / maxSteps trip / happy path.

---

## Attempts that didn't work (current step only)

- None yet — 7b.2 not started.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid.
- **Model in use:** Claude Opus 4.7 for scaffolding sessions; live builds use category routing per ADR 0004 (quick=Haiku 4.5, planning=Sonnet 4.6, deep/reasoning=Opus 4.7).
- **Other:** Windows + Linux cross-platform mandatory. 13 packages + 2 apps. 375 tests. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` per ADR 0019. Budget enforcement per ADR 0020. Project identity via `.factory/project.json` per ADR 0021.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section and the steps.md-checkbox discipline line.
2. Read this STATE.md.
3. Read `.control/phases/phase-7-budget-discipline/README.md` + `steps.md` for the Phase 7b checklist (7b.1 done; 7b.2 → 7b.5 remain).
4. Read `docs/decisions/0021-first-class-project-identity.md` if any question arises about why `directives.project_id` is now populated, what the `.factory/project.json` file means, or how the resolve helper handles missing/corrupt files.
5. Read `docs/decisions/0020-pre-call-budget-enforcement.md` for the `model_usage` shape 7b.2 aggregates over (no schema change in 7b.2; `mode` / `category` / `directive_id` / `task_id` / `model` / `provider` / `cost_usd` / `called_at` are all populated and now `directives.project_id` joins out cleanly).
6. Run `/session-start` for the full drift check.
7. **Next concrete work:** 7b.2 — `@factory5/state` spend aggregation queries. No [HALT] gates; no secrets needed. Pure query work over `model_usage` joined to `directives.project_id`.

**Execution order reminder:** Phase 7 runs **7a → 7b → 7c** in strict order. After 7c, Phase 7 closes and Phase 8 opens (not yet charted — options are Web UI, assessor tier-3, worker-subprocess `ask_user`).

**Budget for 7b.2:** ~half a session, near-zero LLM spend (pure TypeScript + SQLite + unit tests).

**I008 closed this session** — the open blocker list is empty for the first time since Phase 6a.

**Operator follow-up from Phase 6 close (still out-of-band):**

1. Revoke PAT at https://github.com/settings/tokens.
2. Delete throwaway repo: `gh repo delete momobits/factory5-6b-smoke --yes`.
3. Clear env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.

None of these block Phase 7b.2.
