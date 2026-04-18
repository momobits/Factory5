# 0013 — Doorbell via in-process `EventEmitter` plus 250 ms polling fallback

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

The brain's serve loop needs to know when a new directive has arrived on
the SQLite bus. Three options stand out:

1. **Pure polling.** `SELECT * FROM directives WHERE status = 'pending'`
   on a fixed interval.
2. **SQLite triggers + `sqlite3_update_hook`.** Register C-level hooks
   that fire when `directives` is inserted.
3. **Application-level doorbell.** An in-process signal (EventEmitter,
   Deno/browser `BroadcastChannel`, etc.) that the IPC handler rings
   when it receives `/directives/notify`, plus a fallback poll for
   inserts that bypass the IPC (e.g., the CLI writes directly to
   SQLite).

Pure polling is simplest but trades 250 ms of wall-clock latency for
every directive. `update_hook` is 3-4× more complicated and couples the
brain to the DB lifecycle; also hooks fire _per row_ which is noisy
relative to the granularity we need ("some pending directive exists").

## Decision

**A typed in-process `EventEmitter`** owned by the daemon (class
`Doorbell` in `@factory5/daemon`), plus the same 250 ms polling
fallback. Contract:

- Events: `directive.new`, `outbound.new`, `config.reloaded`. The brain
  subscribes only to `directive.new`.
- IPC `/directives/notify` rings `directive.new` after validating the
  request. `factory build` (daemon-mode) and `factory chat` both call
  `notifyDirective` after inserting their directives.
- The brain's serve loop races: `Promise.race([doorbellRang$, poll250ms,
abortSignal])`. Whichever wins, the loop re-checks the claim queue.

**Polling is never removed.** The CLI can insert a directive and
"forget to ring" (e.g. the IPC endpoint was temporarily unreachable
during a daemon restart). Polling guarantees forward progress under
any failure of the doorbell — the cost is at most 250 ms of latency.

**Why 250 ms.** A 250 ms delay is imperceptible for interactive chat
but bounded enough to satisfy the worst case ("doorbell lost during a
daemon reload"). Any longer and chat feels laggy; any shorter and the
polling cost is measurable on a quiet daemon.

## Consequences

**Positive:**

- Zero latency for in-process flow: IPC handler → emitter → brain wake
  is microseconds.
- Polling fallback keeps correctness under partial failures of the
  emit path (daemon restart racing CLI insert; tests bypassing IPC;
  future multi-process brains).
- The `Doorbell` surface is small and typed — brain doesn't see the
  daemon's class, only an `onWake` hook-registration callback.

**Negative:**

- Polling still runs on a busy daemon, even though the doorbell fires.
  At 250 ms × an always-polling `SELECT` = ~14k extra queries per
  hour. Better-sqlite3 handles those in well under 1 ms each; the
  CPU cost is negligible.
- The `EventEmitter` is in-process. When Phase 5 moves the brain out
  of `factoryd` (per ADR 0012's reversibility clause), the doorbell
  must either become an HTTP webhook (a brain can register on daemon
  startup) or be replaced by a shared SQLite trigger. Flagged for
  then, not now.

**Reversible?** Yes. The brain's serve loop takes the doorbell as an
`onWake` hook — any implementation that can invoke a callback on new
work satisfies the contract.

## Alternatives considered

- **Polling only.** Rejected: 250 ms per-directive latency on what's
  supposed to be a snappy chat is a measurable UX degradation for
  zero implementation win (we still need the IPC endpoint to exist
  for the Phase 4+ channel integrations).
- **SQLite `update_hook`.** Rejected — tight coupling to DB lifecycle,
  hooks fire on every row change across every table (we'd filter in
  JS), and the pattern doesn't generalise to `outbound.new` /
  `config.reloaded` which aren't per-row signals.
- **Shared filesystem watch on `factory.db`.** Rejected — modifications
  via WAL don't reliably touch the main DB file; inotify/FSEvents
  would see no change events.
