# @factory5/daemon

Daemon assembly. Wires together:

- `@factory5/channels` (inbound/outbound message channels)
- `@factory5/events` (event sources)
- `@factory5/ipc` (HTTP server: `/status`, `/send`, `/reload-config`, `/events/stream`)
- `@factory5/state` (SQLite for the durable bus)

Consumed by `apps/factoryd` (the binary entry point).

## Lifecycle

```ts
import { startDaemon, stopDaemon } from '@factory5/daemon';

const handle = await startDaemon({ port: 25295, host: '127.0.0.1' });
// ... handles inbound/outbound, polls events, serves /status etc.
await stopDaemon(handle); // graceful — flushes outbound queue, closes channels
```

## Status

Stub. Implementation lands in Phase 3.
