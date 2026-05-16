# Tier 11 — Per-directive log persistence

**Status:** scaffolded, in progress
**Estimated duration:** 1 session
**Issues addressed:** U031 (activity panel empty after reload; multi-tab event split)

## Goal

Persist `log.line` SSE events to SQLite so the directive-detail activity panel survives page reloads and multi-tab consistency. Today the events are ephemeral — emitted by the brain, broadcast by the SSE hub, dropped when the subscriber disconnects. Operators reopening a terminal directive see an empty panel; tabs that subscribe after another tab miss the historic events.

## Outcome

- New `directive_log_lines` table (migration 010) stores every `log.line` event the SSE hub processes, scoped to the originating directive.
- Daemon's `DirectiveStreamHub.emit` tees `log.line` events to the DB synchronously before fanning out to subscribers — no operator-visible reorder.
- New `GET /api/v1/directives/:id/logs?since=<iso>` returns the historic log lines for a directive, paginated by timestamp cursor.
- FE's directive-detail page fetches historic logs on connect, renders them into the activity panel, then attaches SSE for live events — events with `ts <= cursor` are deduped to avoid double-rendering the join boundary.
- A terminal directive opened from a Discord ping link shows the full narrative regardless of how long ago the run happened. Two tabs of the same directive show identical activity panels.

## Where we were, end of Phase 10

Phase 10 closed at `phase-10-resume-and-activity-feed-closed` 2026-05-16. The activity panel renders live SSE events correctly during the session, but the empty-state-on-reload was surfaced by the post-close smoke as a "this UX is incomplete" gap. The Phase 10 Deferred section explicitly flagged "Per-directive log persistence" as the natural Tier 11 follow-up.

The SSE hub + emit-site infrastructure from Tiers 3 (ADR 0029) + 10 (ADR 0031) is in place. Tier 11 is the persistence layer on top — no schema changes to existing tables, no brain-side changes, just a tee + a replay route + an FE reconciliation step.

## Why this phase exists

Three operator-felt failure modes on 2026-05-16, all rooted in the same gap:

1. **Refresh forgets everything.** Operator opens directive-detail mid-run, sees events streaming, refreshes the page (or the tab crashes), activity panel comes back empty. The directive's history is intact in the daemon log file but the dashboard treats it as a fresh subscriber with no backfill.
2. **Multi-tab event split.** Two dashboard tabs subscribed to the same directive show different event sets — events emitted before a tab's subscribe time are never replayed to that tab. Each tab has a different mental model of what happened.
3. **Post-mortem invisibility.** When operator opens a `failed` directive a week later to figure out why it failed, the activity panel is silent. The error info is in the daemon log file (text format, possibly rolled out of retention) but not surfaced where they're looking.

ADR 0031 noted persistence as the Tier 11+ follow-up; this tier ships it.

## What this tier ships

### 11.1 — Open U031

Severity medium; Tier 11; Area state + daemon + web.

### 11.2 — Migration 010: `directive_log_lines` table

```sql
CREATE TABLE directive_log_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  directive_id TEXT NOT NULL,
  ts TEXT NOT NULL,                    -- ISO 8601 with offset
  level TEXT NOT NULL,                 -- trace | debug | info | warn | error | fatal
  component TEXT NOT NULL,             -- 'brain.architect' / 'brain.planner' / etc.
  msg TEXT NOT NULL,
  attrs_json TEXT,                     -- nullable; optional per ADR 0029
  FOREIGN KEY (directive_id) REFERENCES directives(id) ON DELETE CASCADE
);
CREATE INDEX idx_directive_log_lines_directive_ts ON directive_log_lines (directive_id, ts);
```

Migration in `packages/state/src/migrations/010-directive-log-lines.sql` (or `.ts` if it needs JS). No backfill — pre-Tier-11 directives have empty histories, which matches their previous behaviour anyway.

Tests update: the three migration tests that assert `[1..9]` applied IDs grow to `[1..10]` (same pattern as Tier 8's 009).

### 11.3 — State queries

`packages/state/src/queries/directive-log-lines.ts`:

```ts
export function appendLogLine(db: Database, line: NewLogLine): void;
export function listForDirective(
  db: Database,
  directiveId: string,
  opts?: { sinceTs?: string; limit?: number },
): ReadonlyArray<DirectiveLogLine>;
```

Schema in `@factory5/core` (`directiveLogLineSchema` — mirrors the SSE `logLineEventSchema` shape, with `id: number` added). Default `limit: 5000` (high; full directive history is rarely huge — see "Sizing" below).

Unit tests cover: append + read-back; sinceTs filter; ordering by ts; limit; missing directive (orphan row tolerated but not load-bearing); large attrs_json roundtrip.

### 11.4 — Daemon hub tee

In `packages/daemon/src/directive-stream.ts`'s `DirectiveStreamHub.emit`: before iterating subscribers, if `event.type === 'log.line'`, call `appendLogLine(this.db, …)`. The hub gets a `Database` handle via constructor (it doesn't have one today — small refactor, plumbed from `IpcServerOptions`).

Synchronous insert via `better-sqlite3` is fine — average attrs payload is small and SQLite's per-statement overhead is < 1ms. The hub already disclaims `emit` is synchronous (`directive-stream.ts:25`).

Failure handling: a failing INSERT logs `warn` and continues — emission must not block on persistence, by the same "fire-and-forget" contract ADR 0029 already pins for subscribers.

Integration test in `packages/daemon/src/server.test.ts`: emit three log.line events, assert all three are queryable via `listForDirective`.

