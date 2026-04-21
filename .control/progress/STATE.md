# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-21 by 6b.1 commit (`chore(6b.1): record github test repo + PAT ref`)
**Current phase:** 6 — Operator-trust + multi-surface
**Current sub-phase:** 6b — GitHub channel (execution order 3 of 3 within Phase 6)
**Current step:** 6b.2 — ADR: event source (webhook vs polling vs hybrid)
**Status:** active — 6b.1 resolved; next move is the 6b.2 ADR decision before any `packages/channels` or `packages/events` code lands

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root (698 lines) — snapshot at scaffold, canonical design.
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (2900+ lines session log, Phase 6a entry appended), `docs/Phase5_Progress.md` (Phase 5 arc), `docs/Phase6_Progress.md` (active charter; 6c ✅, 6a ✅, 6b pending).
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only — do not duplicate content from `docs/` into `.control/`.

---

## Next action

**Step 6b.2 — ADR: GitHub event source (webhook vs polling vs hybrid).** The decision shapes every step that follows: 6b.3's `ChannelPlugin` shape, 6b.4's event-source package (`github-webhook.ts` vs `github-poller.ts`), 6b.5's migration columns (a webhook config needs a URL + secret; a poller needs a `last_seen_event_id` cursor; hybrid needs both), and 6b.6's fixture recording strategy. Until the ADR lands, the placeholder sub-steps in `.control/phases/phase-6b-github-channel/steps.md` cannot be expanded into detailed bodies.

**Inputs recorded in 6b.1** (see `.control/phases/phase-6b-github-channel/config.md`):
- PAT reference: `env:GITHUB_TOKEN` (stored in `HKCU\Environment`, persistent user env; classic PAT with `public_repo` scope)
- Test repo: `momobits/factory5-6b-smoke` (public, issues enabled)

**Next commit shape:** `docs(6b.2): ADR NNNN — github event source` (webhook/polling/hybrid pick + rationale; ADR number = current highest + 1, to be confirmed against `docs/decisions/INDEX.md`).

---

## Git state

- **Branch:** main
- **Last commit:** `<to be filled by this 6b.1 commit>` — `chore(6b.1): record github test repo + PAT ref`
- **Uncommitted changes:** no (post-6b.1)
- **Last phase tag:** `phase-6a-findings-registry-closed` — tags the previous phase-close commit `e1ab0c0`. No Phase 6b tag yet; the phase closes at 6b.9 with `phase-6b-github-channel-closed`.

---

## Open blockers

- **I008** (MEDIUM, OPEN, state/findings-registry) — `findings_registry` collides when two workspaces share a project name. Deferred to Phase 7+; not a phase-6 blocker, but cite when 6b touches project identity (GitHub-directive-ingest may or may not reuse `projects.upsert` in ways that expose the collision).

---

## In-flight work

- None — 6b.1 committed as a pure `.control/` scratch update (no code paths touched). 6b.2 not started; the ADR will be drafted in its own commit after the webhook/polling/hybrid trade-off is presented to and decided by the user.

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

- **6b.1 — Record GitHub test repo + PAT ref** — 2026-04-21 — commit `<this commit>`; pure `.control/` scratch (new `phase-6b-github-channel/config.md`, steps.md checkbox flipped, STATE + journal updated). No secret value committed — only the reference `env:GITHUB_TOKEN` and repo `momobits/factory5-6b-smoke`.
- **Phase 6a closed (findings registry)** — 2026-04-21 — tag `phase-6a-findings-registry-closed`; 8 sub-steps shipped across commits `5d81fe2`, `e6a2640`, `87ea1c0`, `73ff8fb`, `b17b16e`, `ae933e7`, `cc2447c`, `46606ee`, `fd3837e`
- **6a.8 — PROGRESS + Phase6_Progress close narrative** — 2026-04-21 — commit `fd3837e`
- **6a.7 — Live validation + I008 filed** — 2026-04-21 — commit `46606ee`; backfilled both v5f and v6c corpora, surfaced project_id collision
- **6a.6 — Test coverage** — 2026-04-21 — commit `cc2447c`; +9 state migration shape, +24 CLI handler tests

---

## Attempts that didn't work (current step only)

- None yet — 6b.2 (ADR drafting) has not started; the trade-off presentation and user decision happen in a separate turn after the 6b.1 commit lands.

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest.
- **Model in use:** Claude Opus 4.7 for scaffolding sessions; live builds use category routing per ADR 0004 (quick=Haiku 4.5, planning=Sonnet 4.6, deep/reasoning=Opus 4.7).
- **Other:** Windows + Linux cross-platform mandatory. 13 packages + 2 apps (cli gained its first test file in 6a.6 — no new packages). 309 tests (up from 262 at Phase 6c close).

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section; note the steps.md-checkbox discipline line added mid-6a.
2. Read this STATE.md.
3. Read `.control/phases/phase-6b-github-channel/README.md` + `steps.md` + **`config.md`** (the 6b.1-recorded PAT ref + repo; references only, no secrets).
4. Read `docs/Phase6_Progress.md` for the cross-sub-phase charter context (6a and 6c rows both ✅; 6b in progress).
5. Read `docs/issues/I008-findings-registry-project-id-collision.md` — still open; may be touched by 6b if the GitHub-directive-ingest path routes through `projects.upsert`.
6. Read `docs/decisions/INDEX.md` — check for ADR 0019 (the 6b.2 event-source ADR); if not present, the session resumes at 6b.2 drafting.
7. Run `/session-start` for the full drift check.
8. **The PAT env var lives in `HKCU\Environment`; a fresh Claude Code session will inherit it.** If `$GITHUB_TOKEN` is empty in the new shell, the user may need to restart the shell / CC or the setx was rolled back — do not proceed with live GH code paths until it resolves.

**Execution order reminder:** Phase 6 runs as **6c (done) → 6a (done) → 6b (in progress)**. After 6b closes at 6b.9, Phase 6 as a whole closes and Phase 7 (Operator-control + budget discipline — 7a/7b/7c) opens.

**Budget for 6b:** 2–3 sessions, estimated $6–15 across the full arc. 6b.1 spent $0 (pure `.control/` scratch). 6b.2 ADR drafting is also ~$0 (model reasoning, no LLM spend against factory5's providers). LLM spend concentrates in 6b.6 (fixture-recording integration test may re-run the pipeline with a mocked channel) and 6b.8 (live smoke — one real `factory build` triggered via the GH channel). Carry-forward from 6c: live-run spend still trending above envelope ($7.71 in 6c); Phase 7a (pre-call `max_usd` enforcement) stays pre-charted, 6b won't enforce.
