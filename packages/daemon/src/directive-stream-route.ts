/**
 * `GET /api/v1/directives/:id/stream` — SSE handler.
 *
 * Pumps {@link DirectiveStreamEvent}s from the in-memory
 * {@link DirectiveStreamHub} to a per-request SSE response. Owns:
 *
 *   - Bearer auth via `Authorization: Bearer <token>` OR `?t=<token>`
 *     (browsers' `EventSource` cannot set custom headers).
 *   - 404 when the directive does not exist.
 *   - SSE response headers + heartbeats (every 15 s of stream idle).
 *   - Backfill on connect: `task.started` for every existing task,
 *     plus `task.completed` for tasks already in terminal state, plus
 *     a baseline `spend.updated`. If the directive is already terminal
 *     the handler emits a single `directive.completed` and closes.
 *   - Live subscription for non-terminal directives, with cleanup on
 *     `directive.completed` and on client disconnect.
 *
 * Wire shape: `UPGRADE/specs/sse-directive-stream.md`.
 */

import type { Logger } from '@factory5/logger';
import { type DirectiveStreamEvent } from '@factory5/ipc';
import { IpcRequestError } from '@factory5/ipc';
import {
  directives as directivesQ,
  modelUsage,
  tasksInflight,
  type Database,
  type InflightTask,
} from '@factory5/state';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { DirectiveStreamHub } from './directive-stream.js';

/** Statuses considered terminal at the task level. */
const TERMINAL_TASK_STATUSES = new Set<InflightTask['status']>([
  'complete',
  'failed',
  'aborted',
  'blocked',
]);

/** Idle heartbeat cadence — comment line every N ms while no real event fires. */
const HEARTBEAT_INTERVAL_MS = 15_000;

export interface RegisterDirectiveStreamOptions {
  app: FastifyInstance;
  db: Database;
  hub: DirectiveStreamHub;
  /**
   * Bearer token required by the SSE route. When undefined the route
   * returns 503 (matches `requireUiAuth`'s contract for the rest of
   * `/api/v1/*`). Tests typically pass a known value.
   */
  uiAuthToken: string | undefined;
  log: Logger;
  /**
   * Override for the heartbeat cadence — tests pass a small value
   * (e.g. 100 ms) so they can observe a heartbeat fire without
   * waiting 15 s of real time. Production leaves this unset.
   */
  heartbeatIntervalMs?: number;
}

/**
 * Register `GET /api/v1/directives/:id/stream` against the supplied
 * Fastify instance. Idempotent — call once per server.
 */
