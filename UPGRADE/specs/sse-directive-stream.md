# SSE — `/api/v1/directives/:id/stream`

> **Status:** spec, draft 1 (Phase 3 / Step 3.1)
> **Owner:** factory5 team
> **Slot in tier-3 plan:** [`../plans/tier-3-web-ui-live-and-complete.md`](../plans/tier-3-web-ui-live-and-complete.md) §3.1
> **Promotion target:** ADR 0029 once the protocol is observed in live use across both backend wiring and the FE consumer (3.2).

## Goal

A per-directive event stream that the web UI subscribes to for live task /
finding / spend / log updates, replacing the existing one-shot
`GET /api/v1/directives/:id` + polling pattern. Driven by Server-Sent Events
(SSE) over Fastify's `reply.raw` pump.

Why SSE (not WebSocket): one-way (server→browser), HTTP-shaped, automatic
reconnect via `EventSource`, no separate transport. The data direction
matches the use case — operator submits via existing JSON `POST /api/v1/*`
routes; everything that flows the other way is observation.

## Endpoint

```
GET /api/v1/directives/:id/stream?t=<FACTORY5_UI_TOKEN>
```

- **Auth.** Same `FACTORY5_UI_TOKEN` bearer as every other `/api/v1/*` route.
  The browser's `EventSource` cannot set custom headers, so the token is
  passed via the `?t=` query param. The handler accepts EITHER
  `Authorization: Bearer <token>` OR `?t=<token>` (`fetch`-driven clients
  can still use the header form). Both are constant-time-compared against
  `uiAuthToken`. Token-in-URL is acceptable here under the same loopback
  threat model that ADR 0025 §2 applies to the rest of `/api/v1/*` —
  the daemon binds 127.0.0.1 and the URL never leaves the operator's
  machine. The SPA strips the token from `history.replaceState` after
  the initial load so it doesn't appear in browser history.

- **Response.**
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache, no-transform`
  - `Connection: keep-alive`
  - `X-Accel-Buffering: no` (disables nginx-style proxy buffering when
    proxies are added later)
  - HTTP/1.1 chunked transfer

- **Errors before stream starts.**
  - `401 UI_AUTH_REQUIRED` — missing / wrong token
  - `503 UI_DISABLED` — daemon has no UI auth token configured
  - `404 DIRECTIVE_NOT_FOUND` — `:id` does not match any directive row
  - All bodies follow the existing `ipcErrorSchema` envelope.

## Event types

Six event types, each NDJSON-encoded into the SSE `data:` line per the
SSE spec (`event:` + `data:` + blank line). Payloads validated against
Zod schemas in `@factory5/ipc` so producer / consumer drift surfaces
at request time.

### `task.started`

```
event: task.started
data: {"taskId":"01K…","directiveId":"01K…","title":"…","agent":"builder","category":"reasoning","startedAt":"2026-…"}
```

Emitted when `tasksInflight.register(...)` writes a new row in
`packages/brain/src/pool.ts`. One event per task, regardless of how
many tasks are running concurrently.

### `task.completed`

```
event: task.completed
data: {"taskId":"01K…","directiveId":"01K…","status":"complete","exitCode":0,"finishedAt":"2026-…","error":null}
```

`status` is the terminal task status: `complete`, `failed`, or `aborted`.
`error` is the worker outcome's error string when failed (`null` on
success). Emitted alongside `tasksInflight.markComplete` /
`tasksInflight.markFailed` calls.

### `finding.created`

```
event: finding.created
data: {"findingId":"…","directiveId":"01K…","severity":"HIGH","status":"OPEN","source":"…","target":"…","description":"…","advisory":false}
```

Emitted once per finding raised by the worker, after `mirrorToRegistry`
writes it to `findings_registry`. The `directiveId` field is the
_origin_ directive — the finding may be re-raised by future runs but the
event carries its first-observed directive.

In Step 3.1 the brain emission for `finding.created` is deferred — the
infrastructure carries the event type but no emission point is wired
yet (findings registration crosses the wiki↔brain boundary and tighter
threading lands with 3.2's FE wiring). Until then, the FE refreshes
findings on each `task.completed` via the existing
`GET /api/v1/findings` route.

### `spend.updated`

```
event: spend.updated
data: {"directiveId":"01K…","totalCostUsd":1.234,"callCount":7,"deltaUsd":0.012}
```

Emitted after every `recordUsage(...)` call in `packages/brain/src/pool.ts`.
`totalCostUsd` and `callCount` are the freshly-recomputed rollups
(via `modelUsage.totalCostForDirective` / `countForDirective`); `deltaUsd`
is the cost of the call that triggered the emit.

### `log.line`

```
event: log.line
data: {"ts":"2026-…","level":"info","component":"brain.loop","msg":"…","attrs":{...}}
```

Selective forward of pino log lines tagged with the directive's
`correlationId`. In Step 3.1 the emission is deferred — the
infrastructure carries the event type but no log forwarder is
wired yet. Tests cover the route's ability to deliver this event
shape via simulated emit.

### `directive.completed`

```
event: directive.completed
data: {"directiveId":"01K…","status":"complete","blockedReason":null}
```

`status` is the terminal directive status (`complete`, `failed`, or
`blocked` — see `DIRECTIVE_STATUSES` in `@factory5/core`). `blockedReason`
mirrors `directives.blocked_reason` and is non-null for `blocked` outcomes
or for `failed` outcomes produced by `factory cancel` (Phase 2.4 stamps
`blocked_reason='cancelled'`).

The handler closes the response stream on this event (after a brief
flush window) — the client's `EventSource` will see `readyState=CLOSED`
and stop reconnecting.

## Heartbeats

Every 15 seconds of stream idle (no event sent), the handler writes a
single comment line:

```
:keepalive

