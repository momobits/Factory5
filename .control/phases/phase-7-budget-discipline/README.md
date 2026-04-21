# Phase 7 — Operator-control + budget discipline

**Dependencies:** Phase 6 closed (tag `phase-6-closed`)
**Estimated duration:** 3–5 sessions across three sub-phases
**Status:** 🟢 active — Phase 7a opens after this commit

## Goal

Factory5 runs today with no hard ceiling on cost or step-count. A
stuck agent or a runaway retry loop can burn spend unbounded. Phase
6c's live-validation run cost $7.71 against a $4–6 envelope — a
reasonable overrun inside the Opus-4.7-heavy range, but one that is
invisible and unenforced. Phase 7 makes cost and step-budgets first-
class operator controls.

## Sub-phase schedule

Three sub-phases, shipping in strict order (each depends on the
previous):

| Order | Sub-phase | Name                                         | Pitch                                                                                                                                                                        | Est. sessions |
| ----- | --------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1st   | **7a**    | Budget enforcement (`max_usd` / `max_steps`) | Pre-call cost + step ceilings enforced before each LLM call. CLI flags + config defaults. Graceful escalation when exceeded.                                                 | 1             |
| 2nd   | **7b**    | Cross-session spend dashboard                | `factory spend` subcommand — per-project, per-directive, per-day spend aggregations over `model_usage`. Includes data-model prep ([ADR 0021](../../../docs/decisions/0021-first-class-project-identity.md): first-class project identity via `<project>/.factory/project.json` so per-project rollups are stable across workspace moves; closes [I008](../../../docs/issues/I008-findings-registry-project-id-collision.md)).                                                            | 1–2           |
| 3rd   | **7c**    | Telegram channel                             | Third `ChannelPlugin` (after CLI + Discord). Long-polling event source (Telegram's preferred transport). Discord is the reference channel since 6b was dropped per ADR 0019. | 1–2           |

Each sub-phase closes independently with its own tag
(`phase-7a-budget-enforcement-closed`, etc.). Phase 7 as a whole
closes when all three ship, with tag `phase-7-closed`.

## Phase 7a — Budget enforcement (next up)

**Source:** `CompleteArchitecture.md` §12 line 454 flagged `max_usd` /
`max_steps` alongside retry budgets, stall detector, circuit breakers
as "anti-loop guardrails lifted from OmO" — deferred at scaffold
time, outstanding through Phases 1–6.

**Operational forcing function:** Phase 6c live build $7.71 vs $4–6
envelope (docs/Phase6_Progress.md); no pre-call enforcement existed.
A stuck retry loop today is bounded only by step-level retry budgets
in `packages/providers/` — which do not aggregate across tasks.

**Shape (to be refined at phase start):**

- CLI flags: `factory build <spec> --max-usd <N> --max-steps <N>`.
  Defaults read from `~/.factory5/config.toml`.
- `@factory5/state` exposes a per-directive running total over
  `model_usage` (already recorded per-call by every provider).
- `@factory5/brain`'s main loop pre-call check: read running total +
  per-build ceiling; halt with an escalation when exceeded.
- `@factory5/providers` exposes a per-call _cost estimate_ so the
  ceiling check fires **before** the call, not after.
- Regression test: a synthetic build hits the ceiling → escalates
  cleanly with an informative error + blocked reason; does not
  half-fail mid-task.

## Done criteria

Authored in full at phase start. Must include:

- [ ] All steps checked off with commit references
- [ ] `pnpm build` clean, `pnpm test` green (target: `brain`, `state`, `providers`, `cli`)
- [ ] Regression test: synthetic build hits `max_usd` ceiling → clean escalation
- [ ] Live validation: a real `factory build example --max-usd 3` either lands early clean or escalates cleanly
- [ ] Charter criterion: "no build can cost more than its declared ceiling" verifiable in a test
- [ ] `docs/decisions/` has an ADR for the pre-call-vs-post-call decision and the escalation shape
- [ ] `docs/PROGRESS.md` entry + `docs/Phase7_Progress.md` 7a row flipped ✅
- [ ] Working tree clean
- [ ] Tag `phase-7a-budget-enforcement-closed`

## Rollback plan

`git reset --hard phase-6-closed`. No external state to unwind for 7a
(purely internal budget-tracking logic).

## ADRs likely decided in this sub-phase

- **ADR TBD** — Pre-call cost-estimate approach (how does the brain
  compute "will this next call blow the ceiling?" before making it).
- **ADR TBD** (maybe) — Escalation shape when ceiling hit mid-plan
  (halt vs checkpoint vs ask-user vs blocked).
