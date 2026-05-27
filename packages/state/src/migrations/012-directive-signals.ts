import type { Migration } from './index.js';

/**
 * Migration 012 — `directive_signals` table for per-task retry signaling.
 *
 * Adds a lightweight inbox that lets the daemon post control signals to an
 * in-flight directive without needing a live IPC channel back to the brain.
 * The brain's claim loop polls for unconsumed signals and re-enters the
 * directive execution loop when it finds one.
 *
 * Initial use-case: the cockpit's "Retry" button inserts a `task_retry`
 * signal; the brain picks it up and re-schedules the failed task without
 * operator intervention beyond the button click.
 *
 * Schema notes:
 *   - `payload_json` is nullable — signals with no additional context
 *     (e.g. a bare `task_retry` that carries only the directive scope) do
 *     not need a payload column.
 *   - `consumed_at` is NULL until the brain atomically marks the row read
 *     via {@link consumeNext}. The partial index on `consumed_at IS NULL`
 *     makes the brain's polling query O(1) for unconsumed rows per directive.
 *   - Rows are never deleted — consumed rows stay for the audit trail so an
 *     operator can correlate "when was retry clicked" with the brain's logs.
 */
export const migration012: Migration = {
  id: 12,
  name: 'directive-signals',
  up: `
    CREATE TABLE directive_signals (
      id           TEXT PRIMARY KEY,
      directive_id TEXT NOT NULL,
      signal_type  TEXT NOT NULL,
      payload_json TEXT,
      created_at   TEXT NOT NULL,
      consumed_at  TEXT
    );
    CREATE INDEX idx_directive_signals_unconsumed
      ON directive_signals (directive_id, signal_type)
      WHERE consumed_at IS NULL;
  `,
};
