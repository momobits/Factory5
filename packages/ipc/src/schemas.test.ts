import { newId } from '@factory5/core';
import { describe, expect, it } from 'vitest';

import {
  apiV1PoolUsageResponseSchema,
  apiV1ProjectBudgetDefaultsPutBodySchema,
  directiveBlockedReasonSchema,
  directiveNotifyRequestSchema,
  ipcErrorSchema,
  sendRequestSchema,
  statusResponseSchema,
  workerAskUserRequestSchema,
  workerAskUserResponseSchema,
} from './schemas.js';

describe('statusResponseSchema', () => {
  it('parses a minimal status response', () => {
    const r = {
      version: '0.0.1',
      process: 'factoryd',
      pid: 123,
      uptimeMs: 1000,
      startedAt: new Date().toISOString(),
      channels: [{ id: 'cli' as const, status: 'ready' as const }],
    };
    const parsed = statusResponseSchema.parse(r);
    expect(parsed.channels).toHaveLength(1);
  });
});

describe('sendRequestSchema', () => {
  it('requires a non-empty text', () => {
    const valid = {
      targetChannel: 'discord' as const,
      targetRef: 'channel-1',
      text: 'hi',
    };
    expect(sendRequestSchema.parse(valid).text).toBe('hi');
  });

  it('rejects bad channel', () => {
    expect(() =>
      sendRequestSchema.parse({ targetChannel: 'fax', targetRef: 'x', text: 'x' }),
    ).toThrow();
  });
});

describe('directiveNotifyRequestSchema', () => {
  it('requires a valid ULID and reason', () => {
    const r = { directiveId: newId(), reason: 'new' as const };
    expect(directiveNotifyRequestSchema.parse(r).reason).toBe('new');
  });
});

describe('ipcErrorSchema', () => {
  it('parses a basic error envelope', () => {
    const err = { error: { code: 'NOT_FOUND', message: 'not here' } };
    expect(ipcErrorSchema.parse(err).error.code).toBe('NOT_FOUND');
  });
});

describe('workerAskUserRequestSchema', () => {
  it('parses a minimal request', () => {
    const req = {
      taskId: newId(),
      directiveId: newId(),
      question: 'jwt or session?',
    };
    const parsed = workerAskUserRequestSchema.parse(req);
    expect(parsed.question).toBe('jwt or session?');
    expect(parsed.options).toBeUndefined();
    expect(parsed.deadlineSeconds).toBeUndefined();
  });

  it('parses a request with options and deadline', () => {
    const req = {
      taskId: newId(),
      directiveId: newId(),
      question: 'pick one',
      options: ['jwt', 'session'],
      deadlineSeconds: 1800,
    };
    const parsed = workerAskUserRequestSchema.parse(req);
    expect(parsed.options).toEqual(['jwt', 'session']);
    expect(parsed.deadlineSeconds).toBe(1800);
  });

  it('rejects empty question', () => {
    expect(() =>
      workerAskUserRequestSchema.parse({
        taskId: newId(),
        directiveId: newId(),
        question: '',
      }),
    ).toThrow();
  });

  it('rejects missing taskId — taskId is mandatory per ADR 0024 §3', () => {
    expect(() =>
      workerAskUserRequestSchema.parse({
        directiveId: newId(),
        question: 'hi',
      }),
    ).toThrow();
  });

  it('rejects non-positive deadlineSeconds', () => {
    expect(() =>
      workerAskUserRequestSchema.parse({
        taskId: newId(),
        directiveId: newId(),
        question: 'hi',
        deadlineSeconds: 0,
      }),
    ).toThrow();
  });

  it('rejects empty option strings', () => {
    expect(() =>
      workerAskUserRequestSchema.parse({
        taskId: newId(),
        directiveId: newId(),
        question: 'hi',
        options: ['ok', ''],
      }),
    ).toThrow();
  });
});

describe('workerAskUserResponseSchema', () => {
  it('parses a successful answer', () => {
    const resp = {
      questionId: newId(),
      answer: 'jwt',
      timedOut: false,
      aborted: false,
    };
    expect(workerAskUserResponseSchema.parse(resp).answer).toBe('jwt');
  });

  it('parses a timed-out response (no answer)', () => {
    const resp = {
      questionId: newId(),
      timedOut: true,
      aborted: false,
    };
    const parsed = workerAskUserResponseSchema.parse(resp);
    expect(parsed.timedOut).toBe(true);
    expect(parsed.answer).toBeUndefined();
  });

  it('parses an aborted response', () => {
    const resp = {
      questionId: newId(),
      timedOut: false,
      aborted: true,
    };
    expect(workerAskUserResponseSchema.parse(resp).aborted).toBe(true);
  });
});

