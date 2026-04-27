# Phase 15 — Demand-driven runoff

**Dependencies:** Phase 14 closed (tag `phase-14-carry-forward-continuation-closed`)
**Estimated duration:** indefinite — opens when something bites
**Status:** ⏸ pending demand signal

## Goal

Phase 14 closed with `docs/issues/INDEX.md` Open empty for the first time since the issue tracker existed, every charter-listed carry-forward addressed, and the codebase at a stable position. Phase 15 opens when something genuinely bites the operator — a new issue, an incident, a feature request — rather than going looking for new debt to pay down.

This is a deliberate _paused_ state, not a queued backlog. Phase 14 ran the queue; Phase 15 waits.

## Charter

Demand-signal-ordered, like Phase 14. The candidate pool, in rough priority but not pre-decided:

1. **Bash sandboxing.** ADR 0028 §4 explicitly deferred this. Phase 12.4, 13.x, and 14.x all produced zero `decision":"deny"` lines from the existing tool gate — demand signal still absent. Open this only on a real incident: a worker doing something with `Bash` that should have been gated.

2. **`/build` flag parsing on Telegram + Discord.** Today an inbound `/build foo --max-usd 5` parses the whole text as the project name. The shared `resolveDirectiveLimits` helper from 13.3 already accepts an `explicitFlags` slot — wiring is one line once the parser exists. Defer until an operator asks for inline overrides.

3. **Network egress scoping.** Long-tail concern; wait for an egress-policy demand signal (e.g. a worker hitting a network endpoint that should have been blocked).

4. **Orphan `node.exe` on port 25295 investigation.** Noted during Phase 14.1 smoke: a Node process at `C:\Program Files (x86)\nodejs\node.exe` (an older Node install path, not our pnpm-managed runtime) is squatting on factoryd's default port. Not from any factoryd we ran — no pidfile, older Node install. Could be diagnostic-only ("identify and kill") or could surface a deeper issue worth a sub-step.

5. **Phase 6 operator follow-ups** — PAT revoke, `gh repo delete`, env var cleanup. Out-of-band; mention here for completeness.

6. **Anything new the operator surfaces.** New issues, post-`pnpm factoryd` smoke findings, feature requests.

The phase will close when (a) a sub-step lands and the operator says "no more bites", or (b) the operator decides to wrap the phase as a "still-quiet" close with no sub-steps shipped (and just records the dormancy for the record).

Out of scope:

- **Worker-subprocess `ask_user`** — fully covered by ADR 0024 + Phase 8 implementation; no follow-up needed.
- **Discord per-question reply matcher** (the I012 mirror) — Phase 7c live data showed no equivalent FIFO mismatch on Discord; the channel matcher there already keys on per-message snowflake refs through `discord.js`'s reply primitives. Wiring would be one line if it ever surfaces.
- **Web UI extensions** — fully covered by ADR 0025 (read surface) + ADR 0027 (mutation surface) + Phase 11 implementation. Future Web UI work would be its own phase.

## Sub-step schedule (preliminary — refined as each opens)

| Step | Subject (placeholder)                                                         |
| ---- | ----------------------------------------------------------------------------- |
| 15.1 | First demand signal — opens against whatever the operator hits first          |
| 15.2 | _(if any)_ Second sub-step                                                    |
| 15.x | Phase close — tag `phase-15-demand-driven-runoff-closed`, scaffold next phase |

Single-charter phase. Sub-letter split possible if any candidate (likely Bash sandboxing, if it ever fires) needs an ADR-level discussion.

## Done criteria

- [ ] All landed sub-steps checked off with commit references
- [ ] `pnpm build` clean; `pnpm test` green (regression tests included)
- [ ] `pnpm lint` + `pnpm format:check` clean
- [ ] `docs/PROGRESS.md` entry; `docs/Phase15_Progress.md` charter created
- [ ] `CompleteArchitecture.md` extension if any sub-step warrants one (likely not, unless Bash sandboxing fires)
- [ ] Working tree clean
- [ ] Tag `phase-15-demand-driven-runoff-closed`

If the phase closes still-quiet (no sub-steps shipped), the close commit is just the phase tag + a one-line `docs/Phase15_Progress.md` recording the dormancy + a `PROGRESS.md` entry noting same.

## Rollback plan

`git reset --hard phase-14-carry-forward-continuation-closed`. Each sub-step (when shipped) will be small + isolated; reverting one doesn't affect others.

## Forward queue (after Phase 15)

Same demand-signal queue. Until something bites, the codebase sits at a stable position. The order is durable — re-pick only if a HALT event reveals a different priority.
