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
}

interface FkInfo {
  table: string;
  from: string;
  to: string;
  on_delete: string;
}

describe('migration 003-findings-registry — schema shape', () => {
  it('declares every expected column with the right type and nullability', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(findings_registry)').all() as ColumnInfo[];
    const byName = new Map(cols.map((c) => [c.name, c]));
    const expected: Record<string, { type: string; notnull: boolean; pk: boolean }> = {
      project_id: { type: 'TEXT', notnull: true, pk: true },
      project_path: { type: 'TEXT', notnull: true, pk: false },
      finding_id: { type: 'TEXT', notnull: true, pk: true },
      source: { type: 'TEXT', notnull: true, pk: false },
      target: { type: 'TEXT', notnull: true, pk: false },
      severity: { type: 'TEXT', notnull: true, pk: false },
      status: { type: 'TEXT', notnull: true, pk: false },
      description: { type: 'TEXT', notnull: true, pk: false },
      resolution: { type: 'TEXT', notnull: false, pk: false },
      advisory: { type: 'INTEGER', notnull: true, pk: false },
      origin_directive_id: { type: 'TEXT', notnull: false, pk: false },
      created_at: { type: 'TEXT', notnull: true, pk: false },
      resolved_at: { type: 'TEXT', notnull: false, pk: false },
      updated_at: { type: 'TEXT', notnull: true, pk: false },
    };
    for (const [name, spec] of Object.entries(expected)) {
      const col = byName.get(name);
      expect(col, `column ${name} missing`).toBeDefined();
      expect(col?.type).toBe(spec.type);
      expect(Boolean(col?.notnull)).toBe(spec.notnull);
      expect(Boolean(col?.pk)).toBe(spec.pk);
    }
    expect(cols).toHaveLength(Object.keys(expected).length);
  });

  it('PRIMARY KEY is composite (project_id, finding_id)', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(findings_registry)').all() as ColumnInfo[];
    const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
    expect(pkCols.map((c) => c.name)).toEqual(['project_id', 'finding_id']);
  });

  it('FK origin_directive_id → directives(id) with ON DELETE SET NULL', () => {
    const db = freshDb();
    const fks = db.prepare('PRAGMA foreign_key_list(findings_registry)').all() as FkInfo[];
    expect(fks).toHaveLength(1);
    const fk = fks[0]!;
    expect(fk.table).toBe('directives');
    expect(fk.from).toBe('origin_directive_id');
    expect(fk.to).toBe('id');
    expect(fk.on_delete).toBe('SET NULL');
  });

  it('CHECK constraint rejects invalid severity', () => {
    const db = freshDb();
    const now = '2026-04-21T10:00:00.000Z';
    expect(() => {
      db.prepare(
        `INSERT INTO findings_registry
           (project_id, project_path, finding_id, source, target, severity, status,
            description, advisory, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('p', '/tmp/p', 'F001', 'reviewer', 'x', 'SCARY', 'OPEN', 'd', 0, now, now);
    }).toThrow(/CHECK/);
  });

  it('CHECK constraint rejects invalid status', () => {
    const db = freshDb();
    const now = '2026-04-21T10:00:00.000Z';
    expect(() => {
      db.prepare(
        `INSERT INTO findings_registry
           (project_id, project_path, finding_id, source, target, severity, status,
            description, advisory, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('p', '/tmp/p', 'F001', 'reviewer', 'x', 'HIGH', 'DONE', 'd', 0, now, now);
    }).toThrow(/CHECK/);
  });

  it('CHECK constraint rejects advisory values outside {0, 1}', () => {
    const db = freshDb();
    const now = '2026-04-21T10:00:00.000Z';
    expect(() => {
      db.prepare(
        `INSERT INTO findings_registry
           (project_id, project_path, finding_id, source, target, severity, status,
            description, advisory, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('p', '/tmp/p', 'F001', 'reviewer', 'x', 'HIGH', 'OPEN', 'd', 2, now, now);
    }).toThrow(/CHECK/);
  });

  it('exposes idx_findings_registry_severity_status non-unique index', () => {
    const db = freshDb();
    const indexes = db.prepare('PRAGMA index_list(findings_registry)').all() as IndexInfo[];
    const explicit = indexes.find((i) => i.name === 'idx_findings_registry_severity_status');
    expect(explicit, 'severity/status index missing').toBeDefined();
    expect(explicit?.unique).toBe(0);
    const cols = db.prepare("PRAGMA index_info('idx_findings_registry_severity_status')").all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).toEqual(['severity', 'status']);
  });

  it('composite PK conflict triggers upsert, not insert failure', () => {
    const db = freshDb();
    const now = '2026-04-21T10:00:00.000Z';
    const insertSql = `INSERT INTO findings_registry
      (project_id, project_path, finding_id, source, target, severity, status,
       description, advisory, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, finding_id) DO UPDATE SET status = excluded.status`;
    db.prepare(insertSql).run(
      'p',
      '/tmp/p',
      'F001',
      'reviewer',
      'x',
      'HIGH',
      'OPEN',
      'd',
      0,
      now,
      now,
    );
    db.prepare(insertSql).run(
      'p',
      '/tmp/p',
      'F001',
      'reviewer',
      'x',
      'HIGH',
      'FIXED',
      'd',
      0,
      now,
      now,
    );
    const rows = db
      .prepare('SELECT status FROM findings_registry WHERE project_id = ? AND finding_id = ?')
      .all('p', 'F001') as { status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('FIXED');
  });

  it('runs idempotently — re-applying migrations is a no-op on an up-to-date DB', () => {
    const db = freshDb();
    runMigrations(db); // second pass
    runMigrations(db); // third pass
    const appliedIds = (
      db.prepare('SELECT id FROM migrations ORDER BY id').all() as { id: number }[]
    ).map((r) => r.id);
    expect(appliedIds).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
