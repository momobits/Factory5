import { newId } from '@factory5/core';
import { describe, expect, it } from 'vitest';

import {
  directiveNotifyRequestSchema,
  ipcErrorSchema,
  sendRequestSchema,
  statusResponseSchema,
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
