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
 *   GET  /app/*              (loopback-only) static SPA bundle (ADR 0025)
 *   GET  /api/v1/status      (gated) UI JSON API status smoke (ADR 0025)
 *
 * Every handler logs a correlationId. Non-localhost connections are refused
 * both at the bind layer (we listen on `127.0.0.1`) and at a preHandler
 * (defense-in-depth if the daemon is ever reconfigured to bind broader).
 *
 * Two bearer-gated namespaces, scoped separately per ADR 0025 §2:
 *   - `/worker/*` — token minted per startup; brain passes it to worker
 *     subprocesses via env. Only workers can hit these routes.
 *   - `/api/v1/*` — separate `FACTORY5_UI_TOKEN` for the browser SPA.
 *     Scoped distinct from the worker token so a leaked dashboard token
 *     does not grant worker-impersonation privileges.
 *
 * `/app/*` serves the static SPA bundle via `@fastify/static` when a
 * `webUiStaticPath` is supplied. The shell itself is not bearer-gated
 * (same HTML/JS for every operator); the data API it calls is.
 */

import type { AddressInfo } from 'node:net';
import process from 'node:process';

import fastifyStatic from '@fastify/static';
import type { ChannelId, OutboundMessage } from '@factory5/core';
import { newId } from '@factory5/core';
import {
  apiV1DirectiveDetailResponseSchema,
  apiV1DirectivesListQuerySchema,
  apiV1DirectivesListResponseSchema,
  apiV1FindingsListQuerySchema,
  apiV1FindingsListResponseSchema,
  apiV1PendingQuestionDetailResponseSchema,
  apiV1PendingQuestionsListQuerySchema,
  apiV1PendingQuestionsListResponseSchema,
  apiV1SpendQuerySchema,
  apiV1SpendResponseSchema,
  directiveNotifyRequestSchema,
  IpcRequestError,
  ipcErrorSchema,
  reloadConfigResponseSchema,
  sendRequestSchema,
  sendResponseSchema,
  statusResponseSchema,
  workerAskUserRequestSchema,
  workerAskUserResponseSchema,
  type ApiV1DirectiveDetailResponse,
  type ApiV1DirectivesListResponse,
  type ApiV1FindingsListResponse,
  type ApiV1PendingQuestionDetailResponse,
  type ApiV1PendingQuestionsListResponse,
  type ApiV1SpendResponse,
  type StatusResponse,
  type WorkerAskUserRequest,
  type WorkerAskUserResponse,
} from '@factory5/ipc';
import type { Logger } from '@factory5/logger';
import { createLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  findingsRegistry,
  modelUsage,
  outbound,
  pendingQuestions,
  spend,
  tasksInflight,
  type Database,
} from '@factory5/state';
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
  /**
   * Bearer token required by `/api/v1/*` routes (the web UI's JSON API).
   * When omitted, those routes return 503 `UI_DISABLED` — the daemon is not
   * configured to serve the web UI. Distinct from {@link workerAuthToken}
   * per ADR 0025 §2: scope separation means a compromised UI token cannot
   * impersonate workers. Token is rotated per daemon startup; distributed
   * to the operator via the daemon-logged `/app/?t=<token>` URL.
   */
  uiAuthToken?: string;
  /**
   * Absolute path to a built SPA bundle (e.g. `apps/factory-web/dist/`).
   * When set, the daemon mounts `@fastify/static` under `/app/` pointing at
   * this directory. When omitted, `/app/*` returns 404. Production factoryd
   * resolves this from its install layout; tests typically leave it unset.
   */
  webUiStaticPath?: string;
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

  // ----- GET /api/v1/status (ADR 0025) -----
  // UI-bearer-gated smoke endpoint — returns the same shape as /status so
  // the SPA can confirm its token and the daemon are both reachable before
  // wiring the richer /api/v1/* endpoints (9.4–9.7).
  app.get('/api/v1/status', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
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
    ipcLog.debug({ reqId: request.id, channels: channels.length }, 'ipc: /api/v1/status');
    reply.send(resp);
  });

  // ----- GET /api/v1/directives (ADR 0025, sub-step 9.4) -----
  // Paged list with optional ?status filter. Bearer-gated; schema parse
  // enforces the limit/offset bounds. Reuses directivesQ.listPaged verbatim.
  app.get('/api/v1/directives', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const query = apiV1DirectivesListQuerySchema.parse(request.query);
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const result = directivesQ.listPaged(opts.db, {
      limit,
      offset,
      ...(query.status !== undefined ? { status: query.status } : {}),
    });
    const resp: ApiV1DirectivesListResponse = apiV1DirectivesListResponseSchema.parse({
      items: result.items,
      total: result.total,
      limit,
      offset,
    });
    ipcLog.debug(
      { reqId: request.id, limit, offset, status: query.status, total: result.total },
      'ipc: /api/v1/directives',
    );
    reply.send(resp);
  });

  // ----- GET /api/v1/directives/:id (ADR 0025, sub-step 9.4) -----
  // Detail with timeline: inflight tasks, open pending-questions, and the
  // spend + call-count rollup. Joins happen in SQL via the existing query
  // helpers; the handler just assembles the envelope.
  app.get<{ Params: { id: string } }>('/api/v1/directives/:id', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const { id } = request.params;
    const directive = directivesQ.getById(opts.db, id);
    if (directive === undefined) {
      throw new IpcRequestError(404, 'DIRECTIVE_NOT_FOUND', `directive ${id} not found`);
    }
    const tasks = tasksInflight.listByDirective(opts.db, id);
    const openQuestions = pendingQuestions.openForDirective(opts.db, id);
    const totalCostUsd = modelUsage.totalCostForDirective(opts.db, id);
    const callCount = modelUsage.countForDirective(opts.db, id);
    const resp: ApiV1DirectiveDetailResponse = apiV1DirectiveDetailResponseSchema.parse({
      directive,
      timeline: {
        tasks,
        openQuestions,
        modelUsage: { totalCostUsd, callCount },
      },
    });
    ipcLog.debug(
      {
        reqId: request.id,
        directiveId: id,
        tasks: tasks.length,
        openQuestions: openQuestions.length,
        totalCostUsd,
        callCount,
      },
      'ipc: /api/v1/directives/:id',
    );
    reply.send(resp);
  });

  // ----- GET /api/v1/pending-questions (ADR 0025, sub-step 9.5) -----
  // Surfaces the Phase 8 pending-questions table for the web UI. Default
  // scope is `status=open` (what operators want to see first — "what is
  // factory waiting on?"). `answered` and `all` are available for history.
  app.get('/api/v1/pending-questions', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const query = apiV1PendingQuestionsListQuerySchema.parse(request.query);
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const status = query.status ?? 'open';
    const result = pendingQuestions.listPaged(opts.db, {
      limit,
      offset,
      status,
      ...(query.directiveId !== undefined ? { directiveId: query.directiveId } : {}),
    });
    const resp: ApiV1PendingQuestionsListResponse = apiV1PendingQuestionsListResponseSchema.parse({
      items: result.items,
      total: result.total,
      limit,
      offset,
      status,
    });
    ipcLog.debug(
      {
        reqId: request.id,
        limit,
        offset,
        status,
        directiveId: query.directiveId,
        total: result.total,
      },
      'ipc: /api/v1/pending-questions',
    );
    reply.send(resp);
  });

  // ----- GET /api/v1/pending-questions/:id (ADR 0025, sub-step 9.5) -----
  // Detail endpoint for deep-linking from outbound channel messages
  // (Telegram / Discord can render "Question: <link>" that lands here).
  app.get<{ Params: { id: string } }>('/api/v1/pending-questions/:id', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const { id } = request.params;
    const question = pendingQuestions.getById(opts.db, id);
    if (question === undefined) {
      throw new IpcRequestError(404, 'QUESTION_NOT_FOUND', `question ${id} not found`);
    }
    const resp: ApiV1PendingQuestionDetailResponse = apiV1PendingQuestionDetailResponseSchema.parse(
      { question },
    );
    ipcLog.debug(
      { reqId: request.id, questionId: id, answered: question.answeredAt !== undefined },
      'ipc: /api/v1/pending-questions/:id',
    );
    reply.send(resp);
  });

  // ----- GET /api/v1/spend (ADR 0025, sub-step 9.6) -----
  // All four rollups (per-project / per-directive / per-day / per-model) in
  // a single response so the Spend page renders with one round-trip. The
  // shared SpendFilter (since / until / projectId) applies uniformly.
  app.get('/api/v1/spend', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const query = apiV1SpendQuerySchema.parse(request.query);
    const filter: {
      since?: string;
      until?: string;
      projectId?: string;
    } = {};
    if (query.since !== undefined) filter.since = query.since;
    if (query.until !== undefined) filter.until = query.until;
    if (query.projectId !== undefined) filter.projectId = query.projectId;
    const perProject = spend.perProject(opts.db, filter);
    const perDirective = spend.perDirective(opts.db, filter);
    const perDay = spend.perDay(opts.db, filter);
    const perModel = spend.perModel(opts.db, filter);
    const resp: ApiV1SpendResponse = apiV1SpendResponseSchema.parse({
      perProject,
      perDirective,
      perDay,
      perModel,
      filter,
    });
    ipcLog.debug(
      {
        reqId: request.id,
        projects: perProject.length,
        directives: perDirective.length,
        days: perDay.length,
        models: perModel.length,
        filter,
      },
      'ipc: /api/v1/spend',
    );
    reply.send(resp);
  });

  // ----- GET /api/v1/findings (ADR 0025, sub-step 9.7) -----
  // List registry entries with filters for severity / status / project /
  // advisory; limit clamped [1, 1000] in the query helper. Most-recent
  // first via `updated_at DESC`. 9.7 is read-only — mutation surfaces
  // land in 9b.
  app.get('/api/v1/findings', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const query = apiV1FindingsListQuerySchema.parse(request.query);
    const listFilter: Parameters<typeof findingsRegistry.list>[1] = {};
    if (query.severity !== undefined) listFilter.severity = query.severity;
    if (query.status !== undefined) listFilter.status = query.status;
    if (query.project !== undefined) listFilter.project = query.project;
    if (query.advisory !== undefined) listFilter.advisory = query.advisory;
    if (query.limit !== undefined) listFilter.limit = query.limit;
    const items = findingsRegistry.list(opts.db, listFilter);
    const resp: ApiV1FindingsListResponse = apiV1FindingsListResponseSchema.parse({
      items,
      filter: {
        ...(query.severity !== undefined ? { severity: query.severity } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.project !== undefined ? { project: query.project } : {}),
        ...(query.advisory !== undefined ? { advisory: query.advisory } : {}),
        limit: query.limit ?? 100,
      },
    });
    ipcLog.debug(
      {
        reqId: request.id,
        count: items.length,
        severity: query.severity,
        status: query.status,
        project: query.project,
        advisory: query.advisory,
      },
      'ipc: /api/v1/findings',
    );
    reply.send(resp);
  });

  // ----- POST /worker/ask-user (ADR 0024) -----
  // Bearer-gated; bearer check fires before schema parse so malformed bodies
  // from unauthenticated callers can't probe the schema surface.
  app.post('/worker/ask-user', async (request, reply) => {
    if (!checkBearer(request, opts.workerAuthToken)) {
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
 * Enforce the UI bearer on `/api/v1/*` handlers. When `uiAuthToken` is
 * undefined the daemon is in CLI-only mode; when it's set but the request
 * lacks a matching bearer the request is unauthenticated. Throws the typed
 * {@link IpcRequestError} the handler's error pipeline rewrites into a JSON
 * envelope. Consolidates the 503/401 shape shared across every `/api/v1/*`
 * route so individual handlers stay one-liners.
 */
function requireUiAuth(request: FastifyRequest, token: string | undefined): void {
  if (token === undefined) {
    throw new IpcRequestError(503, 'UI_DISABLED', 'daemon is not configured with a UI auth token');
  }
  if (!checkBearer(request, token)) {
    throw new IpcRequestError(401, 'UI_AUTH_REQUIRED', 'missing or invalid bearer token');
  }
}

/**
 * Bearer-token check for routes that require auth. Returns `true` when the
 * request carries `Authorization: Bearer <expected>` and `expected` is set,
 * OR when `expected` is undefined (test mode — accept any loopback request).
 * Returns `false` when the token is set but the header is missing or wrong.
 *
 * Shared between `/worker/*` (ADR 0024) and `/api/v1/*` (ADR 0025). Each
 * route namespace has its own `expected` token; this helper is the
 * constant-time compare both reuse.
 */
function checkBearer(request: FastifyRequest, expected: string | undefined): boolean {
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
 *
 * Async because `@fastify/static` registration is asynchronous when
 * `webUiStaticPath` is supplied. Callers that skip the web UI still get a
 * well-formed app; the await resolves in a single microtask.
 */
export async function buildIpcServer(opts: IpcServerOptions): Promise<FastifyInstance> {
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

  // Mount the SPA bundle under /app/ when configured. @fastify/static handles
  // MIME types, etag, range requests, and index resolution — we just point
  // it at the directory. When `webUiStaticPath` is unset the plugin is not
  // registered and /app/* yields 404 (Fastify's default for an unhandled route).
  if (opts.webUiStaticPath !== undefined) {
    await app.register(fastifyStatic, {
      root: opts.webUiStaticPath,
      prefix: '/app/',
      // Don't decorate reply with sendFile — we have no route that needs it,
      // and skipping keeps the plugin idempotent across multiple registers.
      decorateReply: false,
    });
    ipcLog.info({ path: opts.webUiStaticPath }, 'ipc: mounted /app/* static serve');
  }

  return app;
}

/**
 * Build and bind the Fastify server. Returns a handle that exposes the bound
 * port + a graceful `stop()`.
 */
export async function startIpcServer(opts: IpcServerOptions): Promise<IpcServerHandle> {
  const app = await buildIpcServer(opts);
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
