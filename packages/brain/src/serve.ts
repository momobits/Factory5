/**
 * `runBrain({ mode: 'serve' })` — long-running claim loop for the daemon.
 *
 * The serve loop:
 *   1. Claims pending directives atomically from SQLite (FIFO, via
 *      `directives.claimNext`).
 *   2. Dispatches each claim to the existing inline pipeline. Multiple
 *      directives can run in parallel up to `concurrency` (default 1).
 *   3. Waits between claim passes on either the doorbell (an external wake
 *      signal — the daemon's IPC `/directives/notify` endpoint) or a 250 ms
 *      polling fallback. When both are available the doorbell shortcuts
 *      latency; when only polling is available the loop still makes progress.
 *   4. Honors an `AbortSignal` for graceful shutdown. On abort we stop
 *      claiming new work and wait for in-flight directives to settle; any
 *      directive whose inline run throws from the abort is transitioned to
 *      `blocked` so the row isn't left in `'running'` state.
 *
 * The brain does not depend on `@factory5/daemon` — the daemon wires its
 * doorbell into the `onWake` hook so the packages remain acyclic.
 */

import process from 'node:process';

import type { Directive } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import type { DirectiveEventEmitter } from '@factory5/ipc';
import type { ProviderRegistry } from '@factory5/providers';
import { directives as directivesQ, type Database } from '@factory5/state';

import { runAutoAnswerSweep } from './auto-answer.js';
import { registerCancellation } from './cancellation.js';
import { emitLogLine } from './emit.js';
import { createPoolResume, type PoolResume } from './pool-resume.js';

const log = createLogger('brain.serve');

/** Default polling cadence when no doorbell is wired (or to catch missed events). */
const DEFAULT_POLL_INTERVAL_MS = 250;

/**
 * Minimum interval between Tier 8 auto-answer sweep passes. The serve
 * loop ticks at `pollIntervalMs` (250 ms by default) but the sweep only
 * runs at most once every `AUTO_ANSWER_SWEEP_INTERVAL_MS` to avoid
 * pointless DB scans. The sweep query itself is cheap (one indexed
 * SELECT) but the cumulative cost of running it 4×/sec is wasted work
 * against deadlines that change on a minute-or-longer scale.
 */
const AUTO_ANSWER_SWEEP_INTERVAL_MS = 5000;

/**
 * Hook the caller uses to register a "new work" signal. The registered
 * callback is invoked whenever an external source (typically the daemon's
 * IPC doorbell) wants to wake the claim loop. Return a disposer used on
 * shutdown.
 */
export type OnWake = (cb: () => void) => () => void;

export interface ServeOptions {
  db: Database;
  registry: ProviderRegistry;
  signal: AbortSignal;
  /** Value written to `directives.claimed_by`. Default `serve-<pid>`. */
  claimedBy?: string;
  /**
   * Max concurrent directives in flight. Per-directive task concurrency is
   * a separate knob on the pool. Default 1 (one build at a time).
   */
  concurrency?: number;
  /** Poll cadence in ms. Default 250. */
  pollIntervalMs?: number;
  /** Register a wake callback. Optional — absent ⇒ polling-only. */
  onWake?: OnWake;
  /**
   * Per-directive SSE event emitter (Phase 3 / step 3.1). Forwarded to
   * each per-directive `runBrain({ mode: 'inline' })` so brain emission
   * sites in `loop.ts` and `pool.ts` can push events through to the
   * daemon's stream hub.
   */
  emitDirectiveEvent?: DirectiveEventEmitter;
  /**
   * Inline runner. Injected so tests can stub out the full pipeline without
   * spinning up providers. Production callers omit this.
   */
  runOne?: (directive: Directive, args: InlineRunnerArgs) => Promise<void>;
}

/** Args passed to the inline runner. */
export interface InlineRunnerArgs {
  db: Database;
  registry: ProviderRegistry;
  claimedBy: string;
  signal: AbortSignal;
  /** Forward of the SSE emitter when set on the parent serve loop. */
  emitDirectiveEvent?: DirectiveEventEmitter;
}

/**
 * Run the serve loop until `signal` aborts. Resolves on clean shutdown;
 * rejects if something catastrophic happens (DB closed mid-loop, etc.) so
 * the supervisor can restart.
 */
