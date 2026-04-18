# 0005 — Three autonomy modes: chat / assisted / autonomous, with mid-flight escalation

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

Factory must support a wide range of human-in-the-loop preferences:

- A user exploring an idea wants turn-by-turn conversation
- A user with a clear spec wants the factory to run, but with checkpoints to course-correct
- A user with a known-good spec wants to fire-and-forget — but the factory must escalate rather than spin in failure loops or silently produce broken work

A binary "interactive vs autonomous" toggle is too coarse. A pure interactive model wastes the factory's parallelism and leverage. A pure autonomous model risks the factory looping silently on bad inputs and the user discovering a wasted budget hours later.

## Decision

Three explicit modes per directive:

| Mode                       | Behavior                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`chat`**                 | Turn-by-turn. Every step asks. For Q&A, brainstorming, light edits.                                                                                                                                                                                                                  |
| **`assisted`** _(default)_ | Brain produces plan → asks user to confirm → executes between checkpoints (per phase boundary, not per step) → asks at next checkpoint.                                                                                                                                              |
| **`autonomous`**           | Runs to completion without checkpoints, **except**: (a) brain pauses and asks user when ambiguity blocks progress; (b) brain escalates to user if a task fails its retry budget; (c) brain reports milestones (start, design done, build done, complete/blocked). No silent looping. |

Two brain-side tools enable mid-flight engagement (so even autonomous mode is never silent when stuck):

- **`ask_user(question, options?, deadline?)`** — pauses execution, posts to originating channel, awaits a reply (default deadline: indefinite). Stored in SQLite `pending_questions`. Survives brain restart.
- **`escalate_blocked(reason, attempted, suggestions)`** — fires when retry budget is exhausted or a circuit breaker is tripped. Posts a structured "I'm stuck — here's what I tried, here's what I'd suggest, what should I do?" message; awaits direction.

Anti-loop guardrails enforce that autonomous mode escalates rather than spinning:

- Per-task retry budget (default 3 attempts → escalate)
- Repetitive-tool-use detector (same tool with same args 3× in a row → abort & escalate)
- Per-build cost ceiling (`max_usd` or `max_steps`)
- Stall detector (no state-hash change in N steps → escalate)
- Per-task timeout (default 30 min → kill worker, mark failed, escalate)

## Consequences

**Positive:**

- Matches the spectrum of how users actually want to interact
- Default (`assisted`) is the safest first-time experience — checkpoints prevent surprise outputs
- Autonomous mode is genuinely usable because it can't disappear into a loop
- `ask_user` and `escalate_blocked` work the same across CLI / Discord / future channels — channel-agnostic
- Survives brain restart: pending questions reload from SQLite

**Negative:**

- Three modes is more surface area than two (interactive/autonomous). Worth it because the middle (`assisted`) is what most users will actually use.
- `ask_user` introduces latency in autonomous mode when called. Acceptable — the alternative is the agent guessing wrong.
- Channel adapters must support inbound (await reply) — adds requirement to `ChannelPlugin` interface.

**Reversible?** Yes. Modes are an enum; we can add or remove modes in a future ADR. The `ask_user`/`escalate_blocked` tools are useful regardless of mode.

## Alternatives considered

- **Two modes (interactive vs autonomous)**. Rejected: too coarse. Most users want autonomous-with-checkpoints.
- **Continuous slider (0 = full chat, 100 = full autonomous)**. Rejected: harder to reason about, harder to test, no clear semantics for intermediate values.
- **No mid-flight escalation in autonomous mode** (silent until done or failed). Rejected because "completely autonomous, never asks" is a recipe for wasted budgets and surprise broken outputs. Even autonomous mode escalates when stuck — that's the whole point of `escalate_blocked`.
- **Always require a confirmation before any LLM call**. Rejected: defeats the purpose of factory; users want to set direction and step away.
