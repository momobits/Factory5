import { newId } from '@factory5/core';
import { describe, expect, it } from 'vitest';

import {
  directiveCompletedEventSchema,
  directiveStreamEventSchema,
  findingCreatedEventSchema,
  logLineEventSchema,
  spendUpdatedEventSchema,
  taskCompletedEventSchema,
  taskStartedEventSchema,
} from './sse.js';

const nowIso = (): string => new Date().toISOString();

describe('taskStartedEventSchema', () => {
  it('parses a valid event', () => {
    const ev = {
      type: 'task.started' as const,
      taskId: newId(),
      directiveId: newId(),
      title: 'Plan',
      agent: 'planner' as const,
      category: 'planning' as const,
      startedAt: nowIso(),
    };
    expect(taskStartedEventSchema.parse(ev).type).toBe('task.started');
  });

  it('rejects empty title', () => {
    expect(() =>
      taskStartedEventSchema.parse({
        type: 'task.started',
        taskId: newId(),
        directiveId: newId(),
        title: '',
        agent: 'planner',
        category: 'planning',
        startedAt: nowIso(),
      }),
    ).toThrow();
  });
});

describe('taskCompletedEventSchema', () => {
  it('parses on success with null error', () => {
    const ev = {
      type: 'task.completed' as const,
      taskId: newId(),
      directiveId: newId(),
      status: 'complete' as const,
      exitCode: 0,
      finishedAt: nowIso(),
      error: null,
    };
    expect(taskCompletedEventSchema.parse(ev).exitCode).toBe(0);
  });

  it('parses on failure with error string', () => {
    const ev = {
      type: 'task.completed' as const,
      taskId: newId(),
      directiveId: newId(),
      status: 'failed' as const,
      exitCode: 1,
      finishedAt: nowIso(),
      error: 'boom',
    };
    expect(taskCompletedEventSchema.parse(ev).error).toBe('boom');
  });
});

describe('findingCreatedEventSchema', () => {
  it('rejects malformed finding ids', () => {
    expect(() =>
      findingCreatedEventSchema.parse({
        type: 'finding.created',
        findingId: 'not-a-finding-id',
        directiveId: newId(),
        severity: 'HIGH',
        status: 'OPEN',
        source: 'verifier',
        target: 'src/foo.ts',
        description: 'unbounded loop',
        advisory: false,
      }),
    ).toThrow();
  });

  it('accepts F001-style finding ids', () => {
    const parsed = findingCreatedEventSchema.parse({
      type: 'finding.created',
      findingId: 'F042',
      directiveId: newId(),
      severity: 'HIGH',
      status: 'OPEN',
      source: 'verifier',
      target: 'src/foo.ts',
      description: 'unbounded loop',
      advisory: true,
    });
    expect(parsed.advisory).toBe(true);
  });
});

describe('spendUpdatedEventSchema', () => {
  it('parses a typical rollup', () => {
    const parsed = spendUpdatedEventSchema.parse({
      type: 'spend.updated',
      directiveId: newId(),
      totalCostUsd: 0.42,
      callCount: 3,
      deltaUsd: 0.07,
    });
    expect(parsed.callCount).toBe(3);
  });

  it('rejects negative cost', () => {
    expect(() =>
      spendUpdatedEventSchema.parse({
        type: 'spend.updated',
        directiveId: newId(),
        totalCostUsd: -0.01,
        callCount: 0,
        deltaUsd: 0,
      }),
    ).toThrow();
  });
});

describe('logLineEventSchema', () => {
  it('parses without optional attrs', () => {
    expect(
      logLineEventSchema.parse({
        type: 'log.line',
        directiveId: newId(),
        ts: nowIso(),
        level: 'info',
        component: 'brain.loop',
        msg: 'hello',
      }).level,
    ).toBe('info');
  });

  it('rejects unknown levels', () => {
    expect(() =>
      logLineEventSchema.parse({
        type: 'log.line',
        directiveId: newId(),
        ts: nowIso(),
        level: 'celebrate',
        component: 'brain.loop',
        msg: 'hello',
      }),
    ).toThrow();
  });
});

describe('directiveCompletedEventSchema', () => {
  it('parses a complete with null reason', () => {
    expect(
      directiveCompletedEventSchema.parse({
        type: 'directive.completed',
        directiveId: newId(),
        status: 'complete',
        blockedReason: null,
      }).status,
    ).toBe('complete');
  });

  it('parses a cancelled (failed + cancelled reason)', () => {
    expect(
      directiveCompletedEventSchema.parse({
        type: 'directive.completed',
        directiveId: newId(),
        status: 'failed',
        blockedReason: 'cancelled',
      }).blockedReason,
    ).toBe('cancelled');
  });
});

describe('directiveStreamEventSchema discriminated union', () => {
  it('routes by type', () => {
    const taskStart = directiveStreamEventSchema.parse({
      type: 'task.started',
      taskId: newId(),
      directiveId: newId(),
      title: 'Plan',
      agent: 'planner',
      category: 'planning',
      startedAt: nowIso(),
    });
    if (taskStart.type !== 'task.started') throw new Error('discriminator broken');
    expect(taskStart.title).toBe('Plan');
  });

  it('rejects unknown types', () => {
    expect(() =>
      directiveStreamEventSchema.parse({
        type: 'cosmic.ray',
        directiveId: newId(),
      }),
    ).toThrow();
  });
});
