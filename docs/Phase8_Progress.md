# Phase 8 — progress & roadmap

> Phase-level overview of the Phase 8 arc. `docs/PROGRESS.md` has the
> session-by-session history; this file tracks the _shape_ of Phase 8
> (what's done, what "done" looked like, carry-forwards).

## Where we were, end of Phase 7 (+ addendum-onboarding)

Phase 7 closed 2026-04-21 (`phase-7-closed` on commit `7906099`) with
budget enforcement (7a) + spend dashboard (7b) + Telegram channel (7c)
shipped; 471 tests green; 23 ADRs. An onboarding addendum closed
2026-04-22 (`addendum-onboarding-closed` on `17c393d`) cleaning up the
fresh-clone operator journey: deduplicated `CLAUDE.md`, new
`docs/ONBOARDING.md`, reshaped `factory init`, `[daemon]` config +
`loadDaemonEndpoint()` resolver.

Operating surface at Phase 8 start:

- **Brain-level `askUser` shipped since Phase 3** (`packages/brain/src/ask-user.ts`) — enqueues a `pending_questions` row + an outbound on the directive's source channel, polls until the answer lands. Discord (Phase 3), Telegram (Phase 7c), CLI (all phases) can all deliver questions and accept replies. But: only used at phase boundaries in the brain pipeline — triage/architect/planner/reviewer/verifier can call it, tool-using workers (scaffolder/builder/fixer/investigator) cannot.
- **Worker-level `ask_user` deferred since Phase 4 ([ADR 0015](decisions/0015-mid-flight-user-engagement.md))**. A running `claude -p` stream can't cheaply suspend; Phase 4 put the helper at phase boundaries instead. ADR 0015 explicitly flagged "revisit in Phase 5+ if users report real pain from the mid-tool gap." Phase 7's live builds reported that pain — the budget-ceiling escalation shape from 7a only _bounded_ runaway builds, it didn't _resolve_ the "confused agent burning dollars on doomed retries that one clarifying question could have unblocked" failure mode.

## Phase 8 scope

Single-charter phase (no sub-letter split). Eight sub-steps shipped in
order; the charter and per-step detail live in
`.control/phases/phase-8-worker-ask-user/{README.md,steps.md}`.

| Step | Subject                                                        | Status         |
| ---- | -------------------------------------------------------------- | -------------- |
| 8.1  | ADR 0024 — route + wall-clock + correlation + restart recovery | ✅ `0754a69`   |
| 8.2  | Brain RPC endpoint (`POST /worker/ask-user` on daemon Fastify) | ✅ `0d018f4`   |
| 8.3  | Worker-side MCP plumbing (new `@factory5/worker-mcp` package)  | ✅ `91c248b`   |
| 8.4  | Agent registry + skill body (whitelist + `skills/ask-user.md`) | ✅ `2c1981c`   |
| 8.5  | `tasks_inflight` lifecycle (migration 007 + orphan recovery)   | ✅ `37c0605`   |
| 8.6  | Regression tests (4 scenarios from ADR 0024 §6)                | ✅ `34f4ab5`   |
| 8.7  | Live validation (Telegram-initiated build, issues I010–I012)   | ✅ `761034a`   |
| 8.8  | Phase close (tag, docs, scaffold Phase 9)                      | ✅ this commit |

Plus one mid-phase fix surfaced during 8.7 prep:

- **`fix(8.7)`** `6c9c5ce` — prevent outbound drain spam from cap-reached rows (`outbound.listPending` now accepts `maxAttempts`; worker logs once on abandonment instead of once per poll per row forever).

## ADR decided in Phase 8

**[ADR 0024](decisions/0024-worker-subprocess-ask-user.md)** —
worker-subprocess `ask_user`. Five sub-decisions in one ADR:

1. **Route: MCP server** (Claude CLI's official tool-extension path;
   new `@factory5/worker-mcp` package; per-task ephemeral config in
   `os.tmpdir()`). Direct-stdio JSON-RPC was the smaller diff but
   bespoke; MCP is reusable for future custom tools.
2. **Wall-clock budget policy: paused during human wait**.
   `max_usd` / `max_steps` don't accrue while the worker is waiting;
   per-question soft deadline default 1 h (configurable via
   `[budget.askUser]`). Operator intent is "the agent is correctly
   stopped, not thrashing" — it shouldn't burn the ceiling while
   parked.
3. **Correlation contract: `taskId` mandatory** in the worker→brain
   envelope. Two workers in the same directive with similar questions
   must each get their own answer; brain enforces by always threading
   `taskId` through.
4. **Restart recovery: `tasks_inflight.status = 'waiting_for_human'`**
   introduced via migration 007 + brain-startup sweep that aborts
   orphans with `aborted_reason = 'brain_restart_during_human_wait'`.
   Late answers for aborted waits are logged "answered after task
   ended" (orphan-warn path in channel collectors) and no-op.
5. **Tool whitelist: scaffolder / builder / fixer / investigator**
   only. Brain-checkpointed agents (triage / architect / planner /
   reviewer / verifier) already use `escalateBlocked` between phases
   and aren't given the MCP tool.

Supersedes ADR 0015's Phase-4 deferral of Shape 1.

## Live validation (8.7) — what was proven

Real Telegram-initiated build, directive `01KPX1Z4RE3535H8X55E169PHR`,
$2.579 spend across 7 LLM calls. The pipeline ran
`triage → architect → planner → scaffolder → 2 builder tasks → verifier → assessor`.
The builder's MCP `ask_user` tool call fired at 11:39:27, hit
`/worker/ask-user`, brain's `askUser` enqueued a `pending_questions`
row with `channel: "telegram"`, and the outbound delivered to the
operator's chat at 11:39:28.511Z (`delivered_at` populated, 0 errors).

The operator's Reply-feature answer later matched via
`maybeAnswerPendingQuestion` and wrote to `pending_questions.answer` —
the first live confirmation of the full Telegram answer round-trip
against a Phase 8 directive.

What didn't go per the charter:

- The builder's first 5-minute MCP poll timed out (claude-cli's
  internal tool timeout) before the operator replied. The skill body
  (`skills/ask-user.md`, §"What to do on timeout / abort") said to
  fall back to a guess; the builder picked TOML and wrote
  `src/config.py` in the TOML branch — the right behaviour per the
  spec, but not the "resume with the operator's answer" state the
  charter asked for. See issue I012 for the answer-routing UX snag
  that compounded this.