describe('apiV1ProjectBudgetDefaultsPutBodySchema (Tier 15.9)', () => {
  it('accepts the full Tier-15 structured body', () => {
    const body = {
      budgetDefaults: {
        maxUsd: 5,
        maxSteps: 100,
        askUserDeadlineMs: 600_000,
        maxTurnsScaffolder: 160,
        maxTurnsBuilder: 120,
        maxTurnsFixer: 80,
        maxUsdPerTask: 1.5,
        maxWikiReadinessAttempts: 5,
      },
      autoIncreaseBudgets: true,
      autoIncreaseCeilingMultiplier: 5,
    };
    const parsed = apiV1ProjectBudgetDefaultsPutBodySchema.parse(body);
    expect(parsed.budgetDefaults?.maxTurnsScaffolder).toBe(160);
    expect(parsed.autoIncreaseBudgets).toBe(true);
    expect(parsed.autoIncreaseCeilingMultiplier).toBe(5);
  });

  it('accepts an empty body (clears all defaults)', () => {
    const parsed = apiV1ProjectBudgetDefaultsPutBodySchema.parse({});
    expect(parsed.budgetDefaults).toBeUndefined();
    expect(parsed.autoIncreaseBudgets).toBeUndefined();
    expect(parsed.autoIncreaseCeilingMultiplier).toBeUndefined();
  });

  it('rejects extra unknown keys (strict mode)', () => {
    expect(() =>
      apiV1ProjectBudgetDefaultsPutBodySchema.parse({
        budgetDefaults: { maxUsd: 5 },
        unknownKey: 'should-fail',
      }),
    ).toThrow();
  });

  it('rejects autoIncreaseCeilingMultiplier below 1', () => {
    expect(() =>
      apiV1ProjectBudgetDefaultsPutBodySchema.parse({ autoIncreaseCeilingMultiplier: 0 }),
    ).toThrow();
    expect(() =>
      apiV1ProjectBudgetDefaultsPutBodySchema.parse({ autoIncreaseCeilingMultiplier: 0.5 }),
    ).toThrow();
  });
});

describe('apiV1PoolUsageResponseSchema (Tier 15.9)', () => {
  it('parses a minimal pool tally', () => {
    const resp = {
      directiveId: '01KQ0P14MZZPJRPA5RW929TTSJ',
      computedAt: new Date().toISOString(),
      perAxis: {
        maxUsd: { used: 0.5, cap: 5, pct: 10, tasks: [], status: 'ok' as const },
      },
    };
    const parsed = apiV1PoolUsageResponseSchema.parse(resp);
    expect(parsed.directiveId).toBe('01KQ0P14MZZPJRPA5RW929TTSJ');
    expect(parsed.perAxis['maxUsd']?.status).toBe('ok');
    expect(parsed.parkedReason).toBeUndefined();
  });

  it('parses a pool tally with per-task contributions and parkedReason', () => {
    const resp = {
      directiveId: '01KQ0P14MZZPJRPA5RW929TTSJ',
      computedAt: new Date().toISOString(),
      perAxis: {
        maxTurnsBuilder: {
          used: 240,
          cap: 240,
          pct: 100,
          tasks: [
            {
              taskId: '01KQ0P14MZZPJRPA5RW929TASK',
              title: 'wire ipc',
              agent: 'builder',
              contribution: 120,
            },
          ],
          status: 'exhausted' as const,
        },
      },
      parkedReason: {
        axis: 'maxTurnsBuilder',
        usedAtPark: 240,
        capAtPark: 240,
        nextBumpTo: 360,
      },
    };
    const parsed = apiV1PoolUsageResponseSchema.parse(resp);
    expect(parsed.parkedReason?.nextBumpTo).toBe(360);
    expect(parsed.perAxis['maxTurnsBuilder']?.tasks).toHaveLength(1);
  });

  it('rejects an unrecognised axis status', () => {
    expect(() =>
      apiV1PoolUsageResponseSchema.parse({
        directiveId: 'x',
        computedAt: new Date().toISOString(),
        perAxis: {
          maxUsd: { used: 0, cap: 5, pct: 0, tasks: [], status: 'wat' },
        },
      }),
    ).toThrow();
  });
});

describe('directiveBlockedReasonSchema (Tier 15.9)', () => {
  it('parses the structured pool-exhausted shape', () => {
    const parsed = directiveBlockedReasonSchema.parse({
      kind: 'pool-exhausted',
      axis: 'maxTurnsBuilder',
      usedAtPark: 240,
      capAtPark: 240,
    });
    if (typeof parsed === 'string') {
      throw new Error('expected structured shape');
    }
    expect(parsed.kind).toBe('pool-exhausted');
    expect(parsed.axis).toBe('maxTurnsBuilder');
  });

  it('parses a legacy free-text reason as a string', () => {
    expect(directiveBlockedReasonSchema.parse('cancelled-from-web-ui')).toBe(
      'cancelled-from-web-ui',
    );
  });

  it('rejects a structured object with wrong kind', () => {
    expect(() =>
      directiveBlockedReasonSchema.parse({
        kind: 'unknown-kind',
        axis: 'maxUsd',
        usedAtPark: 1,
        capAtPark: 1,
      }),
    ).toThrow();
  });
});
