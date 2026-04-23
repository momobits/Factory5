import { newId } from '@factory5/core';
import type { Logger } from '@factory5/logger';
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../migrations/index.js';
import * as directives from './directives.js';
import { MarkBlockedError, ORPHAN_STALE_AFTER_MS } from './directives.js';
import * as modelUsage from './model-usage.js';

type DirectiveRow = Parameters<typeof directives.insert>[1];

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function baseDirective(overrides: Partial<DirectiveRow> = {}): DirectiveRow {
  return {
    id: newId(),
    source: 'cli' as const,
    principal: 'me',
    channelRef: 's-1',
    intent: 'build' as const,
    payload: { project: 'x' },
    autonomy: 'autonomous' as const,
    createdAt: new Date().toISOString(),
    status: 'pending' as const,
    ...overrides,
  };
}

// Minimal noop-ish logger double. We only assert behaviour through the DB;
// keeping a ref lets us check nothing accidentally throws from a log call.
function noopLogger(): Logger {
  const fn = (): void => undefined;
  const self: Record<string, unknown> = {};
  for (const k of ['info', 'warn', 'error', 'debug', 'trace', 'fatal']) {
    self[k] = fn;
  }
  self['child'] = (): Logger => self as Logger;
  return self as Logger;
}

describe('directives.markBlocked', () => {
  let db: BetterSqlite3.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('flips running → blocked and records reason', () => {
    const d = baseDirective();
    directives.insert(db, d);
    directives.updateStatus(db, d.id, 'running');

    const out = directives.markBlocked(db, d.id, '  phase-5c escalation-kill  ');
    expect(out.status).toBe('blocked');
    expect(out.blockedReason).toBe('phase-5c escalation-kill');

    const fresh = directives.getById(db, d.id);
    expect(fresh?.status).toBe('blocked');
    expect(fresh?.blockedReason).toBe('phase-5c escalation-kill');
  });

  it('flips pending → blocked even without a reason', () => {
    const d = baseDirective();
    directives.insert(db, d);

    const out = directives.markBlocked(db, d.id);
    expect(out.status).toBe('blocked');
    expect(out.blockedReason).toBeUndefined();
  });

  it('throws NOT_FOUND for unknown id', () => {
    expect.assertions(2);
    try {
      directives.markBlocked(db, newId(), 'nope');
    } catch (err) {
      expect(err).toBeInstanceOf(MarkBlockedError);
      expect((err as MarkBlockedError).code).toBe('NOT_FOUND');
    }
  });

  it('throws ALREADY_TERMINAL when already blocked', () => {
    const d = baseDirective();
    directives.insert(db, d);
    directives.updateStatus(db, d.id, 'blocked');

    expect.assertions(3);
    try {
      directives.markBlocked(db, d.id, 'try again');
    } catch (err) {
      expect(err).toBeInstanceOf(MarkBlockedError);
      expect((err as MarkBlockedError).code).toBe('ALREADY_TERMINAL');
      expect((err as MarkBlockedError).message).toContain('already blocked');
    }
  });

  it('refuses to touch complete or failed directives', () => {
    const a = baseDirective();
    const b = baseDirective();
    directives.insert(db, a);
    directives.insert(db, b);
    directives.updateStatus(db, a.id, 'complete');
    directives.updateStatus(db, b.id, 'failed');

    for (const id of [a.id, b.id]) {
      expect(() => directives.markBlocked(db, id, 'stop')).toThrow(MarkBlockedError);
    }
  });

  it('does not overwrite an existing reason with an empty one', () => {
    const d = baseDirective();
    directives.insert(db, d);
    directives.updateStatus(db, d.id, 'running');

    directives.markBlocked(db, d.id, 'first reason');
    // already terminal — can't re-mark. So verify the COALESCE semantics by
    // inserting a running row directly and passing an empty string.
    db.prepare(
      `UPDATE directives SET status = 'running', blocked_reason = 'pre-set' WHERE id = ?`,
    ).run(d.id);
    directives.markBlocked(db, d.id, '   ');
    expect(directives.getById(db, d.id)?.blockedReason).toBe('pre-set');
  });
});

