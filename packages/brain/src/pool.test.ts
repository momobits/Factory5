import type { Task } from '@factory5/core';
import { describe, expect, it } from 'vitest';

import { defaultConcurrency, topoSortTasks } from './pool.js';

const BASE_ULID = '01HXABCDEFGHJKMNPQRSTVWXY0';

function mkTask(idSuffix: number, dependsOn: string[] = []): Task {
  const id = (BASE_ULID.slice(0, -1) + idSuffix.toString()).toUpperCase();
  return {
    id,
    planId: BASE_ULID.slice(0, -1) + 'P',
    title: `task-${idSuffix}`,
    agent: 'builder',
    category: 'deep',
    inputs: { files: [], context: '' },
    expectedOutputs: { files: [], signals: [] },
    dependsOn,
    status: 'pending',
    attempts: 0,
  };
}

describe('topoSortTasks', () => {
  it('returns tasks in dependency order', () => {
    const a = mkTask(1, []);
    const b = mkTask(2, [a.id]);
    const c = mkTask(3, [a.id, b.id]);
    const order = topoSortTasks([c, b, a]);
    expect(order.map((t) => t.id)).toEqual([a.id, b.id, c.id]);
  });

  it('throws on a dependency cycle', () => {
    const a = mkTask(1, []);
    const b = mkTask(2, [a.id]);
    // cycle: a -> b -> a
    const aCyclic = { ...a, dependsOn: [b.id] };
    expect(() => topoSortTasks([aCyclic, b])).toThrow(/cycle/i);
  });

  it('tolerates unknown deps (treats them as no-op edges)', () => {
    const a = mkTask(1, ['ZZZZZZZZZZZZZZZZZZZZZZZZZZ']);
    const order = topoSortTasks([a]);
    expect(order.map((t) => t.id)).toEqual([a.id]);
  });
});

describe('defaultConcurrency', () => {
  it('returns a positive integer capped at 4', () => {
    const c = defaultConcurrency();
    expect(c).toBeGreaterThanOrEqual(1);
    expect(c).toBeLessThanOrEqual(4);
    expect(Number.isInteger(c)).toBe(true);
  });
});
