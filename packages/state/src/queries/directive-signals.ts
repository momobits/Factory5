/**
 * Typed CRUD for the `directive_signals` table — per-directive control
 * signals used for out-of-band communication from the daemon (or operator
 * tooling) back to the brain's claim loop.
 *
 * The primary use-case (Tier 15, U041) is retry signaling: when the cockpit
 * "Retry" button is clicked, the daemon inserts a `task_retry` signal via
 * {@link insert}; the brain's claim loop polls via {@link consumeNext} and
 * re-enters the directive execution path for the named directive.
 *
 * Rows are never hard-deleted — consumed rows (where `consumed_at IS NOT
 * NULL`) stay in the table as an audit trail. The partial index on
 * `consumed_at IS NULL` keeps polling queries fast even as history accumulates.
 *
 * All operations use better-sqlite3's synchronous API, matching the rest of
 * the `@factory5/state` query layer.
 */

import { newId } from '@factory5/core';

import type { Database } from '../db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single control signal addressed to a directive.
 *
 * `payload` is the decoded form of the nullable `payload_json` column.
 * It is `null` when the signal carries no additional context beyond its type.
 */
export interface DirectiveSignal {
  /** ULID assigned at insert time. */
  id: string;
  /** The directive this signal is addressed to. */
  directiveId: string;
  /** Machine-readable signal kind, e.g. `'task_retry'`. */
  signalType: string;
  /** Optional structured payload. `null` when `payload_json` is NULL in the row. */
  payload: unknown;
  /** ISO 8601 timestamp of insertion. */
  createdAt: string;
  /** ISO 8601 timestamp when the brain consumed this signal. `null` if still pending. */
  consumedAt: string | null;
}

/** Raw database row shape for `directive_signals`. */
interface Row {
  id: string;
  directive_id: string;
  signal_type: string;
  payload_json: string | null;
  created_at: string;
  consumed_at: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToSignal(row: Row): DirectiveSignal {
  return {
    id: row.id,
    directiveId: row.directive_id,
    signalType: row.signal_type,
    payload: row.payload_json !== null ? (JSON.parse(row.payload_json) as unknown) : null,
    createdAt: row.created_at,
    consumedAt: row.consumed_at,
  };
}

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Insert a new signal for a directive.
 *
 * @param db          - The open database connection.
 * @param directiveId - The directive this signal targets.
 * @param signalType  - Machine-readable signal kind (e.g. `'task_retry'`).
 * @param payload     - Optional structured payload. Pass `undefined` or
 *                      `null` for signals that carry no additional context.
 * @returns The ULID assigned to the new signal row.
 *
 * @example
 * ```ts
 * const id = directiveSignals.insert(db, directiveId, 'task_retry', { taskId });
 * ```
 */
export function insert(
  db: Database,
  directiveId: string,
  signalType: string,
  payload?: unknown,
): string {
  const id = newId();
  const createdAt = new Date().toISOString();
  const payloadJson = payload !== undefined && payload !== null ? JSON.stringify(payload) : null;
  db.prepare(
    `INSERT INTO directive_signals (id, directive_id, signal_type, payload_json, created_at, consumed_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(id, directiveId, signalType, payloadJson, createdAt);
  return id;
}

// ---------------------------------------------------------------------------
// Read / consume helpers
// ---------------------------------------------------------------------------

/**
 * Atomically consume the oldest unconsumed signal of a given type for a
 * directive. Stamps `consumed_at` on the row and returns the signal so the
 * caller can act on it. Returns `undefined` when no matching unconsumed
 * signal exists.
 *
 * Atomicity is achieved via `UPDATE … RETURNING` (SQLite ≥ 3.35), which
 * means the stamp and the read happen in a single statement — no window for
 * a concurrent consumer to claim the same row.
 *
 * @param db          - The open database connection.
 * @param directiveId - The directive whose signals to check.
 * @param signalType  - The signal kind to consume.
 * @returns The consumed {@link DirectiveSignal}, or `undefined` if none pending.
 */
export function consumeNext(
  db: Database,
  directiveId: string,
  signalType: string,
): DirectiveSignal | undefined {
  // Identify the oldest unconsumed signal first (ORDER BY created_at + id
  // for stable tiebreaking within the same millisecond), then stamp it in
  // one UPDATE...RETURNING statement so consumption is atomic.
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `UPDATE directive_signals
          SET consumed_at = ?
        WHERE id = (
          SELECT id FROM directive_signals
           WHERE directive_id = ?
             AND signal_type = ?
             AND consumed_at IS NULL
           ORDER BY created_at ASC, id ASC
           LIMIT 1
        )
        RETURNING *`,
    )
    .all(now, directiveId, signalType) as Row[];
  const first = rows[0];
  return first !== undefined ? rowToSignal(first) : undefined;
}

/**
 * List all unconsumed signals for a directive, oldest first.
 *
 * Useful for the brain's startup pass — after a crash and restart it can
 * drain any signals that arrived while it was down before re-entering the
 * normal claim loop.
 *
 * @param db          - The open database connection.
 * @param directiveId - The directive whose pending signals to list.
 * @returns Array of {@link DirectiveSignal} with `consumedAt === null`,
 *          ordered by `created_at ASC, id ASC`.
 */
export function pendingForDirective(db: Database, directiveId: string): DirectiveSignal[] {
  const rows = db
    .prepare(
      `SELECT * FROM directive_signals
        WHERE directive_id = ?
          AND consumed_at IS NULL
        ORDER BY created_at ASC, id ASC`,
    )
    .all(directiveId) as Row[];
  return rows.map(rowToSignal);
}

/**
 * Return directive IDs that have at least one unconsumed signal of the given
 * type AND whose directive row has `status = 'running'`.
 *
 * Used by the brain's serve loop to discover `task_retry` signals that need
 * re-entry. The query joins on `directives` so that signals targeting
 * non-running directives (e.g. already `complete` or `blocked`) are ignored.
 *
 * Returns distinct directive IDs ordered by the oldest pending signal's
 * `created_at` so the brain processes retries in FIFO order.
 */
export function directiveIdsWithPendingSignal(db: Database, signalType: string): string[] {
  const rows = db
    .prepare(
      `SELECT ds.directive_id, MIN(ds.created_at) AS oldest
         FROM directive_signals ds
         JOIN directives d ON d.id = ds.directive_id
        WHERE ds.signal_type = ?
          AND ds.consumed_at IS NULL
          AND d.status = 'running'
        GROUP BY ds.directive_id
        ORDER BY oldest ASC`,
    )
    .all(signalType) as Array<{ directive_id: string; oldest: string }>;
  return rows.map((r) => r.directive_id);
}