- The verifier raised 2 hallucinated CRITICAL/HIGH findings citing
  our just-filed `docs/issues/I010` + `I011` files (read from the
  factory5 repo via the `Read` tool's unrestricted filesystem
  access). The verify gate flipped false. Brain escalated via a
  second `askUser`; operator replied `abort` via Telegram Reply;
  directive landed `status=blocked`. Non-Phase-8 issue.
- Spend ran uncapped because `/build` from Telegram doesn't inherit
  `[budget.defaults]` — issue I009.

Net: the **primary ADR 0024 objective** (worker MCP `ask_user` routes
through Telegram end-to-end, operator answer round-trips back)
validated live. The literal charter criterion "build resumes with
the answer, build completes within budget" lands with nuance: the
answer-arrives-before-tool-timeout sub-case wasn't hit live this run
(covered instead by the 8.6 regression suite's happy path, and by the
Reply-feature validation on the second escalation question); and
"completes" landed as "blocked" for reasons unrelated to Phase 8.

## Issues opened / closed in Phase 8

| ID   | Severity | Area              | Status                                | Source       |
| ---- | -------- | ----------------- | ------------------------------------- | ------------ |
| I009 | MEDIUM   | channels/telegram | OPEN                                  | 8.7 live run |
| I010 | LOW      | worker/run-worker | WONTFIX / NOT_REPRODUCED (2026-04-23) | 8.7 live run |
| I011 | HIGH     | channels/telegram | RESOLVED (2026-04-23, via 8.7)        | 8.7 live run |
| I012 | LOW      | channels/telegram | OPEN                                  | 8.7 live run |

## Tests at close

