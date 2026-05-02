import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetCancellationRegistry,
  cancelDirective,
  isCancellationRegistered,
  registerCancellation,
} from './cancellation.js';

describe('brain.cancellation registry', () => {
  afterEach(() => {
    _resetCancellationRegistry();
  });

  it('registers a controller and exposes a non-aborted signal', () => {
    const handle = registerCancellation('D1');
    expect(handle.signal.aborted).toBe(false);
    expect(isCancellationRegistered('D1')).toBe(true);
    handle.release();
    expect(isCancellationRegistered('D1')).toBe(false);
  });

  it('cancelDirective(id) fires the registered controller', () => {
    const handle = registerCancellation('D2');
    expect(cancelDirective('D2', 'because-i-said-so')).toBe(true);
    expect(handle.signal.aborted).toBe(true);
    expect((handle.signal.reason as Error).message).toBe('because-i-said-so');
    handle.release();
  });

  it('cancelDirective returns false when no controller is registered', () => {
    expect(cancelDirective('NOT-REGISTERED')).toBe(false);
  });

  it('release after cancel is a no-op', () => {
    const handle = registerCancellation('D3');
    cancelDirective('D3');
    expect(() => handle.release()).not.toThrow();
    expect(isCancellationRegistered('D3')).toBe(false);
  });

  it('parent-signal abort propagates to the combined signal', () => {
    const parent = new AbortController();
    const handle = registerCancellation('D4', parent.signal);
    parent.abort(new Error('shutdown'));
    expect(handle.signal.aborted).toBe(true);
    handle.release();
  });

  it('parent-signal already-aborted at registration time is reflected immediately', () => {
    const parent = new AbortController();
    parent.abort(new Error('pre-aborted'));
    const handle = registerCancellation('D5', parent.signal);
    expect(handle.signal.aborted).toBe(true);
    handle.release();
  });

  it('release detaches the parent listener (no leak)', () => {
    const parent = new AbortController();
    const handle = registerCancellation('D6', parent.signal);
    handle.release();
    // Aborting the parent post-release shouldn't fire on our (now detached)
    // signal — and the registry should already be empty either way.
    parent.abort();
    expect(handle.signal.aborted).toBe(false);
  });

  it('superseding registration aborts the previous controller', () => {
    const first = registerCancellation('D7');
    const second = registerCancellation('D7');
    expect(first.signal.aborted).toBe(true);
    expect((first.signal.reason as Error).message).toBe('superseded by new registration');
    expect(second.signal.aborted).toBe(false);
    expect(isCancellationRegistered('D7')).toBe(true);
    second.release();
  });

  it('release of a superseded handle does not unregister the active one', () => {
    const first = registerCancellation('D8');
    const second = registerCancellation('D8');
    first.release(); // releases the stale handle, but the live one stays
    expect(isCancellationRegistered('D8')).toBe(true);
    second.release();
    expect(isCancellationRegistered('D8')).toBe(false);
  });

  it('isolates registrations by directive id', () => {
    const a = registerCancellation('A');
    const b = registerCancellation('B');
    cancelDirective('A');
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    a.release();
    b.release();
  });

  it('_resetCancellationRegistry aborts and clears all entries', () => {
    const a = registerCancellation('R1');
    const b = registerCancellation('R2');
    _resetCancellationRegistry();
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
    expect(isCancellationRegistered('R1')).toBe(false);
    expect(isCancellationRegistered('R2')).toBe(false);
  });
});
