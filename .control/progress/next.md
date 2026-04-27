# Next session — paste this to start

Phase 15 (Demand-driven runoff) survived its first session-boundary still paused. Session `2026-04-27T22` was a still-quiet pass-through: `/session-start` → confirm state with no drift → `/session-end` without opening a sub-step. No code edits, no live-LLM spend, no new issues filed, no smoke runs. Single `docs(state)` commit refreshing the cursor + journal entry + this prompt.

Workspace at session boundary: **876 tests** green across 15 packages (last gate, Phase 14.5 close — unchanged this session, no code touched). lint + format + build all clean from that same gate. `docs/issues/INDEX.md` Open table still empty (third session in a row). Migration count still 8.

This is now **two consecutive session boundaries** with no demand signal for Phase 15.

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md`, then the Phase 15 charter at `.control/phases/phase-15-demand-driven-runoff/{README.md,steps.md}`. Run `/session-start` for the full drift check.

The phase remains pending demand signal — no predetermined first sub-step. Until something bites, the codebase sits at a stable position with the open-issue tracker empty.

## Recommended next action — three branches, in priority

1. **Something bit between sessions.** Open 15.1 against whichever item from the candidate pool fires first. New issue, smoke finding, feature request, operator pain — whatever the bite is. Treat that as the actual phase content; the candidate pool below is the menu, but the bite is the order.

2. **Nothing bit; close Phase 15 still-quiet** _(recommended if branch 1 is empty)_. The phase charter explicitly enables this path. Single-commit operation:

   - `/phase-close` produces tag `phase-15-demand-driven-runoff-closed`.
   - Author short `docs/Phase15_Progress.md` recording: charter + two still-quiet passes (Phase 14 close session + this session) + final state.
   - Prepend a one-line entry to `docs/PROGRESS.md` noting the still-quiet close.
   - Exit the active Control-managed phase chain until new work demands a phase frame.
   - $0 spend. No new ADRs (no architecture shipped). No `CompleteArchitecture.md` change.

3. **Another still-quiet pass-through** _(only if there's a specific reason to keep Phase 15 nominally open)_. Same shape as this session — bootstrap, confirm, end. Only choose this branch if there's an explicit signal to expect demand soon. Otherwise, branch 2 is the cleaner record.

## Candidate pool (unchanged from Phase 14 close, all non-blocking)

1. **Bash sandboxing** — ADR 0028 §4 explicitly deferred. Open only on a real incident: a worker doing something with `Bash` that should have been gated. Phase 12.4 + 13.x + 14.x + this still-quiet pass all produced **zero** `decision":"deny"` lines.
2. **`/build` flag parsing on Telegram + Discord** — today an inbound `/build foo --max-usd 5` parses the whole text as a project name. The shared `resolveDirectiveLimits` helper from 13.3 already accepts an `explicitFlags` slot — wiring is one line once the parser exists. Defer until an operator asks.
3. **Network egress scoping** — long-tail concern; wait for an egress-policy demand signal.
4. **Orphan `node.exe` on port 25295** — noted during Phase 14.1 smoke. A Node process at `C:\Program Files (x86)\nodejs\node.exe` (older Node install) squatting on factoryd's default port. Diagnostic-only candidate.
5. **Phase 6 operator follow-ups** — PAT revoke, `gh repo delete`, env var cleanup. Out-of-band.
6. **Anything new the operator surfaces** — new issues, post-`pnpm factoryd` smoke findings, feature requests.

## Out of scope (still deferred)

- **Worker-subprocess `ask_user`** — fully covered by ADR 0024 + Phase 8 implementation; no follow-up.
- **Discord per-question reply matcher** — Phase 7c live data showed no equivalent FIFO mismatch on Discord; one-line wiring if it ever surfaces.
- **Web UI extensions** — covered by ADR 0025 + 0027 + Phase 11. Future Web UI work would be its own phase.

## Stable-state observation

factory5's open issue tracker is empty, all carry-forwards from Phases 9–14 are addressed, and the codebase is at the most stable point in its history. Two consecutive still-quiet session boundaries strongly suggest closing Phase 15 still-quiet is the right next move — the phase was always designed as a paused-state on demand signal, and there is no protocol cost to closing it without sub-steps. Closing cleanly is a more accurate signal of project state than holding the phase open indefinitely.

Report back on wake-up with a status block:

```
Phase 15 — pending demand signal (0 sub-steps opened, 2 still-quiet pass-throughs)
Last action: docs(state) <sha> — still-quiet session 2026-04-27T22
Git: branch=main, last=<latest-sha>, uncommitted=no, tag=phase-14-carry-forward-continuation-closed
Open blockers: 0
Proposed next action: if something has bitten — open 15.1; otherwise — /phase-close still-quiet
Ready to proceed?
```
