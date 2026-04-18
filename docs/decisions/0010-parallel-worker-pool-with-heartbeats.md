# 0010 — Parallel worker pool with heartbeats

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

Phase 1 ran plan tasks sequentially in a for-loop because getting the
pipeline end-to-end was the priority (ADR 0006). Phase 2 makes tool-using
tasks expensive (subprocess + worktree + streamed tool loop takes tens of
seconds to minutes), so running them serially when they don't depend on
each other wastes wall-clock time and money. The architecture snapshot
(`CompleteArchitecture.md` §2) calls this out explicitly: _"worktree-
isolated parallel workers"_ is a first-class goal.

Concurrency also raises two operational questions:

1. How do we know a running task hasn't hung? (stuck workers need to be
   detectable so a supervisor can reap them.)
2. When the user Ctrl-Cs mid-build, how do already-started tasks behave?

## Decision

**New module `@factory5/brain/pool.ts`** replaces `runPlanTasks`'s for-loop
with a dependency-aware executor:

- **Topological sort.** `topoSortTasks(tasks)` (exported) walks
  `dependsOn` edges and throws on cycles — cycles are a plan bug, not a
  runtime condition to recover from.
- **Ready queue.** On each iteration: mark any task whose dependency
  failed as `exitCode 2` blocked; find the first pending task whose deps
  are all resolved; schedule up to `concurrency` at once.
- **Concurrency ceiling.** Default `min(4, os.cpus().length)` via
  `defaultConcurrency()`. Overridable per `runBrain({ concurrency: n })`
  call; `factory build --concurrency <n>` surfaces the knob to the CLI.
- **Heartbeats.** On launch, each task writes a row into
  `tasks_inflight` (pre-existing table) with `started_at` and
  `last_heartbeat`. A `setInterval` refreshes `last_heartbeat` every 10
  seconds while `runWorker` runs. On completion the row's `status` /
  `result_json` is updated via `markComplete` or `markFailed`. Phase 3's
  daemon can read these to reap stuck workers without coordinating with
  the brain process.
- **AbortSignal.** If the signal fires while tasks are running we stop
  launching new ones but let in-flight tasks settle. Remaining pending
  tasks get `exitCode 2` with `error = 'aborted before start'`. This
  preserves the invariant that `tasks_inflight` rows always reach a
  terminal status.
- **Deadlock guard.** If the pool drains to zero running tasks with
  pending tasks still unreadied, it logs at `error` and marks them
  failed. This can only happen if topo-sort left a bug; treating it as
  deadlock is the loud-failure default.
- **Plan persistence.** After all tasks settle, the pool writes an
  updated `plan.json` via `writePlan` with each task's new `status`,
  `attempts`, and `result` (including `worktreePath` for tool-using
  tasks). Resume flows rely on this to skip already-complete tasks.

**Ordering of output.** `runPlanPool` returns one `TaskOutcome` per task
in the plan's original order (not dispatch order) so consumer code
— especially the CLI summary — is deterministic.

## Consequences

**Positive:**

- Independent tasks run concurrently; a 6-task plan with 3 independent
  builders completes in ~1/3 the wall-clock of the Phase 1 serial
  execution on a 4-core machine.
- Heartbeats + terminal status on `tasks_inflight` give Phase 3's daemon
  everything it needs to reap stuck processes without inventing a new
  bus or RPC surface.
- `--concurrency` provides an operator escape hatch: set to 1 for
  repeatable debugging runs; set to 2 on a laptop to keep the system
  responsive during big builds.
- Upstream-failure short-circuiting (downstream tasks fail fast with
  `exitCode 2`) avoids paying for inevitably-broken tasks.

**Negative:**

- Concurrent tasks share the project's `plan.json` file (via `writePlan`
  only at the end) and the `model_usage` SQLite table (via `recordUsage`
  on each task's finish). better-sqlite3's serialised writes make this
  safe; still worth noting for anyone adding per-task persistence later.
- Merges back into `main` are serialised inside `cleanupWorktree`
  (ADR 0008); the parallelism is in the tool-use subprocess and the
  assessor, not in the final commit sequence. That's acceptable — merges
  are microseconds, not the bottleneck.
- A task that hangs its provider call (ignoring the abort signal) will
  hold a heartbeat slot until its `streamTimeoutMs` elapses. The pool
  doesn't force-kill by itself; that's the provider's job.

**Reversible?** Yes. `runPlanTasks` in `loop.ts` is a one-line delegation
to `runPlanPool`; swapping it for a serial for-loop (or a different
scheduling policy) is a local change.

## Alternatives considered

- **Library-provided pool (`p-limit`, `tiny-async-pool`).** Rejected as
  a dep: we have a dependency-aware DAG, not a simple batch; we'd wrap
  the library anyway.
- **One global mutex + for-each-ready loop.** Rejected: that's
  effectively `concurrency = 1`, which is what Phase 1 already did.
- **Let the user pick concurrency per task.** Rejected as premature: the
  `--concurrency` global knob is enough, and the planner doesn't yet
  have data to make informed per-task decisions.
- **Heartbeat via IPC to factoryd.** Rejected for Phase 2: no daemon
  exists yet. Heartbeating to the same SQLite the daemon will eventually
  read is the same contract, minus one moving part.
