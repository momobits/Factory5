import { newId } from '@factory5/core';
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../migrations/index.js';
import * as modelUsage from './model-usage.js';

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/**
 * Insert a minimum-viable directives row so a `model_usage.directive_id`
 * FK reference resolves. We use direct SQL so these tests don't depend
 * on the `directives` query module.
 */
function ensureDirective(db: BetterSqlite3.Database, id: string): void {
  const existing = db.prepare('SELECT id FROM directives WHERE id = ?').get(id) as
    | { id: string }
    | undefined;
  if (existing !== undefined) return;
  db.prepare(
    `INSERT INTO directives
       (id, source, principal, channel_ref, intent, payload_json, autonomy, created_at, status)
     VALUES (?, 'cli', 'test', 'test', 'build', '{}', 'autonomous', ?, 'pending')`,
  ).run(id, '2026-04-21T00:00:00.000Z');
}

type RecordOpts = Partial<Omit<modelUsage.UsageRecord, 'id' | 'calledAt'>> & {
  calledAt?: string;
};

function seed(db: BetterSqlite3.Database, i: number, opts: RecordOpts = {}): string {
  const id = newId();
  if (opts.directiveId !== undefined) ensureDirective(db, opts.directiveId);
  modelUsage.record(db, {
    id,
    provider: opts.provider ?? 'claude-cli',
    model: opts.model ?? 'claude-opus-4-7',
    category: opts.category ?? 'reasoning',
    inputTokens: opts.inputTokens ?? 1_000,
    outputTokens: opts.outputTokens ?? 5_000,
    costUsd: opts.costUsd ?? 0.5,
    durationMs: opts.durationMs ?? 10_000,
    calledAt: opts.calledAt ?? new Date(1_714_000_000_000 + i * 1_000).toISOString(),
    ...(opts.directiveId !== undefined ? { directiveId: opts.directiveId } : {}),
    ...(opts.taskId !== undefined ? { taskId: opts.taskId } : {}),
    ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
    ...(opts.error !== undefined ? { error: opts.error } : {}),
  });
  return id;
}

