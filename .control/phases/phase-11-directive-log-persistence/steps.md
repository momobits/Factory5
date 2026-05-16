# Phase 11 Steps

- [x] 11.1 — Open U031 in `UPGRADE/ISSUES.md` Open section. Severity medium; Tier 11; Area state + daemon + web.
- [x] 11.2 — Migration 010 (`directive_log_lines` table). Schema per the plan. Updated the three pre-existing migration shape tests (`003-findings-registry.test.ts`, `004-model-usage-mode.test.ts`, `006-project-identity.test.ts`) + the Tier-8-added `009-pending-questions-answered-by.test.ts` to expect `[1..10]`. Plus 6 new shape tests in `010-directive-log-lines.test.ts` (column shape, index existence, schema-9-absence, cascade-on-directive-delete, attrs round-trip, migrations-table entry).
- [x] 11.3 — State queries — `packages/state/src/queries/directive-log-lines.ts` with `appendLogLine` + `listForDirective`. Schema in `@factory5/core` (`directiveLogLineSchema` + `directiveLogLineInputSchema`). 7 unit tests cover append + read-back, NULL-attrs round-trip, ordering by `(ts, id)` ASC, sinceTs strict-gt, directive-scoping, limit (explicit + default 5000 + floor-1 clamp), large attrs JSON round-trip. State count 180 → 187. Workspace 1200 → 1207 + 3 skipped.
- [x] 11.4 — Daemon hub tees `log.line` to DB. `DirectiveStreamHub.emit` calls `appendLogLine` before fanning out when `event.type === 'log.line'`. Hub gained a required `db: Database` constructor arg; instantiation in `index.ts` deferred until after `openDatabase` (was eagerly built at line 204 before db existed). Failure handling: try/catch + `log.warn` + continue (emission must not block on persistence). 4 integration tests in a new `directive-stream.test.ts`: persist 3 events + ordered read-back, tee-before-fanout to live subscribers, non-`log.line` events skip persistence, DROP-table-induced persistence failure does not block fan-out. Plan-deviation: dedicated `directive-stream.test.ts` (file-co-located with `directive-stream.ts`) rather than appending to `server.test.ts` per the plan — the tee is a hub-internal mechanism with no HTTP surface, so the standalone file matches the codebase's per-module `*.test.ts` convention. Daemon test count 181 → 185.
- [x] 11.5 — `GET /api/v1/directives/:id/logs?since=<iso>&limit=<n>` daemon route. New `apiV1DirectiveLogsQuerySchema` (since: isoDateTime; limit: coerce.int [1, 5000]) + `apiV1DirectiveLogsResponseSchema` ({ items, count, limit }) in `@factory5/ipc`. Bearer-auth via `requireUiAuth`; 404 `DIRECTIVE_NOT_FOUND` for unknown id. Limit default `DEFAULT_LOG_LINE_LIMIT` (5000) re-exported from `@factory5/state`. **5 integration tests** in `server.test.ts` (plan said 3 — added 404 + empty-list as natural neighbors, trivial cost): 401 missing bearer, 404 unknown directive, happy-path read-back of 3 events, since strict-greater-than filter (matches FE join-cursor contract), empty-list 200 for a real directive that emitted nothing. Daemon test count 185 → 190; workspace 1211 → 1216 + 3 skipped.
- [x] 11.6 — FE replay + dedup — directive-detail (`apps/factory-web/src/pages/directives/detail.astro`) `bootstrap()` gains a step 2 between the snapshot fetch and `apiStream`: `GET /api/v1/directives/:id/logs?limit=5000`, seed `state.logLines` from `items`, set `joinCursor = items.at(-1)?.ts`. `applyEvent`'s `log.line` branch drops events with `ts <= joinCursor`. Live-event cap bumped 500 → 5000 to match the replay seed (was trimming historic on the first live tick). **Plan-deviation:** plan §11.6's `joinCursor = ev.ts; // advance` would drop ms-collision live events sharing a ts with a previously-accepted live event (the brain emits multiple events inside a single millisecond on stage transitions — Tier 8/10 evidence). Used a fixed cursor pinned to `historic.last.ts` instead — cursor's only job is the historic/live boundary; ordering within live events is preserved. Failure on the replay fetch is non-fatal (console warn + proceed with live-only). FE-only change; no new tests (no Astro test infrastructure today, same as Tier 9). 11.7 covers the live browser smoke.
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
