# Phase 2 — channel-parity

**Dependencies:** Phase 1 (`phase-1-doc-sweep-closed`)
**Estimated duration:** ~2 sessions

## Goal

Discord and Telegram match the brain's full eight-intent vocabulary (`build / fix / review / investigate / chat / status / resume / cancel`). Today the channels handle `build` and `chat` only; everything else forces the operator back to the CLI.

## Outcome

- `/factory <cmd>` slash commands work natively in Discord (`status`, `spend`, `findings`, `resume`, `cancel`, `budget`, `build`) — no LLM round-trips for the read-only ones.
- Telegram's `/` autocomplete menu lists the same vocabulary via `setMyCommands`, with a parser branch that dispatches to the same shared handler module Discord uses.
- Pending-question outbound messages on both Discord and Telegram carry inline button affordances ("Answer" / "Skip" / "Escalate"), in addition to the existing thread-reply / reply-to-bot path.
- `factory cancel <directive-id>` actually kills running workers within 10 s (real `AbortSignal` plumbing through the pool, not just a status flip).
- The triage agent classifies channel-originated chat across all 8 intents; channel handlers re-route reads (`status`/`spend`/`findings`) to shared command handlers instead of always producing an `intent=chat` directive.

## Where we were, end of Phase 1

<Fill in during phase kickoff.>

## Why this phase exists

Closes the most-felt gap from the audit: today Discord and Telegram are essentially "kick off a build" or "free-form chat" only. Operators on mobile have no way to query state without dropping to the CLI. This phase makes the chat surfaces full operating tools rather than lightweight build triggers. Issues U004 (`factory cancel` doesn't kill workers), U011 (Discord `applicationId` reserved but slash commands never wired), U012 (Telegram `setMyCommands` missing), U013 (no inline-keyboard / button affordances on pending questions), U023 (triage doesn't classify across 8 intents) directly addressed; U005 (chat REPL turn timeout) partially.

## Steps

See [`steps.md`](steps.md) for the detailed checklist.

Full implementation plan (richer than the steps below — file pointers, acceptance criteria per sub-task, decision rationale, suggested commit messages): [`../../../UPGRADE/plans/tier-2-channel-parity.md`](../../../UPGRADE/plans/tier-2-channel-parity.md).

## Done criteria

All must be verified before `/phase-close` advances:

- [ ] All items in `steps.md` checked off, each with a commit reference
- [ ] `.control/issues/OPEN/` contains no items tagged `phase:2-blocker`
- [ ] `pnpm build` ✅ · `pnpm test` ✅ · `pnpm lint` ✅ · `pnpm format:check` ✅
- [ ] Issues U004, U011, U012, U013, U023 marked Resolved in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md)
- [ ] `/factory <cmd>` autocompletes in a real Discord client; each of `status`/`spend`/`findings`/`resume`/`cancel`/`budget`/`build` returns a real response (live smoke against a configured bot)
- [ ] Telegram `/` menu lists factory commands; each works (live smoke against a configured bot)
- [ ] Pending-question buttons work on both Discord and Telegram (live smoke)
- [ ] `factory cancel <directive-id>` kills running workers within 10 s (verified by process inspection during a long-running build); directive ends `failed` with `blocked_reason: 'cancelled'`; worktree cleaned up
- [ ] Triage classification of representative chat messages produces non-`intent=chat` outputs at least 1/4 of the time on a representative test set (per tier-2 plan acceptance)
- [ ] Working tree clean (`git status` shows nothing to commit)
- [ ] All commits follow `<type>(2.<step>): <subject>` shape (e.g. `feat(2.1): wire Discord slash commands`)
- [ ] Phase will be tagged `phase-2-channel-parity-closed` by `/phase-close`

## Rollback plan

If Phase 2 needs to be undone: `git reset --hard phase-1-doc-sweep-closed`. No external state to roll back beyond Discord / Telegram bot-side `setMyCommands` and slash-command registrations — those are idempotent and safe to leave registered (they'll just point at routes that 404 / no-op until the brain knows about them).

## ADRs decided in this phase

- (filled in as decisions are made — likely candidates: command-handlers transport-agnostic module shape; Discord guild-vs-global slash-command scope rule; cancel propagation contract from brain to workers)

## Deferred to Phase 3 (or later)

<!-- Items that surface during this phase's work but exceed scope.
One-line reason per item. Copy forward into the next phase's
"Why this phase exists" section when it activates. -->

- <item> — <one-line reason for deferral>
