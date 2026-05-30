# @factory5/state

SQLite-backed runtime state for factory5. Wraps `better-sqlite3` (synchronous, fast, prebuilt binaries on Win/Linux/Mac). Also owns a small daemon-wide JSON config sidecar (`<dataDir>/config.json`) for tunables that don't belong in `config.toml`.

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

### Recovering stuck directives

A directive flips to `running` while a brain owns it; if that brain is
killed before writing a terminal status, the row stays `running`
indefinitely. Two recovery paths close that gap:

```ts
import { directives, MarkBlockedError, reconcileOrphanedDirectives } from '@factory5/state';

// Manual operator path (also exposed as `factory directive mark-blocked`):
directives.markBlocked(db, directiveId, 'reason text'); // throws MarkBlockedError
// if unknown or already terminal.

// Daemon-startup sweep (wired in `@factory5/daemon`): flip orphaned rows
// whose owning PID is gone AND whose last model_usage activity is older
// than 10 min. Keeps concurrent `factory build --inline` runs safe via
// the activity floor.
reconcileOrphanedDirectives(db, log);
```

Both paths record the reason in the new `blocked_reason TEXT` column
(migration 002) so `factory status` / later inspection explain why a
row was flipped.

## Per-agent category resolver

> ADR 0036 retired this package's `<dataDir>/config.json` reader/writer. The single
> operator config file is now `config.toml` (owned by `@factory5/brain`). What remains here
> is the **pure resolver** for per-agent model-category overrides.

The `[agents]` table lives in `config.toml`; the brain loads it and passes the block into
`resolveAgentCategory`. This helper stays in `@factory5/state` (not brain) because the
dependency direction is brain → state → core — and it is a pure function on a plain
object, no I/O.

```ts
import { resolveAgentCategory, DEFAULT_AGENT_CATEGORIES } from '@factory5/state';

// config = the parsed `[agents]` block from config.toml (or {} when absent)
resolveAgentCategory({ agents: { architect: 'reasoning' } }, 'architect'); // 'reasoning'
resolveAgentCategory({}, 'critic'); // DEFAULT_AGENT_CATEGORIES.critic === 'reasoning'
```

The auto-answer deadline that used to live in `config.json` is now the `askUserDeadlineMs`
**budget axis** (ADR 0035) — resolved per-project (`project.json`) and per-build
(`payload.budgets`), with `DEFAULT_ASK_USER_DEADLINE_MS` (in `@factory5/core`) as the
baked-in default.

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