export async function runServe(opts: ServeOptions): Promise<void> {
  const claimedBy = opts.claimedBy ?? `serve-${String(process.pid)}`;
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const runOne = opts.runOne ?? defaultRunOne;

  // Tier 15 / ADR 0034 — pool-resume watcher. Lazy-registers per project
  // when we claim a directive on that project. When the operator raises a
  // cap in `<project>/.factory/project.json`, the watcher re-checks parked
  // directives on that project and flips those with headroom back to
  // `running`. Our next poll tick claims them.
  const poolResume: PoolResume = createPoolResume({ db: opts.db, log });

  const inflight = new Map<string, Promise<void>>();

  // Doorbell bridge: a simple "fired once since last reset" flag so a ring
  // during a busy pass isn't lost between iterations.
  let doorbellRang = false;
  let pendingWake: (() => void) | undefined;
  const onRing = (): void => {
    doorbellRang = true;
    pendingWake?.();
  };
  const unsubscribe = opts.onWake?.(onRing);

  const abortWake = (): void => {
    pendingWake?.();
  };
  opts.signal.addEventListener('abort', abortWake, { once: true });

  log.info(
    { claimedBy, concurrency, pollIntervalMs, hasDoorbell: opts.onWake !== undefined },
    'serve: started',
  );

  let lastAutoAnswerSweepAt = 0;

  try {
    while (!opts.signal.aborted) {
      // Tier 8 auto-answer sweep (ADR 0030). Throttled to at most once
      // every AUTO_ANSWER_SWEEP_INTERVAL_MS so the serve loop's 250 ms
      // tick doesn't burn cycles re-scanning unchanged state. Errors
      // here are caught + logged so the sweep never breaks the directive
      // claim path.
      const now = Date.now();
      if (now - lastAutoAnswerSweepAt >= AUTO_ANSWER_SWEEP_INTERVAL_MS) {
        lastAutoAnswerSweepAt = now;
        runAutoAnswerSweep({ db: opts.db, registry: opts.registry }).catch((err: unknown) => {
          log.warn({ err }, 'serve: auto-answer sweep threw');
        });
      }

      // Dispatch as many pending directives as we have slots for.
      while (inflight.size < concurrency && !opts.signal.aborted) {
        const directive = directivesQ.claimNext(opts.db, { claimedBy });
        if (directive === undefined) break;
        log.info(
          { directiveId: directive.id, intent: directive.intent, inflight: inflight.size + 1 },
          'serve: claimed directive',
        );

        // Tier 15 / ADR 0034 — register a pool-resume watcher on the
        // directive's project. Idempotent — `registerProject` is a no-op
        // when the project is already watched. The watcher persists for
        // the life of the serve loop (one chokidar watcher per project),
        // covering subsequent directives on the same project too.
        const projectPath = extractProjectPathSafely(directive);
        if (projectPath !== undefined) {
          poolResume.registerProject(projectPath).catch((err: unknown) => {
            log.warn(
              { err, directiveId: directive.id, projectPath },
              'serve: poolResume.registerProject failed — auto-resume on cap-raise will not fire',
            );
          });
        }
        // Phase 2.4 — register a per-directive cancellation controller.
        // The combined signal fires on either parent-shutdown or a
        // `factory cancel <id>` over IPC. Released in the finally clause
        // below so a subsequent cancel for the same id is a no-op.
        const cancellation = registerCancellation(directive.id, opts.signal);
        const runPromise = runOne(directive, {
          db: opts.db,
          registry: opts.registry,
          claimedBy,
          signal: cancellation.signal,
          ...(opts.emitDirectiveEvent !== undefined
            ? { emitDirectiveEvent: opts.emitDirectiveEvent }
            : {}),
        })
          .then(() => {
            log.info({ directiveId: directive.id }, 'serve: directive finished');
          })
          .catch((err: unknown) => {
            // Operator-driven cancel: row has already been flipped to
            // `failed` by the daemon's /cancel route — leave it alone.
            // Recognised by the per-directive signal aborting while the
            // parent (shutdown) signal is still live.
            if (cancellation.signal.aborted && !opts.signal.aborted) {
              log.info(
                { directiveId: directive.id, err },
                'serve: directive cancelled — DB row already updated by cancel route',
              );
              return;
            }
            // If we aborted mid-run, mark the directive as blocked so it
            // doesn't get stuck in `running` forever — resume can pick it up.
            if (opts.signal.aborted) {
              try {
                directivesQ.updateStatus(opts.db, directive.id, 'blocked');
              } catch (writeErr) {
                log.warn(
                  { writeErr, directiveId: directive.id },
                  'serve: failed to mark aborted directive as blocked',
                );
              }
              log.warn(
                { directiveId: directive.id, err },
                'serve: directive aborted — marked blocked',
              );
              return;
            }
            // Non-abort failure: mark failed and keep the loop healthy.
            try {
              directivesQ.updateStatus(opts.db, directive.id, 'failed');
            } catch (writeErr) {
              log.warn(
                { writeErr, directiveId: directive.id },
                'serve: failed to mark failed directive',
              );
            }
            log.error({ err, directiveId: directive.id }, 'serve: directive threw');
            // ADR 0031 — surface the throw on the SSE stream so directive-detail's
            // activity panel renders the actual cause instead of staying silent. The
            // brain-side error sites (architect/planner parse-fail, etc.) already
            // emit a structured log.line earlier in the same throw path; this is a
            // belt-and-suspenders fallback for unexpected throws that didn't get
            // an emit on the way out.
            const emit = opts.emitDirectiveEvent;
            if (emit !== undefined) {
              const errMsg = err instanceof Error ? err.message : String(err);
              emitLogLine(
                emit,
                directive.id,
                'error',
                'brain.loop',
                `brain: directive threw — ${errMsg.slice(0, 200)}`,
              );
              emit({
                type: 'directive.completed',
                directiveId: directive.id,
                status: 'failed',
                blockedReason: null,
              });
            }
          })
          .finally(() => {
            cancellation.release();
            inflight.delete(directive.id);
            pendingWake?.();
          });
        inflight.set(directive.id, runPromise);
      }

      if (opts.signal.aborted) break;

      // Wait for: abort | doorbell ring | poll timeout | any slot freeing.
      const freeSlotOrWake = new Promise<void>((resolve) => {
        pendingWake = resolve;
      });
      const timerPromise = sleep(pollIntervalMs);
      const slotPromises = [...inflight.values()];

      await Promise.race([freeSlotOrWake, timerPromise, ...slotPromises]);
      pendingWake = undefined;
      if (doorbellRang) {
        doorbellRang = false;
      }
    }

    // Shutdown — drain inflight. They each got `signal`, so they'll settle.
    if (inflight.size > 0) {
      log.info({ inflight: inflight.size }, 'serve: draining inflight directives');
      await Promise.allSettled([...inflight.values()]);
    }
    log.info('serve: stopped cleanly');
  } finally {
    opts.signal.removeEventListener('abort', abortWake);
    unsubscribe?.();
    // Tier 15 / ADR 0034 — close all chokidar watchers so the serve loop
    // releases its file-watcher handles on shutdown.
    try {
      await poolResume.shutdown();
    } catch (err) {
      log.warn({ err }, 'serve: poolResume.shutdown failed (non-fatal)');
    }
  }
}

/**
 * Extract the directive's `payload.projectPath` (or `payload.project` as
 * an older alias) for the pool-resume watcher registration. Returns
 * `undefined` for directives without a project path (e.g. chat / system
 * directives) — the caller skips watcher registration in that case.
 */
function extractProjectPathSafely(directive: Directive): string | undefined {
  if (typeof directive.payload !== 'object' || directive.payload === null) return undefined;
  const p = directive.payload as Record<string, unknown>;
  const candidate = p['projectPath'] ?? p['project'];
  if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  return undefined;
}

/**
 * Default inline runner. Lazy-imported to avoid circular module evaluation
 * between `serve.ts` and `loop.ts`.
 */
async function defaultRunOne(directive: Directive, args: InlineRunnerArgs): Promise<void> {
  const { runBrain } = await import('./loop.js');
  const handle = await runBrain({
    mode: 'inline',
    directiveId: directive.id,
    db: args.db,
    registry: args.registry,
    claimedBy: args.claimedBy,
    signal: args.signal,
    ...(args.emitDirectiveEvent !== undefined
      ? { emitDirectiveEvent: args.emitDirectiveEvent }
      : {}),
  });
  await handle.done;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}
