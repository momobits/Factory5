import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { runMigrations } from './index.js';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function dbAtSchemaVersion(maxId: number): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, { maxId });
  return db;
}

function seedDirective(db: BetterSqlite3.Database, id: string, status = 'running'): void {
  db.prepare(
    `INSERT INTO directives
       (id, source, principal, channel_ref, intent, payload_json, autonomy, created_at, status)
     VALUES (?, 'cli', 'tester', 'sess-1', 'build', '{}', 'autonomous', '2026-05-16T00:00:00.000Z', ?)`,
  ).run(id, status);
}

describe('migration 010 — directive-log-lines schema shape', () => {
  it('adds the directive_log_lines table with the expected columns', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(directive_log_lines)').all() as ColumnInfo[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect(byName.has('id')).toBe(true);
    expect(byName.has('directive_id')).toBe(true);
    expect(byName.has('ts')).toBe(true);
    expect(byName.has('level')).toBe(true);
    expect(byName.has('component')).toBe(true);
    expect(byName.has('msg')).toBe(true);
    expect(byName.has('attrs_json')).toBe(true);

    expect(byName.get('id')?.pk).toBe(1);
    expect(byName.get('directive_id')?.notnull).toBe(1);
    expect(byName.get('ts')?.notnull).toBe(1);
    expect(byName.get('level')?.notnull).toBe(1);
    expect(byName.get('component')?.notnull).toBe(1);
    expect(byName.get('msg')?.notnull).toBe(1);
    // attrs_json is optional (per ADR 0029).
    expect(byName.get('attrs_json')?.notnull).toBe(0);
  });

  it('creates an index on (directive_id, ts) so per-directive ordered reads are cheap', () => {
    const db = freshDb();
    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'index' AND tbl_name = 'directive_log_lines'`,
      )
      .all() as { name: string }[];
    expect(indexes.some((i) => i.name === 'idx_directive_log_lines_directive_ts')).toBe(true);
  });

  it('does not exist at schema version 9 (pre-migration-010)', () => {
    const db = dbAtSchemaVersion(9);
    const row = db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name = 'directive_log_lines'`,
      )
      .get();
    expect(row).toBeUndefined();
  });

  it('cascades on directive delete — log rows go with the parent', () => {
    const db = freshDb();
    seedDirective(db, '01KRR0LOG0PARENT0DIRECTIVE0');
    db.prepare(
      `INSERT INTO directive_log_lines
         (directive_id, ts, level, component, msg, attrs_json)
       VALUES (?, '2026-05-16T01:00:00.000Z', 'info', 'brain.test', 'hello', NULL)`,
    ).run('01KRR0LOG0PARENT0DIRECTIVE0');

    const before = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM directive_log_lines WHERE directive_id = ?`)
        .get('01KRR0LOG0PARENT0DIRECTIVE0') as { c: number }
    ).c;
    expect(before).toBe(1);

    db.prepare(`DELETE FROM directives WHERE id = ?`).run('01KRR0LOG0PARENT0DIRECTIVE0');

    const after = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM directive_log_lines WHERE directive_id = ?`)
        .get('01KRR0LOG0PARENT0DIRECTIVE0') as { c: number }
    ).c;
    expect(after).toBe(0);
  });

  it('round-trips a typical log.line event including JSON attrs', () => {
    const db = freshDb();
    seedDirective(db, '01KRR0LOG0ROUND0TRIP0DIRECT');
    const attrs = { detail: 'first 500 chars of LLM output', zodIssues: [{ path: ['tasks'] }] };
    db.prepare(
      `INSERT INTO directive_log_lines
         (directive_id, ts, level, component, msg, attrs_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      '01KRR0LOG0ROUND0TRIP0DIRECT',
      '2026-05-16T01:00:00.000Z',
      'error',
      'brain.planner',
      'planner: schema parse failed',
      JSON.stringify(attrs),
    );
    const row = db
      .prepare(`SELECT * FROM directive_log_lines WHERE directive_id = ?`)
      .get('01KRR0LOG0ROUND0TRIP0DIRECT') as Record<string, unknown>;
    expect(row['level']).toBe('error');
    expect(row['component']).toBe('brain.planner');
    expect(row['msg']).toBe('planner: schema parse failed');
    expect(JSON.parse(row['attrs_json'] as string)).toEqual(attrs);
  });

  it('migrations table records id=10', () => {
    const db = freshDb();
    const ids = (db.prepare('SELECT id FROM migrations ORDER BY id').all() as { id: number }[]).map(
      (r) => r.id,
    );
    expect(ids).toContain(10);
  });
});
