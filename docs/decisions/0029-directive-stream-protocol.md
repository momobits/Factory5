# 0029 — Directive-stream protocol: SSE for live build observation, six event types, brain-side optional-callback emission

- **Status:** Accepted
- **Date:** 2026-05-05
- **Builds on:** [ADR 0012](0012-brain-in-factoryd-process.md) — brain hosted inside `factoryd` via the supervisor; the SSE hub piggy-backs on the same in-process boundary. [ADR 0024](0024-worker-subprocess-ask-user.md) — `pending_questions` rows that the FE surfaces alongside live-stream tasks; the directive-stream renders them via the pre-existing `GET /api/v1/pending-questions` route on connect, not as a stream-side event type. [ADR 0025](0025-web-ui-architecture.md) — `FACTORY5_UI_TOKEN` bearer + `/api/v1/*` surface that this stream lives on; the SPA's loopback threat model carries forward here. [ADR 0027](0027-web-ui-mutation-surface.md) — the inverse direction (POST routes for build kickoff / question answer / budget set); together with this ADR, completes the FE↔daemon round-trip.

## Context

The pre-3.1 dashboard rendered directive state via `GET /api/v1/directives/:id` + a 1 Hz polling loop. That model worked for status checks but fell flat as the operator surface grew: tasks panel, log tail, spend pip, and findings panel all needed updates within seconds of brain-side events, and 1 Hz polling either lagged (every panel waits up to a second) or hammered the daemon (poll harder → more SQLite reads per second to surface a single tick of new state). Three forcing functions converge:

1. **Phase 3 charter** — the dashboard becomes the primary operator surface. Live observation is the table stakes; the polling pattern can't deliver that without reworking the round-trip cost.
2. **Phase 2 chat directives** — the chat surface (Phase 2 / 2.6 carry-forward, 3.5) needs token-by-token streaming of chat replies. A polling-based read pattern can't surface partial agent output; we'd need a streaming transport regardless of how the dashboard works.
3. **Phase 3.6 cancel button** — the operator needs to see the directive's status change within ~1 second of the cancel route returning, not on the next poll. The cancel acceptance smoke in 3.6 is a pinned proof-point that "see the state change live, not via F5" is now load-bearing.

The transport question reduces to SSE vs. WebSocket vs. polling-with-long-poll. **Why SSE wins for the data direction**: server→browser only, HTTP-shaped (passes through every proxy that passes through `/api/v1/*` without a separate transport story), automatic reconnect via `EventSource`, no separate auth/cookie story (same `FACTORY5_UI_TOKEN` bearer with the bearer-via-`?t=` accommodation that `EventSource` requires). Operator submissions go via existing JSON `POST /api/v1/*` routes (per ADR 0027); everything that flows the other way is observation.

Six decisions need pinning before downstream phases consume them — this ADR is the contract that 3.2's FE wiring, 3.5's chat-streaming, 3.6's cancel button, and 3.1b's `finding.created` emission all hold against. The full wire spec lives at [`UPGRADE/specs/sse-directive-stream.md`](../../UPGRADE/specs/sse-directive-stream.md); this ADR distills the decisions and pins the live-verification record.

## Decision

Six parts, one ADR. The SSE protocol composes as: a single `GET /api/v1/directives/:id/stream` route on the daemon, an in-process `DirectiveStreamHub` owned by the daemon, an optional brain-side callback that emits to the hub (no compile-time daemon dep on the brain), six event types covering the directive's full live-observable surface, heartbeats every 15 s, and a backfill burst on connect that makes connect-after-build idempotent.

### 1. Endpoint shape — `GET /api/v1/directives/:id/stream` with `?t=` token accommodation

```
GET /api/v1/directives/:id/stream?t=<FACTORY5_UI_TOKEN>
```

