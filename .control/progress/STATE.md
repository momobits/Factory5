# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-21 by `/phase-close` (end of Phase 6a)
**Current phase:** 6 — Operator-trust + multi-surface
**Current sub-phase:** 6b — GitHub channel (execution order 3 of 3 within Phase 6)
**Current step:** 6b.1 — `[HALT] secret_needed` — user provides GitHub PAT + test repo URL
**Status:** paused-for-human — awaiting GitHub PAT + test repo URL before the session can begin

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root (698 lines) — snapshot at scaffold, canonical design.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (2900+ lines session log, Phase 6a entry appended), `docs/Phase5_Progress.md` (Phase 5 arc), `docs/Phase6_Progress.md` (active charter; 6c ✅, 6a ✅, 6b pending).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only — do not duplicate content from `docs/` into `.control/`.

---

## Next action

Phase 6a is closed. Phase 6b — GitHub channel — is next per the phase-plan's 6c → 6a → 6b execution order. The first step (**6b.1**) is a pause-for-human: the user provides a GitHub Personal Access Token with the minimum scopes (`repo`, `read:org`) and a throwaway repo URL for the live-smoke step. Until that arrives, the session cannot proceed.

Detailed plan: `.control/phases/phase-6b-github-channel/README.md` + `steps.md` (9 sub-steps, placeholder-level; detailed per-step bodies are authored at session start once the ADR choice in 6b.2 — webhook vs polling vs hybrid — is made).
Commit message for 6b.1 resumption: whatever records the received config; typically `chore(6b.1): record github test repo + PAT ref`.

---

## Git state

- **Branch:** main
- **Last commit:** `<to be filled by this phase-close commit>` — `chore(phase-6a): close Phase 6a, kick off Phase 6b`
- **Uncommitted changes:** no (post-phase-close)
- **Last phase tag:** `phase-6a-findings-registry-closed` — tags the phase-close commit above (Phase 6a ran `5d81fe2` → this commit)

---

## Open blockers

- **I008** (MEDIUM, OPEN, state/findings-registry) — `findings_registry` collides when two workspaces share a project name. Deferred to Phase 7+; not a phase-6 blocker, but cite when 6b touches project identity (GitHub-directive-ingest may or may not reuse `projects.upsert` in ways that expose the collision).

---

## In-flight work

- None — Phase 6a closed cleanly. Phase 6b is paused at 6b.1 pending user input.

---

## Test / eval status

- **Last test run:** Phase 6a close, 2026-04-21 — 309 tests across 13 packages, all green. Per-package: logger 5, core 14, ipc 5, state 33, providers 37, assessor 42, wiki 27, channels 25, events 3, worker 24, brain 42, daemon 28, cli 24.
- **Eval score** (agent phases only): Phase 6c live validation remains the last build — directive `01KPQK61F9967TT8JZWCMCV3NW`, 2026-04-21, gate all-true, 119 pytest, two verifier findings (both `advisory: true`), spend $7.71. Phase 6a was pure scaffolding with zero LLM spend.
- **Regression tests:** F001 regression in `packages/worker/src/verifier-f001.test.ts` (ADR 0018 advisory invariant). Registry regression in `packages/state/src/migrations/003-findings-registry.test.ts` (composite PK + CHECK constraints + FK on_delete) and `packages/cli/src/commands/findings.test.ts` (list/show/backfill handler round-trip).

---

## Recent decisions (last 3 ADRs)

- **ADR 0018** (2026-04-21) — Verifier becomes advisory-only (findings don't block the gate)
- **ADR 0017** (2026-04-19) — Assessor project-env provisioning: venv + requires-python + pip install
- **ADR 0016** (2026-04-18) — Planner materialisation: category floor, file-ownership deps, per-task turn budgets

All 18 ADRs live under `docs/decisions/` (factory5's authoritative shape — do not fork into `.control/architecture/decisions/`). Phase 6a shipped without opening ADR 0019; the `(project_id, finding_id)` dedup decision was documented inline in the migration file and the collision caveat captured as I008 rather than as an ADR.

---

## Recently completed (last 5 steps)

- **Phase 6a closed (findings registry)** — 2026-04-21 — tag `phase-6a-findings-registry-closed`; 8 sub-steps shipped across commits `5d81fe2`, `e6a2640`, `87ea1c0`, `73ff8fb`, `b17b16e`, `ae933e7`, `cc2447c`, `46606ee`, `fd3837e`
- **6a.8 — PROGRESS + Phase6_Progress close narrative** — 2026-04-21 — commit `fd3837e`
- **6a.7 — Live validation + I008 filed** — 2026-04-21 — commit `46606ee`; backfilled both v5f and v6c corpora, surfaced project_id collision
- **6a.6 — Test coverage** — 2026-04-21 — commit `cc2447c`; +9 state migration shape, +24 CLI handler tests
- **6a.5 — Findings backfill script** — 2026-04-21 — commit `ae933e7`

---

## Attempts that didn't work (current step only)

- None yet (step 6b.1 has not started; it is a pause-for-human, not an attemptable step).

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest.
- **Model in use:** Claude Opus 4.7 for scaffolding sessions; live builds use category routing per ADR 0004 (quick=Haiku 4.5, planning=Sonnet 4.6, deep/reasoning=Opus 4.7).
- **Other:** Windows + Linux cross-platform mandatory. 13 packages + 2 apps (cli gained its first test file in 6a.6 — no new packages). 309 tests (up from 262 at Phase 6c close).

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section; note the new steps.md-checkbox discipline line added mid-session 6a.
2. Read this STATE.md.
3. Read `.control/phases/phase-6b-github-channel/README.md` + `steps.md` for the Phase 6b plan. Detailed per-step bodies are not authored yet — they'll be expanded after the 6b.2 ADR decision is made (webhook vs polling vs hybrid).
4. Read `docs/Phase6_Progress.md` for the cross-sub-phase charter context (6a and 6c rows now both ✅).
5. Read `docs/issues/I008-findings-registry-project-id-collision.md` — open issue surfaced in 6a.7; may be touched by 6b if project-identity routes through `projects.upsert`.
6. Run `/session-start` for the full drift check.
7. **Be prepared to provide GitHub PAT + test repo URL before the session can start.** 6b.1 is `[HALT] secret_needed` and cannot proceed without them.

**Execution order reminder:** Phase 6 runs as **6c (done) → 6a (done) → 6b (next)**. After 6b, Phase 6 closes as a whole and Phase 7 (Operator-control + budget discipline — 7a/7b/7c) opens.

**Budget for 6b:** 2–3 sessions, estimated $6–15 across the full arc (channel skeleton is unit-level but the live smoke step runs a real `factory build` against a GH-triggered directive). Carry-forward from 6c: live-run spend still trending above envelope ($7.71 in 6c). Phase 7a (pre-call `max_usd` enforcement) stays pre-charted; 6b won't enforce, but keep the live-smoke step single-build.
