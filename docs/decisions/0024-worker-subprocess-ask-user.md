# 0024 — Worker-subprocess `askUser`: MCP route, paused-budget wait, taskId-mandatory correlation

- **Status:** Accepted
- **Date:** 2026-04-23
- **Builds on:** [ADR 0015](0015-mid-flight-user-engagement.md) — promised but explicitly deferred Shape 1 (worker-subprocess suspension) "in Phase 5+ if users report real pain from the mid-tool gap."

## Context

Phase 4 shipped `askUser` and `escalateBlocked` as brain-level helpers (`packages/brain/src/ask-user.ts`) that pause execution at phase boundaries — between triage / architect / planner / pool / assess. Phase 7c shipped Telegram as the third channel that round-trips answers back. The full plumbing — `pending_questions` table, channel-side answer collection, idempotent rehydration on brain restart — is in place and exercised in production builds.

The gap ADR 0015 deliberately left open: a tool-using worker (the `claude -p --output-format stream-json` subprocess that runs scaffolder / builder / fixer / investigator) cannot escalate **mid-stream**. If a builder agent realises three turns into its run that the spec is ambiguous about which auth library to use, it has three lossy options:

- **(a) Guess.** Often wrong. The reviewer + fixer loop catches it eventually but burns budget on the round-trip.
- **(b) Raise a finding.** ADR 0015's recommendation. Works, but adds a phase boundary that wouldn't otherwise exist; assess gate processes the finding; fixer handles it as a bug; the original builder's context is lost; cumulative spend is roughly 2–3× a single resolved ask.
- **(c) Stop and let the brain's `escalateBlocked` fire after the pool returns.** Late: by the time the pool reports failure, the builder has already burned the budget that motivated the escalation.

Phase 7's live builds reported (a) as the dominant failure mode — Phase 6c overshot $4–6 budget at $7.71 partly because a stuck retry loop burned tokens that one clarifying question would have prevented. Phase 7a's budget enforcement now **bounds** the overshoot at the operator-declared `max_usd`, but the directive ends `blocked` rather than completing — the agent stopped without ever asking. Phase 8 fills this gap.

ADR 0015's four cost concerns about Shape 1 must be addressed by any in-worker proposal:

1. **Pinning the Claude CLI subscription.** A subprocess waiting on stdin for a tool result holds a CLI seat for the duration of the human's response time.
2. **Locking the worktree open.** A paused worker keeps its worktree mounted; per-task isolation (ADR 0008) means siblings can run, but a paused task's downstream dependants block.
3. **Brain restart catastrophic.** Brain dying severs the worker's stdin; the answer that arrives later has nowhere to go.
4. **Context window growth.** Subprocess sits on stdin; in practice no tokens consumed during the wait (the concern was overstated in ADR 0015 and is reframed here).

A fifth concern surfaces from research into the actual stream-json protocol: **how does Claude CLI handle a tool name in `--allowed-tools` that isn't a built-in?** Answer: it doesn't, cleanly. The official extension path for custom tools in Claude CLI is **MCP** (Model Context Protocol). A worker that wants to expose `ask_user` as a tool the agent can call must speak MCP.

This ADR pins the design across five sub-decisions so sub-steps 8.2–8.7 can implement against a fixed contract. Mirrors the multi-part shape of [ADR 0020](0020-pre-call-budget-enforcement.md).

## Decision

**Five parts, one ADR.**

### 1. Route: MCP, not direct-stdio JSON-RPC

A new `packages/worker-mcp` package implements an MCP server (stdio transport) that exposes a single tool initially: `ask_user(question: string, options?: string[])`. The worker spawns this MCP server alongside the Claude CLI subprocess (or hosts it in-process, depending on what `@modelcontextprotocol/sdk` supports cleanly on Node 20+) and passes `--mcp-config <path>` (or the equivalent flag) to `claude -p` so Claude CLI knows the tool exists.

