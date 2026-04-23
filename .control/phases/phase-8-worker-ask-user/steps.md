# Phase 8 Steps — Worker-subprocess `askUser`

> **First sub-step (8.1) authored in detail; the rest are outlines that
> expand once 8.1's ADR pins the architecture.** Per the Phase 7 pattern,
> sub-step bodies grow as each session opens.

## Phase 8 — Worker-subprocess `askUser`

- [x] 8.1 — **[ADR 0024](../../../docs/decisions/0024-worker-subprocess-ask-user.md)** worker→brain `askUser` design. Decided:
  - **Route**: MCP server (Claude CLI's official tool-extension path; net-new infra; clean abstraction; reusable for future custom tools) vs direct-stdio JSON-RPC (smaller diff; reuses existing stream parser; bespoke; harder to extend). Consider the cost of standing up the first MCP server in the codebase against the value of a shape that scales to N future custom tools.
  - **Wall-clock budget policy**: does a worker waiting on `ask_user` pause the directive's TTL? Pause `max_steps` accounting? Three options: (a) wall-clock counts as normal — long answers eat the budget (simple, harsh); (b) wait time excluded from `max_usd` and `max_steps` (matches operator intent: "the agent is correctly stopped, not thrashing"); (c) hybrid — `max_steps` paused but `max_usd` keeps accruing as the subprocess is still pinning a CLI seat. Recommendation lean: (b), with a per-question soft deadline (default 1 hour, configurable in `config.toml [budget.askUser]`) so the worker doesn't pin a seat indefinitely.
  - **Correlation contract**: `taskId` becomes mandatory in the worker→brain `ask_user` call (today it's optional in `pending_questions`). Two workers in the same directive with similar questions must each get their own answer. Brain-side proxy enforces by always passing `taskId` from the request envelope.
  - **Brain-restart recovery**: define `tasks_inflight.status = 'waiting_for_human'`. On brain startup, scan for orphaned `waiting_for_human` rows whose worker subprocess is dead (parent_pid != current_brain_pid OR pid not found); mark those tasks `aborted` with `aborted_reason = 'brain_restart_during_human_wait'`. A late-arriving answer for that pending_question writes to the row but its associated task is already dead — log "answered after task ended" and no-op (no retry).
  - **Tool whitelist**: which agent roles get `AskUser`? Recommendation: `scaffolder` / `builder` / `fixer` / `investigator` (the four that own actual writes or runtime decisions). Excluded: `triage` (no tools today), `architect` / `planner` / `reviewer` / `verifier` (already brain-checkpointed via existing `escalateBlocked`).
  - **Out of scope for ADR 0024**: replacing brain-level `askUser` (Phase 4 stays as the canonical primitive — Phase 8 is additive); changing channel answer collection (already polyglot across Discord / Telegram / CLI).
  - Output: `docs/decisions/0024-worker-subprocess-ask-user.md` + INDEX row.

- [x] 8.2 — Brain RPC endpoint. Extended existing daemon Fastify server (per ADR 0012 brain runs in `factoryd` process; daemon already imports from `@factory5/brain`, so a new daemon route is the lowest-coupling shape rather than spinning up a second server). `POST /worker/ask-user`:
  - Request schema `workerAskUserRequestSchema` + response schema `workerAskUserResponseSchema` in `packages/ipc/src/schemas.ts` (taskId mandatory per ADR 0024 §3; deadlineSeconds optional, daemon defaults 3600s). 9 schema tests.
  - Route handler in `packages/daemon/src/server.ts` with bearer-token gate (constant-time compare), `503 WORKER_ASK_USER_DISABLED` when handler not configured, `401 WORKER_AUTH_REQUIRED` before schema parse so unauthenticated callers can't probe schema. Bearer check uses pure XOR fold on equal-length strings; length-mismatch shortcut OK because token length is a public per-startup constant. 9 route tests (happy path, timed-out path, 503 disabled, 401 missing/wrong, 200 correct, 400 missing taskId, 401-before-schema, 404 IpcRequestError pass-through).
  - `buildWorkerAskUserHandler` in `packages/daemon/src/index.ts` validates `(taskId, directiveId)` lives in `tasks_inflight` (defense-in-depth), computes `deadlineAt = now + deadlineSeconds`, calls existing `askUser({db, directiveId, taskId, question, options, deadlineAt})`. New `DaemonOptions.workerAuthToken` enables the route + builds the handler; `workerAskUserDefaultDeadlineSeconds` defaults 3600.
  - `apps/factoryd/src/main.ts` generates a per-startup 24-byte hex token via `crypto.randomBytes`, also exports it as `FACTORY5_WORKER_AUTH_TOKEN` env var (workers spawned by brain inherit it).
  - Tests: 14 ipc + 37 daemon (was 5 + 28 = 33; +18 net). Build/lint/format clean. 489 total workspace tests (was 471, +18).
  - **Carried forward to 8.3:** worker-side spawn must read `FACTORY5_WORKER_AUTH_TOKEN` from env and pass it as `Authorization: Bearer <token>` on every `/worker/ask-user` request. The MCP server (8.3) wraps this; `BRAIN_RPC_URL` derives from `loadDaemonEndpoint()`.

- [ ] 8.3 — Worker-side tool plumbing. **Implementation depends on 8.1's route choice.**
  - **If MCP**: scaffold `packages/worker-mcp/` with a small MCP server exposing `ask_user(question, options?)` tool. Worker spawns it (or hosts in-process via stdio) and passes `--mcp-config` to `claude -p`. MCP handler reads `BRAIN_RPC_URL` + `BRAIN_RPC_TOKEN` from env, hits `POST /worker/ask-user`, returns answer text as the tool result.
  - **If stdio JSON-RPC**: extend `ClaudeCliProvider.stream()` to intercept `tool_use` events for `ask_user`, hit brain RPC, write a synthetic `tool_result` back to Claude CLI stdin, resume stream consumption. Higher coupling to claude-cli internals; brittle if Claude CLI's tool protocol shifts.
  - Either way: worker spawn in `packages/worker/src/run-worker.ts` extended with the new env vars; `provider.stream()` call extended with the route-specific config.
  - Tests: in-process MCP roundtrip (or in-process stream interception) with a fake brain RPC.

- [ ] 8.4 — Agent registry + skill body. `packages/brain/src/agents/registry.ts`: add `'AskUser'` to `scaffolder` / `builder` / `fixer` / `investigator` `tools` arrays (per 8.1 decision). Add a new skill body under `prompts/skills/ask-user.md` teaching when to use it — concrete heuristics ("design choice between two libraries → ask", "missing config value → ask", "flaky test you'd guess at fix → ask", "obvious typo in spec → fix without asking"). Inject the skill via each agent's `defaultSkills` array.

- [ ] 8.5 — `tasks_inflight` lifecycle changes. State migration adds `'waiting_for_human'` to allowed `status` values plus `waiting_question_id` foreign key. Brain startup scans for orphans and marks them `aborted` with `aborted_reason = 'brain_restart_during_human_wait'`. Channel answer collectors (already in Discord / Telegram / CLI) get a path: when writing `pending_questions.answer`, check the linked task's status; if `aborted`, log "answered after task ended" and don't trigger any worker resume.

- [ ] 8.6 — Regression tests:
  - **Happy path**: in-process worker simulation calls `ask_user`, test harness writes answer to `pending_questions`, worker receives answer, asserts on the `tool_result` content the worker would feed back to Claude.
  - **Brain-restart mid-wait**: spawn worker, worker calls `ask_user`, kill brain, write answer to DB, restart brain. Assert: worker's `tasks_inflight` row is `aborted`; the answered `pending_questions` row is intact; no double-spawn.
  - **Two-workers correlation**: two workers in the same directive each call `ask_user("foo")` with distinct `taskId`s. Operator answers each separately. Each worker gets its own answer; no crossover.
  - **Late-answer no-op**: task aborts (e.g. budget exceeded) while waiting for human; answer arrives later; assert: log line emitted, no worker resume.

- [ ] 8.7 — Live validation. Real `factory build` against a synthetic spec engineered to provoke ambiguity: e.g. spec says "build a JSON config loader; choose YAML or TOML for the underlying format." Run with `--max-usd 2`. Builder agent should hit the choice, call `ask_user`, post to operator's Telegram. Operator answers `toml`. Build resumes, completes, passes assess gate. Spend ≤ ceiling. Document in `docs/Phase8_Progress.md` with directive ID + question ID + timing.

- [ ] 8.8 — Close Phase 8 (tag `phase-8-worker-ask-user-closed`). `docs/Phase8_Progress.md` charter complete with all sub-steps ✅; `docs/PROGRESS.md` session entry appended; test count + ADR count refreshed; tag placed on this commit. State next Control command: forward to Phase 9 charter (Web UI).
