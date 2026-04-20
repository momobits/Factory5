# Phase Plan — factory5

> Phases 1–5 are **closed pre-Control** — they shipped before the framework was installed, so there are no `phase-N-closed` git tags for them. The authoritative record of each closed phase is in `docs/PROGRESS.md` and `docs/Phase5_Progress.md`. Phases from 6 onward are Control-managed (commit-per-step, `phase-<N>-<name>-closed` tags).

## Phase ordering

| # | Name | Status | Depends on | Est. sessions | Outcome |
|---|---|---|---|---|---|
| 0 | Scaffold | ✅ closed pre-Control | — | 1 | Workspace skeleton — 13 packages + 2 apps + 148 files |
| 1 | Foundations + inline pipeline | ✅ closed pre-Control | 0 | ~3 | `@factory5/{core,logger,state,ipc,providers,brain}` implemented; inline triage → plan → build |
| 2 | Tool-using worker subprocess | ✅ closed pre-Control | 1 | ~4 | scaffolder/builder/fixer as real tool-using subprocesses; worker streams NDJSON |
| 3 | Daemon + channels + assisted mode | ✅ closed pre-Control | 2 | ~3 | `factoryd`, Discord channel, assisted-mode checkpoints, `ask_user`/`escalate_blocked` |
| 4 | Phase 2 finale + autonomy modes | ✅ closed pre-Control | 3 | ~3 | Category routing, autonomy-mode end-to-end, 201 tests |
| 5 | Green-verify end-to-end | ✅ closed pre-Control (2026-04-19) | 4 | ~5 (5a–5f) | Autonomous loop proven end-to-end; I001–I007 all resolved; `factory build example` fully green; 255 tests |
| **6** | **Operator-trust + multi-surface** | 🟢 **active** | 5 | 3–6 (6c+6a+6b) | See charter in `docs/Phase6_Progress.md` |
| 7 | (TBD) | ⏸ not yet charted | 6 | — | Options: Telegram channel, `max_usd`/`max_steps` enforcement, cross-session spend, Web UI |

## Phase 6 — sub-phase schedule

Phase 6 has three independently-shippable sub-phases. They are executed **out of alphabetical order** — 6c first because its forcing function (F001 verifier hallucination) is concrete and scoped; 6a second because Phase 5's corpus of built projects now justifies the registry; 6b last because the GitHub channel is the biggest build and benefits from the patterns laid down by 6c+6a.

Each sub-phase closes with its own tag: `phase-6c-verifier-overhaul-closed`, `phase-6a-findings-registry-closed`, `phase-6b-github-channel-closed`. Phase 6 as a whole closes when all three ship **or** when the charter is amended to narrow scope (see `docs/Phase6_Progress.md` "exit criteria" — struck-through criteria permitted).

| Order | Sub-phase | Name | Charter pitch | Key package(s) | Est. sessions |
|---|---|---|---|---|---|
| 1st | **6c** | Verifier overhaul | Fix the verifier hallucination surface — either give it fs tools (Read/Glob/Grep) and keep its gate contribution, or formally downgrade it to advisory (never blocks, always informational). F001 on directive `01KPKRNB2V08QZZD02SKTK6MWP` is the forcing function. Pair with a regression test that replays F001. | `brain`, `worker`, `prompts/agents/verifier.md` | 1 |
| 2nd | **6a** | Cross-project findings registry | Aggregate per-project `<workspace>/.factory/findings.json` into a factory-home index (`~/.factory5/findings-registry.sqlite`). Expose `factory findings list [--severity HIGH] [--status OPEN] [--project <glob>]` and `factory findings show <id>`. | `wiki`, `state`, `cli` | 1–2 |
| 3rd | **6b** | GitHub channel | Parallel `github` implementation to the existing `discord` channel. GH issues / PR comments become directives; `finding:raise` / `terminalStatus` events post back as comments. | `channels`, `events`, `daemon` | 2–3 |

## Per-sub-phase summary

### Phase 6c — Verifier overhaul *(active, execution order #1)*

**Goal:** the verifier's claims never contradict reality again. Today its read-only LLM context makes it hallucinate file absence; on the I007 live run it raised F001 CRITICAL claiming six files missing that all existed on main.

**Decision to land as ADR 0018:** _Authoritative verifier_ (give it Read/Glob/Grep tools, keep it in the gate) vs _Advisory verifier_ (strip its gate contribution, surface findings as informational only).

**Done criteria highlights:**
- ADR 0018 written + accepted
- `prompts/agents/verifier.md` rewritten (it's 6 lines today)
- `packages/worker/src/runWorker.ts` (or relevant) reflects the new verifier shape
- Regression test replays F001: same workspace state, verifier produces correct finding (no hallucination)
- Live rerun of `factory build example` ends `complete`, no spurious CRITICAL findings

Detailed plan: `.control/phases/phase-6c-verifier-overhaul/README.md` + `steps.md`.

### Phase 6a — Cross-project findings registry *(queued, execution order #2)*

**Goal:** operator can see `factory findings list --severity HIGH --status OPEN` across every project ever built, without shell-spelunking.

**Key sub-steps (expanded in `phase-6a-findings-registry/steps.md` when scheduled):**
- `state` migration for `findings_registry` table (project_id, finding_id, severity, status, created, updated, raw)
- `wiki` writes to registry on `addFinding` (in addition to per-project file)
- `cli` subcommand `findings list|show` with filters
- Backfill script for existing projects

### Phase 6b — GitHub channel *(queued, execution order #3)*

**Goal:** a real GitHub issue comment produces a `directive:new` row, runs through the pipeline, posts a reply comment with terminal status.

**Key sub-steps (expanded in `phase-6b-github-channel/steps.md` when scheduled):**
- OAuth / PAT coordination with user (Pause-for-human at start)
- `channels/github/` package implementing `ChannelPlugin`
- Event source for webhooks (`events/github-webhook`)
- Round-trip integration test using recorded fixtures
- Live run against a test repo

## Guidance

- Each sub-phase closes independently — pick one per session, don't try to land multiple.
- If a sub-phase starts expanding beyond estimate, subdivide into `phase-6cN.1` etc. rather than letting the scope creep.
- Every sub-phase has a rollback target: `git reset --hard phase-<prev>-closed` (or `git reset --hard 2a9dbd0` for the first Phase 6 step, since Phase 5 has no tag).
- Out-of-scope for Phase 6 (see `docs/Phase6_Progress.md`): Telegram channel, Web UI, assessor tier-3 pluggable runtimes, worker-subprocess `ask_user`, `max_usd`/`max_steps` enforcement, cross-session spend dashboard.