When Claude CLI emits a `tool_use` for `ask_user`, the MCP server's handler reads `BRAIN_RPC_URL` + `BRAIN_RPC_TOKEN` + `TASK_ID` + `DIRECTIVE_ID` from its env, makes an HTTP POST to brain's RPC endpoint, blocks on the brain-side `askUser()` polling loop, and returns the resulting answer (or a structured error on timeout / abort) as the tool result. Claude CLI feeds the result back into the model's next turn and the agent continues.

The alternative (direct-stdio JSON-RPC by intercepting `tool_use` events in `ClaudeCliProvider.stream()`) is rejected on three grounds:

- Claude CLI's behaviour for tool names not on its built-in list is undocumented; current empirical observation is that the call is silently dropped or an error event is emitted, neither of which gives a clean integration surface.
- Bespoke stream interception couples factory5 to claude-cli's tool protocol, which has shifted twice in the past year (`tool_use` event payload shape changed at 0.2.x and again at 0.4.x).
- MCP is the abstraction the rest of the Claude ecosystem is converging on; standing it up once gives factory5 a foundation for any future custom tool (`query_findings`, `read_adr`, `factory_status`) without a second one-off.

The cost is one new package and one new transport. Pays for itself the second time we want a custom tool.

### 2. Wall-clock budget policy: pause `max_usd` and `max_steps`; per-question soft deadline; no aggregate per-build wait ceiling in Phase 8

The brain-side `askUser()` polls SQLite at 1 Hz waiting for `pending_questions.answer`. During this wait:

- **`max_usd` is paused.** The subprocess makes no LLM calls; no `model_usage` rows accrue; the running total stays flat. The ceiling check (ADR 0020) sees no change and trips no `BudgetExceededError`.
- **`max_steps` is paused.** Same reason — `max_steps` counts `model_usage` rows, which don't grow during the wait.
- **`tasks_inflight` is marked `waiting_for_human`.** New status value (see §4); makes the wait observable via `factory status` and brain-startup orphan detection.
- **Per-question soft deadline.** Each `ask_user` call carries a `deadlineAt` (default 1 hour from question creation, configurable via `[budget.askUser] deadlineSeconds` in `config.toml`). When the deadline passes, brain-side `askUser()` returns `{timedOut: true}`; MCP server returns a structured error result (`{"error": "deadline_exceeded", "questionId": "..."}`) as the tool result; the agent receives the error in its next turn and can decide whether to fall back to a guess or escalate via finding.

This matches operator intent: "the agent is correctly stopped, not thrashing — don't penalise it for stopping." The soft deadline bounds worst-case Claude CLI seat pinning at one hour per stuck question; in the worst-worst case (10 stuck questions in a single directive), that's 10 hours, still bounded by directive-level wall-clock policy if the operator wants to layer one (out of scope for Phase 8 — directive-wall-clock is a Phase 7+ concept that nobody has demanded yet).

Aggregate per-build wait ceiling ("don't let any single directive wait on humans for more than 4 hours total") is **not** in Phase 8. If it becomes load-bearing, a future ADR can add it as a third dimension alongside `max_usd` / `max_steps`.

### 3. Correlation contract: `taskId` mandatory in worker→brain `ask_user` envelope

Brain-side `askUser()` already accepts an optional `taskId` (`packages/brain/src/ask-user.ts:53`). Today's brain-level callers (architect / planner / etc.) often omit it because they ask one question per phase, never overlapping.

Worker-level callers can overlap freely — two builders in the same directive may both call `ask_user("Should this use jwt or session cookies?")` independently. Without strict correlation, Worker A's question can be answered by an operator reply that was meant for Worker B (since `pending_questions.openForDirective` returns all open questions and the channel collector picks the first that matches by question text).

**Decision:** the worker→brain `POST /worker/ask-user` Zod schema makes `taskId` **required** (not optional). The brain-side proxy validates that `taskId` corresponds to a `tasks_inflight` row whose `directive_id` matches the request's `directiveId` (defense-in-depth against worker-side bugs). The proxy then calls `askUser({db, directiveId, taskId, question, options, deadlineAt})` with `taskId` always set. Channel-side collectors (Discord / Telegram / CLI) gain a `taskId` filter on their `pending_questions` lookup so an answer routes only to the worker that asked.

