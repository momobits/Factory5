/**
 * Outbound delivery worker — reads undelivered rows from `outbound_messages`
 * and hands them to the channel registry for actual delivery.
 *
 * Without this worker, messages the brain enqueues (e.g. the chat-intent
 * triage reply, Phase 4 Discord replies, `ask_user` prompts) would sit
 * in SQLite forever and never reach the target channel. The IPC `/send`
 * endpoint does its own synchronous delivery, but the brain writes to
 * `outbound.enqueue` directly; this worker covers that path.
 *
 * Loop shape:
 *   - Listens on doorbell `outbound.new` for immediate wake-up.
 *   - Polls every `pollIntervalMs` (default 1 s) as a safety net for
 *     rows that were enqueued without a doorbell ring.
 *   - For each pending row: calls `deliver(msg)`. If `delivered=true`,
 *     stamps `delivered_at`; otherwise records the failure (attempts
 *     ++ and `last_error`).
 *   - Messages whose `attempts` reach `maxAttempts` are skipped until
 *     manual intervention — we don't have a dead-letter table yet.
 */

import type { OutboundMessage } from '@factory5/core';
import type { Logger } from '@factory5/logger';
import { outbound, pendingQuestions, type Database } from '@factory5/state';

import type { Doorbell } from './doorbell.js';

/** Result of a single delivery attempt. */
export interface OutboundDeliveryResult {
  delivered: boolean;
  externalId?: string;
  error?: string;
}

export type OutboundDeliverer = (msg: OutboundMessage) => Promise<OutboundDeliveryResult>;

export interface OutboundWorkerOptions {
  log: Logger;
  db: Database;
  doorbell: Doorbell;
  deliver: OutboundDeliverer;
  /** Poll cadence. Default 1000 ms. */
  pollIntervalMs?: number;
  /** Batch size per pass. Default 25. */
  batchSize?: number;
  /** Give up on a message after this many failed attempts. Default 5. */
  maxAttempts?: number;
}

export interface OutboundWorkerHandle {
  /** Stop the worker. Idempotent. Resolves once the current pass drains. */
  stop(): Promise<void>;
}

/**
 * Start the outbound worker. The returned handle's `stop()` is pushed onto
 * the daemon's subsystems array.
 */
export function startOutboundWorker(opts: OutboundWorkerOptions): OutboundWorkerHandle {
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const batchSize = opts.batchSize ?? 25;
  const maxAttempts = opts.maxAttempts ?? 5;

  let stopped = false;
  let running = false;
  let wakeResolver: (() => void) | undefined;

  const onDoorbell = (): void => {
    wakeResolver?.();
  };
  opts.doorbell.on('outbound.new', onDoorbell);

  opts.log.info({ pollIntervalMs, batchSize, maxAttempts }, 'outbound: worker started');

  const drainOnce = async (): Promise<void> => {
    // Filter at the SQL layer: rows whose attempts have already reached the
    // cap are invisible to the drain loop. Without this they'd be re-fetched
    // every poll and log a warn per row per second forever — see the
    // sub-step 8.7 fix. Cap-reached rows stay in the DB for forensic value.
    const pending = outbound.listPending(opts.db, batchSize, maxAttempts);
    if (pending.length === 0) return;
    for (const msg of pending) {
      if (stopped) return;
      try {
        const result = await opts.deliver(msg);
        if (result.delivered) {
          outbound.markDelivered(opts.db, msg.id, new Date().toISOString());
          // I012: when this outbound carried an `ask_user`/escalation question,
          // stamp the provider's message id back onto pending_questions so the
          // channel matcher can pin a Reply-feature answer to this exact
          // question instead of falling back to FIFO. Best-effort: a missing
          // questionId or externalId just skips the stamp; a DB failure is
          // logged but doesn't fail the delivery.
          const questionId = readQuestionId(msg.metadata);
          if (questionId !== undefined && result.externalId !== undefined) {
            try {
              pendingQuestions.setBotMessageId(opts.db, questionId, result.externalId);
            } catch (err) {
              opts.log.warn(
                { messageId: msg.id, questionId, err },
                'outbound: failed to stamp bot_message_id on pending question',
              );
            }
          }
          opts.log.debug(
            { messageId: msg.id, target: msg.targetChannel, externalId: result.externalId },
            'outbound: delivered',
          );
        } else {
          const errMsg = result.error ?? 'channel returned delivered=false';
          outbound.recordFailure(opts.db, msg.id, errMsg);
          logDeferredOrAbandoned(msg, errMsg);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        outbound.recordFailure(opts.db, msg.id, errMsg);
        logDeferredOrAbandoned(msg, errMsg, err);
      }
    }
  };

  /**
   * Emit one warn on the transition to cap-reached (so operators know the
   * row has been abandoned), otherwise stay at debug. Without this split
   * every failed delivery would warn, burying signal in noise.
   */
  const logDeferredOrAbandoned = (
    msg: { id: string; targetChannel: string; attempts: number },
    errMsg: string,
    err?: unknown,
  ): void => {
    const newAttempts = msg.attempts + 1;
    if (newAttempts >= maxAttempts) {
      opts.log.warn(
        {
          messageId: msg.id,
          attempts: newAttempts,
          target: msg.targetChannel,
          lastError: errMsg,
          ...(err !== undefined ? { err } : {}),
        },
        'outbound: abandoning (attempt cap reached)',
      );
      return;
    }
    opts.log.debug(
      {
        messageId: msg.id,
        target: msg.targetChannel,
        error: errMsg,
        attempts: newAttempts,
        ...(err !== undefined ? { err } : {}),
      },
      'outbound: deferred (no live listener)',
    );
  };

  const loop = async (): Promise<void> => {
    while (!stopped) {
      if (running) {
        // Re-entrance guard — only one drain runs at a time.
        await sleep(50);
        continue;
      }
      running = true;
      try {
        await drainOnce();
      } catch (err) {
        opts.log.error({ err }, 'outbound: drain pass failed');
      } finally {
        running = false;
      }
      if (stopped) break;
      await Promise.race([
        sleep(pollIntervalMs),
        new Promise<void>((resolve) => {
          wakeResolver = resolve;
        }),
      ]);
      wakeResolver = undefined;
    }
  };

  const loopPromise = loop();

  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      wakeResolver?.();
      opts.doorbell.off('outbound.new', onDoorbell);
      try {
        await loopPromise;
      } catch (err) {
        opts.log.warn({ err }, 'outbound: loop rejected on shutdown');
      }
      opts.log.info('outbound: worker stopped');
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

/**
 * Pull a `questionId` out of an outbound's `metadata` blob if present.
 * The blob is `Record<string, unknown>` per the schema; both `askUser`
 * and `escalateBlocked` write `{ kind: 'ask_user', questionId }`.
 */
function readQuestionId(metadata: Record<string, unknown> | undefined): string | undefined {
  if (metadata === undefined) return undefined;
  const raw = metadata['questionId'];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}
