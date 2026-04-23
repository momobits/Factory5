# Next session — paste this to start

Phase 8 (worker-subprocess `askUser`) has 5 of 8 sub-steps closed. The
end-to-end pipeline is wired and unit-tested; the remaining work is
regression-test coverage (8.6), an operator-in-the-loop live build
to validate the real path (8.7), and the phase close (8.8).

What landed this session (commits `0754a69` → `37c0605`):

- **8.1** Charter + ADR 0024 (MCP route over direct-stdio JSON-RPC,
  paused-budget wait with per-question 1h soft deadline,
  `taskId`-mandatory correlation, brain-restart orphan recovery,
  scaffolder/builder/fixer/investigator whitelist).
- **8.2** `POST /worker/ask-user` Bearer-gated route on the daemon
  Fastify server. Schemas in `@factory5/ipc`; handler in
  `@factory5/daemon` proxies into existing brain `askUser()`.
- **8.3** New `@factory5/worker-mcp` package (MCP SDK over stdio).
  `--mcp-config` plumbed through `claude-cli`. Worker writes per-task
  config to `os.tmpdir()` and unlinks after.
- **8.4** `mcp__factory5-ask-user__ask_user` added to four agent
  whitelists. New `skills/ask-user.md` body teaches when to ask vs
  not.
- **8.5** Migration 007 widens `tasks_inflight` (`+'waiting_for_human'`
  - `'aborted'` + `waiting_question_id` + `aborted_reason`).
    `recoverFromHumanWaits()` runs at daemon startup. Channel
    collectors warn on terminal-task late answers via
    `detectOrphanedAnswer`.

535 tests across 14 packages green (was 471 at Phase 7 close, +64).
Build / lint / format clean. New external dep
`@modelcontextprotocol/sdk ^1.0.0`.

## Decisions awaiting your input

**8.7 live validation timing.** This sub-step needs you available to
answer a Telegram question during a real `factory build`. Spend
estimate: $2-3 against a synthetic-ambiguity spec. Two ways to
schedule:

1. **Same session as 8.6** — do tests first, then drive the live
   run when you're ready. Say "continue through 8.7" after 8.6
   lands.
2. **Defer to a separate session** — close 8.6 cleanly, then
   schedule 8.7 when you've got 30 minutes uninterrupted with
   Telegram in front of you.

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md`, then
`.control/phases/phase-8-worker-ask-user/README.md` + `steps.md`
(8.6 / 8.7 / 8.8 still open). Read
`docs/decisions/0024-worker-subprocess-ask-user.md` — the pin for
8.6's regression-test scenarios. Skim
`docs/decisions/0015-mid-flight-user-engagement.md` for the
Phase-4 context Phase 8 reverses.

Run `/session-start` for the full drift check.

## Next concrete work — sub-step 8.6 (regression test suite, ~½ session)

Author the four scenarios from ADR 0024 §6:

1. **Happy path** — Fastify `inject()` calls `POST /worker/ask-user`;
   a separate test fiber writes the answer to `pending_questions`
   mid-poll. Assert: response carries the answer, task transitions
   `running` → `waiting_for_human` → `running`, no late-answer
   warn fires.
2. **Brain-restart mid-wait** — seed `tasks_inflight` with
   `status='waiting_for_human', waiting_question_id=<qId>`. Run
   `recoverFromHumanWaits(db)`. Assert: row → `aborted` with
   reason `'brain_restart_during_human_wait'`. Then write the
   answer and verify `detectOrphanedAnswer` flags it.
3. **Two-workers correlation** — two `inject()` calls with same
   `directiveId`, distinct `taskId`s + distinct questions. Two
   parallel writers each answer one. Assert each call returns its
   own answer with no crossover.
4. **Late-answer no-op** — task already `aborted`. Channel collector
   writes the answer. Assert: row updated, `detectOrphanedAnswer`
   flags the orphan, no other side effects (no resume trigger,
   because there's no consumer structurally).

Test patterns to mirror:

- `packages/daemon/src/server.test.ts` for Fastify `inject()`
  scenarios.
- `packages/state/src/queries/tasks-inflight.test.ts` for DB-driven
  state assertions; extend with a `setTimeout`-backed writer fiber
  for the answer-arrives-mid-poll race.

Likely landing in `packages/daemon/src/worker-ask-user-regression.test.ts`
(new file) since the integration surface is the daemon route.

Report back a 5-line status in this shape:

```
Phase 8 — 5 of 8 sub-steps closed (8.1–8.5; 535 tests; ADR 0024 accepted)
Last action: session-end committed (<sha>) after 5-commit session
Git: branch=main, last=<sha> <subject>, uncommitted=<yes/no>, tag=addendum-onboarding-closed (Phase 8 not yet tagged)
Open blockers: 0
Proposed next action: sub-step 8.6 (regression test suite — happy path / brain-restart / correlation / late-answer)
Ready to proceed?
```

**Operator follow-up from Phase 6 close (still out-of-band whenever
convenient, none blocks Phase 8):** revoke PAT at
https://github.com/settings/tokens; `gh repo delete
momobits/factory5-6b-smoke --yes`; `reg delete "HKCU\Environment"
/v GITHUB_TOKEN /f`.
