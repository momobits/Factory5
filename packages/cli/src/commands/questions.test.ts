/**
 * `factory questions cleanup` — Phase 14.4 sweep tool.
 */

import { newId, type Directive, type PendingQuestion } from '@factory5/core';
import { initLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  pendingQuestions,
  runMigrations,
  type Database,
} from '@factory5/state';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runQuestionsCleanup } from './questions.js';

beforeAll(() => {
  initLogger({ processName: 'cli-questions-test', noFile: true, noConsole: true });
});

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function seedDirective(db: Database, overrides: Partial<Directive> = {}): string {
  const id = overrides.id ?? newId();
  directivesQ.insert(db, {
    id,
    source: overrides.source ?? 'cli',
    principal: overrides.principal ?? 'me',
    channelRef: overrides.channelRef ?? 's-1',
    intent: overrides.intent ?? 'build',
    payload: overrides.payload ?? {},
    autonomy: overrides.autonomy ?? 'autonomous',
    createdAt: overrides.createdAt ?? '2026-04-21T00:00:00.000Z',
    status: overrides.status ?? 'pending',
  });
  return id;
}

function seedQuestion(db: Database, overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  const directiveId = overrides.directiveId ?? seedDirective(db, { status: 'complete' });
  const q: PendingQuestion = {
    id: newId(),
    directiveId,
    question: 'orphaned q?',
    channel: 'cli',
    channelRef: 'ref-x',
    createdAt: '2026-04-23T00:00:00.000Z',
    ...overrides,
    directiveId,
  };
  pendingQuestions.create(db, q);
  return q;
}

interface CapturedStdout {
  write(chunk: string): boolean;
  text(): string;
}
function captureStdout(): CapturedStdout {
  let buf = '';
  return {
    write(chunk: string) {
      buf += chunk;
      return true;
    },
    text() {
      return buf;
    },
  };
}

describe('runQuestionsCleanup', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it('reports a friendly no-op when nothing is orphaned', () => {
    const out = captureStdout();
    const result = runQuestionsCleanup({ db, stdout: out });
    expect(result).toEqual({ found: 0, marked: 0, exitCode: 0 });
    expect(out.text()).toContain('no orphaned questions found');
  });

  it('lists orphans, marks them answered with a synthetic note, returns counts', () => {
    const dir1 = seedDirective(db, { status: 'failed' });
    const dir2 = seedDirective(db, { status: 'complete' });
    const q1 = seedQuestion(db, { directiveId: dir1, question: 'config format?' });
    const q2 = seedQuestion(db, {
      directiveId: dir2,
      question: 'long\nmultiline question body',
    });

    const out = captureStdout();
    const NOW = new Date('2026-04-27T19:00:00.000Z');
    const result = runQuestionsCleanup({ db, stdout: out, now: () => NOW });
    expect(result).toEqual({ found: 2, marked: 2, exitCode: 0 });

    const after1 = pendingQuestions.getById(db, q1.id);
    const after2 = pendingQuestions.getById(db, q2.id);
    expect(after1?.answeredAt).toBe(NOW.toISOString());
    expect(after2?.answeredAt).toBe(NOW.toISOString());
    expect(after1?.answer).toContain(`directive ${dir1} ended failed`);
    expect(after2?.answer).toContain(`directive ${dir2} ended complete`);

    // Output prints both rows + a summary; multiline question is collapsed
    // to its first line for readability.
    const text = out.text();
    expect(text).toContain('Found 2 orphaned question(s)');
    expect(text).toContain(q1.id);
    expect(text).toContain(q2.id);
    expect(text).toContain('"long"'); // first-line truncation
    expect(text).not.toContain('multiline question body');
    expect(text).toContain('Marked 2 question(s) as answered');
  });

  it('--dry-run lists orphans but does not write', () => {
    const dir = seedDirective(db, { status: 'blocked' });
    const q = seedQuestion(db, { directiveId: dir });
    const out = captureStdout();

    const result = runQuestionsCleanup({ db, stdout: out, dryRun: true });
    expect(result).toEqual({ found: 1, marked: 0, exitCode: 0 });

    const after = pendingQuestions.getById(db, q.id);
    expect(after?.answeredAt).toBeUndefined();
    expect(after?.answer).toBeUndefined();
    expect(out.text()).toContain('Dry run — no rows written');
  });

  it('passes through the --since filter', () => {
    const dir = seedDirective(db, { status: 'complete' });
    const oldQ = seedQuestion(db, {
      directiveId: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const recentQ = seedQuestion(db, {
      directiveId: dir,
      createdAt: '2026-04-26T00:00:00.000Z',
    });
    const out = captureStdout();
    const NOW = new Date('2026-04-27T19:00:00.000Z');

    const result = runQuestionsCleanup({
      db,
      since: '2026-04-01T00:00:00.000Z',
      stdout: out,
      now: () => NOW,
    });
    expect(result).toEqual({ found: 1, marked: 1, exitCode: 0 });

    expect(pendingQuestions.getById(db, oldQ.id)?.answeredAt).toBe(NOW.toISOString());
    expect(pendingQuestions.getById(db, recentQ.id)?.answeredAt).toBeUndefined();
  });

  it('rejects an invalid --since string with a friendly exit code', () => {
    const out = captureStdout();
    const result = runQuestionsCleanup({ db, since: 'not-a-date', stdout: out });
    expect(result.exitCode).toBe(2);
    expect(out.text()).toContain('--since must be an ISO-8601');
  });
});
