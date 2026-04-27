# Next session — paste this to start

Phase 14 closed 2026-04-27 (tag `phase-14-carry-forward-continuation-closed`). All five planned sub-steps shipped in a single sustained session arc the same day Phase 13 closed: **14.1** stale-dist dev-loop (conditional exports + `tsx --conditions=development`) → **14.2** I013 → RESOLVED (paid down by Phase 10.3) → **14.3** I012 → RESOLVED (new `pending_questions.bot_message_id` column targeting) → **14.4** `factory questions cleanup` CLI + Windows mojibake README addendum → **14.5** phase close.

Workspace: **876 tests** green across 15 packages (was 855, +21 from this phase). lint + format clean. Builds clean across 15 packages + 3 apps. Spend this phase: $0 (all TS / docs / migration / IPC / CLI work).

`docs/issues/INDEX.md` Open table is **empty for the first time** since the tracker was instituted. Both prior open issues (I012 + I013) moved to RESOLVED.

End-to-end smoke datapoints (this phase):

- **14.1**: factoryd boots clean with `packages/daemon/dist/` renamed away → proves source routing under the `development` condition. Same boot fails with `ERR_MODULE_NOT_FOUND` when `--conditions=development` is absent → proves the condition is what's wiring it up. Tested on Node 22.22.2 + tsx 4.21.0 + Windows.
- **14.3**: regression tests in telegram, outbound-worker, and pending-questions queries cover the I012 disambiguation scenario (the issue's exact two-open-questions-in-same-chat repro) plus back-compat for legacy unstamped rows.
- **14.4**: `runQuestionsCleanup` unit-tested across no-op, list-and-mark, dry-run, since-filter, and invalid-since paths.

Migration count: **7 → 8** (`008-pending-questions-bot-message-id`).

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md` (current phase / step / Phase 15 candidate pool), then the Phase 15 charter at `.control/phases/phase-15-demand-driven-runoff/{README.md,steps.md}`.

Phase 15 is **pending demand signal** — no predetermined first sub-step. Until something bites, the codebase sits at a stable position with the open-issue tracker empty.

Run `/session-start` for the full drift check.

## Next concrete work — 15.1 (pending demand signal)

**No predetermined first bite.** Candidate pool (rough priority, not pre-decided):

1. **Bash sandboxing.** Deferred since ADR 0028 §4. Open only on a real incident — a worker doing something with `Bash` that should have been gated. Phases 12.4 + 13.x + 14.x all produced zero `decision":"deny"` lines.
2. **`/build` flag parsing on Telegram + Discord.** Today an inbound `/build foo --max-usd 5` parses the whole text as a project name. The shared `resolveDirectiveLimits` helper from 13.3 already accepts an `explicitFlags` slot — wiring is one line once the parser exists. Defer until an operator asks.
3. **Network egress scoping.** Long-tail concern; wait for an egress-policy demand signal.
4. **Orphan `node.exe` on port 25295.** Noted during 14.1 smoke: a Node process at `C:\Program Files (x86)\nodejs\node.exe` (older Node install path, not our pnpm-managed runtime) is squatting on factoryd's default port. Not from any factoryd we ran (no pidfile). Could be diagnostic-only or surface a deeper issue.
5. **Phase 6 operator follow-ups** (out-of-band) — PAT revoke, `gh repo delete`, env var cleanup.
6. **Anything new the operator surfaces.** New issues, smoke findings, feature requests.

If nothing has bitten by next session: do nothing. Phase 15 is a paused state, not a queued backlog. Run `/session-start`, confirm state, and end the session if no work signals are present.

## Carry-forward (still non-blocking)

- Bash sandboxing (incident-driven)
- `/build` flag parsing on Telegram + Discord (operator-request-driven)
- Network egress scoping (demand-driven)
- Orphan `node.exe` on port 25295 (diagnostic)
- Phase 6 operator follow-ups (out-of-band)

## Out of scope (still deferred)

- **Worker-subprocess `ask_user`** — fully covered by ADR 0024 + Phase 8 implementation; no follow-up.
- **Discord per-question reply matcher** (the I012 mirror) — Phase 7c live data showed no equivalent FIFO mismatch on Discord; the channel matcher there already keys on per-message snowflake refs through `discord.js`'s reply primitives. One-line wiring if it ever surfaces.
- **Web UI extensions** — covered by ADR 0025 + 0027 + Phase 11. Future Web UI work would be its own phase.

## Stable-state observation

factory5's open issue tracker is empty, all carry-forwards from Phases 9–13 are addressed, and the codebase is at the most stable point in its history. If demand signal stays absent for several sessions, it may be appropriate to close Phase 15 as a "still-quiet" close (no sub-steps shipped, just records the dormancy + tag) and exit the active Control phase chain until new work surfaces.

Report back on wake-up with a status block:

```
Phase 15 — pending demand signal (0 sub-steps opened)
Last action: chore(phase-14) 6cc0008 (close + tag)
Git: branch=main, last=<latest-sha>, uncommitted=no, tag=phase-14-carry-forward-continuation-closed
Open blockers: 0
Proposed next action: pause unless something has surfaced; otherwise open 15.1 against the first bite
Ready to proceed?
```
