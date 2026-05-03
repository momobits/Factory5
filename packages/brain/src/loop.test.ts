/**
 * Unit tests for the small SSE-emit helpers exported from `loop.ts`. The
 * surrounding `runInline` orchestrator is exercised end-to-end by the
 * integration tests under `packages/daemon` and the agent-phase eval
 * runners — this file just covers the pure-function helpers in
 * isolation so the chat-path emission shape is pinned even when the
 * upstream provider stack is mocked out elsewhere.
 */

import type { DirectiveStreamEvent } from '@factory5/ipc';
import { describe, expect, it, vi } from 'vitest';

import { emitLogLine } from './loop.js';

describe('emitLogLine', () => {
  it('is silent when no emitter is wired', () => {
    expect(() =>
      emitLogLine(undefined, '01HZZZZZZZZZZZZZZZZZZZZZZA', 'info', 'brain.chat', 'hello'),
    ).not.toThrow();
  });

  it('forwards a well-formed log.line event to the emitter', () => {
    const events: DirectiveStreamEvent[] = [];
    const emit = vi.fn((event: DirectiveStreamEvent) => events.push(event));

    emitLogLine(emit, '01HZZZZZZZZZZZZZZZZZZZZZZA', 'info', 'brain.chat', 'hello world');

    expect(emit).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.type).toBe('log.line');
    if (event.type !== 'log.line') return; // narrows for the expects below
    expect(event.directiveId).toBe('01HZZZZZZZZZZZZZZZZZZZZZZA');
    expect(event.level).toBe('info');
    expect(event.component).toBe('brain.chat');
    expect(event.msg).toBe('hello world');
    expect(event.attrs).toBeUndefined();
    // ts must parse as a real ISO-with-offset instant.
    expect(new Date(event.ts).toISOString()).toBe(event.ts);
  });

  it('passes through an attrs payload when supplied', () => {
    const events: DirectiveStreamEvent[] = [];
    const emit = (event: DirectiveStreamEvent): void => {
      events.push(event);
    };

    emitLogLine(emit, '01HZZZZZZZZZZZZZZZZZZZZZZB', 'warn', 'brain.triage', 'low confidence', {
      intent: 'chat',
      confidence: 0.42,
    });

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.type).toBe('log.line');
    if (event.type !== 'log.line') return;
    expect(event.attrs).toEqual({ intent: 'chat', confidence: 0.42 });
  });

  it('omits the attrs field entirely when it is undefined (not just absent-key)', () => {
    let captured: DirectiveStreamEvent | undefined;
    const emit = (event: DirectiveStreamEvent): void => {
      captured = event;
    };

    emitLogLine(emit, '01HZZZZZZZZZZZZZZZZZZZZZZC', 'debug', 'brain.test', 'no attrs');

    expect(captured).toBeDefined();
    if (captured === undefined || captured.type !== 'log.line') return;
    expect(Object.prototype.hasOwnProperty.call(captured, 'attrs')).toBe(false);
  });
});
