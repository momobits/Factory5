# @factory5/ipc

HTTP contracts (Zod-validated) and typed client for daemon ↔ brain communication.

> SQLite is the durable bus (see ADR 0002). HTTP is the **doorbell** — used for immediate operations where 250ms SQLite-poll latency would be perceptible (chat replies, status checks, config reload).

## Endpoints

The daemon listens on `127.0.0.1:25295` (overridable via env `FACTORY5_DAEMON_PORT` / `FACTORY5_DAEMON_HOST`).

| Method | Path                            | Direction             | Purpose                                                                             |
| ------ | ------------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| `GET`  | `/status`                       | brain → daemon        | Liveness + version + active channel count                                           |
| `POST` | `/send`                         | brain → daemon        | Immediate channel send (skip SQLite roundtrip latency)                              |
| `POST` | `/directives/notify`            | daemon → brain (rare) | Wake brain when a high-priority directive arrives                                   |
| `POST` | `/reload-config`                | brain → daemon        | Reload daemon config without restart                                                |
| `GET`  | `/api/v1/directives/:id/stream` | SPA → daemon          | Server-Sent Events live tail of one directive's task / finding / spend / log events |

(Brain-side `/directives/notify` requires a brain HTTP listener too; for v0 the brain's listener is opt-in via `factory chat --listen`.)

> This package does **not** register any of these routes. Route registration is owned by the daemon — see `packages/daemon/src/server.ts`. `@factory5/ipc` is the contract layer: the Zod schemas, the typed `DaemonClient`, and the SSE event types. The path table above is the contract those pieces describe, not a server this package mounts.

## Usage

```ts
import { createDaemonClient, type DaemonClient } from '@factory5/ipc';

const client: DaemonClient = createDaemonClient(); // defaults to 127.0.0.1:25295

const status = await client.status(); // { version, uptime, channels: [...] }
await client.send({ targetChannel: 'discord', targetRef: 'channel-id', text: 'hi' });
await client.reloadConfig();
```

### SSE event types

The live directive stream (`GET /api/v1/directives/:id/stream`) is described by a discriminated union exported from this package. Producer (brain) and consumer (SPA `EventSource` wrapper) both validate against it so drift surfaces as a parse error rather than silently-bad rendering:

```ts
import { directiveStreamEventSchema, type DirectiveStreamEvent } from '@factory5/ipc';

const event: DirectiveStreamEvent = directiveStreamEventSchema.parse(JSON.parse(raw));
switch (event.type) {
  case 'task.started':
    /* … */ break;
  case 'task.completed':
    /* … */ break;
  // …also: task.retried, finding.created, spend.updated, transcript.line,
  // log.line, pool.tally, directive.completed
}
```

### Where the routes live

`@factory5/ipc` is the **contract layer only** — Zod schemas (`./schemas`), the typed `DaemonClient` (`./client`), the error shape (`./errors`), and the SSE union (`./sse`). It exports no `registerIpcRoutes` (or any other server-mounting) helper. The **daemon** owns route registration and request handling; read `packages/daemon/src/server.ts` for the wiring that mounts the paths in the table above.

## Conventions

- **All payloads validated.** Both client and server validate request/response with the matching Zod schema.
- **Errors as JSON.** Failures return `{ error: { code, message, details? } }` with HTTP 4xx/5xx.
- **No long-polling.** Use the SSE stream (`/api/v1/directives/:id/stream`) for live tail; everything else is request/response.
- **Localhost-only by default.** Bound to `127.0.0.1`; do not expose this port externally without an auth layer.
