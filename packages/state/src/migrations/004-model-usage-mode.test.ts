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

describe('migration 004-model-usage-mode — schema shape', () => {
  it('adds a nullable `mode` TEXT column to model_usage', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(model_usage)').all() as ColumnInfo[];
    const mode = cols.find((c) => c.name === 'mode');
    expect(mode, 'mode column missing').toBeDefined();
    expect(mode?.type).toBe('TEXT');
    expect(Boolean(mode?.notnull)).toBe(false);
    expect(mode?.pk).toBe(0);
  });

  it('CHECK constraint accepts call / stream and rejects anything else', () => {
    const db = freshDb();
    const insert = (mode: string | null): void => {
      const args: unknown[] = [
        'u1',
        null,
        null,
        'stub',
        'model',
        'quick',
        mode,
        0,
        0,
        0.0,
        0,
        '2026-04-21T00:00:00.000Z',
        null,
      ];
      db.prepare(
        `INSERT INTO model_usage
           (id, directive_id, task_id, provider, model, category, mode,
            input_tokens, output_tokens, cost_usd, duration_ms, called_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(...args);
    };

    insert('call');
    db.prepare('DELETE FROM model_usage').run();
    insert('stream');
    db.prepare('DELETE FROM model_usage').run();
    insert(null); // NULL bypasses CHECK — pre-migration rows stay legal
    db.prepare('DELETE FROM model_usage').run();
    expect(() => insert('batch')).toThrow(/CHECK/);
  });

  it('exposes idx_usage_category_mode non-unique index over (category, mode)', () => {
    const db = freshDb();
    const indexes = db.prepare('PRAGMA index_list(model_usage)').all() as IndexInfo[];
    const idx = indexes.find((i) => i.name === 'idx_usage_category_mode');
    expect(idx, 'idx_usage_category_mode index missing').toBeDefined();
    expect(idx?.unique).toBe(0);
    const cols = db.prepare("PRAGMA index_info('idx_usage_category_mode')").all() as {
      name: string;
    }[];
    expect(cols.map((c) => c.name)).toEqual(['category', 'mode']);
  });

  it('runs idempotently — applied migrations land exactly once', () => {
    const db = freshDb();
    runMigrations(db);
    runMigrations(db);
    const appliedIds = (
      db.prepare('SELECT id FROM migrations ORDER BY id').all() as { id: number }[]
    ).map((r) => r.id);
    expect(appliedIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
