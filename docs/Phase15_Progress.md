# Phase 15 — progress & roadmap

> Phase-level overview of the Phase 15 arc. `docs/PROGRESS.md` has the
> session-by-session history; this file tracks the _shape_ of Phase 15.
>
> **Phase 15 closed still-quiet** — no sub-steps shipped. Scaffolded as
> a paused-state placeholder for demand-signal-driven work; nothing
> demanded work; closed to exit the active Control phase chain rather
> than hold the placeholder open indefinitely.

## Where we were, end of Phase 14

Phase 14 closed 2026-04-27 (`phase-14-carry-forward-continuation-closed` on `6cc0008`) with five sub-steps in a single sustained session arc the same day Phase 13 closed: 14.1 stale-dist dev-loop (conditional exports + `tsx --conditions=development`) → 14.2 I013 → RESOLVED (paid down by Phase 10.3) → 14.3 I012 → RESOLVED via the new `pending_questions.bot_message_id` column → 14.4 `factory questions cleanup` CLI + Windows mojibake README addendum → 14.5 phase close. **876 tests green**, 28 ADRs, 15 packages, 8 schema migrations. `docs/issues/INDEX.md` Open table empty for the first time since the issue tracker was instituted.

## Phase 15 charter (as scaffolded)

Phase 15 — _Demand-driven runoff_ — was scaffolded with an explicit paused-state design: it would open against whichever item the operator hit first, rather than picking from the candidate pool prospectively. Candidate pool, in rough priority but not pre-decided:

1. **Bash sandboxing** (incident-driven; ADR 0028 §4 deferral).
2. **`/build` flag parsing on Telegram + Discord** (operator-request-driven).
3. **Network egress scoping** (demand-driven).
4. **Orphan `node.exe` on port 25295** investigation (diagnostic; noted during 14.1 smoke — already identified as an older-Node-install process at `C:\Program Files (x86)\nodejs\node.exe`, not from any factoryd we ran; remaining work is operator-side: kill it or change factoryd's default port).
5. **Phase 6 operator follow-ups** (out-of-band) — PAT revoke, `gh repo delete`, env var cleanup.
6. **Anything new the operator surfaces.**

The phase charter explicitly enabled either close path: (a) close after sub-steps land, or (b) close still-quiet with no sub-steps if no demand signal arrives across "several sessions."

## Dormancy record

- **Phase opened:** 2026-04-27 with `6cc0008 chore(phase-14): close phase 14, kick off phase 15`.
- **Still-quiet pass #1:** 2026-04-27 (session `2026-04-27T22`). `/session-start` confirmed clean state with no drift; `/session-end` ran without opening a sub-step. Single `c2a12db docs(state)` commit refreshing the cursor + journal entry. Zero code changes, zero spend, zero new issues filed.
- **Phase 15 closed still-quiet:** 2026-04-28. No sub-steps shipped. `docs/issues/INDEX.md` Open table remained empty across the entire phase. `876 tests` green throughout (last gate: Phase 14.5 close — never re-run during Phase 15 because no code changed).

## What didn't ship (and why that's the right outcome)

The candidate pool was real but every item carried a deferral predicate that wasn't satisfied:

- **Bash sandboxing** wanted a real incident — zero `decision":"deny"` lines were emitted by the worker-sandbox gate across Phases 12.4, 13.x, and 14.x. No incident, no opening.
- **`/build` flag parsing** wanted an operator request for inline overrides. None surfaced.
- **Network egress scoping** wanted an egress-policy demand signal. None surfaced.
- **Orphan `node.exe` on port 25295** was already identified during Phase 14.1 (older Node install path, not from factory5). Remaining decision is operator-side (kill the process or change factoryd's default port) — no Claude-side technical work.
- **Phase 6 operator follow-ups** are out-of-band by design (PAT revocation, GitHub repo deletion, env var cleanup — operator actions, not code work).
- **No new issues** were filed during Phase 15. Open table empty at scaffold; empty at close.

Closing still-quiet rather than holding Phase 15 open across more pass-throughs is the more accurate signal of project state. The codebase is genuinely at rest.

## Final state at close

| Metric                  | Value                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Sub-steps shipped       | 0                                                                                  |
| Commits in phase        | 2 (`c2a12db docs(state)` still-quiet pass-through + this `chore(phase-15)` close)  |
| Tests                   | 876 green (15 packages; unchanged across Phase 15 — no code changed)               |
| Lint / format / build   | Clean (last gate: Phase 14.5 close, still applicable)                              |
| Schema migrations       | 8 (unchanged)                                                                      |
| ADRs                    | 28 (no new ADRs)                                                                   |
| `docs/issues/` Open     | Empty (unchanged)                                                                  |
| `CompleteArchitecture`  | No new section                                                                     |
| Spend                   | $0                                                                                 |
| Phase tag               | `phase-15-demand-driven-runoff-closed`                                             |
| Active phase chain      | Exited — no Phase 16 scaffolded; new phase opens on demand if/when work surfaces   |

## Carry-forward

Same candidate pool as Phase 14 close, all still non-blocking, all still demand-signal-gated:

- Bash sandboxing (incident-driven)
- `/build` flag parsing on Telegram + Discord (operator-request-driven)
- Network egress scoping (demand-driven)
- Orphan `node.exe` on port 25295 — operator action
- Phase 6 operator follow-ups (out-of-band)

If any of these (or anything new) surfaces in a future session, scaffold a new phase against it — the Control framework supports re-entry from the dormant state by opening a fresh `phase-16-<name>` directory + READ ME + steps and updating STATE.md to point at it.

## Lessons captured

- **The "do nothing" option is real.** Phase 15 was scaffolded with the explicit shape of a paused-state phase, and the still-quiet close is what it was always allowed to do. Forcing work to fill a phase frame would have been make-work.
- **Demand-signal phases need an exit predicate.** The charter's "if demand stays absent for several sessions, consider closing still-quiet" was the right escape hatch — without it, the phase could have run indefinitely and accumulated a sequence of still-quiet pass entries with no signal.
- **Closing the active phase chain is OK.** The Control framework's default of "phase always chains to phase" is a convention, not a constraint. Stepping out of the chain when the codebase is at rest is more accurate than keeping a placeholder phase open.
