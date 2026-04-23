/**
 * IPC server — Fastify on `127.0.0.1:25295` (default). Exposes the Zod-
 * validated endpoints defined in `@factory5/ipc`:
 *
 *   GET  /healthz            bare liveness probe (handlerless)
 *   GET  /status             daemon status (channels, pid, uptime)
 *   POST /send               enqueue outbound message
 *   POST /directives/notify  doorbell — brain claim loop wakes up
 *   POST /reload-config      broadcast config-reload to subsystems
 *   POST /worker/ask-user    (gated) worker→brain askUser proxy (ADR 0024)
 *
 * Every handler logs a correlationId. Non-localhost connections are refused
 * both at the bind layer (we listen on `127.0.0.1`) and at a preHandler
 * (defense-in-depth if the daemon is ever reconfigured to bind broader).
 *
 * The `/worker/*` namespace is bearer-token-gated. Brain generates a per-
 * startup token and passes it to its worker subprocesses via env; only those
 * workers can hit the route. Existing routes stay loopback-only without the
 * extra gate.
 */

import type { AddressInfo } from 'node:net';
import process from 'node:process';

import type { ChannelId, OutboundMessage } from '@factory5/core';
import { newId } from '@factory5/core';
import {
  directiveNotifyRequestSchema,
  IpcRequestError,
  ipcErrorSchema,
  reloadConfigResponseSchema,
  sendRequestSchema,
  sendResponseSchema,
  statusResponseSchema,
  workerAskUserRequestSchema,
  workerAskUserResponseSchema,
  type StatusResponse,
  type WorkerAskUserRequest,
  type WorkerAskUserResponse,
} from '@factory5/ipc';
import type { Logger } from '@factory5/logger';
import { createLogger } from '@factory5/logger';
import { directives as directivesQ, outbound, type Database } from '@factory5/state';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import type { Doorbell } from './doorbell.js';
import type { OutboundDeliverer } from './outbound-worker.js';

const log = createLogger('daemon.ipc');

/** Loopback hosts accepted by the preHandler IP guard. */
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Minimal read-only view of the channel registry for `/status`. Step 4 wires
 * the real implementation; step 2 passes an empty registry so `/status`
 * returns `channels: []`.
 */
export interface ChannelRegistryView {
  list(): ReadonlyArray<{
    id: ChannelId;
    status: 'ready' | 'starting' | 'failed' | 'disabled';
    lastError?: string;
  }>;
}

/**
 * Handler signature for the `/worker/ask-user` route. Receives the validated
 * request body, returns the response body. The handler owns:
 *
 *  - Validating that `taskId` belongs to a real `tasks_inflight` row whose
 *    `directive_id` matches the request (defense-in-depth per ADR 0024 §3).
 *  - Calling brain's `askUser()` (which polls `pending_questions` until the
 *    answer arrives, the deadline passes, or an abort signal fires).
 *  - Returning `{questionId, answer?, timedOut, aborted}` exactly.
 *
 * Throwing {@link IpcRequestError} bubbles up to the registered error
 * handler with a typed envelope (e.g. 404 unknown task / directive, 409
 * task already in a terminal state). Other errors are logged as 500.
 */
export type WorkerAskUserHandler = (req: WorkerAskUserRequest) => Promise<WorkerAskUserResponse>;

export interface IpcServerOptions {
  host: string;
  port: number;
  db: Database;
  doorbell: Doorbell;
  startedAt: string;
  /** Semver of the daemon; surfaced on `/status`. */
  version: string;
  /**
   * Process name string surfaced on `/status`. Typically `'factoryd'` for
   * production runs; tests pass `'factoryd-test'`.
   */
  processName: string;
  /**
   * Channel registry. If omitted, `/status` reports an empty channels list.
   * Step 4 wires a real registry.
   */
  channels?: ChannelRegistryView;
  /**
   * Outbound deliverer. If omitted, `/send` enqueues to SQLite only and
   * returns `delivered: false`. Step 4 wires a real channel delivery path.
   */
  deliverOutbound?: OutboundDeliverer;
  /**
   * Handler for `POST /worker/ask-user`. When omitted, the route returns 503
   * `WORKER_ASK_USER_DISABLED` — the daemon hasn't been started with worker-
   * askUser support, or it's been deliberately turned off. See ADR 0024.
   */
  workerAskUser?: WorkerAskUserHandler;
  /**
   * Bearer token required by `/worker/*` routes. When omitted, those routes
   * accept any loopback request (intended for tests; production daemons
   * always set this). Token is rotated per brain startup; passed to worker
   * subprocesses via env.
   */
  workerAuthToken?: string;
}

export interface IpcServerHandle {
  /** Bound port (matters when the caller requested port 0). */
  boundPort: number;
  /** Underlying Fastify instance — exposed for tests via `.inject()`. */
  app: FastifyInstance;
  /** Gracefully stop the server. Idempotent. */
  stop(): Promise<void>;
}

