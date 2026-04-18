import { newId, type Directive } from '@factory5/core';
import { initLogger } from '@factory5/logger';
import type { ProviderRegistry } from '@factory5/providers';
import {
  openDatabase,
  runMigrations,
  directives as directivesQ,
  type Database,
} from '@factory5/state';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runServe, type InlineRunnerArgs } from './serve.js';

beforeAll(() => {
  initLogger({ processName: 'serve-test', noFile: true, noConsole: true });
});

function pendingDirective(createdAt: string): Directive {
  return {
    id: newId(),
    source: 'cli',
    principal: 'me',
    channelRef: `ref-${createdAt}`,
    intent: 'build',
    payload: {},
    autonomy: 'assisted',
    createdAt,
    status: 'pending',
  };
}

// A registry shape is required for the signature but our stub runner never
// consults it.
const stubRegistry = {} as ProviderRegistry;

describe('runServe', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('claims a pending directive and calls runOne', async () => {
    const d = pendingDirective(new Date('2026-04-18T12:00:00Z').toISOString());
    directivesQ.insert(db, d);

    const ac = new AbortController();
    const seen: string[] = [];
    const runOne = vi.fn(async (directive: Directive) => {
      seen.push(directive.id);
      // Transition the directive to `complete` so the test can assert state.
      directivesQ.updateStatus(db, directive.id, 'complete');
    });

    const loop = runServe({
      db,
      registry: stubRegistry,
      signal: ac.signal,
      pollIntervalMs: 20,
      runOne,
    });

    // Give the loop one tick to claim and process.
    await new Promise((r) => setTimeout(r, 60));
    ac.abort();
    await loop;

    expect(seen).toEqual([d.id]);
    const after = directivesQ.getById(db, d.id);
    expect(after?.status).toBe('complete');
    expect(after?.claimedBy).toMatch(/^serve-/);
  });

  it('claims FIFO by createdAt', async () => {
    const a = pendingDirective(new Date('2026-04-18T12:00:00Z').toISOString());
    const b = pendingDirective(new Date('2026-04-18T12:00:01Z').toISOString());
    const c = pendingDirective(new Date('2026-04-18T12:00:02Z').toISOString());
    directivesQ.insert(db, c); // inserted out of order on purpose
    directivesQ.insert(db, a);
    directivesQ.insert(db, b);

    const ac = new AbortController();
    const order: string[] = [];
    const runOne = async (directive: Directive): Promise<void> => {
      order.push(directive.id);
      directivesQ.updateStatus(db, directive.id, 'complete');
    };

    const loop = runServe({
      db,
      registry: stubRegistry,
      signal: ac.signal,
      pollIntervalMs: 10,
      runOne,
    });
    await new Promise((r) => setTimeout(r, 120));
    ac.abort();
    await loop;

    expect(order).toEqual([a.id, b.id, c.id]);
  });

  it('respects the concurrency ceiling', async () => {
    for (let i = 0; i < 4; i++) {
      const d = pendingDirective(new Date(Date.now() + i).toISOString());
      directivesQ.insert(db, d);
    }

    const ac = new AbortController();
    let active = 0;
    let peak = 0;
    const runOne = async (directive: Directive): Promise<void> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 30));
      directivesQ.updateStatus(db, directive.id, 'complete');
      active -= 1;
    };

    const loop = runServe({
      db,
      registry: stubRegistry,
      signal: ac.signal,
      pollIntervalMs: 10,
      concurrency: 2,
      runOne,
    });
    await new Promise((r) => setTimeout(r, 250));
    ac.abort();
    await loop;

    expect(peak).toBeLessThanOrEqual(2);
    // All four should have completed by now.
    const remaining = directivesQ.listByStatus(db, 'pending');
    expect(remaining).toHaveLength(0);
  });

  it('doorbell wakes the loop faster than poll interval', async () => {
    const ac = new AbortController();
    let rung = 0;
    let registeredCb: (() => void) | undefined;
    const onWake = (cb: () => void): (() => void) => {
      registeredCb = cb;
      return () => undefined;
    };

    const claimed: string[] = [];
    const runOne = async (directive: Directive): Promise<void> => {
      claimed.push(directive.id);
      directivesQ.updateStatus(db, directive.id, 'complete');
    };

    const loop = runServe({
      db,
      registry: stubRegistry,
      signal: ac.signal,
      pollIntervalMs: 10_000,
      onWake,
      runOne,
    });

    // No directive yet — loop is parked waiting for doorbell or (long) poll.
    await new Promise((r) => setTimeout(r, 30));
    expect(claimed).toHaveLength(0);
    expect(registeredCb).toBeDefined();

    // Insert directive and ring the bell.
    const d = pendingDirective(new Date().toISOString());
    directivesQ.insert(db, d);
    registeredCb?.();
    rung += 1;

    // The loop should wake and claim within tens of ms, not seconds.
    const start = Date.now();
    while (claimed.length === 0 && Date.now() - start < 500) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(claimed).toEqual([d.id]);
    expect(rung).toBe(1);

    ac.abort();
    await loop;
  });

  it('marks a directive as blocked when runOne throws after abort', async () => {
    const d = pendingDirective(new Date().toISOString());
    directivesQ.insert(db, d);

    const ac = new AbortController();
    const runOne = async (_directive: Directive, args: InlineRunnerArgs): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        args.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    };

    const loop = runServe({
      db,
      registry: stubRegistry,
      signal: ac.signal,
      pollIntervalMs: 10,
      runOne,
    });
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await loop;

    const after = directivesQ.getById(db, d.id);
    expect(after?.status).toBe('blocked');
  });
});
