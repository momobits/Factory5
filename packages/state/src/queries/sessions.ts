/**
 * Typed CRUD for the `sessions` table — per-channel conversational state.
 */

import type { AutonomyMode, ChannelId } from '@factory5/core';

import type { Database } from '../db.js';

export interface SessionRecord {
  id: string;
  channel: ChannelId;
  principal: string;
  channelRef: string;
  autonomy: AutonomyMode;
  state: Record<string, unknown>;
  createdAt: string;
  lastActive: string;
}

interface Row {
  id: string;
  channel: string;
  principal: string;
  channel_ref: string;
  autonomy: string;
  state_json: string;
  created_at: string;
  last_active: string;
}

function rowToSession(row: Row): SessionRecord {
  return {
    id: row.id,
    channel: row.channel as ChannelId,
    principal: row.principal,
    channelRef: row.channel_ref,
    autonomy: row.autonomy as AutonomyMode,
    state: JSON.parse(row.state_json) as Record<string, unknown>,
    createdAt: row.created_at,
    lastActive: row.last_active,
  };
}

/** Upsert a session keyed by (channel, channel_ref). */
export function upsert(db: Database, s: SessionRecord): void {
  db.prepare(
    `INSERT INTO sessions (id, channel, principal, channel_ref, autonomy, state_json, created_at, last_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel, channel_ref) DO UPDATE SET
       autonomy    = excluded.autonomy,
       state_json  = excluded.state_json,
       last_active = excluded.last_active`,
  ).run(
    s.id,
    s.channel,
    s.principal,
    s.channelRef,
    s.autonomy,
    JSON.stringify(s.state),
    s.createdAt,
    s.lastActive,
  );
}

/** Find a session by (channel, channelRef). */
export function findByRef(
  db: Database,
  channel: ChannelId,
  channelRef: string,
): SessionRecord | undefined {
  const row = db
    .prepare('SELECT * FROM sessions WHERE channel = ? AND channel_ref = ?')
    .get(channel, channelRef) as Row | undefined;
  return row !== undefined ? rowToSession(row) : undefined;
}

/** Touch the last_active timestamp on a session. */
export function touch(db: Database, id: string, when: string): void {
  db.prepare('UPDATE sessions SET last_active = ? WHERE id = ?').run(when, id);
}
