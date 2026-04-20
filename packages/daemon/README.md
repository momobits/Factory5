# @factory5/daemon

Daemon assembly. Wires together:

- pidfile (one daemon per host — `%LOCALAPPDATA%\factory5\factoryd.pid` on
  Windows, `~/.factory5/factoryd.pid` elsewhere; overridable via
  `FACTORY5_PIDFILE`)
- `@factory5/state` (SQLite — the durable bus for directives, outbound
  messages, events, tasks_inflight)
- `@factory5/ipc` server (Fastify on `127.0.0.1:25295` — Phase 3 step 2)
- brain supervisor (runs `runBrain({ mode: 'serve' })` with exponential
  backoff on crashes — Phase 3 step 3)
- `@factory5/channels` (CLI-RPC, eventually Discord — Phase 3 step 4)
- `@factory5/events` (filesystem watcher, eventually GitHub poll — Phase 3
  step 5)

Consumed by `apps/factoryd` (the binary entry point).

## Startup reconcile

After migrations run and before any subsystem touches the directives
table, `startDaemon` calls `reconcileOrphanedDirectives` from
`@factory5/state`. It sweeps `running` directives whose owning PID is
gone and whose last activity (model_usage row, falling back to
`created_at`) is older than 10 min, flipping them to `blocked` with a
reason. The pidfile lock above the sweep guarantees no other factoryd
is alive, so dead `serve-<pid>` rows are unambiguously orphaned; the
activity floor keeps concurrent `factory build --inline` runs safe.
Disable with `noReconcile: true` in tests that seed their own DB state.

## Lifecycle

```ts
import { startDaemon, stopDaemon } from '@factory5/daemon';

const handle = await startDaemon({ port: 25295, host: '127.0.0.1' });
// ... handles inbound/outbound, polls events, serves /status etc.
await stopDaemon(handle); // graceful — flushes outbound queue, closes channels
```

## Surface

- `startDaemon(opts?)` — returns a `DaemonHandle { port, pid, startedAt, stop }`.
  Throws `PidFileLockedError` if a live daemon already owns the pidfile.
- `stopDaemon(handle)` — symmetric convenience for `handle.stop()`.
- `Doorbell` — typed in-process emitter used by subsystems to signal
  "directive arrived", "outbound ready", "config reloaded".
- `createSupervisor({ name, start, ... })` — wraps a long-running task with
  exponential-backoff crash-loop protection.
- `acquirePidFile(path?)` / `PidFileLockedError` / `readPidFile(path?)` — for
  `factory daemon status` and tests.

## Status

Step 1 landed: pidfile + lifecycle + doorbell + supervisor. Step 2 adds the
IPC server; step 3 wires the brain supervisor; step 4 the CLI-RPC channel;
step 5 the fs-watcher event source.
