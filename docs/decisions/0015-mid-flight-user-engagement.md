# 0015 — Mid-flight user engagement: brain-level `askUser` + checkpoint-and-rehydrate, not worker-subprocess suspension

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

ADR 0005 promised two mid-flight tools — `ask_user` and `escalate_blocked`
— so every autonomy mode can talk back to the originating channel without
silent looping. Phase 4 has to decide _where_ those tools live and _how_
execution pauses until an answer arrives.

Two shapes were on the table:

1. **Worker-subprocess suspension.** The agent subprocess (`claude -p
--output-format stream-json` inside a per-task worktree, see ADR 0007)
   calls an `ask_user` tool provided by the CLI. The CLI intercepts the
   tool call, publishes the question, waits, and feeds the answer back
   into the subprocess' next turn. The subprocess _suspends_ mid-stream
   until the tool reply arrives.

2. **Brain-level checkpoints + rehydrate.** The brain's pipeline (in
   `@factory5/brain/loop.ts`) hands control to phase-boundary helpers
   between triage / architect / planner / pool / assess. Each helper can
   call `askUser()` / `escalateBlocked()`, which synchronously block on
   SQLite polling until `pending_questions.answer` gets written. If the
   brain is killed mid-wait, a later resume re-runs the same phase; the
   helper's idempotent lookup finds the still-open question row and
   continues polling from there, or finds the already-answered row and
   returns the stored answer without re-asking.

Shape 1 is attractive for agents that realise mid-tool-use that they're
stuck, but it comes with a non-trivial cost:

- The stream-json tool protocol isn't designed to _pause_ — the
  subprocess is waiting on stdin for the tool result, pinning the Claude
  CLI subscription (and any per-host concurrency it enforces) for hours
  or days until the user replies.
- The worktree is locked open for the duration — concurrent work on the
  same project has to either wait or operate in parallel worktrees
  (which the pool already does, but a long pause on one worker still
  blocks its dependants).
- A brain restart is catastrophic: the subprocess is dead, the tool
  reply that would have unblocked it is gone, and there's no way to
  "resume" the same subprocess. We'd have to re-spawn the agent, which
  means re-paying its token cost to arrive back at the same point.
- The subprocess' context window keeps growing while it waits —
  eventually hitting the model's context limit from the waiting stderr
  banner chatter alone.

Shape 2 sacrifices in-tool granularity for three wins:

- **Checkpointing maps to how factory already thinks.** Phase boundaries
  are already the unit where findings/plan.json/BUILD.md get persisted.
  Pausing between phases doesn't need any new durability primitive.
- **Restart is free.** `askUser` is idempotent over
  `(directiveId, question, taskId?)` — re-entering the same phase after
  a brain restart finds the open or answered question row and keeps
  going. No rehydrated-subprocess dance, no wasted tokens.
- **Worktrees stay free.** A worker that finishes its task releases its
  worktree immediately; the pause happens at the brain level, outside
  any subprocess.

## Decision

**Shape 2.** Ship `askUser` and `escalateBlocked` as brain-level helpers
in `@factory5/brain/ask-user.ts`. They own:

- row creation in `pending_questions` (keyed by a stable
  `(directiveId, question, taskId?)` tuple so restart replays find the
  open row instead of double-asking);
- outbound enqueue addressed to `directive.source` /
  `directive.channelRef` so the user sees the question in whatever
  channel spawned the directive;
- polling `pending_questions.getById` at 1 Hz (configurable) until
  `answered_at` is set, the deadline passes, or an `AbortSignal` fires.

Integration points in Phase 4:

- **Autonomous mode** — `loop.ts` calls `escalateBlocked` after the pool
  returns with failures (or a failed verify gate). Matches ADR 0005's
  "no silent looping" guarantee.
- **Assisted / chat modes** — deferred to a follow-up iteration. The
  helper is mode-agnostic, so adding checkpoints at phase boundaries is
  a one-line edit per boundary once the UX of "what prompt do we show?"
  is decided for each phase.

Worker-subprocess suspension (shape 1) is **explicitly out of scope** for
Phase 4. When a `builder` or `fixer` agent needs to ask a clarifying
question today, it either (a) guesses and we live with the consequences,
(b) raises a finding (`FINDING [HIGH] <target>: <question>`) that the
reviewer + fixer loop handles the same way they handle bugs, or (c) the
brain (in a later iteration) surfaces the task's early exit as a trigger
for `escalateBlocked` at the end of the pool.

## Consequences

**Positive:**

- Zero new persistence layer; `pending_questions` table already exists.
- Idempotent rehydration on brain restart without bookkeeping on the
  caller side.
- The primitive works identically across all channels — Discord,
  Telegram, CLI, web all just round-trip an inbound message.
- `factory answer <id> <text>` is the generic CLI answer path —
  uniform across all channels.

**Negative:**

- Mid-tool clarification is impossible. A `builder` that realises after
  three turns it needs a design decision has to either ship its best
  guess or error-out and let the pool surface it. This is a UX
  downgrade vs an ideal world where agents can ask at any step.
  Mitigated by: (a) the reviewer role already catches most
  design-discrepancy issues at gate time, (b) findings are a
  lightweight way for an agent to flag something without blocking,
  (c) Phase 5+ can layer shape 1 for specific agents if the pain is
  real.
- Assisted-mode checkpoints still need to land. The helper is ready;
  the integration is deferred because it changes default behaviour
  for anyone on `--autonomy assisted` and deserves its own UX pass.

**Reversible?** Yes. The helper's API is stable; a future
`askUserInWorker(task, question)` that intercepts the stream-json tool
call can publish the same question row + poll the same answer — it'd
live alongside, not replace, the brain-level primitive.

## Alternatives considered

- **Shape 1 (subprocess suspension).** Rejected for Phase 4 per the
  cost analysis above. Revisitable in Phase 5+ if users report real
  pain from the mid-tool gap.
- **Third-party orchestration library (e.g. Temporal, Inngest).**
  Rejected — adds a platform dependency for something we already have
  a SQL table for.
- **Side-channel human-in-the-loop API (HTTP endpoint that blocks a
  single provider call).** Rejected — duplicates state we'd have to
  track anyway, and disappears on brain restart.
