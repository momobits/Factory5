# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-21T16:49:28Z — session `2026-04-21T16` (Phase 6 close + Phase 7 open, `/session-end`)
**Current phase:** 7 — Operator-control + budget discipline
**Current sub-phase:** 7a — Budget enforcement (`max_usd` / `max_steps`)
**Current step:** 7a.1 — ADR: pre-call cost-estimate approach (not started; authored at 7a session start)
**Status:** queued — Phase 7 active, no 7a work landed yet. Next session opens with the 7a.1 ADR.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root (~700 lines) — snapshot at scaffold, canonical design. Pruned of GitHub scaffolding by the Phase 6 close commit (see ADR 0019).
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological session log), `docs/Phase5_Progress.md` (Phase 5 arc), `docs/Phase6_Progress.md` (Phase 6 closed narrative: 6c ✅, 6a ✅, 6b ❌ dropped per ADR 0019).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only — do not duplicate content from `docs/` into `.control/`.

---

## Next action

**Step 7a.1 — ADR for pre-call cost estimation.** Before any code lands, draft the ADR that decides _how_ `brain.loop` knows — before making an LLM call — whether that call will exceed the directive's `max_usd` ceiling. Candidate approaches:

1. **Input-token estimate only:** count tokens in the prompt, multiply by model's input rate. Underestimates because output is unknown. Easy.
2. **Input + expected-output estimate:** same as #1 plus a per-agent heuristic for expected output tokens (e.g., builder avg ~8k, triage ~200). Needs per-agent calibration.
3. **Running average:** track per-agent observed costs in `model_usage`, use rolling average as the estimate. Self-calibrating, but cold-start uses hardcoded defaults.

The ADR picks one and documents the escalation shape when the check trips (halt vs checkpoint vs ask-user vs blocked).

Detailed Phase 7a plan: `.control/phases/phase-7-budget-discipline/README.md` + `steps.md`. 7a has 9 sub-steps; bodies expand at session start once the ADR is decided.

**Commit message shape for 7a.1:** `docs(7a.1): ADR NNNN — pre-call cost estimate approach`.

---

## Git state

- **Branch:** main (28 commits ahead of `origin/main` — push at operator discretion)
- **Last commit:** `47cf160` — `chore(phase-6): close Phase 6, scaffold Phase 7 budget discipline`
- **Uncommitted changes:** no
- **Last phase tag:** `phase-6-closed` (tags `47cf160`). Earlier per-sub-phase tags intact: `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`.

---

## Open blockers

- **I008** (MEDIUM, OPEN, state/findings-registry) — `findings_registry` collides when two workspaces share a project name. Deferred to Phase 7+; not a phase-7 blocker, but worth keeping in mind when Phase 7b's spend dashboard touches project identity.

---

## In-flight work

- None — Phase 6 closed cleanly. Phase 7 opens with no carried work. The 7a.1 ADR has not been drafted yet; the next session starts from scratch against the Phase 7 scaffold.

---

## Test / eval status

- **Last test run:** Phase 6 close, 2026-04-21 — 309 tests across 13 packages, all green. Same count as Phase 6a close; the github-scaffolding prune re-pointed two tests at `fs.changed` without changing the total.
- **Eval score** (agent phases only): Phase 6c live validation remains the most recent LLM spend — directive `01KPQK61F9967TT8JZWCMCV3NW`, 2026-04-21, gate all-true, 119 pytest, two verifier findings (both `advisory: true`), spend $7.71. Phase 6a and the Phase 6 close were zero-LLM-spend sessions.
- **Regression tests:** F001 regression in `packages/worker/src/verifier-f001.test.ts` (ADR 0018 advisory invariant). Registry regression in `packages/state/src/migrations/003-findings-registry.test.ts` + `packages/state/src/state.test.ts` + `packages/cli/src/commands/findings.test.ts`.

---

## Recent decisions (last 4 ADRs)

