/**
 * Typed CRUD for the `events_audit` table — append-only log of observed events.
 */

import { eventSchema, type Event } from '@factory5/core';

import type { Database } from '../db.js';

interface Row {
  id: string;
  source: string;
  kind: string;
  body_json: string;
  metadata_json: string;
  received_at: string;
}

function rowToEvent(row: Row): Event {
  return eventSchema.parse({
    id: row.id,
    source: row.source,
    body: JSON.parse(row.body_json),
    metadata: JSON.parse(row.metadata_json),
    receivedAt: row.received_at,
  });
}

/** Append an event to the audit log. */
export function append(db: Database, event: Event): void {
  const validated = eventSchema.parse(event);
  db.prepare(
    `INSERT INTO events_audit (id, source, kind, body_json, metadata_json, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    validated.id,
    validated.source,
    validated.body.kind,
    JSON.stringify(validated.body),
    JSON.stringify(validated.metadata),
    validated.receivedAt,
  );
}

/** Fetch an event by id. */
export function getById(db: Database, id: string): Event | undefined {
  const row = db.prepare('SELECT * FROM events_audit WHERE id = ?').get(id) as
    | Row
    | undefined;
  return row !== undefined ? rowToEvent(row) : undefined;
}

/** Recent events of a specific kind, newest first. */
export function recentByKind(db: Database, kind: string, limit = 50): Event[] {
  const rows = db
    .prepare(
      `SELECT * FROM events_audit WHERE kind = ? ORDER BY received_at DESC LIMIT ?`,
    )
    .all(kind, limit) as Row[];
  return rows.map(rowToEvent);
}
