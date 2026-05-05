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

import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';

import fastifyStatic from '@fastify/static';
import type { ChannelId, OutboundMessage } from '@factory5/core';
import { directiveSchema, newId } from '@factory5/core';
import {
  apiV1AnswerPendingQuestionRequestSchema,
  apiV1AnswerPendingQuestionResponseSchema,
  apiV1ChatMessageRequestSchema,
  apiV1ChatMessageResponseSchema,
  apiV1CreateBuildRequestSchema,
  apiV1CreateBuildResponseSchema,
  apiV1CreateProjectRequestSchema,
  apiV1CreateProjectResponseSchema,
  apiV1DirectiveDetailResponseSchema,
  apiV1DirectivesListQuerySchema,
  apiV1DirectivesListResponseSchema,
  apiV1FindingsListQuerySchema,
  apiV1FindingsListResponseSchema,
  apiV1PendingQuestionDetailResponseSchema,
  apiV1PendingQuestionsListQuerySchema,
  apiV1PendingQuestionsListResponseSchema,
  apiV1ProjectDetailResponseSchema,
  apiV1ProjectsListResponseSchema,
  apiV1SpendQuerySchema,
  apiV1SpendResponseSchema,
  apiV1UpdateProjectBudgetRequestSchema,
  apiV1UpdateProjectBudgetResponseSchema,
  cancelDirectiveRequestSchema,
  cancelDirectiveResponseSchema,
  directiveNotifyRequestSchema,
  IpcRequestError,
  ipcErrorSchema,
  reloadConfigResponseSchema,
  sendRequestSchema,
  sendResponseSchema,
  statusResponseSchema,
  uiTokenResponseSchema,
  workerAskUserRequestSchema,
  workerAskUserResponseSchema,
  type ApiV1AnswerPendingQuestionResponse,
  type ApiV1ChatMessageResponse,
  type ApiV1CreateBuildResponse,
  type ApiV1CreateProjectResponse,
  type ApiV1DirectiveDetailResponse,
  type ApiV1DirectivesListResponse,
  type ApiV1FindingsListResponse,
  type ApiV1PendingQuestionDetailResponse,
  type ApiV1PendingQuestionsListResponse,
  type ApiV1ProjectDetailResponse,
  type ApiV1ProjectsListResponse,
  type ApiV1SpendResponse,
  type ApiV1UpdateProjectBudgetResponse,
  type CancelDirectiveResponse,
  type StatusResponse,
  type UiTokenResponse,
  type WorkerAskUserRequest,
  type WorkerAskUserResponse,
} from '@factory5/ipc';
import { cancelDirective as brainCancelDirective } from '@factory5/brain';
import type { Logger } from '@factory5/logger';
import { createLogger } from '@factory5/logger';
import {
  CancelDirectiveError,
  directives as directivesQ,
  findingsRegistry,
  modelUsage,
  outbound,
  pendingQuestions,
  projects as projectsQ,
  spend,
  tasksInflight,
  type Database,
} from '@factory5/state';
import {
  budgetDefaultsFromProjectMeta,
  createProject,
  CreateProjectAlreadyExistsError,
  defaultWorkspace,
  languageFromProjectMeta,
  loadOrCreateProjectMetadata,
  ProjectMetadataCorruptError,
  ProjectMetadataNotFoundError,
  readProjectMetadata,
  resolveDirectiveLimits,
  updateProjectMetadata,
} from '@factory5/wiki';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import type { DirectiveStreamHub } from './directive-stream.js';
import { registerDirectiveStreamRoute } from './directive-stream-route.js';
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
  /**
   * Instance-config budget defaults (`config.toml [budget.defaults]`) —
   * the third tier in `resolveDirectiveLimits`'s merge order (ADR 0027 §4).
   * The daemon loads `config.toml` once at boot and threads this through
   * so `POST /api/v1/builds` can apply the same three-tier resolution as
   * `factory build` (issue I009: the body-only resolution skipped this
   * tier). When omitted, the route falls back to body + project tiers.
   */
  configBudgetDefaults?: { maxUsd?: number | undefined; maxSteps?: number | undefined } | undefined;
  /**
   * Workspace root used by `POST /api/v1/projects` for new-project paths
   * (`<workspace>/<name>`). When omitted, falls back to
   * `defaultWorkspace()` (`~/factory5-workspace`). Production factoryd
   * passes `cfg.general.workspace` so the operator's config wins; tests
   * pass an `mkdtemp` path to keep filesystem side-effects scoped.
   */
  workspace?: string;
  /**
   * Per-directive SSE event hub (Phase 3 / step 3.1). When set, the
   * daemon mounts `GET /api/v1/directives/:id/stream`. When omitted,
   * that route is NOT registered — clients get Fastify's default 404
   * for the unmatched path. Production daemons always pass a hub;
   * tests that don't exercise SSE leave it unset.
   */
  directiveStream?: DirectiveStreamHub;
  /**
   * Override for the SSE heartbeat cadence. Tests pass a small value
   * (e.g. 100 ms) so a heartbeat fires within the test's window.
   * Production leaves this unset (defaults to 15 s).
   */
  directiveStreamHeartbeatMs?: number;
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

  // ----- POST /directives/:id/cancel (Phase 2.4) -----
  // Active-cancel: flips the directive's row to `failed` AND fires the
  // brain's per-directive AbortController so the worker subprocess gets
  // SIGTERM (then SIGKILL after grace) within the 10 s acceptance budget.
  // Distinct from `directive mark-blocked`, which only updates the row —
  // `cancel` actively kills the in-flight work.
  //
  // Two routes share one handler:
  //   - `/directives/:id/cancel`        — CLI-facing (loopback, no UI bearer);
  //                                        used by `factory cancel <id>` via
  //                                        the daemon-client (see ipc/client.ts).
  //   - `/api/v1/directives/:id/cancel` — SPA-facing; gated by `requireUiAuth`
  //                                        per the `/api/v1/*` namespace contract
  //                                        (Step 3.6 / Decision 1 = option a).
  // Two separate paths instead of moving the CLI route to /api/v1/* because
  // CLI auth is loopback-only — the CLI doesn't carry the UI bearer token.
  const handleCancel = async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const body = cancelDirectiveRequestSchema.parse(request.body ?? {});
    const id = request.params.id;
    let updated;
    try {
      updated = directivesQ.cancelDirective(opts.db, id, body.reason);
    } catch (err) {
      if (err instanceof CancelDirectiveError) {
        if (err.code === 'NOT_FOUND') {
          throw new IpcRequestError(404, 'NOT_FOUND', err.message);
        }
        throw new IpcRequestError(409, 'ALREADY_TERMINAL', err.message);
      }
      throw err;
    }
    const abortFired = brainCancelDirective(id, body.reason ?? 'cancelled');
    ipcLog.info(
      { reqId: request.id, directiveId: id, reason: body.reason, abortFired, url: request.url },
      'ipc: cancel',
    );
    const resp: CancelDirectiveResponse = cancelDirectiveResponseSchema.parse({
      directive: updated,
      abortFired,
    });
    reply.send(resp);
  };
  app.post<{ Params: { id: string } }>('/directives/:id/cancel', handleCancel);
  app.post<{ Params: { id: string } }>('/api/v1/directives/:id/cancel', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    await handleCancel(request, reply);
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

  // ----- GET /ui-token (Phase 13.2 — ADR 0025 §2 carry-forward) -----
  // Operator recovery for the dashboard URL when terminal scrollback is
  // gone. Returns the live UI bearer plus the URL the operator should
  // open. Intentionally unauthenticated: same threat profile as `/status`
  // and `/healthz` — loopback-only via the preHandler IP guard, and the
  // token isn't a secret from local users (it lives in the daemon's
  // process env, readable via /proc/<pid>/environ on Linux or Process
  // Explorer on Windows). Cross-origin browser tabs that hit this route
  // over loopback can't read the JSON response under default same-origin
  // policy, so a malicious tab cannot exfiltrate the token.
  //
  // Returns 503 when the daemon is running CLI-only (no `uiAuthToken`
  // configured). The CLI prints a friendly message in that case.
  app.get('/ui-token', async (request, reply) => {
    if (opts.uiAuthToken === undefined) {
      throw new IpcRequestError(
        503,
        'UI_DISABLED',
        'daemon is not configured with a UI auth token',
      );
    }
    const port = request.socket.localPort ?? opts.port;
    const hasStaticBundle = opts.webUiStaticPath !== undefined;
    const url = hasStaticBundle
      ? `http://127.0.0.1:${String(port)}/app/?t=${opts.uiAuthToken}`
      : `http://localhost:4321/app/?t=${opts.uiAuthToken}`;
    const resp: UiTokenResponse = uiTokenResponseSchema.parse({
      token: opts.uiAuthToken,
      url,
      hasStaticBundle,
    });
    ipcLog.debug({ reqId: request.id, hasStaticBundle }, 'ipc: /ui-token');
    reply.send(resp);
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

  // ----- POST /api/v1/pending-questions/:id/answer (ADR 0027, sub-step 11.2) -----
  // Mutation surface — same answer-write path the channel collectors take, exposed
  // as one more inbound channel. Idempotency rules per ADR 0027 §2: re-POST with
  // same answer is a 200 no-op; different answer is a 409 with the original
  // preserved (never silently overwrites). Bearer-gated like the read routes.
  app.post<{ Params: { id: string } }>(
    '/api/v1/pending-questions/:id/answer',
    async (request, reply) => {
      requireUiAuth(request, opts.uiAuthToken);
      const { id } = request.params;
      const body = apiV1AnswerPendingQuestionRequestSchema.parse(request.body);

      const existing = pendingQuestions.getById(opts.db, id);
      if (existing === undefined) {
        throw new IpcRequestError(404, 'QUESTION_NOT_FOUND', `question ${id} not found`);
      }

      if (existing.answer !== undefined) {
        // Already answered — same payload is idempotent; different conflicts.
        if (existing.answer === body.answer) {
          const resp: ApiV1AnswerPendingQuestionResponse =
            apiV1AnswerPendingQuestionResponseSchema.parse({ question: existing });
          ipcLog.debug(
            { reqId: request.id, questionId: id },
            'ipc: /api/v1/pending-questions/:id/answer — idempotent re-POST',
          );
          reply.send(resp);
          return;
        }
        throw new IpcRequestError(
          409,
          'QUESTION_ALREADY_ANSWERED_DIFFERENTLY',
          `question ${id} is already answered; the recorded answer is preserved`,
        );
      }

      // First answer for this question.
      const answeredAt = new Date().toISOString();
      pendingQuestions.answer(opts.db, id, body.answer, answeredAt);

      // ADR 0024 §4 — if the linked task is already terminal, the answer is
      // recorded (forensic value preserved) but no consumer remains to resume.
      // Loud log mirrors the Discord / Telegram channel-collector behaviour.
      const orphan = pendingQuestions.detectOrphanedAnswer(opts.db, id);
      if (orphan !== undefined) {
        ipcLog.warn(
          {
            reqId: request.id,
            questionId: id,
            taskId: orphan.taskId,
            taskStatus: orphan.taskStatus,
          },
          'ipc: /api/v1/pending-questions/:id/answer — answer recorded for question whose task is terminal',
        );
      }

      const updated = pendingQuestions.getById(opts.db, id);
      if (updated === undefined) {
        // Row existed at the top of the handler; can't disappear mid-request.
        throw new IpcRequestError(500, 'INTERNAL', 'failed to read back the answered question');
      }
      const resp: ApiV1AnswerPendingQuestionResponse =
        apiV1AnswerPendingQuestionResponseSchema.parse({ question: updated });
      ipcLog.info(
        {
          reqId: request.id,
          questionId: id,
          directiveId: existing.directiveId,
          taskId: existing.taskId,
          orphaned: orphan !== undefined,
        },
        'ipc: /api/v1/pending-questions/:id/answer — answered',
      );
      reply.send(resp);
    },
  );

  // ----- GET /api/v1/spend (ADR 0025, sub-step 9.6) -----
  // All five rollups (per-project / per-directive / per-day /
  // per-day-per-project / per-model) in a single response so the Spend
  // page renders with one round-trip. The shared SpendFilter (since /
  // until / projectId) applies uniformly. The per-day-per-project rollup
  // powers Phase 3.8's spend-page sparklines + 30-day stacked bar.
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
    const perDayPerProject = spend.perDayPerProject(opts.db, filter);
    const perModel = spend.perModel(opts.db, filter);
    const resp: ApiV1SpendResponse = apiV1SpendResponseSchema.parse({
      perProject,
      perDirective,
      perDay,
      perDayPerProject,
      perModel,
      filter,
    });
    ipcLog.debug(
      {
        reqId: request.id,
        projects: perProject.length,
        directives: perDirective.length,
        days: perDay.length,
        dayProjectCells: perDayPerProject.length,
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

  // ----- POST /api/v1/builds (ADR 0027, sub-step 11.3) -----
  // Mutation surface — mirrors `factory build <project>`'s directive-creation
  // path (cli/src/commands/build.ts). Bearer-gated like the read routes.
  // Refuses to create new projects (ADR 0025 / Phase 11 charter): the path
  // must already exist on disk; operator runs `factory init` for new projects.
  // Budget resolution is body-only in 11.3; 11.4 layers in the project-tier
  // fallback (`metadata.budgetDefaults`) shared with the CLI.
  app.post('/api/v1/builds', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const body = apiV1CreateBuildRequestSchema.parse(request.body);

    const workspace = defaultWorkspace();
    const projectPath = await resolveExistingProjectPath(body.project, workspace);
    if (projectPath === undefined) {
      throw new IpcRequestError(
        404,
        'PROJECT_NOT_FOUND',
        `project ${body.project} not found — run \`factory init\` to create it`,
      );
    }

    let projectMeta;
    try {
      projectMeta = await loadOrCreateProjectMetadata(projectPath, body.project);
    } catch (err) {
      if (err instanceof ProjectMetadataCorruptError) {
        throw new IpcRequestError(422, 'PROJECT_METADATA_CORRUPT', err.message);
      }
      throw err;
    }

    const language = body.language ?? languageFromProjectMeta(projectMeta);
    const autonomy = body.autonomy ?? 'assisted';

    const nowIso = new Date().toISOString();
    projectsQ.upsert(opts.db, {
      id: projectMeta.id,
      name: projectMeta.name,
      workspacePath: projectPath,
      status: 'active',
      createdAt: projectMeta.createdAt,
      lastTouchedAt: nowIso,
    });

    // Budget resolution via the shared three-tier helper (ADR 0027 §4 /
    // I009 fix). Body wins over per-project `metadata.budgetDefaults`,
    // which wins over instance-config `[budget.defaults]` (Phase 13.3
    // wired the third tier through `IpcServerOptions.configBudgetDefaults`
    // — pre-fix the daemon discarded it).
    const limits = resolveDirectiveLimits({
      explicitFlags: body.limits,
      projectDefaults: budgetDefaultsFromProjectMeta(projectMeta),
      configDefaults: opts.configBudgetDefaults,
    });
    const hasLimits = limits !== undefined;
    const directive = directiveSchema.parse({
      id: newId(),
      source: 'cli',
      principal: 'web-ui',
      channelRef: `web-ui-${request.id}`,
      intent: 'build',
      payload: {
        project: body.project,
        projectPath,
        workspace,
        ...(language !== undefined ? { language } : {}),
      },
      autonomy,
      createdAt: nowIso,
      status: 'pending',
      projectId: projectMeta.id,
      ...(hasLimits ? { limits } : {}),
    });
    directivesQ.insert(opts.db, directive);

    opts.doorbell.emit('directive.new', { directiveId: directive.id, reason: 'new' });

    const resp: ApiV1CreateBuildResponse = apiV1CreateBuildResponseSchema.parse({ directive });
    ipcLog.info(
      {
        reqId: request.id,
        directiveId: directive.id,
        projectId: projectMeta.id,
        project: body.project,
        language,
        autonomy,
        hasLimits,
      },
      'ipc: /api/v1/builds — directive created',
    );
    reply.send(resp);
  });

  // ----- POST /api/v1/projects (Phase 3 step 3.7 — browser mirror of `factory init`) -----
  // Mutation surface — scaffolds a new project at `<defaultWorkspace()>/<name>`
  // via `wiki.createProject`. Refuses with 409 ALREADY_EXISTS when an identity
  // or CLAUDE.md already lives at that path (mirrors the CLI's exit-2). The
  // route does not honour absolute / relative paths in `name` — that's a
  // CLI-only convenience; web operators use the configured workspace.
  // Bearer-gated like the other UI routes.
  app.post('/api/v1/projects', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const body = apiV1CreateProjectRequestSchema.parse(request.body);

    const workspace = opts.workspace ?? defaultWorkspace();
    const projectPath = join(workspace, body.name);

    let result;
    try {
      result = await createProject({
        projectPath,
        name: body.name,
        language: body.language,
        ...(body.claudeMd !== undefined ? { claudeMd: body.claudeMd } : {}),
      });
    } catch (err) {
      if (err instanceof CreateProjectAlreadyExistsError) {
        throw new IpcRequestError(409, 'ALREADY_EXISTS', err.message);
      }
      throw err;
    }

    // Mirror the new project into the SQLite registry so it appears in
    // GET /api/v1/projects immediately. Same pattern as POST /api/v1/builds
    // line 840+ — the registry's createdAt is registry-scoped (sorting,
    // listing); project.json owns the canonical identity timestamp.
    const nowIso = new Date().toISOString();
    projectsQ.upsert(opts.db, {
      id: result.id,
      name: body.name,
      workspacePath: result.path,
      status: 'active',
      createdAt: nowIso,
      lastTouchedAt: nowIso,
    });

    const resp: ApiV1CreateProjectResponse = apiV1CreateProjectResponseSchema.parse({
      id: result.id,
      path: result.path,
    });
    ipcLog.info(
      {
        reqId: request.id,
        projectId: result.id,
        name: body.name,
        language: body.language,
        hasClaudeMdOverride: body.claudeMd !== undefined,
      },
      'ipc: /api/v1/projects POST — project scaffolded',
    );
    reply.send(resp);
  });

  // ----- GET /api/v1/projects (ADR 0027, sub-step 11.5 — SPA prerequisite) -----
  // Read-only list of every registered project, most-recently touched first.
  // Drives the SPA's project-list page and the build form's project dropdown
  // (operator picks by name → SPA maps to ULID for the budget route's `:id`).
  app.get('/api/v1/projects', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const items = projectsQ.listAll(opts.db);
    const resp: ApiV1ProjectsListResponse = apiV1ProjectsListResponseSchema.parse({ items });
    ipcLog.debug({ reqId: request.id, count: items.length }, 'ipc: /api/v1/projects');
    reply.send(resp);
  });

  // ----- GET /api/v1/projects/:id (ADR 0027, sub-step 11.5 — SPA prerequisite) -----
  // Single project by canonical ULID. Returns the registry row plus pre-shaped
  // `budgetDefaults` and `language` extracted from the on-disk project.json
  // metadata so the SPA detail page pre-fills its forms without having to
  // walk the free-form `metadata` blob client-side.
  //
  // Best-effort on the disk read — a missing or corrupt project.json yields
  // a successful response with the budget/language fields absent rather than
  // failing the whole page (the SPA renders an inline note instead). The
  // mutation route surfaces those failures loudly with PROJECT_PATH_UNREADABLE
  // / PROJECT_METADATA_CORRUPT, which is the right place to learn about them.
  app.get<{ Params: { id: string } }>('/api/v1/projects/:id', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const { id } = request.params;
    const project = projectsQ.getById(opts.db, id);
    if (project === undefined) {
      throw new IpcRequestError(404, 'PROJECT_NOT_FOUND', `project ${id} not found`);
    }

    let budgetDefaults: ReturnType<typeof budgetDefaultsFromProjectMeta>;
    let language: ReturnType<typeof languageFromProjectMeta>;
    try {
      const meta = await readProjectMetadata(project.workspacePath);
      if (meta !== undefined) {
        budgetDefaults = budgetDefaultsFromProjectMeta(meta);
        language = languageFromProjectMeta(meta);
      }
    } catch (err) {
      // ProjectMetadataCorruptError is the only expected throw from
      // readProjectMetadata — treat as soft on the GET path. Log so an
      // operator chasing a confusing UI state can find a trail.
      if (err instanceof ProjectMetadataCorruptError) {
        ipcLog.warn(
          { reqId: request.id, projectId: id, workspacePath: project.workspacePath },
          'ipc: /api/v1/projects/:id — project.json corrupt; returning registry row only',
        );
      } else {
        throw err;
      }
    }

    const resp: ApiV1ProjectDetailResponse = apiV1ProjectDetailResponseSchema.parse({
      project,
      ...(budgetDefaults !== undefined ? { budgetDefaults } : {}),
      ...(language !== undefined ? { language } : {}),
    });
    ipcLog.debug({ reqId: request.id, projectId: id }, 'ipc: /api/v1/projects/:id');
    reply.send(resp);
  });

  // ----- PUT /api/v1/projects/:id/budget (ADR 0027, sub-step 11.4) -----
  // Mutation surface — sets per-project `metadata.budgetDefaults` (mirrors
  // ADR 0020's `directiveLimitsSchema`). Full RFC-9110 PUT semantics: body
  // is the new state of the budgetDefaults document; absent fields are
  // removed. Bearer-gated like the other UI routes.
  app.put<{ Params: { id: string } }>('/api/v1/projects/:id/budget', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const { id } = request.params;
    const body = apiV1UpdateProjectBudgetRequestSchema.parse(request.body);

    const project = projectsQ.getById(opts.db, id);
    if (project === undefined) {
      throw new IpcRequestError(404, 'PROJECT_NOT_FOUND', `project ${id} not found`);
    }

    let updated;
    try {
      updated = await updateProjectMetadata(project.workspacePath, (meta) => ({
        ...meta,
        metadata: { ...meta.metadata, budgetDefaults: body },
      }));
    } catch (err) {
      if (err instanceof ProjectMetadataNotFoundError) {
        throw new IpcRequestError(404, 'PROJECT_PATH_UNREADABLE', err.message);
      }
      if (err instanceof ProjectMetadataCorruptError) {
        throw new IpcRequestError(422, 'PROJECT_METADATA_CORRUPT', err.message);
      }
      throw err;
    }

    const persistedDefaults = budgetDefaultsFromProjectMeta(updated) ?? {};
    const resp: ApiV1UpdateProjectBudgetResponse = apiV1UpdateProjectBudgetResponseSchema.parse({
      projectId: project.id,
      budgetDefaults: persistedDefaults,
    });
    ipcLog.info(
      {
        reqId: request.id,
        projectId: project.id,
        maxUsd: persistedDefaults.maxUsd,
        maxSteps: persistedDefaults.maxSteps,
      },
      'ipc: /api/v1/projects/:id/budget — defaults updated',
    );
    reply.send(resp);
  });

  // ----- POST /api/v1/chat/messages (Phase 3 / step 3.5) -----
  // Mints an `intent=chat` directive on the brain's standard chat path
  // (same minting shape Discord/Telegram inbound takes); returns the
  // directive id so the SPA can subscribe to its SSE stream for the
  // streamed reply. The brain emits one `log.line` event per agent turn
  // (step 3.5 commit 1) — the chat page renders one bubble per event.
  //
  // `source: 'cli'` mirrors POST /api/v1/builds: the web UI is a
  // loopback surface, not a distinct ChannelId. `principal: 'web-ui'`
  // distinguishes web-minted from CLI-minted in the audit log without
  // expanding the channel-id enum.
  app.post('/api/v1/chat/messages', async (request, reply) => {
    requireUiAuth(request, opts.uiAuthToken);
    const body = apiV1ChatMessageRequestSchema.parse(request.body);

    const directive = directiveSchema.parse({
      id: newId(),
      source: 'cli',
      principal: 'web-ui',
      channelRef: `web-ui-${request.id}`,
      intent: 'chat',
      payload: {
        text: body.message,
        ...(body.conversationId !== undefined ? { conversationId: body.conversationId } : {}),
      },
      autonomy: 'chat',
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
    directivesQ.insert(opts.db, directive);
    opts.doorbell.emit('directive.new', { directiveId: directive.id, reason: 'new' });

    const resp: ApiV1ChatMessageResponse = apiV1ChatMessageResponseSchema.parse({ directive });
    ipcLog.info(
      { reqId: request.id, directiveId: directive.id, messageLen: body.message.length },
      'ipc: /api/v1/chat/messages — directive minted',
    );
    reply.send(resp);
  });

  // ----- GET /api/v1/directives/:id/stream (Phase 3 / step 3.1) -----
  // SSE event stream for live task / finding / spend / log updates per
  // directive. Mounted only when a `directiveStream` hub is supplied.
  // Wire shape: UPGRADE/specs/sse-directive-stream.md.
  if (opts.directiveStream !== undefined) {
    registerDirectiveStreamRoute({
      app,
      db: opts.db,
      hub: opts.directiveStream,
      uiAuthToken: opts.uiAuthToken,
      log: ipcLog,
      ...(opts.directiveStreamHeartbeatMs !== undefined
        ? { heartbeatIntervalMs: opts.directiveStreamHeartbeatMs }
        : {}),
    });
  }

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
 * Best-effort filesystem existence check. Used by the build-creation route to
 * pre-validate a project path before handing it to `loadOrCreateProjectMetadata`
 * (which would otherwise create a stray empty project for a typo'd name —
 * ADR 0025 / Phase 11 charter explicitly puts project-creation out of scope).
 */
async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a build-route `project` argument to an absolute path that already
 * exists on disk. Returns `undefined` when nothing matches — caller raises
 * `PROJECT_NOT_FOUND`. Two rungs only:
 *
 *   1. Absolute path that exists.
 *   2. `<workspace>/<name>` that exists.
 *
 * Deliberately does NOT call `wiki.resolveProjectPath` because that helper
 * creates empty directories and copies templates as a side effect, which
 * is operator-friendly for the CLI but a footgun for the API.
 */
async function resolveExistingProjectPath(
  project: string,
  workspace: string,
): Promise<string | undefined> {
  if (isAbsolute(project)) {
    return (await fileExists(project)) ? project : undefined;
  }
  const inWorkspace = join(workspace, project);
  return (await fileExists(inWorkspace)) ? inWorkspace : undefined;
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
