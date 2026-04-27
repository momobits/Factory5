# Phase 14 — progress & roadmap

> Phase-level overview of the Phase 14 arc. `docs/PROGRESS.md` has the
> session-by-session history; this file tracks the _shape_ of Phase 14
> (what shipped, what "done" looked like, carry-forwards).

## Where we were, end of Phase 13

Phase 13 closed 2026-04-27 (`phase-13-operator-experience-closed`) with operator-experience polish + carry-forward sweep complete: I015 file-sink logger fix, the long-overdue `factory ui-token` CLI surface, I009 shared `resolveDirectiveLimits` helper, and I014 architect auto-commit. **855 tests green**, 28 ADRs, 15 packages.

Two open issues remained on `docs/issues/INDEX.md`:

- **MEDIUM**: I013 (`worker-worktree-cleanup-blocked-by-node-modules`) — INDEX still showed OPEN despite Phase 10.3's `prePurgeDepDirs` being the canonical fix and Phase 12's sandbox cleanup further shrinking the surface. Doc drift.
- **LOW**: I012 (`telegram-reply-matcher-fifo-not-targeted`) — Telegram Reply-feature answers always landed on the oldest open question in the chat, regardless of which bot message the operator targeted. Real bug, low traffic.

Plus a stack of long-standing carry-forwards:

- **Stale-dist dev-loop gotcha** (overdue since Phase 9 close — `apps/factoryd` consumes workspace packages via `main: "./dist/index.js"`, so dev edits don't propagate without manual `pnpm build`).
- **PowerShell em-dash mojibake** (operator-side console encoding fix).
- **Stale `pending_questions`** orphans from older completed directives — never blocking, but accumulating.

Phase 14's charter sweeps these with surgical, single-session fixes — TS-only work, no live-LLM spend.

## Phase 14 scope

Single-charter phase (no sub-letter split). Five sub-steps shipped in a single sustained session arc; the charter and per-step detail live in `.control/phases/phase-14-carry-forward-continuation/{README.md,steps.md}`.

| Step | Subject                                                                                                                                                                         | Status         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 14.1 | Stale-dist dev-loop gotcha (overdue since Phase 9). Conditional exports + `tsx --conditions=development` route dev runs through `src/`; prod path through `dist/` unchanged     | ✅ `95b901b`   |
| 14.2 | I013 status re-read → RESOLVED. Code re-read confirmed `prePurgeDepDirs` (Phase 10.3) is the fix; doc-status reconciled                                                         | ✅ `ee96dcd`   |
| 14.3 | I012 → RESOLVED. New `pending_questions.bot_message_id` column (migration 008) + outbound-worker stamping + matcher exact-rung. Discord untouched per Phase 7c live-data signal | ✅ `6e40872`   |
| 14.4 | `factory questions cleanup` CLI for the `pending_questions` orphan sweep + Windows mojibake README addendum                                                                     | ✅ `448505f`   |
| 14.5 | Phase close (tag, this doc, PROGRESS entry, Phase 15 scaffold)                                                                                                                  | ✅ this commit |

## What "done" looked like

End-to-end + smoke evidence per sub-step:

| Sub-step | Smoke evidence                                                                                                                                                                                                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14.1     | `pnpm factoryd` boots clean with `packages/daemon/dist/` renamed away — proves source routing under the `development` condition. Same boot fails with `ERR_MODULE_NOT_FOUND` when `--conditions=development` is absent — proves the condition is what's wiring it up. Tested on Node 22.22.2 + tsx 4.21.0 + Windows.                          |
| 14.2     | No code change. Code re-read confirmed: `packages/worker/src/worktree.ts:375` exports `prePurgeDepDirs` (rimrafs `node_modules`, `.venv`, `__pycache__` with retry/force); `cleanupWorktree` invokes it at line 358 before `git worktree remove --force`; `worktree.test.ts:138` is the explicit I013 regression test. Issue + INDEX updated. |
| 14.3     | Telegram regression: two open questions on the same directive/chat with distinct `bot_message_id`s; an inbound reply targeting the newer's id correctly answers the newer. Companion test proves back-compat for unstamped legacy rows. Outbound-worker test proves the stamp lands when `metadata.questionId` is present.                    |
| 14.4     | `runQuestionsCleanup` unit-tested across the no-op/list-and-mark/dry-run/since-filter/invalid-since paths. Helper unit tests cover terminal-vs-running directives, already-answered exclusion, since filter, oldest-first ordering, no-op on unknown id.                                                                                      |

## Architecture decisions

**No new ADRs.** Phase 14 was a sweep phase like Phase 13. None of the four fixes warranted pinning a new contract:

- **14.1's conditional exports** stayed inside the `package.json` / launcher surface. ADR 0029 would only be warranted if we were committing to a richer dev-vs-prod split (e.g. `customConditions` in `tsconfig.base.json` for typecheck-without-dist). Phase 14 explicitly punted that scope.
- **14.2** was pure doc reconciliation — fix was already shipped in 10.3.
- **14.3** is the issue's hypothesis option-1 (record the bot's outbound `message_id`), wired through the existing `metadata.questionId` plumbing rather than a Telegram-specific send-path rewrite. Schema migration is incremental; matcher remains back-compat.
- **14.4** is a small operator surface (`factory questions cleanup`) plus a one-paragraph README addendum. No new contracts.