export function registerDirectiveStreamRoute(opts: RegisterDirectiveStreamOptions): void {
  const { app, db, hub, log } = opts;
  const heartbeatMs = opts.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;

  app.get<{ Params: { id: string }; Querystring: { t?: string } }>(
    '/api/v1/directives/:id/stream',
    async (request, reply) => {
      requireSseAuth(request, opts.uiAuthToken);

      const { id } = request.params;
      const directive = directivesQ.getById(db, id);
      if (directive === undefined) {
        throw new IpcRequestError(404, 'DIRECTIVE_NOT_FOUND', `directive ${id} not found`);
      }

      // Hand the underlying socket over to us — Fastify won't try to set
      // headers or close the connection after this point.
      reply.hijack();
      const raw = reply.raw;

      raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // ----- helpers -----
      let lastWriteAt = Date.now();
      let cleanedUp = false;

      const writeEvent = (event: DirectiveStreamEvent): boolean => {
        if (cleanedUp || raw.writableEnded || raw.destroyed) return false;
        try {
          raw.write(`event: ${event.type}\n`);
          raw.write(`data: ${JSON.stringify(event)}\n\n`);
          lastWriteAt = Date.now();
          return true;
        } catch (err) {
          log.warn({ err, directiveId: id, type: event.type }, 'directive-stream: write failed');
          return false;
        }
      };

      const writeKeepalive = (): void => {
        if (cleanedUp || raw.writableEnded || raw.destroyed) return;
        try {
          raw.write(`:keepalive\n\n`);
          lastWriteAt = Date.now();
        } catch (err) {
          log.warn({ err, directiveId: id }, 'directive-stream: keepalive write failed');
        }
      };

      // Heartbeat: only fires when the stream has been idle for `heartbeatMs`.
      // Using a coarse poll cadence (heartbeatMs / 3) gives near-15-s timing
      // without firing on every single tick.
      const heartbeatTimer = setInterval(
        () => {
          if (Date.now() - lastWriteAt >= heartbeatMs) writeKeepalive();
        },
        Math.max(50, Math.floor(heartbeatMs / 3)),
      );
      // Don't keep the daemon's process alive purely on this timer.
      heartbeatTimer.unref?.();

      // Late-bound subscription handle — set after the terminal-short-circuit
      // check passes. Stored on a const holder so the cleanup closure can
      // forward unsubscribe without mutating a `let` binding.
      const subscription: { unsubscribe?: () => void } = {};

      // Run on disconnect (client close, completion event, error). Idempotent.
      const cleanup = (): void => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearInterval(heartbeatTimer);
        subscription.unsubscribe?.();
      };

      // Cleanup on client disconnect (browser close, network drop).
      request.raw.on('close', () => {
        cleanup();
      });
      request.raw.on('error', (err) => {
        log.debug({ err, directiveId: id }, 'directive-stream: request errored');
        cleanup();
      });

      // ----- backfill on connect -----
      const tasks = tasksInflight.listByDirective(db, id);
      for (const task of tasks) {
        const startedAt = task.startedAt ?? new Date(0).toISOString();
        writeEvent({
          type: 'task.started',
          taskId: task.id,
          directiveId: id,
          title: task.title,
          agent: task.agent,
          category: task.category,
          startedAt,
        });
        if (TERMINAL_TASK_STATUSES.has(task.status)) {
          writeEvent({
            type: 'task.completed',
            taskId: task.id,
            directiveId: id,
            status: task.status,
            exitCode: task.result?.exitCode ?? -1,
            finishedAt: task.finishedAt ?? new Date().toISOString(),
            error: task.result?.error ?? null,
          });
        }
      }

      writeEvent({
        type: 'spend.updated',
        directiveId: id,
        totalCostUsd: modelUsage.totalCostForDirective(db, id),
        callCount: modelUsage.countForDirective(db, id),
        deltaUsd: 0,
      });

      // transcript.line events are NOT backfilled on SSE reconnect. The
      // persisted transcript file (via GET .../transcript) is the recovery
      // path. On reconnect the frontend re-fetches from the API and resumes
      // the SSE tail from the last lineIndex seen.

      // ----- already-terminal short-circuit -----
      if (
        directive.status === 'complete' ||
        directive.status === 'failed' ||
        directive.status === 'blocked'
      ) {
        writeEvent({
          type: 'directive.completed',
          directiveId: id,
          status: directive.status,
          blockedReason: directive.blockedReason ?? null,
        });
        cleanup();
        try {
          raw.end();
        } catch {
          // socket already gone — nothing to do
        }
        return;
      }

      // ----- live subscription -----
      subscription.unsubscribe = hub.subscribe(id, (event) => {
        const written = writeEvent(event);
        if (!written) return;
        if (event.type === 'directive.completed') {
          // Forward then close: each per-request subscription unwinds itself
          // via cleanup(); the hub's own residual map is collapsed by the
          // brain side calling `closeDirective` when no consumer remained
          // (see DirectiveStreamHub.closeDirective).
          cleanup();
          try {
            raw.end();
          } catch {
            // socket already gone
          }
        }
      });

      log.debug({ directiveId: id, taskBackfill: tasks.length }, 'directive-stream: subscribed');
    },
  );
}

/**
 * Bearer check for the SSE route. Accepts EITHER
 * `Authorization: Bearer <token>` OR `?t=<token>` (the latter for
 * `EventSource` which can't set custom headers). Mirrors the
 * 503/401 contract of `requireUiAuth`.
 *
 * Constant-time-compares both forms against the daemon's
 * `uiAuthToken`. Length-mismatch shortcut is fine — token length is
 * a public constant per startup.
 */
function requireSseAuth(
  request: FastifyRequest<{ Querystring: { t?: string } }>,
  token: string | undefined,
): void {
  if (token === undefined) {
    throw new IpcRequestError(503, 'UI_DISABLED', 'daemon is not configured with a UI auth token');
  }
  const fromHeader = extractHeaderBearer(request);
  const fromQuery = typeof request.query.t === 'string' ? request.query.t : undefined;
  const provided = fromHeader ?? fromQuery;
  if (provided === undefined || !constantTimeEqual(provided, token)) {
    throw new IpcRequestError(401, 'UI_AUTH_REQUIRED', 'missing or invalid bearer token');
  }
}

function extractHeaderBearer(request: FastifyRequest): string | undefined {
  const header = request.headers['authorization'];
  if (typeof header !== 'string') return undefined;
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return undefined;
  return header.slice(prefix.length);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
