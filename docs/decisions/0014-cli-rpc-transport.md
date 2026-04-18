# 0014 — CLI-RPC transport: HTTP + SQLite polling, not SSE (yet)

- **Status:** Accepted
- **Date:** 2026-04-18

## Context

`factory chat` and daemon-mode `factory build` both need two-way
communication between the CLI and `factoryd`:

- **Inbound** (CLI → daemon): user types a line; daemon's brain should
  see it.
- **Outbound** (daemon → CLI): brain produces a reply; CLI should
  render it.

Options considered for the transport:

1. **HTTP POST for inbound, SSE (Server-Sent Events) stream for
   outbound.** CLI opens a long-lived GET to the daemon, daemon writes
   event chunks when the brain produces them.
2. **HTTP POST for inbound, WebSocket for outbound.** Full-duplex,
   but WS brings a larger surface (ping/pong, binary frames) than we
   need.
3. **HTTP POST for inbound, SQLite polling for outbound.** CLI writes
   the inbound directive directly to SQLite (same row the daemon
   inserts via IPC) and polls `outbound_messages` for messages
   addressed to its session.

The architecture snapshot explicitly names `cli-rpc` as a
`ChannelPlugin`, which nudges toward SSE. But the CLI is _always on
the same host_ as the daemon and _always has DB access_ (the same
`factory.db` path), which makes SQLite polling uniquely cheap compared
to the Discord/Telegram case.

## Decision

**HTTP POST for inbound, SQLite polling for outbound, with a
pluggable-listener hook on the CLI-RPC channel plugin for future SSE.**

Concretely for Phase 3:

- `factory chat`:
  - generates a session id (`chat-<ulid>`)
  - writes a directive with `source='cli'` and `channelRef=<sessionId>`
    directly to SQLite
  - calls `POST /directives/notify` so the daemon's brain claims it
    without waiting for the next poll
  - polls `outbound_messages WHERE targetChannel='cli' AND
targetRef=<sessionId> AND delivered_at IS NULL` every 250 ms
  - marks each delivered row it reads
- `factory build` (daemon mode):
  - writes the directive to SQLite, calls `/directives/notify`, polls
    the directive's `status` column until terminal. No outbound
    stream needed — the CLI prints a final summary after seeing
    `complete` / `failed` / `blocked`.
- **CLI-RPC `ChannelPlugin`** lives in `@factory5/channels/cli-rpc`:
  - Registers as `id: 'cli'` so `/status` reports it.
  - `send(msg)` looks up `msg.targetRef` in an in-memory
    `Map<sessionRef, listener>`; invokes the listener if present.
  - When no listener is registered, returns `delivered: false` so
    the outbound row stays in SQLite for the CLI's poller to pick up.
  - Exposes `registerSession(sessionRef, listener)` for a future SSE
    endpoint (or a Phase 5 out-of-process CLI bridge) to wire live
    delivery without touching this decision.

## Consequences

**Positive:**

- No new transport to maintain in Phase 3. HTTP + SQLite is already
  paid for.
- The CLI can reconnect, die, or start up late without losing
  outbound messages — they persist in SQLite until delivered.
- `factory chat` is resilient to daemon restarts: the CLI keeps
  polling SQLite; on next daemon start, messages flow again without
  reconnection logic.
- The `ChannelPlugin` contract stays stable; SSE layer slots in by
  calling `registerSession` from a Fastify SSE route.

**Negative:**

- 250 ms of latency per outbound message in the common case (no live
  listener registered). Fine for Phase 3 chat, not for a live typing
  UI.
- Two sources of truth for CLI chat liveness (HTTP `/healthz` for
  daemon, DB polling for session). The CLI handles this by checking
  the pidfile at startup and assuming SQLite polling thereafter.
- Cross-host is out of scope: CLI must have DB access. If we ever
  want `factory chat` from a different machine, we need the SSE
  layer (the ChannelPlugin is ready).

**Reversible?** Yes. Adding an SSE endpoint (`GET
/channels/cli/stream?sessionRef=<id>`) is additive. The CLI plugin's
`registerSession` is already the hook SSE would wire.

## Alternatives considered

- **SSE from the outset.** Rejected for Phase 3: another transport to
  version + test, and polling wasn't saving meaningful latency at
  these message sizes (< 1 KB).
- **WebSocket.** Rejected: oversized for unidirectional push-to-CLI.
- **Pure SQLite polling (skip the doorbell).** Rejected: 250 ms of
  startup latency for every chat message after the user presses
  Enter is visible even on localhost. The doorbell trims it to
  sub-10 ms.
