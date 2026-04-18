# @factory5/state

SQLite-backed runtime state for factory5. Wraps `better-sqlite3` (synchronous, fast, prebuilt binaries on Win/Linux/Mac).

> Per-project state lives in **files** (the wiki, BUILD.md, findings); this package handles only **factory runtime state** (the durable bus, sessions, dedup). See ADR 0003.

## What lives in the database

One file at `<dataDir>/factory.db` (see `@factory5/logger/paths` for `dataDir()`).

| Table               | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `directives`        | Inbound work queue across all channels                           |
| `outbound_messages` | Brain → channel delivery queue with audit                        |
| `events_audit`      | Every external event ever observed                               |
| `sessions`          | Per-channel/per-user conversational state                        |
| `pending_questions` | `ask_user` calls awaiting user reply                             |
| `tasks_inflight`    | Currently-running worker tasks (worktree path, agent, heartbeat) |
| `projects`          | Registry of all projects factory has touched                     |
| `learnings`         | Cross-project patterns extracted from past builds                |
| `model_usage`       | Token / cost tracking per provider per directive                 |
| `migrations`        | Bookkeeping for which migrations have been applied               |

## Usage

```ts
import { openDatabase, runMigrations } from '@factory5/state';

const db = openDatabase(); // opens at <dataDir>/factory.db, enables WAL
runMigrations(db); // idempotent — safe to call on every startup

// Typed query helpers (one module per table):
import { insertDirective, claimNextDirective } from '@factory5/state';

insertDirective(db, {
  id: '...',
  source: 'cli',
  /* ... */
});

const claimed = claimNextDirective(db, { claimedBy: `factory-${process.pid}` });
```

## Conventions

- **Always validate at boundaries.** Inputs to insert helpers are validated against the matching `@factory5/core` schema before SQL is run.
- **WAL mode is on by default** so concurrent readers (daemon + brain + workers) don't block each other.
- **All timestamps are stored as ISO8601 strings.** SQLite has no native datetime type; ISO strings sort correctly and round-trip cleanly.
- **Use prepared statements.** Helpers cache prepared statements per-database for speed.
- **Migrations are append-only.** New schema = new migration file with the next number. Never edit a shipped migration.

## Adding a migration

1. Create `src/migrations/NNN-description.ts` exporting `{ id, name, up }` (id = next number, name = kebab-case, up = SQL string)
2. Add to `src/migrations/index.ts` migrations array
3. Add tests if behavior changed
4. Increment `CURRENT_SCHEMA_VERSION` if you want to gate older client versions

## Testing

Tests use in-memory SQLite (`:memory:`) for speed and isolation:

```ts
import Database from 'better-sqlite3';
import { runMigrations } from '@factory5/state';

const db = new Database(':memory:');
runMigrations(db);
// ... test against db
```
