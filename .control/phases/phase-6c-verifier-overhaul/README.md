# Phase 6c — Verifier overhaul

**Dependencies:** Phase 5 closed (pre-Control — no git tag; HEAD at commit `2a9dbd0` "feat: add issue I003 for scaffolder project hygiene artifacts omission" as of 2026-04-21)
**Estimated duration:** 1 session
**Execution order within Phase 6:** 1st (before 6a, before 6b)
**Budget:** $4–6

## Goal

The verifier's claims never contradict ground truth again. Today it is read-only (no filesystem tools) yet its prompt asks it to make filesystem claims — so it hallucinates. On directive `01KPKRNB2V08QZZD02SKTK6MWP` (I007 live validation, 2026-04-19, workspace `/c/Users/Momo/factory5-v5f-example-2`) it raised F001 CRITICAL claiming six Python source files were absent. All six files existed on main. The assessor's green gate (build: true, integration: true, verify: true, 78 tests pass) overrode the finding, so the build shipped — but F001 is on the books as a CRITICAL, visible in `factory findings`.

## Outcome

At close, the verifier is either:

- **Authoritative path:** given `Read`, `Glob`, `Grep` tools (parallel to the builder's tool surface). Its findings stay in the gate. Its prompt is rewritten to require evidence citations (file paths, line numbers) for every claim. F001 becomes unreproducible.
- **Advisory path:** its findings are stripped from `brain.loop`'s gate calculation. They appear in `factory findings` tagged `verifier: advisory` but never block. The assessor remains the sole ground-truth gate. The verifier prompt is scoped to the claims it _can_ make from context alone (lint-quality suggestions, architecture observations) — it no longer asserts filesystem presence.

The decision between the two is captured in **ADR 0018** (to be written as step 6c.2).

## Sub-steps

See [`steps.md`](steps.md) for the detailed checklist.

## Done criteria

All must be verified before `/phase-close` advances:

- [ ] All items in `steps.md` checked off, each with a commit reference
- [ ] `.control/issues/OPEN/` has no items tagged `phase:6c-blocker` (plus no new CRITICAL/HIGH in `docs/issues/`)
- [ ] `pnpm test` passes for all affected packages (target: brain, worker; existing 255 tests remain green plus new verifier regression test)
- [ ] `pnpm build && pnpm lint && pnpm format:check` clean
- [ ] ADR 0018 written, status `accepted`, and added to `docs/decisions/INDEX.md`
- [ ] **F001 regression test:** a unit test that reproduces the Phase 5 I007 scenario — verifier invoked against a workspace where `src/*.py`, `tests/`, `pyproject.toml` all exist on main — and asserts the verifier does **not** raise a CRITICAL finding claiming absence
- [ ] **Live validation smoke test:** `factory build example --autonomy autonomous --concurrency 2` ends `terminalStatus: complete`, zero verifier-sourced CRITICAL findings, and no finding contradicting assessor ground truth
- [ ] `docs/PROGRESS.md` has a new entry dated 2026-04-21 (or actual date) with Phase 6c outcome
- [ ] `docs/Phase6_Progress.md` status column for 6c flipped to ✅
- [ ] Working tree clean
- [ ] Phase tagged `phase-6c-verifier-overhaul-closed` by `/phase-close`

## Rollback plan

If Phase 6c needs to be undone: `git reset --hard 2a9dbd0` (Phase 5 close HEAD). No external resources are created by this phase.

## ADRs decided in this phase

- **ADR 0018** — Verifier: authoritative with tools _vs_ advisory without (to be filed at step 6c.2)

## Pointers

- Forcing function: F001 finding at `C:/Users/Momo/factory5-v5f-example-2/example/.factory/findings.json`
- Current verifier prompt: `prompts/agents/verifier.md` (6 lines — Phase 1 stub)
- Builder tool surface (reference for authoritative path): look up allowlist in `packages/worker/src/runWorker.ts` and agent registration in `packages/brain/src/agents.ts`
- Gate calculation (reference for advisory path): `packages/brain/src/loop.ts` (wherever findings roll up)
- Phase 5 verifier skip context: `docs/Phase5_Progress.md` §5f; `docs/Phase6_Progress.md` §"Where we were, end of Phase 5"
