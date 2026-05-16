/**
 * Typed CRUD for the `directive_log_lines` table — persistence of
 * `log.line` SSE events teed by the daemon's `DirectiveStreamHub`
 * (Tier 11 / U031). Backs the directive-detail activity panel's
 * replay-on-connect path so refresh, multi-tab join, and post-mortem
 * views show the brain's narration consistently with what live
 * subscribers saw at the time.
 *
 * Write path: `DirectiveStreamHub.emit` calls {@link appendLogLine}
 * before fanning out to subscribers. Persistence is best-effort — the
 * hub catches and logs at `warn` so a stalled writer cannot block
 * event delivery.
 *
 * Read path: the daemon's `GET /api/v1/directives/:id/logs` route
 * calls {@link listForDirective}; the FE renders that into its
 * `state.logLines` and captures the last `ts` as the join cursor
 * before attaching SSE (Tier 11 §11.6).
 */

import {
  directiveLogLineSchema,
  type DirectiveLogLine,
  type DirectiveLogLineInput,
} from '@factory5/core';

import type { Database } from '../db.js';

interface Row {
  id: number;
  directive_id: string;
  ts: string;
  level: string;
  component: string;
  msg: string;
  attrs_json: string | null;
}

function rowToLogLine(row: Row): DirectiveLogLine {
  return directiveLogLineSchema.parse({
    id: row.id,
    directiveId: row.directive_id,
    ts: row.ts,
    level: row.level,
    component: row.component,
    msg: row.msg,
    ...(row.attrs_json !== null ? { attrs: JSON.parse(row.attrs_json) } : {}),
  });
}

/**
 * Default cap on rows returned by {@link listForDirective}. Matches the
 * FE replay fetch on directive-detail load (`limit=5000`) so the
 * "no-query-param" daemon and brain-test code paths agree with what
 * the page actually requests.
 */
export const DEFAULT_LOG_LINE_LIMIT = 5000;

/**
 * Append a single `log.line` event to the directive's persisted history.
 * Returns the auto-assigned surrogate `id` so callers can correlate
 * downstream operations if needed (none today; reserved for parity
 * with the read shape).
 *
 * No validation on insert — the daemon's `DirectiveStreamHub.emit`
 * already runs `logLineEventSchema.parse` upstream and forwards a
 * type-narrowed event. Re-parsing here would double-cost the hot path
 * on every fan-out tick.
 */
export function appendLogLine(db: Database, line: DirectiveLogLineInput): number {
  const result = db
    .prepare(
      `INSERT INTO directive_log_lines
         (directive_id, ts, level, component, msg, attrs_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      line.directiveId,
      line.ts,
      line.level,
      line.component,
      line.msg,
      line.attrs !== undefined ? JSON.stringify(line.attrs) : null,
    );
  return Number(result.lastInsertRowid);
}

export interface ListForDirectiveOptions {
  /**
   * Strict-greater-than cursor on `ts`. Used by the FE replay+SSE
   * join: replay fetches up to and including the live cursor, then
   * SSE handlers drop events with `ts <= joinCursor` to avoid
   * double-rendering at the boundary. Passing this option mirrors
   * that contract on the server side so a paginated replay can
   * resume cleanly.
   */
  sinceTs?: string;
  /**
   * Cap on rows returned. Floor 1; default {@link DEFAULT_LOG_LINE_LIMIT}.
   * No hard upper cap here — the daemon route applies its own ceiling
   * (and the FE only ever asks for the default 5000).
   */
  limit?: number;
}

/**
 * Read a directive's persisted log lines ordered by `(ts, id)`
 * ascending. The `id` tiebreaker preserves insertion order when two
 * events share an ISO timestamp (the brain emits multiple `log.line`
 * events inside a single millisecond on stage transitions; e.g.
 * triage-end + architect-calling).
 */
export function listForDirective(
  db: Database,
  directiveId: string,
  options: ListForDirectiveOptions = {},
): DirectiveLogLine[] {
  const limit = Math.max(1, options.limit ?? DEFAULT_LOG_LINE_LIMIT);
  const wheres: string[] = ['directive_id = ?'];
  const params: unknown[] = [directiveId];
  if (options.sinceTs !== undefined) {
    wheres.push('ts > ?');
    params.push(options.sinceTs);
  }
  const rows = db
    .prepare(
      `SELECT * FROM directive_log_lines
        WHERE ${wheres.join(' AND ')}
        ORDER BY ts ASC, id ASC
        LIMIT ?`,
    )
    .all(...params, limit) as Row[];
  return rows.map(rowToLogLine);
}
