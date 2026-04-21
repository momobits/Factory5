import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { runMigrations } from './index.js';

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

describe('migration 005-directive-limits — schema shape', () => {
  it('adds nullable max_usd REAL and max_steps INTEGER columns', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(directives)').all() as ColumnInfo[];
    const maxUsd = cols.find((c) => c.name === 'max_usd');
    const maxSteps = cols.find((c) => c.name === 'max_steps');
    expect(maxUsd, 'max_usd column missing').toBeDefined();
    expect(maxUsd?.type).toBe('REAL');
    expect(Boolean(maxUsd?.notnull)).toBe(false);
    expect(maxSteps, 'max_steps column missing').toBeDefined();
    expect(maxSteps?.type).toBe('INTEGER');
    expect(Boolean(maxSteps?.notnull)).toBe(false);
  });

  it('accepts NULL for both columns — unlimited budget is the default', () => {
    const db = freshDb();
    const now = '2026-04-21T10:00:00.000Z';
    db.prepare(
      `INSERT INTO directives
         (id, source, principal, channel_ref, intent, payload_json, autonomy,
          created_at, status)
       VALUES (?, 'cli', 'u', 'r', 'build', '{}', 'autonomous', ?, 'pending')`,
    ).run('01KPRG0000000000000000AAAA', now);
    const row = db
      .prepare('SELECT max_usd, max_steps FROM directives WHERE id = ?')
      .get('01KPRG0000000000000000AAAA') as { max_usd: number | null; max_steps: number | null };
    expect(row.max_usd).toBeNull();
    expect(row.max_steps).toBeNull();
  });

  it('round-trips non-null budget values', () => {
    const db = freshDb();
    const now = '2026-04-21T10:00:00.000Z';
    db.prepare(
      `INSERT INTO directives
         (id, source, principal, channel_ref, intent, payload_json, autonomy,
          created_at, status, max_usd, max_steps)
       VALUES (?, 'cli', 'u', 'r', 'build', '{}', 'autonomous', ?, 'pending', ?, ?)`,
    ).run('01KPRG0000000000000000BBBB', now, 3.5, 40);
    const row = db
      .prepare('SELECT max_usd, max_steps FROM directives WHERE id = ?')
      .get('01KPRG0000000000000000BBBB') as { max_usd: number; max_steps: number };
    expect(row.max_usd).toBeCloseTo(3.5);
    expect(row.max_steps).toBe(40);
  });
});