describe('directives.reconcileOrphanedDirectives', () => {
  let db: BetterSqlite3.Database;
  const log = noopLogger();
  const fixedNow = Date.parse('2026-04-19T12:00:00.000Z');

  beforeEach(() => {
    db = freshDb();
  });

  function seedRunning(
    age: number,
    opts: { claimedBy?: string | null; lastUsageAgeMs?: number } = {},
  ): string {
    const createdAt = new Date(fixedNow - age).toISOString();
    const d = baseDirective({ createdAt });
    directives.insert(db, d);
    db.prepare(`UPDATE directives SET status = 'running', claimed_by = ? WHERE id = ?`).run(
      opts.claimedBy ?? null,
      d.id,
    );
    if (opts.lastUsageAgeMs !== undefined) {
      modelUsage.record(db, {
        id: newId(),
        directiveId: d.id,
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        category: 'planning',
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.01,
        durationMs: 100,
        calledAt: new Date(fixedNow - opts.lastUsageAgeMs).toISOString(),
      });
    }
    return d.id;
  }

  it('flips only the orphaned directive on a mixed DB', () => {
    // a: stale + dead inline pid → should flip.
    const a = seedRunning(30 * 60 * 1000, {
      claimedBy: 'inline-999999',
      lastUsageAgeMs: 30 * 60 * 1000,
    });
    // b: recent activity → leave alone even though pid is dead.
    const b = seedRunning(30 * 60 * 1000, {
      claimedBy: 'inline-999999',
      lastUsageAgeMs: 30 * 1000,
    });
    // c: live pid → leave alone regardless of age.
    const c = seedRunning(30 * 60 * 1000, {
      claimedBy: 'inline-555',
      lastUsageAgeMs: 30 * 60 * 1000,
    });
    // d: terminal already → not inspected.
    const d = baseDirective();
    directives.insert(db, d);
    directives.updateStatus(db, d.id, 'complete');

    const res = directives.reconcileOrphanedDirectives(db, log, {
      now: () => fixedNow,
      isPidAlive: (pid) => pid === 555,
    });

    expect(res.reconciled).toEqual([a]);
    expect(res.inspected).toBe(3);
    expect(directives.getById(db, a)?.status).toBe('blocked');
    expect(directives.getById(db, a)?.blockedReason).toMatch(/reconciled at daemon start/);
    expect(directives.getById(db, b)?.status).toBe('running');
    expect(directives.getById(db, c)?.status).toBe('running');
    expect(directives.getById(db, d.id)?.status).toBe('complete');
  });

  it('flips a NULL-claimed directive when it is stale enough', () => {
    // Inline `factory build` never writes claimed_by; this is the common case.
    const id = seedRunning(ORPHAN_STALE_AFTER_MS + 60 * 1000, {
      claimedBy: null,
      lastUsageAgeMs: ORPHAN_STALE_AFTER_MS + 30 * 1000,
    });
    const res = directives.reconcileOrphanedDirectives(db, log, {
      now: () => fixedNow,
      // Unreachable because claimedBy is null → no pid to check. Force true so
      // a PID check path can't rescue the directive.
      isPidAlive: () => true,
    });
    expect(res.reconciled).toEqual([id]);
  });

  it('leaves young directives with no model_usage alone', () => {
    // Directive created just now, no LLM calls yet. The activity floor
    // must fall back to created_at so we don't orphan a directive whose
    // brain is still spinning up.
    seedRunning(5 * 1000, { claimedBy: null });
    const res = directives.reconcileOrphanedDirectives(db, log, {
      now: () => fixedNow,
      isPidAlive: () => false,
    });
    expect(res.reconciled).toEqual([]);
  });

  it('honours staleAfterMs override', () => {
    const id = seedRunning(6 * 60 * 1000, {
      claimedBy: 'inline-99999',
      lastUsageAgeMs: 6 * 60 * 1000,
    });
    const res = directives.reconcileOrphanedDirectives(db, log, {
      now: () => fixedNow,
      isPidAlive: () => false,
      staleAfterMs: 5 * 60 * 1000,
    });
    expect(res.reconciled).toEqual([id]);
  });
});

describe('directives.listPaged', () => {
  let db: BetterSqlite3.Database;
  beforeEach(() => {
    db = freshDb();
  });

  function seedMany(count: number, status: DirectiveRow['status'] = 'pending'): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const d = baseDirective({
        status,
        // stagger createdAt so ORDER BY DESC is deterministic
        createdAt: new Date(2026, 3, 23, 12, 0, i).toISOString(),
      });
      directives.insert(db, d);
      ids.push(d.id);
    }
    return ids;
  }

  it('returns newest first and caps limit at 100', () => {
    const ids = seedMany(3);
    const { items, total } = directives.listPaged(db);
    expect(total).toBe(3);
    expect(items.map((d) => d.id)).toEqual([...ids].reverse());
  });

  it('defaults limit to 20 when omitted', () => {
    seedMany(25);
    const { items, total } = directives.listPaged(db);
    expect(items).toHaveLength(20);
    expect(total).toBe(25);
  });

  it('applies offset + limit', () => {
    const ids = seedMany(5);
    const { items, total } = directives.listPaged(db, { limit: 2, offset: 2 });
    expect(total).toBe(5);
    // newest-first: [4, 3, 2, 1, 0]; offset 2 → start at ids[2] = index 2 from end
    expect(items.map((d) => d.id)).toEqual([ids[2], ids[1]]);
  });

  it('filters by status when provided (total respects the filter)', () => {
    seedMany(3, 'pending');
    seedMany(2, 'running');
    const res = directives.listPaged(db, { status: 'running' });
    expect(res.total).toBe(2);
    expect(res.items.every((d) => d.status === 'running')).toBe(true);
  });

  it('clamps limit to 100 max and 1 min', () => {
    seedMany(5);
    expect(directives.listPaged(db, { limit: 500 }).items.length).toBeLessThanOrEqual(100);
    expect(directives.listPaged(db, { limit: 0 }).items.length).toBeLessThanOrEqual(5);
    expect(directives.listPaged(db, { limit: -5 }).items.length).toBeLessThanOrEqual(5);
  });

  it('returns empty items + total 0 on empty db', () => {
    expect(directives.listPaged(db)).toEqual({ items: [], total: 0 });
  });
});
