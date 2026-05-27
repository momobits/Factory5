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

interface IndexInfo {
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

function seedDirective(db: BetterSqlite3.Database, id: string): void {
  db.prepare(
    `INSERT INTO directives
       (id, source, principal, channel_ref, intent, payload_json, autonomy,
        created_at, status)
     VALUES (?, 'cli', 'u', 'r', 'build', '{}', 'autonomous',
             '2026-04-23T00:00:00.000Z', 'pending')`,
  ).run(id);
}

function seedTask(
  db: BetterSqlite3.Database,
  taskId: string,
  directiveId: string,
  status: string,
): void {
  db.prepare(
    `INSERT INTO tasks_inflight
       (id, directive_id, plan_id, title, agent, category, status, attempts)
     VALUES (?, ?, 'plan-1', 'title', 'builder', 'deep', ?, 0)`,
  ).run(taskId, directiveId, status);
}

describe('migration 007-task-waiting-for-human — schema shape', () => {
  it('adds waiting_question_id and aborted_reason columns (both nullable TEXT)', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(tasks_inflight)').all() as ColumnInfo[];

    const waiting = cols.find((c) => c.name === 'waiting_question_id');
    expect(waiting, 'waiting_question_id missing').toBeDefined();
    expect(waiting?.type).toBe('TEXT');
    expect(Boolean(waiting?.notnull)).toBe(false);

    const aborted = cols.find((c) => c.name === 'aborted_reason');
    expect(aborted, 'aborted_reason missing').toBeDefined();
    expect(aborted?.type).toBe('TEXT');
    expect(Boolean(aborted?.notnull)).toBe(false);
  });

  it('preserves the original 14 columns + adds 2 (007) + adds 3 (011) = 19 total', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(tasks_inflight)').all() as ColumnInfo[];
    expect(cols).toHaveLength(19);
    // Spot-check a few originals to confirm rebuild preserved everything.
    expect(cols.find((c) => c.name === 'id')?.pk).toBe(1);
    expect(cols.find((c) => c.name === 'directive_id')?.notnull).toBe(1);
    expect(cols.find((c) => c.name === 'last_heartbeat')?.type).toBe('TEXT');
  });

  it('reinstates idx_tasks_status and idx_tasks_directive after the table rebuild', () => {
    const db = freshDb();
    const indexes = db.prepare('PRAGMA index_list(tasks_inflight)').all() as IndexInfo[];
    const names = new Set(indexes.map((i) => i.name));
    expect(names.has('idx_tasks_status')).toBe(true);
    expect(names.has('idx_tasks_directive')).toBe(true);
  });

  it('adds the partial idx_tasks_waiting_for_human index for the orphan-cleanup scan', () => {
    const db = freshDb();
    const indexes = db.prepare('PRAGMA index_list(tasks_inflight)').all() as IndexInfo[];
    const partial = indexes.find((i) => i.name === 'idx_tasks_waiting_for_human');
    expect(partial, 'partial index missing').toBeDefined();
    expect(partial?.partial).toBe(1);
  });
});

describe('migration 007 — CHECK constraint widening', () => {
  it('accepts the existing five status values', () => {
    const db = freshDb();
    seedDirective(db, '01KPRG0000000000000000AAAA');
    for (const status of ['pending', 'running', 'complete', 'failed', 'blocked']) {
      const taskId = `01KPRG0000000000000000${status.toUpperCase().padEnd(4, 'A').slice(0, 4)}`;
      expect(() => seedTask(db, taskId, '01KPRG0000000000000000AAAA', status)).not.toThrow();
    }
  });

  it('accepts the new waiting_for_human status', () => {
    const db = freshDb();
    seedDirective(db, '01KPRG0000000000000000AAAA');
    expect(() =>
      seedTask(db, '01KPRG000000000000000WAITA', '01KPRG0000000000000000AAAA', 'waiting_for_human'),
    ).not.toThrow();
  });

  it('accepts the new aborted status', () => {
    const db = freshDb();
    seedDirective(db, '01KPRG0000000000000000AAAA');
    expect(() =>
      seedTask(db, '01KPRG000000000000000ABRTA', '01KPRG0000000000000000AAAA', 'aborted'),
    ).not.toThrow();
  });

  it('rejects an unknown status (CHECK constraint enforcement)', () => {
    const db = freshDb();
    seedDirective(db, '01KPRG0000000000000000AAAA');
    expect(() =>
      seedTask(db, '01KPRG000000000000000XXXXA', '01KPRG0000000000000000AAAA', 'wat-no'),
    ).toThrow();
  });
});

describe('migration 007 — backwards-data preservation', () => {
  it('migrates existing tasks_inflight rows through the rebuild without loss', () => {
    // Stage the DB at schema 6 (pre-007), seed a row, then run 007.
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, { maxId: 6 });
    seedDirective(db, '01KPRG0000000000000000AAAA');
    seedTask(db, '01KPRG000000000000000PRESV', '01KPRG0000000000000000AAAA', 'running');
    runMigrations(db);

    const row = db
      .prepare('SELECT id, status, directive_id, agent FROM tasks_inflight WHERE id = ?')
      .get('01KPRG000000000000000PRESV') as Record<string, unknown>;
    expect(row.id).toBe('01KPRG000000000000000PRESV');
    expect(row.status).toBe('running');
    expect(row.directive_id).toBe('01KPRG0000000000000000AAAA');
    expect(row.agent).toBe('builder');
  });
});
