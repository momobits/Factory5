# @factory5/ipc

HTTP contracts (Zod-validated) and typed client for daemon ↔ brain communication.

> SQLite is the durable bus (see ADR 0002). HTTP is the **doorbell** — used for immediate operations where 250ms SQLite-poll latency would be perceptible (chat replies, status checks, config reload).

## Endpoints

The daemon listens on `127.0.0.1:25295` (overridable via env `FACTORY5_DAEMON_PORT` / `FACTORY5_DAEMON_HOST`).

| Method | Path                 | Direction             | Purpose                                                |
| ------ | -------------------- | --------------------- | ------------------------------------------------------ |
| `GET`  | `/status`            | brain → daemon        | Liveness + version + active channel count              |
| `POST` | `/send`              | brain → daemon        | Immediate channel send (skip SQLite roundtrip latency) |
| `POST` | `/directives/notify` | daemon → brain (rare) | Wake brain when a high-priority directive arrives      |
| `POST` | `/reload-config`     | brain → daemon        | Reload daemon config without restart                   |
| `GET`  | `/events/stream`     | \* → daemon           | Server-Sent Events live tail of recent events          |

(Brain-side `/directives/notify` requires a brain HTTP listener too; for v0 the brain's listener is opt-in via `factory chat --listen`.)

## Usage

```ts
import { createDaemonClient, type DaemonClient } from '@factory5/ipc';

const client: DaemonClient = createDaemonClient(); // defaults to 127.0.0.1:25295

const status = await client.status(); // { version, uptime, channels: [...] }
await client.send({ targetChannel: 'discord', targetRef: 'channel-id', text: 'hi' });
await client.reloadConfig();
```

Server-side (in `@factory5/daemon`):

```ts
import { registerIpcRoutes } from '@factory5/ipc';

registerIpcRoutes(fastify, {
  status: () => ({ version: '0.0.1', uptime: ..., channels: [...] }),
  send: async (msg) => ({ delivered: true }),
  reloadConfig: async () => ({ reloaded: true }),
});
```

## Conventions

- **All payloads validated.** Both client and server validate request/response with the matching Zod schema.
- **Errors as JSON.** Failures return `{ error: { code, message, details? } }` with HTTP 4xx/5xx.
- **No long-polling.** Use `/events/stream` (SSE) for live tail; everything else is request/response.
- **Localhost-only by default.** Bound to `127.0.0.1`; do not expose this port externally without an auth layer.
