# 0011 — Single-daemon-instance coordination via pidfile

- **Status:** Accepted
- **Date:** 2026-04-18

> **Path note (ADR 0023):** The `~/.factory5/factoryd.pid` and `%LOCALAPPDATA%\factory5\factoryd.pid` paths below predate [ADR 0023](0023-repo-local-instance-and-cwd-walk.md), which moved factory's runtime state to the active instance's `.factory/` directory (home fallback `~/.factory/`). Read those paths as `<dataDir>/factoryd.pid`.

## Context

Phase 3 turns `factoryd` into a real long-running daemon. That raises the
coordination question that every daemon has to answer: _how do we guarantee
only one daemon is alive on a host at a time?_ If two `factoryd`s race for
the same `factory.db`, the winner is undefined — we'd see split-brain claim
behaviour, duplicated brain supervisors, and both processes fighting over
the same IPC port.

Three viable mechanisms were on the table:

- **Pidfile.** A file under the factory5 data dir containing the daemon's
  PID. Startup refuses if the file exists and its owner is alive.
- **File lock (flock/fs-ext).** Same file, held via `flock`/`LOCK_EX`. Lock
  released automatically by the OS when the process dies.
- **Port-in-use detection.** Try to `listen` on `127.0.0.1:25295`; if the
  port is busy, assume another daemon owns it.

Port-in-use is fragile: some platforms allow `SO_REUSEADDR` to succeed, and
the port tells us nothing about a crashed daemon that left a stale socket.
File-locks via `flock`/`fs-ext` don't ship with Node's stdlib — we'd need
a native dep, and the cross-platform story (Linux `flock`, macOS `flock`,
Windows `LockFileEx`) is non-trivial for something this small.

## Decision

**A pidfile at `<dataDir>/factoryd.pid`** (overridable via `FACTORY5_PIDFILE`)
is the lone coordination mechanism. `@factory5/daemon/pidfile.ts` owns
acquire/release with the following protocol:

1. If the file does not exist, write our PID with `O_EXCL` (Node's
   `{ flag: 'wx' }`). On the rare race where two daemons reach the `wx`
   open in the same tick, the loser retries the whole sequence and
   reaches step 2.
2. If the file exists, read the PID. Liveness-check via
   `process.kill(pid, 0)` (portable on Node — throws `ESRCH` if the
   process is gone, `EPERM` if it exists but we can't signal it).
3. If the owner is alive, throw `PidFileLockedError` so `factoryd`
   exits 2 with a clear message.
4. If the owner is dead, treat the file as stale: unlink, retry the
   `wx` open.

**Release unlinks only when the file still contains our PID.** A daemon
that got restart-looped by a supervisor shouldn't blow away its successor's
pidfile during its own teardown.

`readPidFile()` is exported so `factory daemon status` and the e2e test
can probe without acquiring.

## Consequences

**Positive:**

- No native dep, no platform-specific code paths. Works identically on
  Windows (`%LOCALAPPDATA%\factory5\factoryd.pid`) and Unix
  (`~/.factory5/factoryd.pid`).
- Stale pidfiles auto-reap; a crashed daemon doesn't block the next
  start.
- `factory daemon status` can tell the user "the pidfile is there but
  the owner is dead" — actionable diagnostic.
- The pidfile doubles as the target for `factory daemon stop`, which
  sends SIGTERM to the recorded PID.

**Negative:**

- On Windows, a hard crash that leaves the pidfile in place plus a
  coincidentally-recycled PID (~1 in 65k odds) would be misdiagnosed as
  "daemon alive" and refuse to start. The mitigation is manual: delete
  the pidfile. Not worth engineering around at this scale.
- A file lock would release automatically on process death; pidfiles
  require the explicit liveness check. The code complexity is roughly
  equivalent.

**Reversible?** Yes. The acquire/release contract is narrow; swapping
in a flock-based implementation later is a local change inside
`pidfile.ts`.

## Alternatives considered

- **File lock (`flock`/`fs-ext`).** Rejected for Phase 3: adds a native
  dep, and the PID-in-pidfile gives us extra diagnostic value the lock
  does not (we can print the owner PID on refusal).
- **Port-in-use detection only.** Rejected — doesn't diagnose stale
  state; can false-positive on platforms with `SO_REUSEADDR`.
- **Systemd / Windows Service enforcement.** Rejected for Phase 3: we
  want the daemon to work without system-level integration. A future
  `factory daemon install` can layer service-manager coordination on
  top of the pidfile without changing the core contract.
