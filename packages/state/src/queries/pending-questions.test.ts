import { newId, type Directive, type PendingQuestion } from '@factory5/core';
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../migrations/index.js';
import * as directives from './directives.js';
import * as pendingQuestions from './pending-questions.js';

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Insert a directive and return its id; pending_questions.directive_id → directives(id). */
function seedDirective(db: BetterSqlite3.Database, overrides: Partial<Directive> = {}): string {
  const d: Directive = {
    id: newId(),
    source: 'cli',
    principal: 'me',
    channelRef: 'ref-1',
    intent: 'build',
    payload: {},
    autonomy: 'assisted',
    createdAt: new Date().toISOString(),
    status: 'pending',
    ...overrides,
  };
  directives.insert(db, d);
  return d.id;
}

function makeQuestion(
  db: BetterSqlite3.Database,
  overrides: Partial<PendingQuestion> = {},
): PendingQuestion {
  // Need a real directive row to satisfy the FK unless one was supplied.
  const directiveId = overrides.directiveId ?? seedDirective(db);
  return {
    id: newId(),
    directiveId,
    question: 'jwt or session?',
    channel: 'cli',
    channelRef: 'session-1',
    createdAt: new Date().toISOString(),
    ...overrides,
    directiveId,
  };
}

describe('pendingQuestions.listPaged', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = freshDb();
  });

  function seed(count: number, overrides: Partial<PendingQuestion> = {}): PendingQuestion[] {
    const out: PendingQuestion[] = [];
    for (let i = 0; i < count; i++) {
      const q = makeQuestion(db, {
        createdAt: new Date(2026, 3, 23, 12, 0, i).toISOString(),
        ...overrides,
      });
      pendingQuestions.create(db, q);
      out.push(q);
    }
    return out;
  }

  it('defaults to open-only, newest first, limit 20', () => {
    seed(25);
    const res = pendingQuestions.listPaged(db);
    expect(res.total).toBe(25);
    expect(res.items).toHaveLength(20);
    // Check that the first item is the most recent (highest index seeded).
    expect(res.items[0]?.createdAt).toBe(new Date(2026, 3, 23, 12, 0, 24).toISOString());
  });

  it('status=answered only returns answered questions', () => {
    const seeded = seed(3);
    // Answer the first two
    const first = seeded[0];
    const second = seeded[1];
    if (first === undefined || second === undefined) throw new Error('seed failed');
    pendingQuestions.answer(db, first.id, 'a', new Date().toISOString());
    pendingQuestions.answer(db, second.id, 'b', new Date().toISOString());

    const res = pendingQuestions.listPaged(db, { status: 'answered' });
    expect(res.total).toBe(2);
    expect(res.items.map((q) => q.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('status=all includes both open and answered', () => {
    const [first] = seed(3);
    if (first === undefined) throw new Error('seed failed');
    pendingQuestions.answer(db, first.id, 'x', new Date().toISOString());

    const res = pendingQuestions.listPaged(db, { status: 'all' });
    expect(res.total).toBe(3);
  });

  it('filters by directiveId', () => {
    const directiveId = seedDirective(db);
    seed(2, { directiveId });
    seed(3); // different directiveId (each question seeds its own directive)
    const res = pendingQuestions.listPaged(db, { directiveId, status: 'all' });
    expect(res.total).toBe(2);
    expect(res.items.every((q) => q.directiveId === directiveId)).toBe(true);
  });

  it('applies limit + offset (newest first)', () => {
    const seeded = seed(5);
    const res = pendingQuestions.listPaged(db, { limit: 2, offset: 1 });
    expect(res.total).toBe(5);
    // newest-first over indices 0..4 → [4, 3, 2, 1, 0]; offset 1 limit 2 → [3, 2]
    expect(res.items.map((q) => q.id)).toEqual([seeded[3]?.id, seeded[2]?.id]);
  });

  it('clamps limit to [1, 100]', () => {
    seed(5);
    expect(pendingQuestions.listPaged(db, { limit: 9999 }).items.length).toBeLessThanOrEqual(100);
    expect(pendingQuestions.listPaged(db, { limit: 0 }).items.length).toBeLessThanOrEqual(5);
  });

  it('returns empty on empty table', () => {
    expect(pendingQuestions.listPaged(db)).toEqual({ items: [], total: 0 });
  });
});

describe('pendingQuestions.setBotMessageId / findOpenByBotMessageId (I012)', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = freshDb();
  });

  it('round-trips: stamp then find', () => {
    const q = makeQuestion(db, { channel: 'telegram', channelRef: '555#10' });
    pendingQuestions.create(db, q);

    pendingQuestions.setBotMessageId(db, q.id, '200');

    const found = pendingQuestions.findOpenByBotMessageId(db, 'telegram', '200');
    expect(found?.id).toBe(q.id);
    expect(found?.botMessageId).toBe('200');
  });

  it('does not match across channels', () => {
    const tg = makeQuestion(db, { channel: 'telegram', channelRef: '555#10' });
    pendingQuestions.create(db, tg);
    pendingQuestions.setBotMessageId(db, tg.id, '200');

    expect(pendingQuestions.findOpenByBotMessageId(db, 'discord', '200')).toBeUndefined();
  });

  it('does not match an already-answered question', () => {
    const q = makeQuestion(db, { channel: 'telegram', channelRef: '555#10' });
    pendingQuestions.create(db, q);
    pendingQuestions.setBotMessageId(db, q.id, '200');
    pendingQuestions.answer(db, q.id, 'done', new Date().toISOString());

    expect(pendingQuestions.findOpenByBotMessageId(db, 'telegram', '200')).toBeUndefined();
  });

  it('setBotMessageId is a silent no-op for an unknown question id', () => {
    expect(() => pendingQuestions.setBotMessageId(db, newId(), '200')).not.toThrow();
  });

  it('returns undefined for an unstamped question (legacy / pre-migration row)', () => {
    const q = makeQuestion(db, { channel: 'telegram', channelRef: '555#10' });
    pendingQuestions.create(db, q);

    expect(pendingQuestions.findOpenByBotMessageId(db, 'telegram', '200')).toBeUndefined();
  });
});