```

SSE comment lines start with `:` and have no `event:` / `data:` —
intermediaries forward them but `EventSource` discards them silently.
Their job is to keep proxies / NAT timeouts from killing the long-lived
connection.

## Backfill on connect

A client subscribing mid-build needs the in-progress state, not just
events from the moment of connection forward. On every connect, the
handler synthesizes a backfill burst before switching to live:

1. `task.started` for each row in `tasksInflight.listByDirective(db, id)`
   whose status is `running`. Tasks already in a terminal state get a
   single `task.completed` event each (skipping the `task.started`).
2. A single `spend.updated` carrying the current
   `totalCostForDirective` + `countForDirective` rollup with `deltaUsd: 0`
   (the FE renders this as the "starting" value).
3. If the directive's row in `directives` is already terminal
   (`complete`, `failed`, or `blocked`), a single `directive.completed`
   and stream close.

Findings backfill is **deferred** — fresh subscribers see findings via
the existing `GET /api/v1/findings` route on initial page load and
receive `finding.created` events live for anything raised after.

This makes a connect-after-build idempotent: the operator sees the same
final state as someone who watched live.

## Subscription map

The daemon owns a single `DirectiveStreamHub` instance. The hub's shape:

```ts
interface DirectiveStreamHub {
  /** Add a listener for a specific directive's events. Returns an
   *  unsubscribe function. */
  subscribe(directiveId: string, listener: (event: DirectiveStreamEvent) => void): () => void;

  /** Push an event into the hub. Listeners for that directiveId fire
   *  synchronously. */
  emit(event: DirectiveStreamEvent): void;

  /** Drop every listener for a directive. Called by the SSE handler
   *  after a `directive.completed` is forwarded so listeners don't
   *  accumulate when the hub is long-lived. */
  closeDirective(directiveId: string): void;

  /** Drop every listener for every directive — called during daemon
   *  shutdown so the Fastify close path doesn't hang on residual
   *  EventEmitter strong references. */
  shutdown(): void;
}
```

One emit dispatches synchronously to every active subscriber for that
directive — typically one (the dashboard tab) but the map accepts
multiple (a second tab, or a CLI `curl -N`).

## Cleanup on client disconnect

The handler subscribes a per-request listener that pushes to
`reply.raw.write(...)`. On `request.raw.on('close', ...)` (browser tab
closed, network drop, server graceful shutdown), the handler calls the
unsubscribe function returned by `hub.subscribe(...)` and clears the
heartbeat interval.

This ensures the hub's listener count returns to zero after every
disconnected client, so a long-running daemon doesn't leak listener
references over the course of many builds.

## Brain emission

Brain has no compile-time dependency on `@factory5/daemon` — the wiring
is via an optional callback in `BrainOptions`:

```ts
interface BrainOptions {
  // ...existing fields...
  emitDirectiveEvent?: (event: DirectiveStreamEvent) => void;
}
```

When `runBrain` is invoked from the daemon's brain-supervisor, the
supervisor constructs the callback to call `hub.emit(event)`. When
`runBrain` is invoked inline (e.g. `factory build` without a daemon),
the callback is undefined and emit calls are silently no-op — the
inline-build operator is reading log output, not a dashboard.

In Step 3.1, the brain wires four emission points:

| Site                                          | Event                 |
| --------------------------------------------- | --------------------- |
| `pool.ts` after `tasksInflight.register`      | `task.started`        |
| `pool.ts` after `markComplete` / `markFailed` | `task.completed`      |
| `pool.ts` after `recordUsage`                 | `spend.updated`       |
| `loop.ts` after terminal status set           | `directive.completed` |

`finding.created` and `log.line` emission are deferred to a follow-up
sub-step. The route, schemas, and tests cover all six event types.

## Lifetime / GC story

- Hub has no implicit per-directive eviction. The SSE handler calls
  `closeDirective(id)` after forwarding `directive.completed` to its
  client; if no client is connected, `closeDirective` runs from the
  brain's supervisor at terminal-status transition (covering the no-
  consumer path so listener bookkeeping stays accurate even when
  nobody subscribed).
- Daemon shutdown calls `hub.shutdown()` from the existing
  `IpcServerHandle.stop()` cleanup path.

## Test surface (3.1 acceptance)

- `pnpm --filter @factory5/daemon test` covers:
  - 401 / 503 / 404 pre-stream errors
  - Header bearer + `?t=` query bearer both authenticate
  - Single live event flows from `hub.emit` to the client
  - `task.started` + `task.completed` + `spend.updated` + `directive.completed` round-trip
  - Heartbeat fires after 15 s idle
  - Stream closes after `directive.completed`
  - Client disconnect → unsubscribed (hub listener count returns to 0)
  - Backfill on connect: synthetic `task.*` + `spend.updated` events for
    a directive already running; immediate `directive.completed` + close
    for a directive already terminal

Tests use a real Fastify instance (via `inject()` won't work for SSE —
need a real bound socket) and a real `EventSource` client (or `fetch`
streamed body) so the test exercises the actual chunked transfer.

## Future work (out of scope for 3.1)

- `finding.created` brain emission (3.2 or follow-up sub-step).
- `log.line` forwarder — selective pino-stream tap that filters by
  `correlationId`.
- Findings backfill on connect (currently fetched via separate API).
- Promote spec to ADR 0029 once 3.2 ships and the FE consumer validates
  the wire shape.
