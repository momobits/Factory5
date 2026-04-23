# Project State

> Single source of truth for Control's operational cursor. Read this first every session. Updated at every `/session-end` and by the `PreCompact` hook.

**Last updated:** 2026-04-23T07:10:00Z — session `2026-04-23T06` (Phase 8 sub-steps 8.1 → 8.5; charter + ADR + brain RPC + worker MCP + agent registry + lifecycle migration all shipped)
**Current phase:** 8 — Worker-subprocess `askUser` — **🟢 active**
**Current sub-phase:** n/a — single-charter phase (no sub-letter split)
**Current step:** 8.6 — author the regression test suite (happy path, brain-restart-mid-wait, two-workers correlation, late-answer no-op)
**Status:** Phase 8 charter authored + 5 sub-steps shipped this session. End-to-end pipeline wired: `mcp__factory5-ask-user__ask_user` tool → MCP server → daemon `POST /worker/ask-user` (Bearer-gated) → brain `askUser()` polling → channel collector → answer round-trips back to the agent's next turn. Brain-restart-mid-wait: orphan tasks aborted at startup; late answers logged but no resume. 535 tests across 14 packages green; `pnpm lint` + `pnpm format:check` clean. ADR 0024 accepted as the design pin. New workspace package `@factory5/worker-mcp` (+1 → 14 packages); new external dep `@modelcontextprotocol/sdk ^1.0.0`. No open blockers.

---

## Project spec

**Canonical:** `CompleteArchitecture.md` at root (~700 lines) — snapshot at scaffold, canonical design. §11 (worker / agent surface) gains an inline pointer to ADR 0024 in 8.4's commit (deferred until 8.7 close — see "Notes for next session").
**Current reference:** `docs/ARCHITECTURE.md` (evolves), `docs/CONTRACTS.md` (typed data shapes), `docs/SKILLS.md`, `docs/AGENTS.md`.
**Phase history:** `docs/PROGRESS.md` (chronological session log), `docs/Phase5_Progress.md`, `docs/Phase6_Progress.md`, `docs/Phase7_Progress.md`. Phase 8 progress doc lands at 8.8 close.
**Role:** the `docs/` tree is authoritative. `.control/architecture/overview.md` is a pointer file only.

---

## Next action

**Sub-step 8.6 — regression test suite.** Four scenarios from ADR 0024 §6:

