import { newId } from '@factory5/core';
import { describe, expect, it } from 'vitest';

import {
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