Same auth surface as every other `/api/v1/*` route per ADR 0025: `FACTORY5_UI_TOKEN` bearer, constant-time compare. The `EventSource` client cannot set custom headers, so the handler accepts EITHER `Authorization: Bearer <token>` OR `?t=<token>` — both valid per the loopback threat model that ADR 0025 §2 already pins (daemon binds 127.0.0.1, URL never leaves the operator's machine, SPA strips token from `history.replaceState` after the initial load).

Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`. HTTP/1.1 chunked transfer.

Pre-stream errors (before the `text/event-stream` body opens) follow the existing `ipcErrorSchema` envelope: `401 UI_AUTH_REQUIRED`, `503 UI_DISABLED`, `404 DIRECTIVE_NOT_FOUND`.

### 2. Six event types covering the full live-observable surface

| Event                 | Payload (Zod-validated in `@factory5/ipc`)                                                                                                  | Emission site                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `task.started`        | `{ taskId, directiveId, title, agent, category, startedAt }`                                                                                | `pool.ts` after `tasksInflight.register(...)`                                 |
| `task.completed`      | `{ taskId, directiveId, status, exitCode, finishedAt, error }`                                                                              | `pool.ts` after `tasksInflight.markComplete` / `markFailed`                   |
| `finding.created`     | `{ findingId, directiveId, severity, status, source, target, description, advisory }`                                                       | `pool.ts` after `task.completed`, via `listFindings(plan.projectPath)` (3.1b) |
| `spend.updated`       | `{ directiveId, totalCostUsd, callCount, deltaUsd }`                                                                                        | `pool.ts` after `recordUsage(...)`                                            |
| `log.line`            | `{ ts, level, component, msg, attrs }` (selective forward, filtered by `correlationId`)                                                     | Pino-stream tap (3.x; live in 3.1's route, brain forwarder deferred)          |
| `directive.completed` | `{ directiveId, status, blockedReason }` — terminal status (`complete` / `failed` / `blocked`); `blockedReason` non-null for cancel/blocked | `loop.ts` after terminal status set                                           |

The event-type set is **closed** for this protocol. New live signals get a new event type in a follow-up ADR rather than overloading existing payloads. `finding.created` carries the **origin** directive (the directive that first surfaced the finding); re-raises by future runs continue to reference the original directive.

Schemas are exported from `@factory5/ipc/sse` with a discriminated union (`DirectiveStreamEvent`) so producer / consumer drift surfaces at request time, not at deserialize time.

### 3. Heartbeats + backfill on connect

**Heartbeat.** Every 15 s of stream idle, the handler writes a single `:keepalive` SSE comment line. SSE comments (`:`-prefixed, no `event:` / `data:`) are forwarded by intermediaries but discarded by `EventSource` silently — their job is to keep proxies / NAT timeouts from killing the long-lived connection. Heartbeat interval is non-configurable; 15 s is the conservative low end of common proxy idle-kill thresholds (60 s being the usual default).

**Backfill on connect.** A client subscribing mid-build needs the in-progress state, not just events from the moment of connection forward. On every connect, the handler synthesises a backfill burst before switching to live:

1. `task.started` for each row in `tasksInflight.listByDirective(db, id)` whose status is `running`. Tasks already in a terminal state get a single `task.completed` event each (skipping the `task.started`).
2. A single `spend.updated` carrying the current `totalCostForDirective` + `countForDirective` rollup with `deltaUsd: 0` (the FE renders this as the "starting" value).
3. If the directive's row in `directives` is already terminal, a single `directive.completed` and stream close.

Findings backfill is **deferred** — fresh subscribers see findings via the existing `GET /api/v1/findings` route on initial page load and receive `finding.created` events live for anything raised after. This makes connect-after-build idempotent for the four backfilled types: the operator sees the same final state as someone who watched live.

### 4. Subscription map — single `DirectiveStreamHub` instance owned by the daemon

```ts
interface DirectiveStreamHub {
  subscribe(directiveId: string, listener: (event: DirectiveStreamEvent) => void): () => void;
  emit(event: DirectiveStreamEvent): void;
  closeDirective(directiveId: string): void;
  shutdown(): void;
}
```

One emit dispatches synchronously to every active subscriber for that directive — typically one (the dashboard tab) but the map accepts multiple (a second tab, a CLI `curl -N`, or both detail + chat consumers as 3.5 introduced). On `request.raw.on('close', ...)` (browser tab closed, network drop, server graceful shutdown), the per-request handler calls the unsubscribe function and clears the heartbeat interval — listener count returns to zero after every disconnected client.

The hub has no implicit per-directive eviction. The SSE handler calls `closeDirective(id)` after forwarding `directive.completed` to its client; if no client is connected, `closeDirective` runs from the brain's supervisor at terminal-status transition (covering the no-consumer path so listener bookkeeping stays accurate even when nobody subscribed). Daemon shutdown calls `hub.shutdown()` from the existing `IpcServerHandle.stop()` cleanup path.

### 5. Brain emission — optional callback in `BrainOptions`, no compile-time daemon dep

```ts
interface BrainOptions {
  // ...existing fields...
  emitDirectiveEvent?: (event: DirectiveStreamEvent) => void;
}
```

When `runBrain` is invoked from the daemon's brain-supervisor, the supervisor constructs the callback to call `hub.emit(event)`. When `runBrain` is invoked inline (e.g., `factory build` without a daemon), the callback is undefined and emit calls are silently no-op — the inline-build operator is reading log output, not a dashboard. This shape preserves the brain's compile-time independence from `@factory5/daemon` (per ADR 0012's process-boundary intent) while still giving the daemon a clean wire to live state.

Each emit is `try`/`catch`-wrapped at the callsite (per `pool.ts`'s `emitFindingCreated` / `emitTaskStarted` etc. helpers) so a corrupt emit-side payload never fails the underlying brain operation. The brain's job is the build; the stream is observation.

### 6. Cleanup + disconnect symmetry

Per-request cleanup symmetry: every subscribe pairs with an unsubscribe on either of (i) `directive.completed` forwarded to that client, (ii) request-side `close` event. The hub's `closeDirective(id)` purges any residual listeners that survived an out-of-order shutdown sequence. Daemon shutdown calls `hub.shutdown()` to drop every listener for every directive — Fastify's close path doesn't hang on residual EventEmitter strong references.

## Live verification

The 3.1 acceptance smoke (route-level) verified `task.started` / `task.completed` / `spend.updated` / `directive.completed` over a real Fastify-bound socket with a real `EventSource` client (`packages/daemon/test/directive-stream-route.test.ts` — 161 → 167 daemon test count after 3.6).

The **2026-05-05 phase-3 live smoke** drove a real `factory build smoke-demo` build through the daemon and observed via `/app/directives/detail` in a live browser:

| Event                 | Verified live   | Verification path                                                                                                                                                                                                                                                                   |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task.started`        | ✅ (2026-05-05) | 3 tasks each rendered "Tasks (N)" panel update in real time                                                                                                                                                                                                                         |
| `task.completed`      | ✅ (2026-05-05) | Both successes and the verifier's failure rendered with terminal status                                                                                                                                                                                                             |
| `spend.updated`       | ✅ (2026-05-05) | Spend pip ticked $0.46 → $0.54 → $1.24 across the build                                                                                                                                                                                                                             |
| `log.line`            | ✅ (2026-05-05) | Worker subprocess activity rendered in the log tail                                                                                                                                                                                                                                 |
| `finding.created`     | ✅ (2026-05-05) | 3.7's `node-sse-smoke` build emitted F001 live (assessor-class advisory finding); rendered into the directive-detail page's findings panel via the SSE round-trip without F5. Backstopped by 4 unit tests in `packages/brain/src/pool.test.ts` (added in commit `f990323` for 3.1b) |
| `directive.completed` | ✅ (2026-05-05) | Operator-driven cancel from the FE flipped status; FE rendered the new state via the `directive.completed` round-trip                                                                                                                                                               |

All six event types are confirmed live end-to-end. The `finding.created` live-verification gap pinned at ADR acceptance was closed in 3.7's smoke (`node-sse-smoke` build's assessor F001 finding) and the structural promotion landed at `/phase-close` (Phase 3 closed 2026-05-06).

