# @factory5/events

Event sources for the daemon. Each source runs as a long-lived async loop, normalizes external observations into `Event` records, and writes them to `events_audit` (and where appropriate, materializes a `Directive`).

## Status

- **`EventSource` interface** — defined (`src/types.ts`)
- **`fs-watcher`** — implemented (chokidar, debounced 500 ms; Phase 3)
- **`git-poll`** — stub (future; no concrete use case yet)

GitHub event sources (`github-poll`, `webhook-server`) were dropped by
ADR 0019 along with the GitHub channel. See that ADR for rationale.

## Pattern (lifted from clawhip)

- Polling sources keep last-seen state in-memory; emit only on delta
- Poll cadence configurable per source (default 10s)
- Errors logged and retried with exponential backoff; one failing source doesn't stop the others
- Webhooks land in a small Fastify-mounted route inside the daemon's IPC server (no separate server)

## Adding a source

1. Implement `EventSource` from `src/types.ts`
2. Export from `src/index.ts`
3. Register from the daemon entry (`apps/factoryd/src/main.ts`)