The Phase 12 close extended `CompleteArchitecture.md` with §24 (worker filesystem-scoping). Phase 13 + Phase 14 both ship **no `CompleteArchitecture.md` change**.

## Implementation footprint

| Component                                                                      | Change                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/*/package.json` (15 files)                                           | Each gained a `"development": "./src/<entry>.ts"` condition in its `exports` map. Subpath exports on `logger`, `worker-mcp`, `worker-sandbox` got the same condition for their additional entries. (Phase 14.1)                                                                                     |
| `apps/factory/package.json`, `apps/factoryd/package.json`, root `package.json` | `dev` scripts and root `factory` / `factoryd` scripts pass `--conditions=development` to `tsx`. Prod paths (`node dist/main.js`) untouched. (Phase 14.1)                                                                                                                                            |
| `packages/state/src/migrations/008-pending-questions-bot-message-id.ts`        | New migration: `ALTER TABLE pending_questions ADD COLUMN bot_message_id TEXT` + partial index `idx_pending_bot_message ON (bot_message_id) WHERE bot_message_id IS NOT NULL AND answered_at IS NULL`. Idempotent re-apply tests bumped from `[1..7]` to `[1..8]`. (Phase 14.3)                      |
| `packages/core/src/schemas.ts`                                                 | `pendingQuestionSchema` gained optional `botMessageId: z.string().min(1).optional()`. (Phase 14.3)                                                                                                                                                                                                  |
| `packages/state/src/queries/pending-questions.ts`                              | New helpers: `setBotMessageId(db, id, botMessageId)` (idempotent stamp); `findOpenByBotMessageId(db, channel, botMessageId)` (channel-scoped exact lookup, answered-row-aware); `findOrphaned(db, { since? })` + `markOrphanAnswered(db, orphan, when)` for the cleanup sweep. (Phases 14.3 + 14.4) |
| `packages/daemon/src/outbound-worker.ts`                                       | After successful `deliver()`, when `msg.metadata.questionId` is a string and `result.externalId` is set, calls `pendingQuestions.setBotMessageId`. Best-effort: a thrown DB error logs and continues. No-op when metadata lacks `questionId`. (Phase 14.3)                                          |
| `packages/channels/src/telegram.ts`                                            | New exact rung in `maybeAnswerPendingQuestion`: prefer `findOpenByBotMessageId('telegram', String(replyTo.message_id))`; fall through to legacy `channel_ref` / `LIKE` rungs when the exact rung misses. Discord left alone — Phase 7c live data showed no equivalent FIFO mismatch. (Phase 14.3)   |
| `packages/cli/src/commands/questions.ts`                                       | New `factory questions cleanup` command with `--since <iso-date>` and `--dry-run` flags. Pure `runQuestionsCleanup` function exported for testability (mirrors the 13.2 `runUiToken` pattern). (Phase 14.4)                                                                                         |
| `README.md`                                                                    | New "Windows operator tips" subsection under Quick start: `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` for PowerShell 5.1 em-dash mojibake. Windows Terminal + PowerShell 7+ pick this up automatically; classic PowerShell 5.1 does not. (Phase 14.4)                                |
| `docs/issues/INDEX.md`                                                         | I012 + I013 moved from Open to Resolved (in date order). Open table is now empty for the first time since the issue tracker existed. (Phases 14.2 + 14.3)                                                                                                                                           |

## Tests

**855 → 876** green across 15 packages (+21 from this phase):

- `state` +12 (5 from 14.3 `setBotMessageId` / `findOpenByBotMessageId`; 7 from 14.4 `findOrphaned` / `markOrphanAnswered`)
- `channels` +2 (14.3 telegram regressions: targeted match + legacy fallback)
- `daemon` +2 (14.3 outbound-worker stamp + skip-when-no-questionId)
- `cli` +5 (14.4 `runQuestionsCleanup` cases)

`pnpm lint` + `pnpm format:check` clean. `pnpm build` clean across 15 packages + 3 apps. Tests run on Windows + Node 22.22.2 + tsx 4.21.0.

## Spend

**$0** this phase. All TS / docs / migration / IPC / CLI work — no live-LLM smoke runs needed. Phase 13 + Phase 14 together are now the longest stretch of carry-forward sweep work without an LLM call.

## Issues

- **I012** (LOW, OPEN since 2026-04-23) → RESOLVED 2026-04-27. Targeted via the new `bot_message_id` column.
- **I013** (MEDIUM, OPEN since 2026-04-24) → RESOLVED 2026-04-24 (paid down by Phase 10.3; Phase 14.2 reconciled the doc status).
- **`docs/issues/INDEX.md` Open table:** empty as of Phase 14 close. First time since the tracker was instituted.

## Carry-forward into Phase 15

Phase 15 opens against the **demand-signal queue** (no concrete first item):

- **Bash sandboxing.** ADR 0028 §4 explicitly deferred this. Phase 12.4 + 13.x + 14.x all produced zero `decision":"deny"` lines, so no demand signal yet. Open this only on a real incident.
- **`/build` flag parsing on Telegram + Discord.** Today an inbound `/build foo --max-usd 5` parses the whole text as a project name. The shared `resolveDirectiveLimits` helper from 13.3 already accepts an `explicitFlags` slot — wiring is one line once the parser exists. Defer until an operator asks for inline overrides.
- **Network egress scoping.** Long-tail concern; wait for an egress-policy demand signal.
- **Orphan `node.exe` on port 25295.** Noted during 14.1 smoke: a Node process at `C:\Program Files (x86)\nodejs\node.exe` is squatting on factoryd's default port. Not from any factoryd we ran (no pidfile, older Node install path). Could be diagnostic-only ("identify and kill") or could surface a deeper issue.
- **Phase 6 operator follow-ups** (out-of-band): PAT revoke, `gh repo delete`, env var cleanup.

Phase 15 is genuinely _pending demand signal_ — if nothing has bitten by next session, the right call is to do nothing.

## Forcing functions paid down

- **Stale-dist dev-loop** (Phase 9.9 follow-up) — closed by 14.1.
- **I013** (Phase 10.3 follow-up; doc drift) — reconciled by 14.2.
- **I012** (Phase 8.7 live-validation finding) — closed by 14.3.
- **Stale `pending_questions` orphans** (Phase 12.4 finding) — sweep tool shipped in 14.4.
- **PowerShell em-dash mojibake** (Phase 12.4 finding, operator-side) — README addendum shipped in 14.4.

## Memory updates

No new memories. Existing `feedback_fix_root_causes.md` and `feedback_use_frontend_design_skill.md` continue to apply. The 14.3 fix is another instance of `feedback_fix_root_causes.md` in action — the stop-gap was tempting (refuse FIFO when >1 open question), but the real fix is the schema column.

## Significant blockers hit

- **Prettier line-wrap + inline-backtick interaction** at 14.2 + 14.4 close on `.control/phases/phase-14-*/steps.md`. Same issue Phase 13 hit at 13.4 close, slightly different shape: this time line-wrapping inside an inline code span (e.g. `` `git worktree remove --force` `` split across lines) confused prettier's continuation-indent calculation. Workaround: keep inline code on one line; line-wrap surrounding prose only. Useful gotcha for Control phase steps.md edits.

## Non-trivial finding (carries forward)

The 14.1 fix changes how `pnpm factoryd` resolves workspace packages. Vitest's resolver activates `development` by default in test mode — which means tests now route to `src/` too, not `dist/`. This is _good_ (no `pnpm build` required between test runs) but it's a behavior change worth knowing: any future tooling that relies on workspace packages being routed through `dist/` during test runs (CI pipelines, coverage tools, etc.) needs `--conditions=production` or `NODE_ENV=production` set. Today's tests don't, and they pass; flagged here for future readers.
