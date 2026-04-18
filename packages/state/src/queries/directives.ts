/**
 * Typed CRUD for the `directives` table.
 *
 * The brain claims pending directives via {@link claimNext}; channels insert
 * via {@link insert}; transitions via {@link updateStatus}.
 */

import { directiveSchema, type Directive } from '@factory5/core';

import type { Database } from '../db.js';

interface Row {
  id: string;
  source: string;
  principal: string;
  channel_ref: string;
  intent: string;
  payload_json: string;
  autonomy: string;
  created_at: string;
  status: string;
  claimed_by: string | null;
  parent_directive_id: string | null;
}

function rowToDirective(row: Row): Directive {
  return directiveSchema.parse({
    id: row.id,
    source: row.source,
    principal: row.principal,
    channelRef: row.channel_ref,
    intent: row.intent,
    payload: JSON.parse(row.payload_json),
    autonomy: row.autonomy,
    createdAt: row.created_at,
    status: row.status,
    ...(row.claimed_by !== null ? { claimedBy: row.claimed_by } : {}),
    ...(row.parent_directive_id !== null ? { parentDirectiveId: row.parent_directive_id } : {}),
  });
}

/** Insert a fresh directive. Validates against the schema. */
export function insert(db: Database, d: Directive): void {
  const validated = directiveSchema.parse(d);
  db.prepare(
    `INSERT INTO directives
       (id, source, principal, channel_ref, intent, payload_json, autonomy,
        created_at, status, claimed_by, parent_directive_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    validated.id,
    validated.source,
    validated.principal,
    validated.channelRef,
    validated.intent,
    JSON.stringify(validated.payload ?? null),
    validated.autonomy,
    validated.createdAt,
    validated.status,
    validated.claimedBy ?? null,
    validated.parentDirectiveId ?? null,
  );
}

/** Fetch a directive by id. */
export function getById(db: Database, id: string): Directive | undefined {
  const row = db.prepare('SELECT * FROM directives WHERE id = ?').get(id) as Row | undefined;
  return row !== undefined ? rowToDirective(row) : undefined;
}

/** List directives by status (most-recent first), limited. */
export function listByStatus(db: Database, status: Directive['status'], limit = 50): Directive[] {
  const rows = db
    .prepare('SELECT * FROM directives WHERE status = ? ORDER BY created_at DESC LIMIT ?')
    .all(status, limit) as Row[];
  return rows.map(rowToDirective);
}

/**
 * Atomically claim the next pending directive (FIFO). Returns the claimed
 * directive or `undefined` if the queue is empty.
 */
export function claimNext(db: Database, opts: { claimedBy: string }): Directive | undefined {
  const claimTx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM directives
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get() as Row | undefined;
    if (row === undefined) return undefined;
    db.prepare(`UPDATE directives SET status = 'claimed', claimed_by = ? WHERE id = ?`).run(
      opts.claimedBy,
      row.id,
    );
    return rowToDirective({ ...row, status: 'claimed', claimed_by: opts.claimedBy });
  });
  return claimTx();
}

/** Update a directive's status. */
export function updateStatus(db: Database, id: string, status: Directive['status']): void {
  db.prepare('UPDATE directives SET status = ? WHERE id = ?').run(status, id);
}

/** List the most recent N directives across all statuses. */
export function listRecent(db: Database, limit = 50): Directive[] {
  const rows = db
    .prepare('SELECT * FROM directives ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Row[];
  return rows.map(rowToDirective);
}
