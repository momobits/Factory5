/**
 * Unit tests for the `outbound_messages` query helpers. The outbound
 * worker's integration behavior is covered by
 * `packages/daemon/src/outbound-worker.test.ts`; this suite pins the
 * query-layer contract so the worker can trust its inputs.
 */

import { newId, type OutboundMessage } from '@factory5/core';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../migrations/index.js';
import * as outbound from './outbound.js';

function freshDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function msg(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    id: newId(),
    targetChannel: 'cli',
    targetRef: 'ref-1',
    text: 'hi',
    createdAt: new Date().toISOString(),
    attempts: 0,
    ...overrides,
  };
}

describe('outbound.listPending', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns undelivered rows oldest-first', () => {
    outbound.enqueue(db, msg({ createdAt: '2026-04-23T10:00:00.000Z', text: 'second' }));
    outbound.enqueue(db, msg({ createdAt: '2026-04-23T09:00:00.000Z', text: 'first' }));
    const rows = outbound.listPending(db);
    expect(rows.map((r) => r.text)).toEqual(['first', 'second']);
  });

  it('excludes delivered rows', () => {
    const m = msg();
    outbound.enqueue(db, m);
    outbound.markDelivered(db, m.id, new Date().toISOString());
    expect(outbound.listPending(db)).toHaveLength(0);
  });

  it('respects the `limit` argument', () => {
    for (let i = 0; i < 5; i++) {
      outbound.enqueue(db, msg({ text: `m${String(i)}` }));
    }
    expect(outbound.listPending(db, 2)).toHaveLength(2);
  });

  it('excludes cap-reached rows when maxAttempts is set (sub-step 8.7 fix)', () => {
    // Three rows at varying attempt counts — cap = 5 should leave only the
    // first two.
    outbound.enqueue(db, msg({ text: 'fresh', attempts: 0 }));
    outbound.enqueue(db, msg({ text: 'retrying', attempts: 3 }));
    outbound.enqueue(db, msg({ text: 'capped', attempts: 5 }));

    const filtered = outbound.listPending(db, 50, 5);
    expect(filtered.map((r) => r.text).sort()).toEqual(['fresh', 'retrying']);

    // Default (no cap) still returns every undelivered row — cap-reached
    // rows stay visible for forensic inspection.
    const unfiltered = outbound.listPending(db);
    expect(unfiltered).toHaveLength(3);
  });

  it('excludes rows whose attempts exceed the cap, not just equal it', () => {
    outbound.enqueue(db, msg({ text: 'over-cap', attempts: 99 }));
    expect(outbound.listPending(db, 50, 5)).toHaveLength(0);
  });
});