describe('pendingQuestions.findOrphaned / markOrphanAnswered (Phase 14.4)', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = freshDb();
  });

  it('returns open questions whose directive is in a terminal state', () => {
    const completedDir = seedDirective(db, { status: 'complete' });
    const failedDir = seedDirective(db, { status: 'failed' });
    const blockedDir = seedDirective(db, { status: 'blocked' });
    pendingQuestions.create(db, makeQuestion(db, { directiveId: completedDir }));
    pendingQuestions.create(db, makeQuestion(db, { directiveId: failedDir }));
    pendingQuestions.create(db, makeQuestion(db, { directiveId: blockedDir }));

    const orphans = pendingQuestions.findOrphaned(db);
    expect(orphans).toHaveLength(3);
    expect(orphans.map((o) => o.directiveStatus).sort()).toEqual(['blocked', 'complete', 'failed']);
  });

  it('skips questions whose directive is still running / pending / claimed', () => {
    const liveDir = seedDirective(db, { status: 'running' });
    const pendingDir = seedDirective(db, { status: 'pending' });
    const claimedDir = seedDirective(db, { status: 'claimed' });
    pendingQuestions.create(db, makeQuestion(db, { directiveId: liveDir }));
    pendingQuestions.create(db, makeQuestion(db, { directiveId: pendingDir }));
    pendingQuestions.create(db, makeQuestion(db, { directiveId: claimedDir }));

    expect(pendingQuestions.findOrphaned(db)).toEqual([]);
  });

  it('skips already-answered rows even when the directive is terminal', () => {
    const dir = seedDirective(db, { status: 'complete' });
    const q = makeQuestion(db, { directiveId: dir });
    pendingQuestions.create(db, q);
    pendingQuestions.answer(db, q.id, 'too late', new Date().toISOString());

    expect(pendingQuestions.findOrphaned(db)).toEqual([]);
  });

  it('respects the `since` filter (rows created strictly before the cutoff)', () => {
    const dir = seedDirective(db, { status: 'complete' });
    const oldQ = makeQuestion(db, {
      directiveId: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const recentQ = makeQuestion(db, {
      directiveId: dir,
      createdAt: '2026-04-20T00:00:00.000Z',
    });
    pendingQuestions.create(db, oldQ);
    pendingQuestions.create(db, recentQ);

    const orphans = pendingQuestions.findOrphaned(db, { since: '2026-04-01T00:00:00.000Z' });
    expect(orphans.map((o) => o.id)).toEqual([oldQ.id]);
  });

  it('orders results oldest-first', () => {
    const dir = seedDirective(db, { status: 'complete' });
    const q1 = makeQuestion(db, {
      directiveId: dir,
      createdAt: '2026-04-20T00:00:00.000Z',
    });
    const q2 = makeQuestion(db, {
      directiveId: dir,
      createdAt: '2026-04-10T00:00:00.000Z',
    });
    const q3 = makeQuestion(db, {
      directiveId: dir,
      createdAt: '2026-04-15T00:00:00.000Z',
    });
    pendingQuestions.create(db, q1);
    pendingQuestions.create(db, q2);
    pendingQuestions.create(db, q3);

    const orphans = pendingQuestions.findOrphaned(db);
    expect(orphans.map((o) => o.id)).toEqual([q2.id, q3.id, q1.id]);
  });

  it('markOrphanAnswered stamps a self-describing synthetic note', () => {
    const dir = seedDirective(db, { status: 'failed' });
    const q = makeQuestion(db, { directiveId: dir });
    pendingQuestions.create(db, q);
    const when = '2026-04-27T19:00:00.000Z';

    pendingQuestions.markOrphanAnswered(
      db,
      { id: q.id, directiveId: dir, directiveStatus: 'failed' },
      when,
    );

    const after = pendingQuestions.getById(db, q.id);
    expect(after?.answeredAt).toBe(when);
    expect(after?.answer).toContain(`directive ${dir} ended failed`);
    expect(after?.answer).toContain(when);
  });

  it('markOrphanAnswered is a no-op on an already-answered row', () => {
    const dir = seedDirective(db, { status: 'complete' });
    const q = makeQuestion(db, { directiveId: dir });
    pendingQuestions.create(db, q);
    pendingQuestions.answer(db, q.id, 'real answer', '2026-04-25T00:00:00.000Z');

    pendingQuestions.markOrphanAnswered(
      db,
      { id: q.id, directiveId: dir, directiveStatus: 'complete' },
      '2026-04-27T19:00:00.000Z',
    );

    const after = pendingQuestions.getById(db, q.id);
    expect(after?.answer).toBe('real answer');
    expect(after?.answeredAt).toBe('2026-04-25T00:00:00.000Z');
  });
});
