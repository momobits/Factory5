import type { Finding, Task } from '@factory5/core';
import type { DirectiveStreamEvent } from '@factory5/ipc';
import { describe, expect, it, vi } from 'vitest';

import { defaultConcurrency, emitFindingCreated, topoSortTasks } from './pool.js';

const BASE_ULID = '01HXABCDEFGHJKMNPQRSTVWXY0';
const SAMPLE_DIRECTIVE_ID = '01HZZZZZZZZZZZZZZZZZZZZZZA';

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

function mkFinding(overrides: Partial<Finding> = {}): Finding {
  const base: Finding = {
    id: 'F001',
    source: 'builder',
    target: 'src/widget.ts',
    severity: 'major',
    status: 'OPEN',
    description: 'function exits non-zero on empty input',
    createdAt: '2026-05-03T16:30:00.000Z',
  };
  return { ...base, ...overrides };
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

describe('emitFindingCreated', () => {
  it('is silent when no emitter is wired', () => {
    expect(() => emitFindingCreated(undefined, SAMPLE_DIRECTIVE_ID, mkFinding())).not.toThrow();
  });

  it('forwards a well-formed finding.created event with advisory=false when finding.advisory is undefined', () => {
    const events: DirectiveStreamEvent[] = [];
    const emit = vi.fn((event: DirectiveStreamEvent) => events.push(event));

    emitFindingCreated(emit, SAMPLE_DIRECTIVE_ID, mkFinding());

    expect(emit).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.type).toBe('finding.created');
    if (event.type !== 'finding.created') return; // narrow
    expect(event.findingId).toBe('F001');
    expect(event.directiveId).toBe(SAMPLE_DIRECTIVE_ID);
    expect(event.severity).toBe('major');
    expect(event.status).toBe('OPEN');
    expect(event.source).toBe('builder');
    expect(event.target).toBe('src/widget.ts');
    expect(event.description).toBe('function exits non-zero on empty input');
    expect(event.advisory).toBe(false);
  });

  it('forwards advisory=true when the finding carries advisory: true', () => {
    const events: DirectiveStreamEvent[] = [];
    const emit = (event: DirectiveStreamEvent): void => {
      events.push(event);
    };

    emitFindingCreated(
      emit,
      SAMPLE_DIRECTIVE_ID,
      mkFinding({
        id: 'F042',
        source: 'verifier',
        severity: 'minor',
        advisory: true,
      }),
    );

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.type).toBe('finding.created');
    if (event.type !== 'finding.created') return;
    expect(event.findingId).toBe('F042');
    expect(event.source).toBe('verifier');
    expect(event.severity).toBe('minor');
    expect(event.advisory).toBe(true);
  });

  it('emits one event per call (caller drives the per-finding loop)', () => {
    const events: DirectiveStreamEvent[] = [];
    const emit = (event: DirectiveStreamEvent): void => {
      events.push(event);
    };

    const findings: Finding[] = [
      mkFinding({ id: 'F001', target: 'src/a.ts' }),
      mkFinding({ id: 'F002', target: 'src/b.ts', advisory: true }),
      mkFinding({ id: 'F003', target: 'src/c.ts', severity: 'critical' }),
    ];
    for (const f of findings) emitFindingCreated(emit, SAMPLE_DIRECTIVE_ID, f);

    expect(events).toHaveLength(3);
    const ids = events.flatMap((e) => (e.type === 'finding.created' ? [e.findingId] : []));
    expect(ids).toEqual(['F001', 'F002', 'F003']);
  });
});