- Phase 7 close baseline: **471** tests.
- Addendum-onboarding close: **471** (no net change).
- Phase 8.2 close: **489** (+18 ipc + daemon route tests).
- Phase 8.3 close: **506** (+15 worker-mcp + 2 providers).
- Phase 8.4 close: **511** (+5 brain registry).
- Phase 8.5 close: **535** (+24 state — migration 007 + tasks-inflight + pending-questions.detectOrphanedAnswer).
- Phase 8.6 close: **539** (+4 daemon regression suite).
- Phase 8.7 + fix commit: **564** (+5 state outbound + 10 shared project-resolver / Telegram resolver integration + 10 others from stashed test runs).
- **Phase 8 close: 564** tests across 14 packages. All green on Windows. `pnpm lint` + `pnpm format:check` clean.

Per-package at close: **logger 13**, core 14, **ipc 14** (+9 from 8.2), **worker-mcp 15** (NEW in 8.3), **providers 39** (+2 from 8.3), **state 121** (+29: 24 from 8.5 + 5 from the outbound fix), assessor 42, **wiki 47** (+8 from 8.7's project-resolver), **channels 62** (+2 from 8.7's resolver integration), events 3, worker 24, **brain 64** (+5 from 8.4), **daemon 41** (+13: 9 from 8.2 + 4 from 8.6), cli 55.

## Carry-forward

1. **Issue I009** (OPEN, MEDIUM) — Telegram / Discord inbound don't inherit `[budget.defaults]`. A Telegram-initiated `/build` runs uncapped. Fix: resolve defaults at directive-creation time regardless of source.
2. **Issue I012** (OPEN, LOW) — `maybeAnswerPendingQuestion`'s matcher is FIFO across all open questions on a directive. When a directive has multiple open questions simultaneously (builder `ask_user` + brain `escalateBlocked`, as we saw live), a reply to the newest bot message hits the oldest unanswered. Fix direction: store the bot's outbound `message_id` on `pending_questions` for per-question discrimination.
3. **Resource-hygiene follow-up** — `askUser` poll loops kept running inside the daemon's HTTP handler after the worker subprocess exited, logging "answer received" against closed HTTP connections. Cosmetic but worth hardening (honour `request.aborted` in the handler / cancel the `askUser` when the request socket closes).
4. **Filesystem scoping** — observed but pre-existing: worker subprocesses have unrestricted `Read`/`Glob`/`Grep` access via their Claude CLI tool whitelist. The verifier during the 8.7 live run read the factory5 repo's `docs/issues/` files into its context. Not Phase 8 scope. If it becomes a correctness problem (verifier hallucinating from repo-internal files), it'd warrant its own issue + fix.
5. **Telegram `/build` flag parsing** — inline flags (`--max-usd`, `--autonomy`) aren't parsed from Telegram's `/build <name>` command. Out of scope today; if operators want to set caps from Telegram, the `parseBuildPayload` parser needs extending.

**Operator follow-up from Phase 6 close** (still unchanged, still
doesn't block forward motion): revoke PAT at
<https://github.com/settings/tokens>; `gh repo delete
momobits/factory5-6b-smoke --yes`; `reg delete "HKCU\Environment"
/v GITHUB_TOKEN /f`.

## Done criteria — assessment at close

- [x] All sub-steps checked off with commit references (table above).
- [x] `pnpm build` clean, `pnpm test` green (564 tests across 14 packages, 2026-04-23).
- [x] `pnpm lint` + `pnpm format:check` clean.
- [x] Regression tests cover happy-path / brain-restart-mid-wait / two-workers correlation / late-answer no-op (`packages/daemon/src/worker-ask-user-regression.test.ts`, 8.6).
- [x] Live validation: real build with deliberate ambiguity → builder asked → operator answered via Telegram. **With nuance**: the answer-arrives-before-tool-timeout path validated via Reply on the verify-gate escalation; the original config-format question's poll timed out and builder guessed. See §"Live validation (8.7) — what was proven" above for the honest account. Primary ADR 0024 mechanism validated end-to-end.
- [x] [ADR 0024](decisions/0024-worker-subprocess-ask-user.md) authored covering route choice + wall-clock policy + correlation contract + restart recovery.
- [x] `docs/PROGRESS.md` entry appended; this `docs/Phase8_Progress.md` charter created.
- [x] Working tree clean.
- [x] Tag `phase-8-worker-ask-user-closed` (applied on the phase-close commit).
