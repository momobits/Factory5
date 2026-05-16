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

function seedDirective(db: BetterSqlite3.Database, id: string, status = 'complete'): void {
  db.prepare(
    `INSERT INTO directives
       (id, source, principal, channel_ref, intent, payload_json, autonomy, created_at, status)
     VALUES (?, 'cli', 'tester', 'sess-1', 'chat', '{}', 'chat', '2026-05-08T00:00:00.000Z', ?)`,
  ).run(id, status);
}

function seedQuestion(
  db: BetterSqlite3.Database,
  id: string,
  directiveId: string,
  opts: { answer?: string; answeredAt?: string } = {},
): void {
  db.prepare(
    `INSERT INTO pending_questions
       (id, directive_id, task_id, question, options_json, channel, channel_ref,
        created_at, deadline_at, answered_at, answer, bot_message_id)
     VALUES (?, ?, NULL, 'Q?', NULL, 'cli', 'sess-1',
             '2026-05-08T00:00:00.000Z', NULL, ?, ?, NULL)`,
  ).run(id, directiveId, opts.answeredAt ?? null, opts.answer ?? null);
}

describe('migration 009-pending-questions-answered-by — schema shape', () => {
  it('adds a nullable `answered_by` TEXT column to pending_questions', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(pending_questions)').all() as ColumnInfo[];
    const col = cols.find((c) => c.name === 'answered_by');
    expect(col, 'answered_by column missing').toBeDefined();
    expect(col?.type).toBe('TEXT');
    expect(Boolean(col?.notnull)).toBe(false);
    expect(col?.pk).toBe(0);
  });

  it('CHECK constraint accepts the four enum values + NULL, rejects others', () => {
    const db = freshDb();
    seedDirective(db, '01ABCDEFGHJKMNPQRSTVWXYZ00');

    const setAnsweredBy = (qid: string, value: string | null): void => {
      db.prepare(
        `INSERT INTO pending_questions
           (id, directive_id, task_id, question, options_json, channel, channel_ref,
            created_at, deadline_at, answered_at, answer, bot_message_id, answered_by)
         VALUES (?, '01ABCDEFGHJKMNPQRSTVWXYZ00', NULL, 'Q?', NULL, 'cli', 'sess-1',
                 '2026-05-08T00:00:00.000Z', NULL,
                 '2026-05-08T00:01:00.000Z', 'a', NULL, ?)`,
      ).run(qid, value);
    };

    setAnsweredBy('01ABCDEFGHJKMNPQRSTVWXYZ01', 'user');
    setAnsweredBy('01ABCDEFGHJKMNPQRSTVWXYZ02', 'agent');
    setAnsweredBy('01ABCDEFGHJKMNPQRSTVWXYZ03', 'agent-failed');
    setAnsweredBy('01ABCDEFGHJKMNPQRSTVWXYZ04', 'orphan-sweep');
    setAnsweredBy('01ABCDEFGHJKMNPQRSTVWXYZ05', null);
    expect(() => setAnsweredBy('01ABCDEFGHJKMNPQRSTVWXYZ06', 'human')).toThrow(/CHECK/);
  });

  it('backfills orphan-sweep rows with the canonical prefix', () => {
    const db = dbAtSchemaVersion(8);
    seedDirective(db, '01ABCDEFGHJKMNPQRSTVWXYZ10');
    seedQuestion(db, '01ABCDEFGHJKMNPQRSTVWXYZ11', '01ABCDEFGHJKMNPQRSTVWXYZ10', {
      answer:
        '[orphaned by factory questions cleanup at 2026-05-01T12:00:00.000Z: directive 01OLDDIRECTIVE0000000000000 ended complete]',
      answeredAt: '2026-05-01T12:00:00.000Z',
    });
    runMigrations(db);
    const row = db
      .prepare('SELECT answered_by FROM pending_questions WHERE id = ?')
      .get('01ABCDEFGHJKMNPQRSTVWXYZ11') as { answered_by: string };
    expect(row.answered_by).toBe('orphan-sweep');
  });

  it("backfills remaining answered rows with 'user'", () => {
    const db = dbAtSchemaVersion(8);
    seedDirective(db, '01ABCDEFGHJKMNPQRSTVWXYZ20');
    seedQuestion(db, '01ABCDEFGHJKMNPQRSTVWXYZ21', '01ABCDEFGHJKMNPQRSTVWXYZ20', {
      answer: 'I picked option B',
      answeredAt: '2026-05-01T12:00:00.000Z',
    });
    runMigrations(db);
    const row = db
      .prepare('SELECT answered_by FROM pending_questions WHERE id = ?')
      .get('01ABCDEFGHJKMNPQRSTVWXYZ21') as { answered_by: string };
    expect(row.answered_by).toBe('user');
  });

  it('leaves unanswered rows with NULL answered_by', () => {
    const db = dbAtSchemaVersion(8);
    seedDirective(db, '01ABCDEFGHJKMNPQRSTVWXYZ30');
    seedQuestion(db, '01ABCDEFGHJKMNPQRSTVWXYZ31', '01ABCDEFGHJKMNPQRSTVWXYZ30');
    runMigrations(db);
    const row = db
      .prepare('SELECT answered_by FROM pending_questions WHERE id = ?')
      .get('01ABCDEFGHJKMNPQRSTVWXYZ31') as { answered_by: string | null };
    expect(row.answered_by).toBeNull();
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
