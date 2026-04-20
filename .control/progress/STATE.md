# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-21 by Control instantiation
**Current phase:** 6 — Operator-trust + multi-surface
**Current sub-phase:** 6c — Verifier overhaul (execution order 1 of 3 within Phase 6)
**Current step:** 6c.1 — Reproduce F001 in a unit test (red)
**Status:** ready-to-start (awaiting user go)

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root (698 lines) — snapshot at scaffold, canonical design.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (2500+ lines session log), `docs/Phase5_Progress.md` (Phase 5 arc), `docs/Phase6_Progress.md` (active charter).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only — do not duplicate content from `docs/` into `.control/`.

---

## Next action

Begin **step 6c.1** — author a failing unit test in `packages/worker/test/verifier-f001.test.ts` (or an appropriate location) that reproduces F001. The test mounts a fixture workspace matching the 2026-04-19 I007 live-run state (`src/models.py`, `src/api.py`, `src/formatter.py`, `src/cli.py`, `tests/test_*.py`, `pyproject.toml` all present on main) and asserts the current verifier implementation produces a CRITICAL finding claiming absence — **red on purpose**, to prove the reproducer is correct before the fix.

Detailed plan: `.control/phases/phase-6c-verifier-overhaul/steps.md` §6c.1.
Reference finding: `C:/Users/Momo/factory5-v5f-example-2/example/.factory/findings.json` (F001, source=verifier, target=src/, severity=CRITICAL).
Commit message: `test(6c.1): red reproducer for F001 verifier hallucination`.

---

## Git state

- **Branch:** main
- **Last commit:** `6494766` — chore: install Control framework v1.3.0
- **Uncommitted changes:** yes — Control instantiation content (this STATE.md, phase-plan, overview, Phase 6 sub-phase dirs, CLAUDE.md augment). Will be committed as `chore: instantiate Control for factory5 Phase 6`.
- **Last phase tag:** `protocol-initialised` (set by Control's `setup.sh`; no `phase-*-closed` tags yet — Phases 1–5 shipped pre-Control so have no tags)

---

## Open blockers

- None. Phase 5 closed with all 7 factory5 self-issues (I001–I007) resolved. `docs/issues/INDEX.md` "Open" section is empty.

Note: the F001 hallucination is the **forcing function** for Phase 6c, not a blocker — it's captured as the phase's goal, not as an open issue, because it's a verifier-behavior issue rather than a factory5 self-issue. A new issue (I008?) may be filed during 6c if the investigation surfaces a separable sub-problem.

---

## In-flight work

- **Control instantiation** (this session) — installing the framework + populating `.control/` with factory5-specific content. See uncommitted changes above. No implementation work started yet on Phase 6c.

---

## Test / eval status

- **Last test run:** Phase 5 close, 2026-04-19 — 255 tests across 12 packages, all green.
- **Eval score** (agent phases only): Phase 5 outcome α — `factory build example --autonomy autonomous --concurrency 2` completes with all gates true, 95 tests pass, $5.84 spend.
- **Regression tests:** I001–I007 all have regression tests. F001 regression test is step 6c.1 (not yet written).

---

## Recent decisions (last 3 ADRs)

- **ADR 0017** (2026-04-19) — Assessor project-env provisioning: venv + requires-python + pip install
- **ADR 0016** (2026-04-18) — Planner materialisation: category floor, file-ownership deps, per-task turn budgets
- **ADR 0015** (2026-04-18) — Mid-flight user engagement via brain-level askUser + checkpoint-and-rehydrate

All 17 ADRs live under `docs/decisions/` (factory5's authoritative shape — do not fork into `.control/architecture/decisions/`).

---

## Recently completed (last 5 steps)

- **Control framework instantiated** — 2026-04-21 — commit pending (`chore: instantiate Control for factory5 Phase 6`); tag `protocol-initialised` set by installer
- **Phase 5 closed (Outcome α)** — 2026-04-19 — I006 resolved, `factory build example` ships fully green; pre-Control, no `phase-5-closed` tag
- **I007 filed + resolved** — 2026-04-19 — builder pip user-site pollution; orthogonal to I006, inert post-fix
- **I006 resolved** — 2026-04-19 — `ensureAssessorVenv` → per-project assessor venv at `<projectPath>/.factory/assessor-env/`
- **I005 resolved** — 2026-04-19 — `persistFindings` path moved into `.factory/` tree so it doesn't dirty main's worktree

---

## Attempts that didn't work (current step only)

- None yet (step 6c.1 has not started).

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest.
- **Model in use:** Claude Opus 4.7 (this session). factory5 itself uses category-routed Claude models per ADR 0004 (quick=Haiku, standard=Sonnet, deep=Opus).
- **Other:** Windows + Linux cross-platform mandatory. 12 packages + 2 apps. 255 tests.

---

## Notes for next session

If resuming after `/session-end`:

1. Read `CLAUDE.md` (root) — note the new Control-framework section at the top describing the content-vs-operational split.
2. Read this STATE.md.
3. Read `.control/phases/phase-6c-verifier-overhaul/README.md` + `steps.md` for the detailed 6c plan.
4. Read `docs/Phase6_Progress.md` for the full charter context.
5. Run `/session-start` for the full drift check.
6. If ready, type `go` to kick off step 6c.1.

**Execution order reminder:** Phase 6 runs as **6c → 6a → 6b**. 6c first because F001 is the concrete forcing function. 6a second because Phase 5 produced enough built projects that cross-project aggregation has real signal. 6b last because the GitHub channel is the biggest build and benefits from patterns laid down by 6c + 6a. See `.control/architecture/phase-plan.md`.

**Budget for 6c:** $4–6, one session. If 6c expands past that, pause and reassess rather than letting scope creep.
