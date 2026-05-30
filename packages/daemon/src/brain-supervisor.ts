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

import type { DirectiveStreamHub } from './directive-stream.js';
import type { Doorbell } from './doorbell.js';
import { createSupervisor, type SupervisorHandle } from './supervisor.js';

export interface BrainSupervisorOptions {
  log: Logger;
  db: Database;
  doorbell: Doorbell;
  /**
   * Per-directive SSE event hub (Phase 3 / step 3.1). When set, the
   * supervisor wires `runBrain`'s `emitDirectiveEvent` callback to
   * push every brain-emitted state transition into the hub. SSE
   * subscribers receive these events live. When omitted, brain runs
   * with emission disabled (SSE consumers see only backfill on
   * connect).
   */
  directiveStream?: DirectiveStreamHub;
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
    onGiveUp: (lastErr, attempts) => {
      // The supervisor has permanently stopped restarting the serve loop.
      // factoryd stays up (channels, IPC) but will NOT process any further
      // directives until it is restarted — make that loud rather than silent.
      opts.log.error(
        { component: 'brain', err: lastErr, attempts },
        'brain supervisor gave up after repeated crashes — NO directives will be processed until factoryd is restarted; investigate the crash above',
      );
    },
    start: async (signal) => {
      let handle: BrainHandle | undefined;
      try {
        const hub = opts.directiveStream;
        handle = await runBrain({
          mode: 'serve',
          db: opts.db,
          signal,
          ...(opts.registry !== undefined ? { registry: opts.registry } : {}),
          ...(opts.claimedBy !== undefined ? { claimedBy: opts.claimedBy } : {}),
          ...(opts.concurrency !== undefined ? { serveConcurrency: opts.concurrency } : {}),
          ...(hub !== undefined ? { emitDirectiveEvent: (event) => hub.emit(event) } : {}),
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