The 3.6 cancel-button live smoke also surfaced one carry-forward bug separate from this protocol: `directives/detail.astro` was missing `captureTokenFromUrl()` on init (every other auth-gated page calls it). Fixed in commit `00d2bc4` (`fix(3.6): bootstrap UI token in directives/detail.astro`); not a protocol issue, recorded here only to disambiguate from the smoke's actual ADR 0029 evidence.

The cancel-button smoke also surfaced the documented `Dashboard.astro` scoped-CSS / slot-content issue (the "PageShell + `<style is:global>` migration" deferred follow-up tracked in `phase-3-web-ui/steps.md`). Visual styling is not a protocol concern but is noted because the smoke evidence above came from an unstyled-ish render — the SSE round-trip semantics held regardless of CSS state, which is the right cleavage line.

## Consequences

**Positive.**

- **One transport, one data direction.** SSE matches the use case (server→browser observation) without a second protocol for the browser→server submission side (which keeps using the existing `POST /api/v1/*` routes per ADR 0027).
- **No new external deps.** SSE is HTTP/1.1 chunked transfer; `EventSource` is browser-native. Server side is `reply.raw` writes from Fastify — no library beyond what the daemon already pulls in.
- **Brain stays compile-time independent of daemon.** The optional callback shape in `BrainOptions` lets the daemon wire emission without flipping the dependency arrow ADR 0012 set up. Inline-build operators (no daemon) get silently no-op emits; their feedback is the existing log stream.
- **Two distinct FE consumers prove the protocol's reach.** `directives/detail.astro` (3.2) consumes the per-directive stream for tasks/log/spend/findings; `chat.astro` (3.5) consumes it for chat-reply token streaming. Same protocol, two surfaces — the contract has survived a non-trivial second consumer, which matters more than a thicker single-consumer test.
- **Heartbeat + backfill make connect-after-build idempotent.** A second tab or a refresh during a long build sees the same final state, not "I missed the early events." The four backfilled event types cover everything a fresh subscriber needs.
- **Cancel button gets sub-second feedback.** Operator clicks Cancel, daemon mutates `directives.status`, brain's loop.ts emits `directive.completed`, hub forwards to the open SSE client, FE re-renders. End-to-end latency observed in the 2026-05-05 smoke: ~2 s including the model-side cleanup of the in-flight call.

