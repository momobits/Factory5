# @factory5/events

Event sources for the daemon. Each source runs as a long-lived async loop, normalizes external observations into `Event` records, and writes them to `events_audit` (and where appropriate, materializes a `Directive`).

## Status

- **`EventSource` interface** — defined (`src/types.ts`)
- **`github-poll`** — stub (Phase 5)
- **`git-poll`** — stub (Phase 5)
- **`fs-watch`** — stub (future)
- **`webhook-server`** — stub (future)

## Pattern (lifted from clawhip)

- Polling sources keep last-seen state in-memory; emit only on delta
- Poll cadence configurable per source (default 10s)
- Errors logged and retried with exponential backoff; one failing source doesn't stop the others
- Webhooks land in a small Fastify-mounted route inside the daemon's IPC server (no separate server)

## Adding a source

1. Implement `EventSource` from `src/types.ts`
2. Export from `src/index.ts`
3. Register from the daemon entry (`apps/factoryd/src/main.ts`)