- **ADR 0019** (2026-04-21) — Drop GitHub integration from factory5; future output-to-GH is operator-directed per-directive, not pattern-driven. **Durable doctrine.**
- **ADR 0018** (2026-04-21) — Verifier becomes advisory-only (findings don't block the gate).
- **ADR 0017** (2026-04-19) — Assessor project-env provisioning: venv + requires-python + pip install.
- **ADR 0016** (2026-04-18) — Planner materialisation: category floor, file-ownership deps, per-task turn budgets.

All 19 ADRs live under `docs/decisions/` (factory5's authoritative shape — do not fork into `.control/architecture/decisions/`).

---

## Recently completed (last 5 steps)

- **Phase 6 closed** — 2026-04-21 — tag `phase-6-closed` on commit `47cf160`; 2 of 3 sub-phases shipped (6c ✅, 6a ✅, 6b ❌ dropped per ADR 0019). Session commits: `c780180` (6b.1 PAT/repo scaffold, retired), `c39ef8f` (ADR 0019), `ee85efd` (github scaffolding pruned from code + docs), `47cf160` (phase-6 close + Phase 7 scaffold). Phase 6 exit criterion #2 amended via charter clause.
- **6b.2 — ADR 0019 authored + code prune** — 2026-04-21 — commits `c39ef8f` + `ee85efd`. Replaces the original 6b.2 event-source ADR (webhook vs polling vs hybrid) — that design session surfaced neither framing earned its keep for a solo dev-box operator.
- **6b.1 — Record GitHub test repo + PAT ref** — 2026-04-21 — commit `c780180`. Scaffold-only; retired when Phase 6b was dropped. Operator-level cleanup (revoke PAT, delete repo, clear env var) is out-of-band.
- **Phase 6a closed (findings registry)** — 2026-04-21 — tag `phase-6a-findings-registry-closed`; 8 sub-steps across commits `5d81fe2` → `fd3837e`.
- **Phase 6c closed (verifier advisory)** — 2026-04-21 — tag `phase-6c-verifier-overhaul-closed`; ADR 0018; 7 sub-steps across commits `c35681a` → `a24f883`.

---

## Attempts that didn't work (current step only)

- None yet — 7a.1 not started.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest.
- **Model in use:** Claude Opus 4.7 for scaffolding sessions; live builds use category routing per ADR 0004 (quick=Haiku 4.5, planning=Sonnet 4.6, deep/reasoning=Opus 4.7).
- **Other:** Windows + Linux cross-platform mandatory. 13 packages + 2 apps. 309 tests. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` by ADR 0019.

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section and the steps.md-checkbox discipline line.
2. Read this STATE.md.
3. Read `.control/phases/phase-7-budget-discipline/README.md` + `steps.md` for the Phase 7 plan.
4. Read `docs/Phase6_Progress.md` closed narrative + `docs/decisions/0019-drop-github-integration.md` if any question arises about the GitHub-dropping decision or the "operator-directed, not pattern-driven" doctrine.
5. Read `docs/issues/I008-findings-registry-project-id-collision.md` — still open, may be relevant when 7b's spend dashboard touches project identity.
6. Run `/session-start` for the full drift check.
7. **Next concrete work:** draft ADR for pre-call cost estimation (step 7a.1). No [HALT] gates; no secrets needed for 7a.

**Execution order reminder:** Phase 7 runs **7a → 7b → 7c** in strict order. After 7c, Phase 7 closes and Phase 8 opens (not yet charted — options are Web UI, assessor tier-3, worker-subprocess `ask_user`).

**Budget for 7a:** estimated ~1 session, $2–4 LLM spend for the regression validation (a synthetic build hitting the ceiling). The live validation `factory build example --max-usd 3` is intentionally cheap — if the ceiling is set below what the build needs, the whole point is that it halts early, not that it finishes.

**Operator follow-up from Phase 6 close (out-of-band, at operator's convenience):**

1. Revoke PAT at https://github.com/settings/tokens.
2. Delete throwaway repo: `gh repo delete momobits/factory5-6b-smoke --yes`.
3. Clear env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`, then log out/in or broadcast `WM_SETTINGCHANGE`.

None of these block Phase 7.