This is a strictly additive constraint: brain-level callers (architect / planner / etc.) keep working unchanged because their `taskId` field stays optional and their lookups don't change. Only the new worker path gains the requirement.

### 4. Brain-restart recovery: `tasks_inflight.status = 'waiting_for_human'`; orphan cleanup; late-answer no-op

Migration 007 (lands with sub-step 8.5):

- Adds `'waiting_for_human'` as an allowed value in `tasks_inflight.status`. Existing values: `'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'blocked'`. New: `'waiting_for_human'`.
- Adds nullable `waiting_question_id TEXT` column referencing `pending_questions.id`. Set when the task transitions to `waiting_for_human`; null otherwise.
- Adds nullable `aborted_reason TEXT` column. Allows brain-startup orphan cleanup to record why a task was aborted.

**Worker-side write:** when the MCP `ask_user` handler sends the brain RPC, the brain proxy first updates `tasks_inflight` for `taskId` to `status='waiting_for_human', waiting_question_id=<question.id>`. When the answer arrives (or times out), the proxy flips back to `status='running'` before returning to the MCP handler.

**Brain startup:** scans `SELECT * FROM tasks_inflight WHERE status='waiting_for_human'`. For each row, the worker subprocess that owned it is dead by definition (brain just restarted; workers are children of brain). Mark the row `status='aborted', aborted_reason='brain_restart_during_human_wait'`. The directive may or may not be salvageable; the brain's normal directive recovery loop handles that as it does any other aborted task.

**Late-answer no-op:** channel collectors (Discord / Telegram / CLI) write to `pending_questions.answer` regardless of task state. After the write, they look up the linked task: if `tasks_inflight.status` is `'aborted'` (or any terminal state), log `pending_questions.answeredAfterTaskEnded` and take no further action. The answer is preserved in the row for forensic value but doesn't trigger a worker resume (worker is dead; nothing to resume).

This treats brain restart as a soft-error: forward progress is lost, but no data corruption, no double-spawn, no orphan rows. Operator sees a `blocked` directive with `blocked_reason='restart_during_human_wait'` and can resume with `factory resume <directive>`.

### 5. Tool whitelist: scaffolder, builder, fixer, investigator

`packages/brain/src/agents/registry.ts` adds `'AskUser'` to the `tools` array of:

- **`scaffolder`** — creates files, picks structure; should ask for missing config rather than guess project layout.
- **`builder`** — the primary failure mode from Phase 7 lived here; does TDD, hits design choices, picks libraries.
- **`fixer`** — when an error message is ambiguous between two root causes, ask before patching the wrong one.
- **`investigator`** — when symptoms are inconclusive, ask the operator for context only they have.

**Excluded** (deliberately, with rationale):

- **`triage`** — no tools today; one-shot classification by design. If triage is ambiguous, the brain re-runs with more context, not the agent itself.
- **`architect` / `planner` / `reviewer` / `verifier`** — already brain-checkpointed. Brain calls `escalateBlocked` (the existing brain-level primitive) after each. Adding in-agent ask creates two paths to the same outcome and risks the agent asking when the brain already plans to.

A new skill body at `prompts/skills/ask-user.md` teaches when to use it. Concrete heuristics rather than a "ask whenever you're unsure" goal:

- **Ask:** design choice between two equally-valid libraries; missing config value the spec didn't fill in; ambiguous error whose root cause splits between two patches; spec contradiction.
- **Don't ask:** typos in the spec (fix and continue); minor naming choices (use a sensible default); style preferences not pinned in the spec (use the project's existing convention).

Each agent's `defaultSkills` array gains the `'ask-user'` skill so the heuristics ship in every run.

## Consequences

**Positive.**

