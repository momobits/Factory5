# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-21 by `/phase-close` (end of Phase 6c)
**Current phase:** 6 — Operator-trust + multi-surface
**Current sub-phase:** 6a — Cross-project findings registry (execution order 2 of 3 within Phase 6)
**Current step:** 6a.1 — Schema design + `state` migration for `findings_registry`
**Status:** ready-to-start (awaiting user go)

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root (698 lines) — snapshot at scaffold, canonical design.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (2700+ lines session log, Phase 6c entry appended), `docs/Phase5_Progress.md` (Phase 5 arc), `docs/Phase6_Progress.md` (active charter; 6c row ✅, 6a/6b pending).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only — do not duplicate content from `docs/` into `.control/`.

---

## Next action

Begin **step 6a.1** — design the `findings_registry` SQLite schema and author the migration under `packages/state/src/migrations/`. Primary key `(project_id, finding_id)`; columns include `advisory` (propagating ADR 0018's flag into the registry), `origin_directive_id` for traceability, and `updated_at` for upsert semantics.

Detailed plan: `.control/phases/phase-6a-findings-registry/steps.md` §6a.1.
Commit message: `feat(6a.1): state migration for findings_registry table`.
Possible ADR 0019: if the dedup-on-rebuild decision (upsert vs version-append vs ID-fork) gets contested, file it.

---

## Git state

- **Branch:** main
- **Last commit:** `<to be filled by this phase-close commit>` — `chore(phase-6c): close Phase 6c, kick off Phase 6a`
- **Uncommitted changes:** no (post-phase-close)
- **Last phase tag:** `phase-6c-verifier-overhaul-closed` — tags commit `a24f883` (`docs(6c.8): PROGRESS.md entry for Phase 6c session close`)

---

## Open blockers

- None. Phase 6c shipped with zero new factory5 issues opened. `docs/issues/INDEX.md` Open list remains empty.

---

## In-flight work

- None — Phase 6c closed cleanly. Phase 6a has not started.

---

## Test / eval status

- **Last test run:** Phase 6c close, 2026-04-21 — 262 tests across 12 packages, all green. Per-package: logger 5, core 14, ipc 5, state 16, providers 37, assessor 42, wiki 21, channels 25, events 3, worker 24, brain 42, daemon 28.
- **Eval score** (agent phases only): Phase 6c live validation (directive `01KPQK61F9967TT8JZWCMCV3NW`, 2026-04-21) — `factory build example --autonomy autonomous --concurrency 2 --workspace /c/Users/Momo/factory5-v6c-example` terminated `complete` with `gate: {build: true, integration: true, verify: true}`, 119 pytest passed, two verifier findings (both `advisory: true`, non-contradictory), spend $7.71.
- **Regression tests:** F001 regression in `packages/worker/src/verifier-f001.test.ts` asserts the ADR 0018 invariant (hallucinated CRITICAL still persists but is marked advisory → cannot block gate).

---

## Recent decisions (last 3 ADRs)

- **ADR 0018** (2026-04-21) — Verifier becomes advisory-only (findings don't block the gate)
- **ADR 0017** (2026-04-19) — Assessor project-env provisioning: venv + requires-python + pip install
- **ADR 0016** (2026-04-18) — Planner materialisation: category floor, file-ownership deps, per-task turn budgets

All 18 ADRs live under `docs/decisions/` (factory5's authoritative shape — do not fork into `.control/architecture/decisions/`).

---

## Recently completed (last 5 steps)

- **Phase 6c closed (advisory path)** — 2026-04-21 — tag `phase-6c-verifier-overhaul-closed`; 8 sub-steps shipped across commits `c35681a`, `a911604`, `0334597`, `9c8246d`, `ad36c46`, `2daa3d0`, `7bfee98`, `a24f883`
- **6c.8 — PROGRESS.md session entry** — 2026-04-21 — commit `a24f883`
- **6c.7 — Live validation passed** — 2026-04-21 — commit `7bfee98`; directive `01KPQK61F9967TT8JZWCMCV3NW`
- **6c.6 — Phase6_Progress 6c row flipped ✅** — 2026-04-21 — commit `2daa3d0`
- **6c.5 — F001 regression green (advisory invariant)** — 2026-04-21 — commit `ad36c46`

---

## Attempts that didn't work (current step only)

- None yet (step 6a.1 has not started).

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest.
- **Model in use:** Claude Opus 4.7 for scaffolding sessions; live builds use category routing per ADR 0004 (quick=Haiku 4.5, planning=Sonnet 4.6, deep/reasoning=Opus 4.7).
- **Other:** Windows + Linux cross-platform mandatory. 12 packages + 2 apps. 262 tests (up from 255 at Phase 5 close).

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-6a-findings-registry/README.md` + `steps.md` for the Phase 6a plan (steps.md was expanded during the 6c close).
4. Read `docs/Phase6_Progress.md` for the cross-sub-phase charter context.
5. Read `docs/decisions/0018-verifier-advisory-only.md` — the advisory flag is a hand-off that 6a's display layer (`factory findings list`) will branch on.
6. Run `/session-start` for the full drift check.
7. If ready, type `go` to kick off step 6a.1.

**Execution order reminder:** Phase 6 runs as **6c (done) → 6a (next) → 6b**. After 6a: Phase 6b (GitHub channel) requires OAuth / PAT coordination before a session starts — expect a checkpoint.

**Budget for 6a:** $4–6, 1–2 sessions. Carry-over concern from 6c: live-run spend trending above envelope ($7.71 in 6c, $5.84 in 5f). Phase 7a (pre-call `max_usd` enforcement) is pre-charted in `.control/architecture/phase-plan.md` — 6a itself won't enforce, but keep the agent-heavy backfill step (6a.5) short.