**Negative.**

- **`log.line` brain-side forwarder is still an open follow-up.** The route delivers `log.line` events when the hub emits them, but the brain's selective pino-stream tap (filter by `correlationId`) is not wired in 3.x; FE renders log lines via a polling fallback in the meantime. Tracked as a phase-3 follow-up and a phase-4-or-later candidate.
- **Backfill is one-shot, not idempotent across reconnects.** If the `EventSource` reconnects (transient network drop), the handler runs the backfill burst again — the FE de-duplicates by `taskId` / `findingId` (idempotent merge), but the cost is N extra events per reconnect. Acceptable given the typical reconnect frequency (rare in loopback usage).
- **Hub is in-process only.** A second daemon instance (multi-host) wouldn't share state — but multi-instance daemon isn't a near-term direction (ADR 0011 pins single daemon via pidfile), so this isn't a real constraint today.
- **Token-in-URL accommodation has the usual surface area.** Tokens land in browser history briefly before `history.replaceState` strips them; the daemon's access log records `?t=` on the SSE-opening request. Loopback threat model (per ADR 0025 §2) handles this, but operators should know the pattern is conscious.
- **Per-emit `try`/`catch` discipline at every callsite.** Brain-side emit helpers wrap their `emitter?.(event)` calls so a malformed event doesn't fail the underlying operation. The discipline is required at every new emit-site; a missing try/catch could regress the brain's reliability. Mitigated by the helper-pattern (`emitTaskStarted`, `emitFindingCreated`, etc. in `pool.ts`) — new emit sites should add a helper rather than inlining.

**Reversible?** Yes, layered.

- _Disable the stream:_ daemon can stop registering the route; FE detects 404 / connection failure and falls back to polling on `/api/v1/directives/:id`. Pre-3.1 behaviour returns; no migration needed since `directives` table state is unaffected.
- _Disable a single event type:_ remove the brain-side emit site; FE silently sees fewer events. Schema in `@factory5/ipc/sse` keeps the type for backward compat with archived consumers.
- _Move to WebSocket later:_ would require a different transport but the event-type set + payloads + hub semantics carry over directly. The ADR doesn't pin SSE-specific shapes that would block a future switch.

## Alternatives considered

