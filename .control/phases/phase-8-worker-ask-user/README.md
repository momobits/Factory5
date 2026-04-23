# Phase 8 — Worker-subprocess `askUser`

**Dependencies:** Phase 7 closed (tag `phase-7-closed`) + addendum-onboarding closed (tag `addendum-onboarding-closed`)
**Estimated duration:** 2–3 sessions
**Status:** 🟢 active — opens with this commit

## Goal

Surface the brain's existing `askUser` primitive to tool-using workers (`scaffolder` / `builder` / `fixer` / `investigator`), so a mid-build agent can escalate interactively rather than guessing wrong, marking blocked, or silently thrashing. Cleanest fix for the failure mode that Phase 7a's budget enforcement only **bounded**, not **resolved**: a confused agent that burns its `max_usd` ceiling on doomed retries instead of stopping to ask one clarifying question.

This is the **Shape 1** (worker-subprocess suspension) deferral from [ADR 0015](../../../docs/decisions/0015-mid-flight-user-engagement.md) — explicitly out of scope for Phase 4, called out as revisitable "in Phase 5+ if users report real pain from the mid-tool gap." Phase 7's live builds reported that pain.

## Charter

`askUser` becomes a tool in the worker agent's whitelist. When a builder calls `ask_user("Should auth use JWT or session cookies?", options=["jwt", "session"])`, the call routes:

```
worker subprocess (claude -p stream) → tool-use event → ask-user handler
  → HTTP POST to brain RPC → brain.askUser() → pending_questions row + outbound to channel
  → operator answers via Discord/Telegram/CLI → channel writes pending_questions.answer
  → brain.askUser() polling loop returns → HTTP responds → tool_result back into Claude stream
  → builder continues with the answer in context
```

Brain-side `askUser()` (`packages/brain/src/ask-user.ts`) is **already shipped** — Discord, Telegram, CLI all already round-trip answers. The new work is the worker→brain RPC and the Claude-CLI-side tool plumbing. [ADR 0024](../../../docs/decisions/0024-worker-subprocess-ask-user.md) (sub-step 8.1) pins the route as **MCP** (Model Context Protocol — Claude CLI's official tool-extension path), with `taskId`-mandatory correlation, paused `max_usd`/`max_steps` during human wait, per-question soft deadline (default 1h, configurable), and `tasks_inflight.status = 'waiting_for_human'` for brain-restart recovery.

## Sub-step schedule

Single-charter phase (no sub-letter split). Eight sub-steps, shipping in order:

| Step | Subject                                                                                                                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1  | **ADR 0024** — worker→brain `askUser` route (MCP server vs stdio JSON-RPC), wall-clock budget policy (does waiting for human pause directive TTL?), correlation contract (`taskId` mandatory from worker), brain-restart-mid-wait recovery, tool whitelist policy.                                                         |
| 8.2  | Brain RPC endpoint — small HTTP server (or new daemon route) for `POST /worker/ask-user`. Takes `{taskId, directiveId, question, options?, deadlineAt?}`, proxies into existing `askUser()`, returns `{answer, timedOut, aborted}`. Localhost-only, token-gated for worker-only.                                           |
| 8.3  | Worker-side tool plumbing — implement the route chosen in 8.1. If MCP: new `packages/worker-mcp` (or in-process MCP) exposing `ask_user`; spawn args extended with `--mcp-config`. If stdio: a stream-json post-processor that intercepts `ask_user` tool_use events.                                                      |
| 8.4  | `agents/registry.ts` — add `'AskUser'` to `scaffolder` / `builder` / `fixer` / `investigator` tool whitelists. System-prompt fragment (skill-shaped) teaching when to use it: ambiguity > guess, design choice > assumption, missing input > placeholder.                                                                  |
| 8.5  | `tasks_inflight` lifecycle — add `waiting_for_human` status; brain-restart cleanup marks orphaned waits as `aborted`. Late-arriving answers for aborted waits log "answered after task ended" and no-op.                                                                                                                   |
| 8.6  | Regression tests — in-process simulation of worker calling `ask_user`, answer arrives via direct DB write, worker proceeds with answer. Brain-restart-mid-wait test (kill brain, write answer, restart, verify late-answer no-op). Two-workers-same-question correlation test (each picks up its own answer via `taskId`). |
| 8.7  | Live validation — a real `factory build example` against a synthetic spec with deliberate ambiguity (e.g. "build a CLI; pick a config format"). Verify: builder asks, operator answers via Telegram (already wired in 7c.6), build resumes with the answer in context, build completes. Spend stays under ceiling.         |
| 8.8  | Close Phase 8 — tag `phase-8-worker-ask-user-closed`. `docs/PROGRESS.md` entry + new `docs/Phase8_Progress.md` charter doc.                                                                                                                                                                                                |

## Done criteria

- [ ] All sub-steps checked off with commit references
- [ ] `pnpm build` clean, `pnpm test` green (target: `brain`, `worker`, `ipc`, `state`, plus any new package from 8.3)
- [ ] `pnpm lint` + `pnpm format:check` clean
- [ ] Regression tests cover: happy path, brain-restart-mid-wait, two-workers correlation, late-answer no-op
- [ ] Live validation: real build with deliberate ambiguity → builder asks → operator answers via Telegram → build resumes → build completes within budget
- [ ] [ADR 0024](../../../docs/decisions/) authored covering route choice + wall-clock policy + correlation contract + restart recovery
- [ ] `docs/PROGRESS.md` entry; `docs/Phase8_Progress.md` charter created with done criteria mirrored
- [ ] Working tree clean
- [ ] Tag `phase-8-worker-ask-user-closed`

## Rollback plan

`git reset --hard addendum-onboarding-closed`. Brain-side `askUser()` is unchanged (existing helper); the new code is purely additive (new HTTP route, new tool registration, new prompt fragment). Workers without the `AskUser` tool in their whitelist behave exactly as today.

If 8.3's route choice (MCP vs stdio) turns out wrong mid-phase, supersede ADR 0024 with a new ADR rather than editing the accepted one (per CLAUDE.md ADR discipline).

## ADRs likely decided in this phase

- **ADR 0024** (sub-step 8.1) — worker→brain `askUser` route + wall-clock budget policy + correlation contract + restart recovery. Single ADR captures the full design; sub-steps implement.
- **ADR TBD** (maybe) — if MCP is chosen and it grows beyond `ask_user` (e.g. `query_findings`, `read_adr`), an ADR covering the worker-MCP package's scope and contract surface.

## Forward queue (after Phase 8)

Per the operator's pick at Phase 8 charter time:

- **Phase 9** — Web UI (browser dashboard served by `factoryd`, ~3–5 sessions). Pending questions panel will be more compelling once 8 lands and there are more questions to answer.
- **Phase 10** — Assessor tier-3 (Node / Go / Rust language environments, ~2–3 sessions).

Order is durable — only re-pick if a HALT event in Phase 8 reveals a different priority.