function isLoopback(request: FastifyRequest): boolean {
  const ip = request.ip ?? '';
  if (LOOPBACK_IPS.has(ip)) return true;
  // Fastify may also expose hostname 'localhost' in some environments; treat
  // unset `request.ip` as untrusted.
  return false;
}

function setupErrorHandler(app: FastifyInstance, ipcLog: Logger): void {
  app.setErrorHandler((err, request, reply) => {
    // Fastify hands us a typed FastifyError; real runtime errors can be any
    // thrown object, so narrow through `unknown` before instanceof checks.
    const thrown = err as unknown;

    if (thrown instanceof IpcRequestError) {
      ipcLog.warn(
        { reqId: request.id, status: thrown.httpStatus, code: thrown.code, msg: thrown.message },
        'ipc: request error',
      );
      reply.status(thrown.httpStatus).send(thrown.toEnvelope());
      return;
    }
    if (thrown instanceof ZodError) {
      ipcLog.warn({ reqId: request.id, issues: thrown.issues }, 'ipc: schema validation failed');
      reply.status(400).send(
        ipcErrorSchema.parse({
          error: {
            code: 'SCHEMA_VALIDATION_FAILED',
            message: 'request body failed schema validation',
            details: thrown.issues,
          },
        }),
      );
      return;
    }
    // Fastify's built-in error shape (e.g. FST_ERR_VALIDATION) has `statusCode`.
    const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
    const message = err.message.length > 0 ? err.message : 'internal error';
    ipcLog.error(
      { reqId: request.id, err, statusCode },
      statusCode >= 500 ? 'ipc: unhandled error' : 'ipc: request error',
    );
    reply.status(statusCode).send(
      ipcErrorSchema.parse({
        error: {
          code: statusCode >= 500 ? 'INTERNAL' : 'BAD_REQUEST',
          message,
        },
      }),
    );
  });
}