describe('modelUsage.record — mode column round-trip', () => {
  it('persists and re-reads the mode value', () => {
    const db = freshDb();
    seed(db, 0, { directiveId: 'd1', mode: 'stream', costUsd: 1.0 });
    const rows = modelUsage.listForDirective(db, 'd1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.mode).toBe('stream');
  });

  it('leaves mode undefined when the caller omits it (legacy compatibility)', () => {
    const db = freshDb();
    seed(db, 0, { directiveId: 'd1', costUsd: 0.1 });
    const rows = modelUsage.listForDirective(db, 'd1');
    expect(rows[0]?.mode).toBeUndefined();
  });
});

describe('modelUsage.countForDirective', () => {
  let db: BetterSqlite3.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('returns zero when no calls have been recorded for the directive', () => {
    expect(modelUsage.countForDirective(db, 'nonexistent')).toBe(0);
  });

  it('counts only rows scoped to the given directive', () => {
    for (let i = 0; i < 3; i++) seed(db, i, { directiveId: 'd1' });
    for (let i = 0; i < 5; i++) seed(db, 10 + i, { directiveId: 'd2' });
    seed(db, 20); // no directive_id
    expect(modelUsage.countForDirective(db, 'd1')).toBe(3);
    expect(modelUsage.countForDirective(db, 'd2')).toBe(5);
  });

  it('counts error rows too — a failed call still counts against max_steps', () => {
    seed(db, 0, { directiveId: 'd1' });
    seed(db, 1, { directiveId: 'd1', error: 'provider blew up' });
    expect(modelUsage.countForDirective(db, 'd1')).toBe(2);
  });
});

describe('modelUsage.averageCostByCategory', () => {
  let db: BetterSqlite3.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('returns undefined when no rows match the (category, mode) bucket', () => {
    expect(modelUsage.averageCostByCategory(db, 'reasoning', 'stream')).toBeUndefined();
  });

  it('returns the mean cost of matching rows', () => {
    seed(db, 0, { category: 'reasoning', mode: 'stream', costUsd: 1.0 });
    seed(db, 1, { category: 'reasoning', mode: 'stream', costUsd: 2.0 });
    seed(db, 2, { category: 'reasoning', mode: 'stream', costUsd: 3.0 });
    expect(modelUsage.averageCostByCategory(db, 'reasoning', 'stream')).toBe(2.0);
  });

  it('segregates buckets by mode', () => {
    seed(db, 0, { category: 'reasoning', mode: 'call', costUsd: 0.05 });
    seed(db, 1, { category: 'reasoning', mode: 'call', costUsd: 0.15 });
    seed(db, 2, { category: 'reasoning', mode: 'stream', costUsd: 2.0 });
    seed(db, 3, { category: 'reasoning', mode: 'stream', costUsd: 3.0 });
    expect(modelUsage.averageCostByCategory(db, 'reasoning', 'call')).toBeCloseTo(0.1);
    expect(modelUsage.averageCostByCategory(db, 'reasoning', 'stream')).toBeCloseTo(2.5);
  });

  it('segregates buckets by category', () => {
    seed(db, 0, { category: 'quick', mode: 'call', costUsd: 0.01 });
    seed(db, 1, { category: 'planning', mode: 'call', costUsd: 0.2 });
    seed(db, 2, { category: 'reasoning', mode: 'call', costUsd: 0.5 });
    expect(modelUsage.averageCostByCategory(db, 'quick', 'call')).toBeCloseTo(0.01);
    expect(modelUsage.averageCostByCategory(db, 'planning', 'call')).toBeCloseTo(0.2);
    expect(modelUsage.averageCostByCategory(db, 'reasoning', 'call')).toBeCloseTo(0.5);
  });

  it('excludes error rows — a failed call biases the estimate low', () => {
    seed(db, 0, { category: 'reasoning', mode: 'stream', costUsd: 2.0 });
    seed(db, 1, { category: 'reasoning', mode: 'stream', costUsd: 2.0 });
    seed(db, 2, {
      category: 'reasoning',
      mode: 'stream',
      costUsd: 0.05,
      error: 'subprocess died',
    });
    expect(modelUsage.averageCostByCategory(db, 'reasoning', 'stream')).toBeCloseTo(2.0);
  });

  it('excludes NULL-mode rows — legacy rows do not poison the average', () => {
    seed(db, 0, { category: 'reasoning', mode: 'stream', costUsd: 2.0 });
    seed(db, 1, { category: 'reasoning', costUsd: 0.05 }); // legacy row, no mode
    expect(modelUsage.averageCostByCategory(db, 'reasoning', 'stream')).toBeCloseTo(2.0);
  });

  it('honors sampleSize — takes only the most recent N rows by called_at DESC', () => {
    // Seed 10 rows at $1, then 3 rows at $10. The last 3 are the newest by
    // called_at because seed uses `1_714_000_000_000 + i * 1_000`.
    for (let i = 0; i < 10; i++) {
      seed(db, i, { category: 'reasoning', mode: 'stream', costUsd: 1.0 });
    }
    for (let i = 0; i < 3; i++) {
      seed(db, 100 + i, { category: 'reasoning', mode: 'stream', costUsd: 10.0 });
    }
    expect(modelUsage.averageCostByCategory(db, 'reasoning', 'stream', 3)).toBeCloseTo(10.0);
    expect(modelUsage.averageCostByCategory(db, 'reasoning', 'stream', 13)).toBeCloseTo(
      (10 * 1 + 3 * 10) / 13,
    );
  });

  it('defaults sampleSize to 20 when omitted', () => {
    for (let i = 0; i < 15; i++) {
      seed(db, i, { category: 'reasoning', mode: 'stream', costUsd: 1.0 });
    }
    for (let i = 0; i < 10; i++) {
      seed(db, 100 + i, { category: 'reasoning', mode: 'stream', costUsd: 2.0 });
    }
    // 20 newest = 10 at $2 + 10 at $1 → mean = 1.5
    expect(modelUsage.averageCostByCategory(db, 'reasoning', 'stream')).toBeCloseTo(1.5);
  });
});

describe('modelUsage.totalCostForDirective — untouched by ADR 0020 changes', () => {
  it('sums cost_usd across every row regardless of mode or error', () => {
    const db = freshDb();
    seed(db, 0, { directiveId: 'd1', mode: 'stream', costUsd: 1.0 });
    seed(db, 1, { directiveId: 'd1', mode: 'call', costUsd: 0.2 });
    seed(db, 2, { directiveId: 'd1', costUsd: 0.05, error: 'timeout' });
    expect(modelUsage.totalCostForDirective(db, 'd1')).toBeCloseTo(1.25);
  });
});
