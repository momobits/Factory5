/**
 * Typed CRUD for the `outbound_messages` table.
 */

import { outboundMessageSchema, type OutboundMessage } from '@factory5/core';

import type { Database } from '../db.js';

interface Row {
  id: string;
  directive_id: string | null;
  target_channel: string;
  target_ref: string;
  text: string;
  metadata_json: string | null;
  created_at: string;
  delivered_at: string | null;
  attempts: number;
  last_error: string | null;
}

function rowToMessage(row: Row): OutboundMessage {
  return outboundMessageSchema.parse({
    id: row.id,
    ...(row.directive_id !== null ? { directiveId: row.directive_id } : {}),
    targetChannel: row.target_channel,
    targetRef: row.target_ref,
    text: row.text,
    ...(row.metadata_json !== null ? { metadata: JSON.parse(row.metadata_json) } : {}),
    createdAt: row.created_at,
    ...(row.delivered_at !== null ? { deliveredAt: row.delivered_at } : {}),
    attempts: row.attempts,
    ...(row.last_error !== null ? { lastError: row.last_error } : {}),
  });
}

/** Enqueue an outbound message for the daemon to deliver. */
export function enqueue(db: Database, msg: OutboundMessage): void {
  const validated = outboundMessageSchema.parse(msg);
  db.prepare(
    `INSERT INTO outbound_messages
       (id, directive_id, target_channel, target_ref, text, metadata_json,
        created_at, delivered_at, attempts, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    validated.id,
    validated.directiveId ?? null,
    validated.targetChannel,
    validated.targetRef,
    validated.text,
    validated.metadata !== undefined ? JSON.stringify(validated.metadata) : null,
    validated.createdAt,
    validated.deliveredAt ?? null,
    validated.attempts,
    validated.lastError ?? null,
  );
}

/** Pending (undelivered) messages, oldest first. */
export function listPending(db: Database, limit = 50): OutboundMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM outbound_messages
       WHERE delivered_at IS NULL
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(limit) as Row[];
  return rows.map(rowToMessage);
}

/** Mark a message as delivered. */
export function markDelivered(db: Database, id: string, when: string): void {
  db.prepare('UPDATE outbound_messages SET delivered_at = ? WHERE id = ?').run(when, id);
}

/** Record a delivery failure (increments attempts, records last error). */
export function recordFailure(db: Database, id: string, error: string): void {
  db.prepare(
    'UPDATE outbound_messages SET attempts = attempts + 1, last_error = ? WHERE id = ?',
  ).run(error, id);
}