- **WebSocket.** Two-way transport, more general, but pays for a duplex channel we don't use (operator submission is already JSON POST). Adds a separate auth story (Sec-WebSocket-Protocol or first-message bearer) and breaks the "everything on `/api/v1/*` with one bearer" simplicity from ADR 0025. Reconsider iff browser→daemon push semantics become load-bearing (interactive agent steering, mid-build edits) — Phase 4+ candidate.
- **Long-poll on `GET /api/v1/directives/:id` with `?since=<seq>`.** Stays in JSON, no streaming transport, no `EventSource`. Pays heavy tax: every reconnect costs a full directive snapshot, the per-event latency is bounded by the request round-trip + a server-side debounce, and the server has to keep an event-seq table to dedupe. SSE collapses all this into the transport.
- **gRPC streaming.** The serialisation efficiency is not the bottleneck (we measure $0.x per build, not throughput-per-second). gRPC adds protobuf, a code-gen step, and a transport that doesn't pass through the same proxies as `/api/v1/*`. Not a fit for the use case.
- **One event type with a tagged-union `kind` field instead of six event types.** Tempting because `event:` lines could be dropped from the SSE shape. Rejected because the SSE `event:` line is the standard discriminator for `EventSource.addEventListener('task.started', ...)`-style consumers — collapsing to one event type forces every consumer to dispatch in JS. Multi-type is the more idiomatic SSE shape.
- **No backfill on connect.** Smaller surface (no synthetic events), but breaks the connect-after-build idempotency that operators rely on. Refresh-during-build would render an empty Tasks panel until the next live event — bad UX. The synthetic burst is small (typically <10 events for a healthy build) and the FE de-duplicates anyway.
- **Per-directive event stream as a separate process.** Tempting for isolation, but the daemon's brain is already in-process per ADR 0012; piggy-backing the hub on the same process is the smallest seam. A separate process would introduce IPC for emit-side and double the cleanup surface for shutdown.
- **Make `finding.created` emission synchronous with worker output rather than post-`task.completed`.** The chosen shape (emit after task.completed, via `listFindings(plan.projectPath)`) reads the project's persistent findings registry; alternatives that emit as the worker writes a finding would require routing the worker's findings.json writes through a brain-mediated channel. Rejected: the persistent file is the source of truth (and what the verifier already reads); emit-after-completion lets the worker write findings in its natural flow, brain emits a single batch per task, FE sees a coherent post-task picture.

## Implementation status (cross-step)

| Sub-step | Commit                                        | What landed                                                                                                                                                                                                                                               |
| -------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1      | (3.1)                                         | Schemas in `@factory5/ipc/sse`, `DirectiveStreamHub` in `@factory5/daemon`, route `/api/v1/directives/:id/stream`, 4 of 6 brain emits (`task.started`, `task.completed`, `spend.updated`, `directive.completed`); `finding.created` + `log.line` deferred |
| 3.2      | (3.2)                                         | `directives/detail.astro` consumes the stream — tasks/log/spend/findings panels update without F5; polling fallback for SSE-stripped proxies                                                                                                              |
| 3.5      | (3.5)                                         | `chat.astro` consumes the stream for chat-reply token streaming; same `command-handlers.ts` shared with Discord/Telegram for slash-prefixed reads                                                                                                         |
| 3.1b     | `f990` (`feat(3.1b)`)                         | Brain emits `finding.created` from `pool.ts` after each `task.completed`; one `listFindings` per task feeds every emit. +4 unit tests in `pool.test.ts`                                                                                                   |
| 3.6      | `0167` `0f57` (`feat(3.6)` + `refactor(3.6)`) | Cancel button on `directives/detail.astro` uses the SSE round-trip for state feedback (button morph + status flip rendered live)                                                                                                                          |

Future work (not gating ADR 0029):

- Brain-side `log.line` forwarder (selective pino-stream tap filtered by `correlationId`). Target: phase-4 carry-forward or later — the route delivers events when the hub emits them; FE renders log lines via polling in the meantime.
- Findings backfill on connect (currently fetched via separate `GET /api/v1/findings` route). Target: address if operator surfaces a need; today's connect-then-`finding.created` pattern is operator-acceptable.

`@factory5/ipc/sse` is the canonical schema home; `packages/daemon/src/directive-stream{,-route}.ts` are the route + hub implementation; the brain's emit sites are in `packages/brain/src/pool.ts` + `loop.ts`. The wire spec in [`UPGRADE/specs/sse-directive-stream.md`](../../UPGRADE/specs/sse-directive-stream.md) remains the authoritative source for payload shapes; this ADR pins the architectural decisions and the live-verification record.
