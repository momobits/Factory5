import { describe, expect, it } from 'vitest';

import {
  eventToChunks,
  parseStreamJsonLine,
  resultIsError,
  usageFromResult,
  type ResultEvent,
} from './stream-events.js';

describe('parseStreamJsonLine', () => {
  it('returns undefined for blank lines', () => {
    expect(parseStreamJsonLine('')).toBeUndefined();
    expect(parseStreamJsonLine('   ')).toBeUndefined();
  });

  it('returns undefined for non-JSON lines', () => {
    expect(parseStreamJsonLine('hello, world')).toBeUndefined();
    expect(parseStreamJsonLine('{"type": "assistant"')).toBeUndefined();
  });

  it('returns undefined for JSON without a recognised type', () => {
    expect(parseStreamJsonLine('{"type":"weird"}')).toBeUndefined();
  });

  it('parses a system/init event', () => {
    const evt = parseStreamJsonLine('{"type":"system","subtype":"init","cwd":"/tmp"}');
    expect(evt?.type).toBe('system');
  });

  it('parses an assistant text-block event', () => {
    const evt = parseStreamJsonLine(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
    );
    expect(evt?.type).toBe('assistant');
  });

  it('parses a result event with usage', () => {
    const evt = parseStreamJsonLine(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'done',
        total_cost_usd: 0.05,
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    );
    expect(evt?.type).toBe('result');
  });
});

describe('eventToChunks', () => {
  it('emits one chunk per text block on an assistant event', () => {
    const evt = parseStreamJsonLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'first' },
            { type: 'text', text: 'second' },
          ],
        },
      }),
    );
    const chunks = eventToChunks(evt!);
    expect(chunks.map((c) => c.delta)).toEqual(['first', 'second']);
  });

  it('skips tool_use blocks and empty text blocks', () => {
    const evt = parseStreamJsonLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '' },
            { type: 'tool_use', id: 't1', name: 'Write', input: { path: 'a.py' } },
            { type: 'text', text: 'after tool' },
          ],
        },
      }),
    );
    const chunks = eventToChunks(evt!);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.delta).toBe('after tool');
  });

  it('emits a terminal chunk with usage on a result event', () => {
    const evt = parseStreamJsonLine(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'done',
        total_cost_usd: 0.05,
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    );
    const chunks = eventToChunks(evt!);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.delta).toBe('');
    expect(chunks[0]?.usage?.costUsd).toBeCloseTo(0.05);
    expect(chunks[0]?.usage?.inputTokens).toBe(100);
    expect(chunks[0]?.usage?.outputTokens).toBe(20);
  });

  it('emits no chunks for system and user events', () => {
    const sys = parseStreamJsonLine('{"type":"system","subtype":"init"}');
    const user = parseStreamJsonLine(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
        },
      }),
    );
    expect(eventToChunks(sys!)).toEqual([]);
    expect(eventToChunks(user!)).toEqual([]);
  });
});

describe('usageFromResult', () => {
  it('prefers total_cost_usd over cost_usd', () => {
    const r: ResultEvent = {
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.07,
      cost_usd: 0.01,
    };
    expect(usageFromResult(r).costUsd).toBeCloseTo(0.07);
  });

  it('falls back to cost_usd', () => {
    const r: ResultEvent = { type: 'result', subtype: 'success', cost_usd: 0.02 };
    expect(usageFromResult(r).costUsd).toBeCloseTo(0.02);
  });

  it('defaults to zero when usage is absent', () => {
    const r: ResultEvent = { type: 'result', subtype: 'success' };
    const u = usageFromResult(r);
    expect(u.inputTokens).toBe(0);
    expect(u.outputTokens).toBe(0);
    expect(u.costUsd).toBe(0);
  });
});

describe('resultIsError', () => {
  it('returns true when is_error flag is set', () => {
    expect(resultIsError({ type: 'result', subtype: 'success', is_error: true })).toBe(true);
  });
  it('returns true when subtype is an error variant', () => {
    expect(resultIsError({ type: 'result', subtype: 'error_max_turns' })).toBe(true);
    expect(resultIsError({ type: 'result', subtype: 'error' })).toBe(true);
  });
  it('returns false for success', () => {
    expect(resultIsError({ type: 'result', subtype: 'success' })).toBe(false);
  });
});
