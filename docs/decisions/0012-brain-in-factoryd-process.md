# 0012 — Brain hosted inside `factoryd` via a supervised serve loop

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

Phase 3 promotes the brain's serve mode from a stub to a real long-running
claim loop. Two architectural options for _where_ that loop runs:

1. **Inside `factoryd`.** `factoryd` constructs the brain with
   `runBrain({ mode: 'serve' })` and keeps it alive under a crash-loop
   supervisor.
2. **In a separate `factory serve` process.** `factoryd` hosts only the
   IPC server + channels + event sources. A sibling `factory` process
   long-runs the brain, claiming directives out of the shared SQLite.

Option (2) has stronger fault isolation: a brain crash (bad provider
response, native-bindings blowup) can't take Discord/GitHub polling with
it. Option (1) is simpler: one process, one log stream, a single doorbell
path via an in-process `EventEmitter`.

The factory5 architecture snapshot (`CompleteArchitecture.md` §3) says
_"brain restarts during dev shouldn't kill Discord connections"_ — that's
a two-process argument. But the same snapshot also says the brain can
serve directives from the daemon's bus, which fits either model.

## Decision

**Host the brain inside `factoryd`** for Phase 3. The brain's `runBrain`
is invoked from `@factory5/daemon/brain-supervisor.ts`, wrapped in the
generic `createSupervisor` helper. When the brain throws, the supervisor
logs, backs off exponentially (500 ms → 30 s, capped at 10 consecutive
crashes), and restarts.

The brain's doorbell hook (`onWake`) is wired to the daemon's in-process
`Doorbell` emitter. IPC `/directives/notify` rings the doorbell; the
brain wakes within milliseconds instead of the 250 ms polling interval.

To preserve the fault-isolation story we'd otherwise lose:

- The supervisor **restarts on exception only**. A clean serve-loop
  exit (which happens on graceful daemon shutdown) is treated as "done,
  don't restart."
- Channels + event sources run independently of the brain. A brain
  crash does not tear down Discord / fs-watcher / IPC — the daemon's
  subsystems are siblings, not a chain.
- The brain's SQLite handle comes from the daemon, so a brain restart
  does not reopen the DB — avoids pragma re-application and the
  transient `WAL` setup cost.

## Consequences

**Positive:**

- Simpler operator story: one pidfile, one log file, one `/status`.
- Latency: doorbell is a synchronous event dispatch, not an HTTP round
  trip. An inbound CLI directive is visible to the claim loop within
  microseconds of the IPC handler's call.
- Resource footprint: one Node VM, one SQLite connection pool.

**Negative:**

- A pathological brain crash (e.g. native assertion inside
  `better-sqlite3`) could still take `factoryd` down. The supervisor
  catches JavaScript exceptions but not segfaults.
- Memory pressure: the brain's worktree spawning + streaming adds
  live memory to `factoryd`'s RSS; on a resource-constrained host this
  could matter. Mitigated by the existing per-task subprocess model
  — workers run in child processes.

**Reversible?** Yes. `@factory5/brain`'s serve loop is already a
standalone export; extracting it to a `factory serve` process is a
matter of replacing `startBrainSupervisor` with a `spawn(process.execPath,
['factory', 'serve', ...])` call. The wire contract (SQLite bus +
doorbell HTTP call) stays identical.

## Alternatives considered

- **Separate `factory serve` process (option 2 above).** Rejected for
  Phase 3: strong fault isolation buys us less than it costs in
  operational complexity (two pidfiles, double the startup
  orchestration, cross-process doorbell that has to survive one side
  restarting). Phase 5+ might revisit if brain instability becomes a
  real problem.
- **Brain runs per-directive as a child process.** Rejected: the
  serve loop is a single long-running state machine, not a fan-out of
  short jobs. Spawning a fresh Node + TS module graph per directive
  would cost seconds per directive for zero isolation gain beyond
  what the existing worker-subprocess model already provides.
