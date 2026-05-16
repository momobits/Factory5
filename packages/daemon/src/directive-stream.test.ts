import { newId, type Directive } from '@factory5/core';
import { initLogger } from '@factory5/logger';
import {
  openDatabase,
  runMigrations,
  directives as directivesQ,
  directiveLogLines,
  type Database,
} from '@factory5/state';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DirectiveStreamHub } from './directive-stream.js';

beforeAll(() => {
  initLogger({ processName: 'directive-stream-test', noFile: true, noConsole: true });
});

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

function seedDirective(db: Database, overrides: Partial<Directive> = {}): string {
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
  directivesQ.insert(db, d);
  return d.id;
}

describe('DirectiveStreamHub — log.line tee to directive_log_lines (Tier 11 §11.4)', () => {
  let db: Database;
  let hub: DirectiveStreamHub;
  let directiveId: string;

  beforeEach(() => {
    db = freshDb();
    hub = new DirectiveStreamHub(db);
    directiveId = seedDirective(db);
  });

  it('persists three emitted log.line events and listForDirective returns them in ts order', () => {
    hub.emit({
      type: 'log.line',
      directiveId,
      ts: '2026-05-16T01:00:00.000Z',
      level: 'info',
      component: 'brain.triage',
      msg: 'classified as build',
    });
    hub.emit({
      type: 'log.line',
      directiveId,
      ts: '2026-05-16T01:00:01.000Z',
      level: 'info',
      component: 'brain.architect',
      msg: 'wrote 13 wiki pages',
      attrs: { pages: 13 },
    });
    hub.emit({
      type: 'log.line',
      directiveId,
      ts: '2026-05-16T01:00:02.000Z',
      level: 'error',
      component: 'brain.planner',
      msg: 'planner: schema parse failed',
      attrs: { detail: 'first 500 chars…', zodIssues: [{ path: ['tasks'] }] },
    });

    const lines = directiveLogLines.listForDirective(db, directiveId);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.msg)).toEqual([
      'classified as build',
      'wrote 13 wiki pages',
      'planner: schema parse failed',
    ]);
    expect(lines[1]?.attrs).toEqual({ pages: 13 });
    expect(lines[2]?.attrs).toEqual({
      detail: 'first 500 chars…',
      zodIssues: [{ path: ['tasks'] }],
    });
  });

  it('still fans out to subscribers when there are no listeners for any other directive', () => {
    const received: string[] = [];
    const unsubscribe = hub.subscribe(directiveId, (event) => {
      if (event.type === 'log.line') received.push(event.msg);
    });

    hub.emit({
      type: 'log.line',
      directiveId,
      ts: '2026-05-16T01:00:00.000Z',
      level: 'info',
      component: 'brain.pool',
      msg: 'dispatching',
    });

    expect(received).toEqual(['dispatching']);
    // And the same event made it to disk — the tee happens BEFORE fan-out.
    const lines = directiveLogLines.listForDirective(db, directiveId);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.msg).toBe('dispatching');

    unsubscribe();
  });

  it('does not persist non-log.line events (other types have their own authoritative DB rows)', () => {
    hub.emit({
      type: 'directive.completed',
      directiveId,
      status: 'complete',
      blockedReason: null,
    });
    hub.emit({
      type: 'spend.updated',
      directiveId,
      totalCostUsd: 0.42,
      callCount: 3,
      deltaUsd: 0.15,
    });

    const lines = directiveLogLines.listForDirective(db, directiveId);
    expect(lines).toHaveLength(0);
  });

  it('a persistence failure does not block fan-out to subscribers', () => {
    // Drop the table to simulate a write failure (the prepared INSERT will
    // throw "no such table"). The hub catches + logs warn; subscribers
    // still get the event.
    db.exec('DROP TABLE directive_log_lines');

    const received: string[] = [];
    hub.subscribe(directiveId, (event) => {
      if (event.type === 'log.line') received.push(event.msg);
    });

    expect(() =>
      hub.emit({
        type: 'log.line',
        directiveId,
        ts: '2026-05-16T01:00:00.000Z',
        level: 'info',
        component: 'brain.triage',
        msg: 'still delivered',
      }),
    ).not.toThrow();

    expect(received).toEqual(['still delivered']);
  });
});