### 11.5 — Route + Schema

New `GET /api/v1/directives/:id/logs?since=<iso>`:

```ts
// packages/ipc/src/schemas.ts
export const apiV1DirectiveLogsQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});
export const apiV1DirectiveLogsResponseSchema = z.object({
  items: z.array(directiveLogLineSchema),
  // No `total` — operator either wants tail (most-recent) or full
  // history; pagination beyond limit=5000 is a Tier-12+ concern.
});
```

Daemon route in `packages/daemon/src/server.ts`:

```ts
app.get('/api/v1/directives/:id/logs', async (request, reply) => {
  requireUiAuth(request, opts.uiAuthToken);
  const id = (request.params as { id: string }).id;
  const query = apiV1DirectiveLogsQuerySchema.parse(request.query ?? {});
  const items = listForDirective(opts.db, id, query);
  reply.send(apiV1DirectiveLogsResponseSchema.parse({ items }));
});
```

Reuses bearer-auth pattern from the other `/api/v1/directives/:id/*` routes. No 404 special-casing — empty list for unknown directive is fine (matches the SSE stream's "subscribe to a non-existent id and get heartbeats only" behaviour).

3 integration tests in `server.test.ts`: 401, since-cursor filter, happy path.

### 11.6 — FE replay + dedup

In `apps/factory-web/src/pages/directives/detail.astro`:

```ts
// On boot, before attaching SSE:
const historic = await apiFetch<{ items: LogLine[] }>(
  `/api/v1/directives/${encodeURIComponent(directiveId)}/logs?limit=5000`,
);
state.logLines = historic.items;
// Track the latest historic ts as the join-boundary cursor
const joinCursor = historic.items.at(-1)?.ts;
```

Then in the SSE event handler for `log.line` events:

```ts
case 'log.line': {
  // De-dupe against the historic cursor. Same event reappears via SSE
  // if the connection (a) opened during ongoing brain work, (b) the
  // hub tee'd the event to the DB AND fanned it out before the FE's
  // historic-fetch landed. Reject any event whose ts is <= cursor.
  if (joinCursor !== undefined && ev.ts <= joinCursor) break;
  state.logLines.push({ ts: ev.ts, level: ev.level, component: ev.component, msg: ev.msg });
  break;
}
```

Render path is unchanged — `buildLogTail()` already walks `state.logLines`.

### 11.7 — Phase close

Standard gates + a live browser smoke that proves:

- Start a build, observe live events arriving.
- Refresh — same events still visible.
- Open in a second tab — same events visible there too.
- Open after the directive terminates — full history still visible.

## Done criteria

- [ ] All four `pnpm` gates green
- [ ] Migration 010 lands; three pre-existing migration shape tests bump to `[1..10]`
- [ ] State queries + tests
- [ ] Daemon hub tees `log.line` to DB; integration test asserts read-back
- [ ] `GET /api/v1/directives/:id/logs` returns historic; 3 integration tests
- [ ] FE replays on load; dedup against the SSE stream
- [ ] Browser smoke: refresh on a running directive preserves activity panel
- [ ] Browser smoke: open same directive in tab 2, identical panel content
- [ ] Browser smoke: open a terminal directive a session later, full history visible
- [ ] U031 closes

## Sizing

Quick napkin math for the persistence cost:

- Typical successful build emits ~30-60 `log.line` events (triage + architect entry/exit + readiness + planner entry/exit + N task lifecycle pairs + assessor + terminal).
- Average event size: ~150 bytes (`level + component + msg + small attrs`).
- 100 directives/day × 50 events/directive × 150 bytes ≈ 750 KB/day.
- 1 year unchecked: ~275 MB. Index doubles that to ~550 MB.

Not a problem for the operator-laptop case this tier targets. Retention policy (auto-prune after N days) deferred — Tier 13+ candidate if anyone hits the limit.

Error events with `attrs.detail` of 500 chars dominate the size; 50% of errors with 500-char detail vs 0% error = ~2× size. Still under 1 GB/year for a hot operator.

## Rollback

`git reset --hard phase-10-resume-and-activity-feed-closed` rolls the code. Migration 010 is forward-only by Control invariant; if it must be unwound, drop the table manually and remove the entry from the `migrations` table — but this is a destructive op, not a real rollback path. The migration is idempotent (`CREATE TABLE IF NOT EXISTS`) so re-running is safe.

## Carry-forward (Tier 12+ candidates)

- **Auto-prune retention policy.** Add a sweep that drops log lines older than N days (configurable in `<dataDir>/config.json`). Defer-until-signal.
- **Search / filter in the activity panel.** Free-text grep, level filter, component filter. UX polish, not load-bearing.
- **Persist `task.started` / `task.completed` / `finding.created` events too.** Those currently get reconstructed from the DB by the SSE handler's snapshot logic; they're already durable in their respective tables. Same shape would unify the SSE replay code path.
- **CLI tail.** `factory directive tail <id>` consumes the same logs endpoint and prints them as they arrive. Composition over the new route.

## Suggested commit shape

- `chore(phase-11): scaffold tier 11 directive log persistence`
- `chore(11.1): open U031`
- `feat(11.2): migration 010 — directive_log_lines table`
- `feat(11.3): state queries for directive log lines`
- `feat(11.4): daemon SSE hub tees log.line events to DB`
- `feat(11.5): GET /api/v1/directives/:id/logs`
- `feat(11.6): FE replay historic logs + dedup against SSE`
- `chore(phase-11): close phase 11`
