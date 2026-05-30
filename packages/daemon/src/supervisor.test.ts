import { createLogger, initLogger } from '@factory5/logger';
import { beforeAll, describe, expect, it } from 'vitest';

import { createSupervisor } from './supervisor.js';

beforeAll(() => {
  initLogger({ processName: 'supervisor-test', noFile: true, noConsole: true });
});

const log = createLogger('test');

describe('supervisor', () => {
  it('does not restart on clean exit', async () => {
    let started = 0;
    const sup = createSupervisor({
      name: 'clean',
      log,
      start: async () => {
        started += 1;
      },
    });
    await sup.done;
    await sup.stop();
    expect(started).toBe(1);
  });

  it('retries on crash up to maxRestarts', async () => {
    let started = 0;
    const crashes: number[] = [];
    const sup = createSupervisor({
      name: 'crasher',
      log,
      minBackoffMs: 1,
      maxBackoffMs: 5,
      maxRestarts: 3,
      onCrash: (_err, attempt) => crashes.push(attempt),
      start: async () => {
        started += 1;
        throw new Error('boom');
      },
    });
    await sup.done;
    expect(started).toBe(3);
    expect(crashes).toEqual([1, 2, 3]);
  });

  it('resets the consecutive-crash counter after a healthy run (does not hit the cap)', async () => {
    let started = 0;
    const crashes: number[] = [];
    const sup = createSupervisor({
      name: 'recoverer',
      log,
      minBackoffMs: 1,
      maxBackoffMs: 5,
      maxRestarts: 3,
      // Treat every run as "healthy" so each crash forgives the previous one.
      // With a lifetime counter this would give up after 3 crashes; here it
      // survives 5 and reaches the clean 6th run.
      resetAfterHealthyMs: 0,
      onCrash: (_err, attempt) => crashes.push(attempt),
      start: async () => {
        started += 1;
        if (started <= 5) throw new Error('boom');
      },
    });
    await sup.done;
    await sup.stop();
    expect(started).toBe(6);
    expect(crashes).toEqual([1, 1, 1, 1, 1]);
  });

  it('fires onGiveUp once when the crash cap is reached', async () => {
    let started = 0;
    let gaveUp = 0;
    let giveUpAttempts = 0;
    const sup = createSupervisor({
      name: 'giver',
      log,
      minBackoffMs: 1,
      maxBackoffMs: 5,
      maxRestarts: 2,
      resetAfterHealthyMs: 100_000, // immediate crashes never count as healthy
      onGiveUp: (_err, attempts) => {
        gaveUp += 1;
        giveUpAttempts = attempts;
      },
      start: async () => {
        started += 1;
        throw new Error('boom');
      },
    });
    await sup.done;
    expect(started).toBe(2);
    expect(gaveUp).toBe(1);
    expect(giveUpAttempts).toBe(2);
  });

  it('stop() aborts the supplied signal and settles done', async () => {
    let aborted = false;
    const sup = createSupervisor({
      name: 'longrunner',
      log,
      minBackoffMs: 1,
      start: (signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve();
          });
        }),
    });

    // Let the supervisor start.
    await new Promise((r) => setImmediate(r));
    await sup.stop();
    expect(aborted).toBe(true);
  });

  it('stop() while backing off short-circuits the wait', async () => {
    let started = 0;
    const sup = createSupervisor({
      name: 'backoff',
      log,
      minBackoffMs: 10_000, // long enough that done would hang if we didn't short-circuit
      maxBackoffMs: 60_000,
      maxRestarts: 5,
      start: async () => {
        started += 1;
        if (started === 1) throw new Error('once');
        // Second "attempt" shouldn't happen because we stop during backoff.
      },
    });

    // Wait for the first crash.
    await new Promise((r) => setTimeout(r, 20));
    await sup.stop();
    expect(started).toBe(1);
  });
});
