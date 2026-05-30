import { newId, type Directive } from '@factory5/core';
import BetterSqlite3 from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../migrations/index.js';
import * as directiveLogLines from './directive-log-lines.js';
import { DEFAULT_LOG_LINE_LIMIT } from './directive-log-lines.js';
import * as directives from './directives.js';

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Insert a directive row and return its id; FK satisfies directive_log_lines.directive_id. */
function seedDirective(db: BetterSqlite3.Database, overrides: Partial<Directive> = {}): string {
  const d: Directive = {
    id: newId(),
    source: 'cli',
    principal: 'tester',
    channelRef: 'sess-1',
    intent: 'build',
    payload: {},
    autonomy: 'autonomous',
    createdAt: '2026-05-16T00:00:00.000Z',
    status: 'running',
    ...overrides,
  };
  directives.insert(db, d);
  return d.id;
}

describe('directiveLogLines.appendLogLine + listForDirective', () => {
  let db: BetterSqlite3.Database;
  let directiveId: string;

  beforeEach(() => {
    db = freshDb();
    directiveId = seedDirective(db);
  });

  it('appends a single line and reads it back with all fields intact', () => {
    const id = directiveLogLines.appendLogLine(db, {
      directiveId,
      ts: '2026-05-16T01:00:00.000Z',
      level: 'info',
      component: 'brain.triage',
      msg: 'classified as build',
      attrs: { intent: 'build', score: 0.92 },
    });

    expect(id).toBeGreaterThan(0);

    const lines = directiveLogLines.listForDirective(db, directiveId);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toBeDefined();
    if (line === undefined) throw new Error('unreachable');
    expect(line.id).toBe(id);
    expect(line.directiveId).toBe(directiveId);
    expect(line.ts).toBe('2026-05-16T01:00:00.000Z');
    expect(line.level).toBe('info');
    expect(line.component).toBe('brain.triage');
    expect(line.msg).toBe('classified as build');
    expect(line.attrs).toEqual({ intent: 'build', score: 0.92 });
  });

  it('omits attrs from the parsed row when attrs_json is NULL', () => {
    directiveLogLines.appendLogLine(db, {
      directiveId,
      ts: '2026-05-16T01:00:00.000Z',
      level: 'info',
      component: 'brain.pool',
      msg: 'dispatching',
    });
    const [line] = directiveLogLines.listForDirective(db, directiveId);
    expect(line?.attrs).toBeUndefined();
  });

  it('orders by ts ASC, then id ASC as a tiebreaker on identical timestamps', () => {
    // Two events emitted "inside the same millisecond" on a stage transition.
    const sameTs = '2026-05-16T01:00:00.000Z';
    const idA = directiveLogLines.appendLogLine(db, {
      directiveId,
      ts: sameTs,
      level: 'info',
      component: 'brain.triage',
      msg: 'triage exit',
    });
    const idB = directiveLogLines.appendLogLine(db, {
      directiveId,
      ts: sameTs,
      level: 'info',
      component: 'brain.architect',
      msg: 'architect-calling',
    });
    // Later event, later ts — proves the primary sort key wins over id.
    const idC = directiveLogLines.appendLogLine(db, {
      directiveId,
      ts: '2026-05-16T01:00:00.001Z',
      level: 'info',
      component: 'brain.architect',
      msg: 'wrote 13 wiki pages',
    });
    // And one in the past, inserted last — proves primary sort beats insertion order.
    const idEarly = directiveLogLines.appendLogLine(db, {
      directiveId,
      ts: '2026-05-16T00:59:59.999Z',
      level: 'info',
      component: 'brain.triage',
      msg: 'triage entry',
    });

    const lines = directiveLogLines.listForDirective(db, directiveId);
    expect(lines.map((l) => l.id)).toEqual([idEarly, idA, idB, idC]);
  });

  it('sinceTs is strict-greater-than (boundary line is excluded — matches FE join cursor contract)', () => {
    directiveLogLines.appendLogLine(db, {
      directiveId,
      ts: '2026-05-16T01:00:00.000Z',
      level: 'info',
      component: 'brain.triage',
      msg: 'before',
    });
    directiveLogLines.appendLogLine(db, {
      directiveId,
      ts: '2026-05-16T01:00:01.000Z',
      level: 'info',
      component: 'brain.triage',
      msg: 'cursor',
    });
    directiveLogLines.appendLogLine(db, {
      directiveId,
      ts: '2026-05-16T01:00:02.000Z',
      level: 'info',
      component: 'brain.architect',
      msg: 'after',
    });

    const lines = directiveLogLines.listForDirective(db, directiveId, {
      sinceTs: '2026-05-16T01:00:01.000Z',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.msg).toBe('after');
  });

  it('scopes results to the requested directiveId', () => {
    const otherDirectiveId = seedDirective(db);
    directiveLogLines.appendLogLine(db, {
      directiveId,
      ts: '2026-05-16T01:00:00.000Z',
      level: 'info',
      component: 'brain.triage',
      msg: 'mine',
    });
    directiveLogLines.appendLogLine(db, {
      directiveId: otherDirectiveId,
      ts: '2026-05-16T01:00:00.000Z',
      level: 'info',
      component: 'brain.triage',
      msg: 'theirs',
    });

    const mine = directiveLogLines.listForDirective(db, directiveId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.msg).toBe('mine');
  });

  it('caps results at the supplied limit (and at DEFAULT_LOG_LINE_LIMIT otherwise)', () => {
    // Seed 12 lines spanning distinct timestamps so ordering is deterministic.
    for (let i = 0; i < 12; i++) {
      directiveLogLines.appendLogLine(db, {
        directiveId,
        ts: new Date(Date.UTC(2026, 4, 16, 1, 0, i)).toISOString(),
        level: 'info',
        component: 'brain.pool',
        msg: `event ${i}`,
      });
    }

    // Explicit limit smaller than the available rows, no cursor → the NEWEST 5,
    // reversed into chronological order (so the panel shows the recent tail, not
    // ancient startup lines).
    const limited = directiveLogLines.listForDirective(db, directiveId, { limit: 5 });
    expect(limited).toHaveLength(5);
    expect(limited.map((l) => l.msg)).toEqual([
      'event 7',
      'event 8',
      'event 9',
      'event 10',
      'event 11',
    ]);

    // No limit supplied → default; 12 rows fit comfortably below the default.
    const defaulted = directiveLogLines.listForDirective(db, directiveId);
    expect(defaulted).toHaveLength(12);
    // Default cap is the 5000 the FE asks for.
    expect(DEFAULT_LOG_LINE_LIMIT).toBe(5000);

    // Limits below 1 are clamped up so callers can't accidentally request zero.
    const clamped = directiveLogLines.listForDirective(db, directiveId, { limit: 0 });
    expect(clamped).toHaveLength(1);
  });

  it('round-trips a large attrs payload (the kind ADR 0031 mandates on error events)', () => {
    // ADR 0031 §3: error events carry first 500 chars of LLM output in attrs.detail.
    // Use a richer structure to prove deep round-trip survives JSON serialization.
    const detail = 'x'.repeat(500);
    const attrs = {
      detail,
      zodIssues: [
        { path: ['tasks'], code: 'invalid_type', message: 'Expected array, received undefined' },
        { path: ['tasks', 0, 'agent'], code: 'invalid_enum_value', received: 'unknown' },
      ],
      meta: {
        model: 'claude-opus-4-7',
        attempt: 2,
        nested: { deeper: { hello: 'world', n: 42, ok: true } },
      },
    };
    directiveLogLines.appendLogLine(db, {
      directiveId,
      ts: '2026-05-16T01:00:00.000Z',
      level: 'error',
      component: 'brain.planner',
      msg: 'planner: schema parse failed',
      attrs,
    });

    const [line] = directiveLogLines.listForDirective(db, directiveId);
    expect(line?.attrs).toEqual(attrs);
    expect((line?.attrs as { detail: string }).detail.length).toBe(500);
  });
});