1. **Happy path** — Fastify `inject()` calls `POST /worker/ask-user`; a separate test fiber writes the answer to `pending_questions` mid-poll. Assert: response carries the answer; task transitions `running` → `waiting_for_human` → `running`; no late-answer warn fires.
2. **Brain-restart mid-wait** — seed `tasks_inflight` with `status='waiting_for_human', waiting_question_id=<qId>`. Run `recoverFromHumanWaits(db)`. Assert: row → `aborted` with `aborted_reason='brain_restart_during_human_wait'`. Then write the answer to `pending_questions` and verify `detectOrphanedAnswer` flags it.
3. **Two-workers correlation** — two parallel `inject()` calls with same `directiveId`, distinct `taskId`s + distinct questions. Two parallel writers answer each. Assert each returned envelope carries its own answer; `pending_questions.task_id` correctly partitions.
4. **Late-answer no-op** — task already `aborted`. Channel collector calls `pendingQuestions.answer(...)`. Assert: row updated; `detectOrphanedAnswer` returns the orphan info; no side effects (no resume trigger because there's no consumer structurally).

After 8.6: **8.7 live validation** needs operator presence (real `factory build` against a synthetic-ambiguity spec, Telegram answer round-trip, ~$2-3 LLM spend). **8.8** is the phase-close commit + tag `phase-8-worker-ask-user-closed`.

---

## Git state

- **Branch:** main (ahead of `origin/main` by ~69 commits since Phase 5 close — push at operator discretion)
- **Last commit (pre-session-end):** `37c0605` — `feat(8.5): tasks_inflight waiting_for_human + brain-restart recovery`. Session-end docs commit lands on top.
- **Uncommitted changes:** only this session-end docs commit in-flight. `.claude/scheduled_tasks.lock` may show dirty in `git status` (Claude Code harness artifact; gitignored semantics-wise; ignored at every prior session-end).
- **Last addendum tag:** `addendum-onboarding-closed` (on `17c393d`).
- **Last phase tag:** `phase-7-closed` (on `7906099`). Phase 8 is open; new tag not placed until 8.8.

Earlier tags intact: `phase-7c-telegram-channel-closed`, `phase-7b-spend-dashboard-closed`, `phase-7a-budget-enforcement-closed`, `phase-6-closed`, `phase-6a-findings-registry-closed`, `phase-6c-verifier-overhaul-closed`.

---

## Open blockers

- **None.** I008 RESOLVED in 7b.1. Open backlog empty for the fifth consecutive session.

---

## In-flight work

- Session-end docs commit only: this STATE.md update, journal entry, next.md rewrite. No code mid-edit.

---

## Test / eval status

- **Last test run:** sub-step 8.5 close, 2026-04-23T07:04Z — 535 tests across 14 packages, all green. (+64 over Phase 7 close baseline of 471: +9 ipc at 8.2, +9 daemon at 8.2, +15 worker-mcp at 8.3, +2 providers at 8.3, +5 brain at 8.4, +24 state at 8.5.)
- **Per-package counts at close:** core 14, **logger 13**, **ipc 14 (+9)**, **providers 39 (+2)**, **state 116 (+24)**, assessor 42, wiki 39, channels 60, events 3, worker 24, **brain 64 (+5)**, **daemon 37 (+9)**, cli 55, **worker-mcp 15 (+15, NEW)**.
- **Eval score** (agent phases only): unchanged from 7a.8 — directive `01KPRHNEX1T3VR3S4ZTTSJ8F0M`, $1.9151 of $3.00 ceiling, tripped cleanly at builder-2. Not re-run this session — the 8.4 whitelist + skill body addition haven't been measured live yet; 8.7's live validation will refresh.
- **Regression tests added this session:**
  - `packages/ipc/src/schemas.test.ts` (+9 — `workerAskUser` request/response shape, mandatory taskId, deadline validation)
  - `packages/daemon/src/server.test.ts` (+9 — route happy path / 503 disabled / 401 missing-or-wrong-bearer / 200 correct / 400 bad schema / 401 fires before schema parse / IpcRequestError pass-through)
  - `packages/worker-mcp/src/handler.test.ts` (+11 — env validation × 2, happy paths × 4, URL/header/body shape × 2, error paths × 3)
  - `packages/worker-mcp/src/mcp-config.test.ts` (+4 — claude-cli config shape, env wiring, JSON serialisation)
  - `packages/providers/src/claude-cli.test.ts` (+2 — `--mcp-config` presence + empty-string skip)
  - `packages/brain/src/agents/registry.test.ts` (+5 — tool/skill inclusion list, exclusion list, canonical tool name)
  - `packages/state/src/migrations/007-task-waiting-for-human.test.ts` (+9 — schema cols, CHECK widening, partial-index, backwards-data preservation)
  - `packages/state/src/queries/tasks-inflight.test.ts` (+15 — query helpers + race-safety + `detectOrphanedAnswer`)

---

## Recent decisions (last 3 ADRs)

- **ADR 0024** (2026-04-23) — Worker-subprocess `askUser`: MCP route, paused-budget wait, taskId-mandatory correlation. Reverses ADR 0015's Phase-4 deferral of Shape 1. Five sub-decisions in one ADR: (1) MCP server (Claude CLI's official tool extension) over direct-stdio JSON-RPC; (2) `max_usd`/`max_steps` paused during human wait, per-question soft deadline default 1h (configurable via `[budget.askUser]`); (3) `taskId` mandatory in worker→brain envelope (closes sibling-worker crossover hazard); (4) `tasks_inflight.status='waiting_for_human'` + brain-startup orphan-cleanup via `recoverFromHumanWaits`; (5) tool whitelist limited to scaffolder/builder/fixer/investigator (brain-checkpointed agents keep using `escalateBlocked`).
- **ADR 0023** (2026-04-22) — Repo-local factory instances via cwd-walk discovery; `.factory/` replaces `.factory5/`. Partially supersedes ADR 0004's storage-location claims.
- **ADR 0022** (2026-04-22) — Telegram long-polling lives inside `TelegramChannel`, not as a separate `EventSource`.

