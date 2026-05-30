/**
 * Crash-loop supervisor. Wraps a long-running async task (e.g. the brain's
 * serve loop) with exponential backoff + bounded restart budget.
 *
 * Contract for the supervised `start(signal)`:
 *   - Returns a promise that resolves when the task exits cleanly (normal
 *     shutdown) and rejects when it crashes.
 *   - MUST honor the supplied `AbortSignal` — when the supervisor itself is
 *     stopped, it aborts the signal; `start` should observe it and settle.
 *
 * The supervisor restarts on *reject* only; a clean resolve is treated as
 * "done, don't restart" (e.g., a serve loop that ran out of work and exited
 * gracefully).
 */

import type { Logger } from '@factory5/logger';

export interface SupervisorOptions {
  /** Component name used in log fields; e.g. `'brain'`. */
  name: string;
  /** Logger inherited from the daemon. */
  log: Logger;
  /**
   * The long-running task. Receives an AbortSignal the supervisor aborts
   * when stopping. Should resolve on clean exit, reject on crash.
   */
  start: (signal: AbortSignal) => Promise<void>;
  /** Initial backoff after the first crash. Default 500ms. */
  minBackoffMs?: number;
  /** Upper bound on the backoff. Default 30_000ms. */
  maxBackoffMs?: number;
  /**
   * Max *consecutive* crashes before giving up (prevents infinite tight
   * crash loops from burning CPU). `null` disables the cap. Default 10.
   *
   * "Consecutive" is enforced via {@link resetAfterHealthyMs}: a crash that
   * follows a healthy run resets the counter, so crashes spread across a long
   * lifetime never accumulate to the cap.
   */
  maxRestarts?: number | null;
  /**
   * If the task ran for at least this long before crashing, the consecutive-
   * crash counter is reset to 0 (the prior crashes are "forgiven" — the task
   * clearly recovered). Without this, the counter is a *lifetime* counter and
   * the supervised task is killed permanently after `maxRestarts` crashes no
   * matter how far apart. Default 60_000ms.
   */
  resetAfterHealthyMs?: number;
  /** Called on each crash — mostly for test hooks / telemetry. */
  onCrash?: (err: unknown, attempt: number) => void;
  /**
   * Called once when the supervisor permanently gives up (crash cap reached).
   * Lets the daemon surface a loud, actionable signal instead of silently
   * running on with a dead supervised task.
   */
  onGiveUp?: (lastErr: unknown, attempts: number) => void;
}

export interface SupervisorHandle {
  /** Resolves when the supervisor stops (clean exit or crash-cap). */
  done: Promise<void>;
  /** Stop the supervised task and the supervisor. Idempotent. */
  stop(): Promise<void>;
}

export function createSupervisor(opts: SupervisorOptions): SupervisorHandle {
  const minBackoff = opts.minBackoffMs ?? 500;
  const maxBackoff = opts.maxBackoffMs ?? 30_000;
  const maxRestarts = opts.maxRestarts === undefined ? 10 : opts.maxRestarts;
  const resetAfterHealthy = opts.resetAfterHealthyMs ?? 60_000;

  let stopped = false;
  let consecutiveCrashes = 0;
  let currentAc: AbortController | undefined;
  let stopResolve: (() => void) | undefined;
  const stopped$ = new Promise<void>((resolve) => {
    stopResolve = resolve;
  });

  const done = (async () => {
    while (!stopped) {
      const ac = new AbortController();
      currentAc = ac;
      const taskStartedAt = Date.now();
      try {
        opts.log.info(
          { component: opts.name, attempt: consecutiveCrashes + 1 },
          'supervisor: starting task',
        );
        await opts.start(ac.signal);
        // Clean resolve → we're done.
        opts.log.info({ component: opts.name }, 'supervisor: task exited cleanly');
        return;
      } catch (err) {
        if (stopped) {
          // Error during shutdown — expected; don't restart.
          opts.log.debug({ component: opts.name, err }, 'supervisor: task errored during shutdown');
          return;
        }
        // A crash that follows a healthy run forgives the earlier crashes —
        // keeps `consecutiveCrashes` truly consecutive rather than a lifetime
        // tally (which would permanently kill the task after `maxRestarts`
        // crashes spread arbitrarily far apart).
        // Clamp: a backward wall-clock jump must not produce a negative uptime
        // that spuriously skips the healthy-run reset.
        const uptimeMs = Math.max(0, Date.now() - taskStartedAt);
        if (consecutiveCrashes > 0 && uptimeMs >= resetAfterHealthy) {
          opts.log.info(
            { component: opts.name, uptimeMs, forgaveCrashes: consecutiveCrashes },
            'supervisor: task ran healthy before crashing — resetting consecutive-crash counter',
          );
          consecutiveCrashes = 0;
        }
        consecutiveCrashes += 1;
        opts.onCrash?.(err, consecutiveCrashes);
        opts.log.error(
          { component: opts.name, err, attempt: consecutiveCrashes, max: maxRestarts },
          'supervisor: task crashed',
        );
        if (maxRestarts !== null && consecutiveCrashes >= maxRestarts) {
          opts.log.error(
            { component: opts.name, attempt: consecutiveCrashes, max: maxRestarts },
            'supervisor: crash cap reached, giving up',
          );
          opts.onGiveUp?.(err, consecutiveCrashes);
          return;
        }
        const delay = Math.min(maxBackoff, minBackoff * Math.pow(2, consecutiveCrashes - 1));
        const jitter = Math.floor(delay * 0.2 * Math.random());
        const wait = delay + jitter;
        opts.log.warn(
          { component: opts.name, waitMs: wait, nextAttempt: consecutiveCrashes + 1 },
          'supervisor: backing off before restart',
        );
        await Promise.race([sleep(wait), stopped$]);
      }
    }
  })();

  return {
    done,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      stopResolve?.();
      currentAc?.abort();
      try {
        await done;
      } catch {
        // Swallow — supervisor's done doesn't reject; this is defensive.
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Don't keep Node alive just for a backoff timer — supervisor lifetime is
    // owned by `stop()`.
    if (typeof t.unref === 'function') t.unref();
  });
}