function registerRoutes(
  app: FastifyInstance,
  opts: IpcServerOptions,
  ipcLog: Logger,
  startedAtMs: number,
): void {
  // ----- GET /healthz -----
  app.get('/healthz', async (_request, reply) => {
    reply.code(200).send({ ok: true });
  });

  // ----- GET /status -----
  app.get('/status', async (request, reply) => {
    const channels = (opts.channels?.list() ?? []).map((c) => ({
      id: c.id,
      status: c.status,
      ...(c.lastError !== undefined ? { lastError: c.lastError } : {}),
    }));
    const resp: StatusResponse = statusResponseSchema.parse({
      version: opts.version,
      process: opts.processName,
      pid: process.pid,
      uptimeMs: Date.now() - startedAtMs,
      startedAt: opts.startedAt,
      channels,
    });
    ipcLog.debug({ reqId: request.id, channels: channels.length }, 'ipc: /status');
    reply.send(resp);
  });

  // ----- POST /send -----
  app.post('/send', async (request, reply) => {
    const body = sendRequestSchema.parse(request.body);
    const message: OutboundMessage = {
      id: newId(),
      ...(body.directiveId !== undefined ? { directiveId: body.directiveId } : {}),
      targetChannel: body.targetChannel,
      targetRef: body.targetRef,
      text: body.text,
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    outbound.enqueue(opts.db, message);
    opts.doorbell.emit('outbound.new', { messageId: message.id });

    let delivered = false;
    let externalId: string | undefined;
    if (opts.deliverOutbound !== undefined) {
      try {
        const result = await opts.deliverOutbound(message);
        delivered = result.delivered;
        externalId = result.externalId;
        if (delivered) {
          outbound.markDelivered(opts.db, message.id, new Date().toISOString());
        } else if (result.error !== undefined) {
          outbound.recordFailure(opts.db, message.id, result.error);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        outbound.recordFailure(opts.db, message.id, errMsg);
        ipcLog.warn(
          { reqId: request.id, messageId: message.id, err },
          'ipc: /send — delivery threw',
        );
      }
    }

    ipcLog.info(
      {
        reqId: request.id,
        messageId: message.id,
        targetChannel: body.targetChannel,
        targetRef: body.targetRef,
        delivered,
      },
      'ipc: /send',
    );
    const resp = sendResponseSchema.parse({
      delivered,
      messageId: message.id,
      ...(externalId !== undefined ? { externalId } : {}),
    });
    reply.send(resp);
  });

  // ----- POST /directives/notify -----
  app.post('/directives/notify', async (request, reply) => {
    const body = directiveNotifyRequestSchema.parse(request.body);
    // Verify the directive exists so accidental typos surface as 404 rather
    // than a silently-ignored doorbell ring.
    const directive = directivesQ.getById(opts.db, body.directiveId);
    if (directive === undefined) {
      throw new IpcRequestError(
        404,
        'DIRECTIVE_NOT_FOUND',
        `directive ${body.directiveId} not found`,
      );
    }
    opts.doorbell.emit('directive.new', {
      directiveId: body.directiveId,
      reason: body.reason,
    });
    ipcLog.info(
      { reqId: request.id, directiveId: body.directiveId, reason: body.reason },
      'ipc: /directives/notify',
    );
    reply.send({ acknowledged: true });
  });

  // ----- POST /reload-config -----
  app.post('/reload-config', async (request, reply) => {
    opts.doorbell.emit('config.reloaded');
    ipcLog.info({ reqId: request.id }, 'ipc: /reload-config');
    reply.send(
      reloadConfigResponseSchema.parse({
        reloaded: true,
        appliedAt: new Date().toISOString(),
        warnings: [],
      }),
    );
  });

  // ----- POST /worker/ask-user (ADR 0024) -----
  // Bearer-gated; bearer check fires before schema parse so malformed bodies
  // from unauthenticated callers can't probe the schema surface.
  app.post('/worker/ask-user', async (request, reply) => {
    if (!checkWorkerBearer(request, opts.workerAuthToken)) {
      throw new IpcRequestError(401, 'WORKER_AUTH_REQUIRED', 'missing or invalid bearer token');
    }
    if (opts.workerAskUser === undefined) {
      throw new IpcRequestError(
        503,
        'WORKER_ASK_USER_DISABLED',
        'daemon is not configured with a worker askUser handler',
      );
    }
    const body = workerAskUserRequestSchema.parse(request.body);
    ipcLog.info(
      {
        reqId: request.id,
        taskId: body.taskId,
        directiveId: body.directiveId,
        questionLen: body.question.length,
        deadlineSeconds: body.deadlineSeconds,
      },
      'ipc: /worker/ask-user — handling',
    );
    const result = await opts.workerAskUser(body);
    const resp = workerAskUserResponseSchema.parse(result);
    ipcLog.info(
      {
        reqId: request.id,
        taskId: body.taskId,
        questionId: resp.questionId,
        answered: resp.answer !== undefined,
        timedOut: resp.timedOut,
        aborted: resp.aborted,
      },
      'ipc: /worker/ask-user — done',
    );
    reply.send(resp);
  });
}

/**
 * Bearer-token check for `/worker/*` routes. Returns `true` when the request
 * carries `Authorization: Bearer <expected>` and `expected` is set, OR when
 * `expected` is undefined (test mode — accept any loopback request). Returns
 * `false` when the token is set but the header is missing or wrong.
 */
function checkWorkerBearer(request: FastifyRequest, expected: string | undefined): boolean {
  if (expected === undefined) return true;
  const header = request.headers['authorization'];
  if (typeof header !== 'string') return false;
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);
  // Constant-time compare avoids timing-leak distinguishing wrong-length from
  // wrong-content. Length-mismatch shortcut is fine because token length is a
  // public constant per startup.
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Build a Fastify instance without starting it. Exposed for tests that want
 * to use `inject()` without opening a real socket.
 */
export function buildIpcServer(opts: IpcServerOptions): FastifyInstance {
  const startedAtMs = Date.parse(opts.startedAt);
  const app = Fastify({
    logger: false,
    genReqId: () => newId(),
    // Keep the default body limit; IPC payloads are small.
    trustProxy: false,
  });

  const ipcLog = log.child({});

  // Localhost-only preHandler: rejects requests originating from non-loopback
  // IPs. The bind address (127.0.0.1) is the primary guard; this is defense.
  app.addHook('preHandler', async (request) => {
    if (!isLoopback(request)) {
      ipcLog.warn(
        { reqId: request.id, ip: request.ip, url: request.url },
        'ipc: rejecting non-localhost connection',
      );
      throw new IpcRequestError(403, 'NON_LOCALHOST', 'daemon refuses non-localhost connections');
    }
  });

  setupErrorHandler(app, ipcLog);
  registerRoutes(app, opts, ipcLog, startedAtMs);

  return app;
}

/**
 * Build and bind the Fastify server. Returns a handle that exposes the bound
 * port + a graceful `stop()`.
 */
export async function startIpcServer(opts: IpcServerOptions): Promise<IpcServerHandle> {
  const app = buildIpcServer(opts);
  await app.listen({ host: opts.host, port: opts.port });
  const address = app.server.address() as AddressInfo | null;
  const boundPort = address?.port ?? opts.port;
  log.info({ host: opts.host, port: boundPort }, 'ipc: listening');

  let stopped = false;
  return {
    boundPort,
    app,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      try {
        await app.close();
        log.info('ipc: stopped');
      } catch (err) {
        log.warn({ err }, 'ipc: close failed');
      }
    },
  };
}