All 24 ADRs live under `docs/decisions/`.

---

## Recently completed (last 5 steps)

- **8.5 closed** — 2026-04-23 — commit `37c0605`. Migration 007 widens `tasks_inflight` (`+'waiting_for_human'`, `+'aborted'`, `waiting_question_id`, `aborted_reason`); 7 new tasks-inflight queries (`getById`, `markWaitingForHuman`, `markRunningAfterAnswer`, `markAborted`, `findOrphanedHumanWaits`, `isTerminalStatus`, `TERMINAL_STATUSES`). Brain RPC handler stages wait via new `onQuestionResolved` callback added to `askUser`; `recoverFromHumanWaits` aborts orphans at daemon startup; channel collectors warn on terminal-task answer via `detectOrphanedAnswer`. +24 state tests.
- **8.4 closed** — 2026-04-23 — commit `2c1981c`. `ASK_USER_MCP_TOOL = 'mcp__factory5-ask-user__ask_user'` added to scaffolder/builder/fixer/investigator tool whitelists; `'ask-user'` added to those agents' `defaultSkills`; new `skills/ask-user.md` heuristic body. Brain-checkpointed agents (architect/planner/reviewer/verifier/triage) deliberately excluded. +5 brain tests covering both directions.
- **8.3 closed** — 2026-04-23 — commit `91c248b`. New `@factory5/worker-mcp` package (+1 → 14 packages) with handler.ts (HTTP layer), mcp-config.ts (claude-cli config), server.ts (MCP SDK stdio entry), index.ts (`getServerScriptPath`); `@modelcontextprotocol/sdk ^1.0.0` runtime dep (+68 transitive). `ProviderRequest.mcpConfigPath` threaded through `buildClaudeArgs`. Worker spawn writes per-task mcp-config to `os.tmpdir()`, passes `--mcp-config`, unlinks on completion. Pool builds askUserConfig from env + `loadDaemonEndpoint()`. +17 tests.
- **8.2 closed** — 2026-04-23 — commit `0d018f4`. New `POST /worker/ask-user` daemon route, Bearer-gated with constant-time compare; bearer check fires before schema parse so unauthenticated callers can't probe schema. Schemas in `@factory5/ipc` (taskId mandatory). `buildWorkerAskUserHandler` validates `(taskId, directiveId)` against `tasks_inflight` then proxies into existing brain `askUser()`. `apps/factoryd/src/main.ts` generates per-startup 24-byte hex token via `crypto.randomBytes`. +18 tests.
- **8.1 closed** — 2026-04-23 — commit `0754a69`. Phase 8 charter authored: `.control/phases/phase-8-worker-ask-user/{README.md,steps.md}` (8 sub-steps), ADR 0024 (~360 lines, 5 sub-decisions), INDEX row.

---

## Attempts that didn't work (current step only)

- n/a — 8.6 hasn't started.

(Two notable in-step adjustments resolved during the session, recorded for future-self:)

- **8.3 build:** initial `WorkerAskUserHandler` type used an inline `req: { taskId; directiveId; question; options?: string[]; deadlineSeconds?: number }`. Under `exactOptionalPropertyTypes: true`, this didn't accept `options?: string[] | undefined` from the destructured request. Fix: import `WorkerAskUserRequest` from `@factory5/ipc` and use that as the handler signature. One-line type-import change, no runtime impact.
- **8.5 idempotency tests:** migration tests in 003/004/006 had hard-coded `expect(appliedIds).toEqual([1, 2, 3, 4, 5, 6])`. Adding migration 007 broke them. Bumped each to `[1, 2, 3, 4, 5, 6, 7]`. (These are append-only migration tests; bumping at every new migration is part of the protocol — not actually a "didn't work" so much as expected forward maintenance.)

