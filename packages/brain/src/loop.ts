/**
 * Brain orchestration loop — stub.
 *
 * Phase 1: implements `mode: 'inline'` (claims given directiveId, runs the
 * pipeline synchronously, returns when complete or escalated).
 *
 * Phase 3: adds `mode: 'serve'` (long-running, polls SQLite for pending
 * directives, claims FIFO, runs in-process or spawns workers).
 */

import { createLogger } from '@factory5/logger';

const log = createLogger('brain.loop');

export interface BrainOptions {
  mode: 'inline' | 'serve';
  /** Required when mode = 'inline'. */
  directiveId?: string;
}

export interface BrainHandle {
  /** Resolves when the brain has finished its work (inline) or been stopped (serve). */
  done: Promise<void>;
  /** Stop the brain (signals graceful shutdown for serve mode). */
  stop(): Promise<void>;
}

/** Stub. */
export async function runBrain(opts: BrainOptions): Promise<BrainHandle> {
  log.warn({ mode: opts.mode }, 'runBrain: stub — Phase 1 implementation pending');
  return {
    done: Promise.resolve(),
    stop: async () => undefined,
  };
}
