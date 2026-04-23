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