- **Cures the Phase 7 failure mode.** Builders that today burn budget on doomed retries can stop at the first ambiguity and ask. Operator answers; build continues with the right answer in context. No reviewer/fixer round-trip required.
- **Reuses the entire Phase-4 + Phase-7c stack.** `pending_questions` table, channel collectors, brain `askUser()` polling — all unchanged. The new code is one Zod schema + one Fastify route + one MCP server + one tool registration. ~1.5 sessions of net new work for a foundation-shifting capability.
- **MCP foundation pays forward.** The second custom tool (e.g. `query_findings` so a fixer can look up related historical findings without re-scanning) adds one MCP handler instead of a second route + protocol negotiation.
- **Restart safety without new persistence.** `tasks_inflight` already exists; one new status value + one nullable column is the entire migration.
- **No silent crossover between sibling workers.** `taskId`-mandatory correlation closes the hazard ADR 0015 didn't have to address (because brain-level callers don't overlap).
- **Wall-clock budget honesty.** Operators who set `--max-usd 3` get exactly that ceiling on their LLM spend; human wait time doesn't eat into it.

**Negative.**

- **One new package + one new transport.** `packages/worker-mcp` is net-new code with its own dependency footprint. The MCP SDK adds one workspace dependency. Mitigated by: scope kept minimal (one tool initially); the MCP shape is well-understood and stable in the Claude ecosystem.
- **Claude CLI seat pinned per-question for up to the soft deadline.** Default 1h means a single confused builder can hold a CLI seat for an hour. With Anthropic's per-key concurrency in the 5–10 range, ten concurrent stuck builders would pin all seats and starve other directives. Mitigated by: per-question deadline is configurable; aggregate stuck-count surfaces in `factory status` so operator can spot and unblock; in practice agents stuck enough to ask are rare and the answer comes back in seconds-to-minutes, not hours.
- **MCP server lifecycle adds spawn complexity.** Worker now manages two child processes (claude-cli + MCP server) instead of one. Crash on one means the other must clean up. Mitigated by: MCP SDK provides standard lifecycle hooks; worker treats MCP-server-died as a fatal task error (same as claude-cli-died).
- **Late-answer no-op silently discards operator intent.** An operator who answers a question 10 minutes after the brain restarted gets no feedback that their answer was ignored. Mitigated by: log line is loud (`pending_questions.answeredAfterTaskEnded`); future surface (Phase 9 Web UI) can render it; today's CLI/Telegram operators learn from the `factory status` surface that the directive is `blocked`.
- **Per-question deadline hides degradation.** A model that always times out on `ask_user` (e.g. the operator is asleep) burns one hour per question before the agent gives up. Mitigated by: agents can choose to fall back to a guess on `deadline_exceeded`, deferring the eventual failure to the gate; future operator config can lower the default deadline globally.

**Reversible?** Yes, layered. Removing `'AskUser'` from agent tool whitelists in `registry.ts` makes the tool invisible to agents — instant rollback at the integration layer. Removing the MCP server from the worker spawn kills the route at the transport layer. Removing `tasks_inflight.waiting_for_human` and the brain RPC route is a one-commit revert plus a no-op data migration (existing rows in that state on revert get cleaned up by the next brain startup as orphans, then the column itself can be dropped).

## Alternatives considered

- **Direct-stdio JSON-RPC** intercepting `tool_use` events in `ClaudeCliProvider.stream()`. Rejected per §1: undocumented Claude CLI behaviour for unknown tool names; brittle coupling to the tool protocol shape; doesn't extend to a second custom tool.

- **Make `ask_user` a regular brain checkpoint by inserting it as a phase boundary after every worker.** Rejected: that's effectively the existing brain-level `escalateBlocked` (ADR 0015 Shape 2). Phase 8's whole point is in-stream escalation that doesn't require the worker to terminate first.

- **`max_usd` / `max_steps` keep accruing during human wait.** Rejected: penalises the agent for stopping. Operators who set `max_usd 3` mean "spend at most $3 of LLM money" — wall-clock hours waiting on a human is not LLM money. Wrong contract surface.

- **No per-question deadline; wait forever until aborted by signal.** Rejected: pins Claude CLI seats indefinitely; one stuck builder over the weekend exhausts concurrency. The 1-hour default is conservative; operators can raise it via config.

- **Make `taskId` optional in worker→brain envelope** (matching brain-level callers). Rejected per §3: worker-level callers overlap; operator answers can crossover between sibling workers without strict correlation.

