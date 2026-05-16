# Phase 11 Steps

- [x] 11.1 — Open U031 in `UPGRADE/ISSUES.md` Open section. Severity medium; Tier 11; Area state + daemon + web.
- [x] 11.2 — Migration 010 (`directive_log_lines` table). Schema per the plan. Updated the three pre-existing migration shape tests (`003-findings-registry.test.ts`, `004-model-usage-mode.test.ts`, `006-project-identity.test.ts`) + the Tier-8-added `009-pending-questions-answered-by.test.ts` to expect `[1..10]`. Plus 6 new shape tests in `010-directive-log-lines.test.ts` (column shape, index existence, schema-9-absence, cascade-on-directive-delete, attrs round-trip, migrations-table entry).
- [x] 11.3 — State queries — `packages/state/src/queries/directive-log-lines.ts` with `appendLogLine` + `listForDirective`. Schema in `@factory5/core` (`directiveLogLineSchema` + `directiveLogLineInputSchema`). 7 unit tests cover append + read-back, NULL-attrs round-trip, ordering by `(ts, id)` ASC, sinceTs strict-gt, directive-scoping, limit (explicit + default 5000 + floor-1 clamp), large attrs JSON round-trip. State count 180 → 187. Workspace 1200 → 1207 + 3 skipped.
- [ ] 11.4 — Daemon hub tees `log.line` to DB. `DirectiveStreamHub.emit` calls `appendLogLine` before fanning out when `event.type === 'log.line'`. Hub gets a `Database` handle via constructor (plumbed from `IpcServerOptions`). Failure handling: log `warn` + continue (emission must not block on persistence). Integration test in `server.test.ts` emits 3 events, asserts queryable.
- [ ] 11.5 — `GET /api/v1/directives/:id/logs?since=<iso>&limit=<n>` daemon route. New `apiV1DirectiveLogsQuerySchema` + `apiV1DirectiveLogsResponseSchema`. Bearer-auth pattern from `/api/v1/builds`. 3 integration tests (401, since-cursor filter, happy path).
- [ ] 11.6 — FE replay + dedup — on directive-detail page load, fetch `/api/v1/directives/:id/logs?limit=5000` first, render into `state.logLines`, capture last `ts` as `joinCursor`, then attach SSE — events with `ts <= joinCursor` are dropped to avoid double-rendering at the join boundary.
- [ ] 11.7 — `/phase-close` — verify all done-criteria; tag `phase-11-directive-log-persistence-closed`; append final session entry to `UPGRADE/LOG.md`; transition STATE back to "all phases complete" (eighth time) unless Tier 12 starts immediately.

## Step detail

### 11.2 — migration 010

```sql
CREATE TABLE IF NOT EXISTS directive_log_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  directive_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  component TEXT NOT NULL,
  msg TEXT NOT NULL,
  attrs_json TEXT,
  FOREIGN KEY (directive_id) REFERENCES directives(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_directive_log_lines_directive_ts ON directive_log_lines (directive_id, ts);
```

No backfill. Pre-Tier-11 directives have empty histories, which matches their previous behaviour.

### 11.4 — hub tee site

In `DirectiveStreamHub.emit`:

```ts
if (event.type === 'log.line') {
  try {
    appendLogLine(this.db, {
      directiveId: event.directiveId,
      ts: event.ts,
      level: event.level,
      component: event.component,
      msg: event.msg,
      attrs: event.attrs,
    });
  } catch (err) {
    log.warn({ err, directiveId: event.directiveId }, 'directive-stream: log.line persistence failed (non-fatal)');
  }
}
```

Then iterate subscribers as today.

### 11.6 — FE flow

In `apps/factory-web/src/pages/directives/detail.astro`'s bootstrap:

```ts
captureTokenFromUrl();
// Existing snapshot + SSE bootstrap stays as-is. Add the historic-logs
// fetch BEFORE attachStream() so the join cursor is set when the first
// SSE log.line lands.
const historic = await apiFetch<{ items: LogLine[] }>(
  `/api/v1/directives/${encodeURIComponent(directiveId)}/logs?limit=5000`,
);
state.logLines = historic.items;
let joinCursor = historic.items.at(-1)?.ts;

// In the SSE event handler for log.line:
case 'log.line': {
  if (joinCursor !== undefined && ev.ts <= joinCursor) break;
  state.logLines.push({ ts: ev.ts, level: ev.level, component: ev.component, msg: ev.msg });
  joinCursor = ev.ts; // advance so we don't dedupe future events
  break;
}
```
