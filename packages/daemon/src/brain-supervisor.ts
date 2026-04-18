/**
 * Daemon-side wiring for the brain's serve loop.
 *
 * `startBrainSupervisor` glues together:
 *   - The `@factory5/brain` serve loop (`runBrain({ mode: 'serve' })`).
 *   - The daemon's {@link Doorbell} — `directive.new` events ring the
 *     brain's wake hook.
 *   - A {@link createSupervisor} wrapper that restarts the loop on crash
 *     with exponential backoff.
 */

import { runBrain, type BrainHandle } from '@factory5/brain';
import type { ProviderRegistry } from '@factory5/providers';
import type { Logger } from '@factory5/logger';
import type { Database } from '@factory5/state';

import type { Doorbell } from './doorbell.js';
import { createSupervisor, type SupervisorHandle } from './supervisor.js';

export interface BrainSupervisorOptions {
  log: Logger;
  db: Database;
  doorbell: Doorbell;
  /**
   * Provider registry. If omitted, `runBrain` loads config from disk on
   * each (re)start so the brain picks up config reloads naturally.
   */
  registry?: ProviderRegistry;
  /** Directives in flight concurrently. Default 1. */
  concurrency?: number;
  /** `claimedBy` written to `directives.claimed_by`. */
  claimedBy?: string;
  /** Crash-loop backoff floor; default 500 ms. */
  minBackoffMs?: number;
  /** Crash-loop backoff ceiling; default 30 s. */
  maxBackoffMs?: number;
  /** Restart cap before giving up; default 10. Set `null` for unbounded. */
  maxRestarts?: number | null;
}

/**
 * Start a supervised brain serve loop. The returned supervisor can be
 * stopped gracefully; `done` resolves when the supervisor exits (either
 * clean shutdown or crash cap reached).
 */
export function startBrainSupervisor(opts: BrainSupervisorOptions): SupervisorHandle {
  return createSupervisor({
    name: 'brain',
    log: opts.log,
    ...(opts.minBackoffMs !== undefined ? { minBackoffMs: opts.minBackoffMs } : {}),
    ...(opts.maxBackoffMs !== undefined ? { maxBackoffMs: opts.maxBackoffMs } : {}),
    ...(opts.maxRestarts !== undefined ? { maxRestarts: opts.maxRestarts } : {}),
    start: async (signal) => {
      let handle: BrainHandle | undefined;
      try {
        handle = await runBrain({
          mode: 'serve',
          db: opts.db,
          signal,
          ...(opts.registry !== undefined ? { registry: opts.registry } : {}),
          ...(opts.claimedBy !== undefined ? { claimedBy: opts.claimedBy } : {}),
          ...(opts.concurrency !== undefined ? { serveConcurrency: opts.concurrency } : {}),
          onWake: (cb) => {
            opts.doorbell.on('directive.new', cb);
            return () => opts.doorbell.off('directive.new', cb);
          },
        });
        await handle.done;
      } finally {
        // Handle.stop is async, but if `done` already settled it's a no-op.
        await handle?.stop();
      }
    },
  });
}