- **Separate `worker_pending_questions` table.** Rejected: duplicates the existing `pending_questions` schema for no semantic difference. A `task_id` column is enough to distinguish worker-originated from brain-originated questions when the difference matters (rare).

- **Spawn a dedicated brain-side answer-listener subprocess per worker question** rather than polling SQLite. Rejected: SQLite polling at 1 Hz is observably fine for the brain-level path; no reason to invent a second mechanism.

- **Make `escalateBlocked` reachable from the worker rather than `askUser`.** Rejected for Phase 8: `escalateBlocked` is heavier (full attempted/suggestions structure), more appropriate for end-of-pool reporting; mid-stream wants the lightweight `ask_user` shape. `escalateBlocked` from the worker is a possible Phase 9+ extension if the pain materialises.

- **Surface every worker question in the Web UI before answering via channels.** Deferred. Phase 9 (Web UI) will surface `pending_questions` naturally; this ADR doesn't need to wait for it. Channels stay the canonical answer surface for Phase 8.

## Implementation notes

Sub-step mapping (mirrors the body of `.control/phases/phase-8-worker-ask-user/steps.md`):

- **8.2 — Brain RPC endpoint.** New Fastify route on a new brain-side HTTP server (or extension of the existing daemon→brain bridge — to be picked at implementation time based on whichever has lower coupling cost). `POST /worker/ask-user` with Zod schema in `@factory5/ipc`. Localhost-only IP guard. `Authorization: Bearer <token>` matching brain's in-memory `BRAIN_RPC_TOKEN` (rotated per brain startup; passed to workers in env at spawn time). Server handler proxies into `askUser()` (existing) and returns `{answer?, timedOut, aborted}`.

- **8.3 — `packages/worker-mcp/`.** New package. Single tool: `ask_user`. MCP stdio transport. Reads `BRAIN_RPC_URL` / `BRAIN_RPC_TOKEN` / `TASK_ID` / `DIRECTIVE_ID` from env. Worker spawn extended in `packages/worker/src/run-worker.ts` to (a) start the MCP server, (b) write the MCP config file, (c) pass `--mcp-config` to `claude -p`. MCP-server-died treated as fatal task error (same code path as claude-cli-died).

- **8.4 — Agent registry + skill body.** `packages/brain/src/agents/registry.ts` adds `'AskUser'` to scaffolder/builder/fixer/investigator `tools`. New `prompts/skills/ask-user.md` with the heuristics above. Each agent's `defaultSkills` gains `'ask-user'`.

- **8.5 — Migration 007 + brain startup recovery.** Adds `'waiting_for_human'` to `tasks_inflight.status` allowed values; adds nullable `waiting_question_id`; adds nullable `aborted_reason`. Brain startup adds `recoverFromHumanWaits()` step that scans + marks orphans aborted. Channel collectors gain the `task.status === 'aborted'` check before any post-answer side effect.

- **8.6 — Regression tests.** `packages/brain/src/worker-ask-user-regression.test.ts` covers: happy path (MCP roundtrip via in-process MCP client + stub brain RPC), brain-restart-mid-wait (kill-restart simulation), two-workers correlation (parallel asks, parallel answers, no crossover), late-answer no-op (write answer to aborted task → log + no resume).

- **8.7 — Live validation.** Real `factory build` with a synthetic spec engineered for ambiguity. Operator answers via Telegram (the 7c.6 path). Document directive ID, question ID, timing in `docs/Phase8_Progress.md`. Verify spend ≤ ceiling and that the human-wait window doesn't show up in `model_usage`.

- **`CompleteArchitecture.md`** §11 (the agent / worker section, exact line TBD at implementation time) gets an inline pointer to this ADR in the same commit that lands 8.4.

`@factory5/ipc` schema additions land with 8.2; the schema file exports `workerAskUserRequestSchema` and `workerAskUserResponseSchema` matching the §3 envelope shape. Brain RPC client (worker-side) is a small fetch wrapper; if `@factory5/ipc` already has a client base, extend it; otherwise inline a 30-line wrapper in `packages/worker-mcp/`.