---

## Environment snapshot

- **Language / runtime:** TypeScript strict mode on Node 20+ (ADR 0001). pnpm workspaces. ESM (NodeNext) with explicit `.js` import extensions.
- **Key pinned deps:** Pino, Zod, Commander, Fastify, better-sqlite3, discord.js, chokidar, simple-git, vitest, ulid. **NEW: `@modelcontextprotocol/sdk ^1.0.0`** (in `@factory5/worker-mcp`).
- **Model in use:** Claude Opus 4.7 for scaffolding sessions; live builds use category routing per ADR 0004 (quick=Haiku 4.5, planning=Sonnet 4.6, deep/reasoning=Opus 4.7).
- **Other:** Windows + Linux cross-platform mandatory. **14 packages + 2 apps** (was 13 + 2 — `@factory5/worker-mcp` added at 8.3). **535 tests**. `CHANNEL_IDS` narrowed to `['cli','discord','telegram']` per ADR 0019. Budget enforcement per ADR 0020. Project identity via `.factory/project.json` per ADR 0021. Cross-session spend dashboard via `factory spend` per 7b.3. Telegram channel via plugin-owned long-poll per ADR 0022. Instance data dir via cwd-walk per ADR 0023. **Worker-subprocess `ask_user`** wired end-to-end per ADR 0024 (8.1–8.5 shipped; 8.6 regression tests + 8.7 live validation pending).

---

## Notes for next session

If resuming after `/session-end` or a cold start:

1. Read `CLAUDE.md` (root) — standing brief incl. Control-framework section.
2. Read this STATE.md.
3. Read `.control/phases/phase-8-worker-ask-user/README.md` + `steps.md` — Phase 8 charter; 8.6 / 8.7 / 8.8 still open.
4. Read `docs/decisions/0024-worker-subprocess-ask-user.md` — the architectural pin for 8.6's regression-test scenarios.
5. Read `docs/decisions/0015-mid-flight-user-engagement.md` — the original Phase 4 deferral that Phase 8 reverses.
6. Run `/session-start` for the full drift check.
7. **Next concrete work:** sub-step 8.6 regression tests. Patterns to mirror: Fastify `inject()` from `packages/daemon/src/server.test.ts` for the route-side scenarios; in-process DB-write race for the answer side from `packages/state/src/queries/tasks-inflight.test.ts` extended with a `setTimeout`-backed writer fiber.

**Budget for remaining Phase 8:** 8.6 ≈ ½ session (4 tests + harness scaffolding). 8.7 ≈ ½ session, but **needs operator presence** (real LLM build + Telegram answer + ~$2-3 spend). 8.8 ≈ phase-close commit + tag.

**Carry-forward TODOs noted during the session:**

- `CompleteArchitecture.md` §11 should gain an inline pointer to ADR 0024 — deferred to 8.8 close along with `docs/Phase8_Progress.md` authoring (cleaner to do all the doc updates in one phase-close commit).
- 8.5 set up `tasks_inflight.status='waiting_for_human'` lifecycle but the supervisor's heartbeat-reaper logic doesn't yet treat that state specially. If a `waiting_for_human` task's heartbeat goes stale (e.g. worker subprocess died for non-brain-restart reasons), the reaper might mis-classify it. Out of scope for Phase 8; would surface as an issue if it bites.

**Operator follow-up from Phase 6 close (still out-of-band whenever convenient, none blocks Phase 8):**

1. Revoke PAT at https://github.com/settings/tokens.
2. Delete throwaway repo: `gh repo delete momobits/factory5-6b-smoke --yes`.
3. Clear env var: `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.
