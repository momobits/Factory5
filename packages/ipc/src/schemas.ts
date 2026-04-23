/**
 * Request / response schemas for daemon ↔ brain HTTP endpoints.
 *
 * Both sides validate at the boundary. Drift between client and server is
 * caught at request-time by the schema parse.
 */

import {
  agentRoleSchema,
  channelIdSchema,
  directiveSchema,
  modelCategorySchema,
  pendingQuestionSchema,
  taskResultSchema,
  taskStatusSchema,
  ulidSchema,
} from '@factory5/core';
import { z } from 'zod';

// -----------------------------------------------------------------------------
// GET /status
// -----------------------------------------------------------------------------

export const statusResponseSchema = z.object({
  version: z.string(),
  process: z.string(),
  pid: z.number().int(),
  uptimeMs: z.number().nonnegative(),
  startedAt: z.string().datetime({ offset: true }),
  channels: z.array(
    z.object({
      id: channelIdSchema,
      status: z.enum(['ready', 'starting', 'failed', 'disabled']),
      lastError: z.string().optional(),
    }),
  ),
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

// -----------------------------------------------------------------------------
// POST /send
// -----------------------------------------------------------------------------

export const sendRequestSchema = z.object({
  targetChannel: channelIdSchema,
  targetRef: z.string().min(1),
  text: z.string(),
  directiveId: ulidSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type SendRequest = z.infer<typeof sendRequestSchema>;

export const sendResponseSchema = z.object({
  delivered: z.boolean(),
  messageId: ulidSchema,
  externalId: z.string().optional(),
});
export type SendResponse = z.infer<typeof sendResponseSchema>;

// -----------------------------------------------------------------------------
// POST /directives/notify  (daemon → brain)
// -----------------------------------------------------------------------------

export const directiveNotifyRequestSchema = z.object({
  directiveId: ulidSchema,
  reason: z.enum(['new', 'priority', 'cancelled']),
});
export type DirectiveNotifyRequest = z.infer<typeof directiveNotifyRequestSchema>;

export const directiveNotifyResponseSchema = z.object({
  acknowledged: z.boolean(),
});
export type DirectiveNotifyResponse = z.infer<typeof directiveNotifyResponseSchema>;

// -----------------------------------------------------------------------------
// POST /reload-config
// -----------------------------------------------------------------------------

export const reloadConfigResponseSchema = z.object({
  reloaded: z.boolean(),
  appliedAt: z.string().datetime({ offset: true }),
  warnings: z.array(z.string()),
});
export type ReloadConfigResponse = z.infer<typeof reloadConfigResponseSchema>;

// -----------------------------------------------------------------------------
// POST /worker/ask-user  (worker subprocess → daemon → brain)
// -----------------------------------------------------------------------------

/**
 * Mid-stream escalation from a worker subprocess. The MCP `ask_user` tool
 * (sub-step 8.3) hits this route; the daemon proxies into the brain's
 * existing `askUser()` helper, which polls `pending_questions` until the
 * operator answers or the deadline passes.
 *
 * `taskId` is **mandatory** for worker callers (per ADR 0024 §3) — sibling
 * workers in the same directive must each receive their own answer, so
 * crossover is prevented by tying the question to a specific task.
 */
export const workerAskUserRequestSchema = z.object({
  taskId: ulidSchema,
  directiveId: ulidSchema,
  question: z.string().min(1),
  options: z.array(z.string().min(1)).optional(),
  /**
   * Optional per-question soft deadline in seconds. When omitted the daemon
   * uses its configured default (1 hour per ADR 0024 §2). When the deadline
   * passes the response is returned with `timedOut: true` and no answer; the
   * agent decides whether to fall back to a guess.
   */
  deadlineSeconds: z.number().int().positive().optional(),
});
export type WorkerAskUserRequest = z.infer<typeof workerAskUserRequestSchema>;

export const workerAskUserResponseSchema = z.object({
  questionId: ulidSchema,
  answer: z.string().optional(),
  timedOut: z.boolean(),
  aborted: z.boolean(),
});
export type WorkerAskUserResponse = z.infer<typeof workerAskUserResponseSchema>;

// -----------------------------------------------------------------------------
// GET /api/v1/directives  (web UI, ADR 0025)
// -----------------------------------------------------------------------------

/**
 * Query string for `GET /api/v1/directives`. All fields optional.
 *
 *   ?limit=20     page size, clamped server-side to [1, 100]
 *   ?offset=0     rows to skip (>= 0)
 *   ?status=...   filter by directive status (pending | running | complete | ...)
 */
export const apiV1DirectivesListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  status: directiveSchema.shape.status.optional(),
});
export type ApiV1DirectivesListQuery = z.infer<typeof apiV1DirectivesListQuerySchema>;

export const apiV1DirectivesListResponseSchema = z.object({
  items: z.array(directiveSchema),
  /** Total matching rows ignoring pagination. */
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type ApiV1DirectivesListResponse = z.infer<typeof apiV1DirectivesListResponseSchema>;

// -----------------------------------------------------------------------------
// GET /api/v1/directives/:id  (web UI, ADR 0025)
// -----------------------------------------------------------------------------

/**
 * Runtime-state view of a task. Mirrors `InflightTask` in
 * `@factory5/state/queries/tasks-inflight`. Kept inline here (rather than
 * promoted to `@factory5/core`) because its audience is the web UI; brain
 * and CLI read the concrete interface directly.
 */
export const apiV1InflightTaskSchema = z.object({
  id: ulidSchema,
  directiveId: ulidSchema,
  planId: ulidSchema,
  title: z.string(),
  agent: agentRoleSchema,
  category: modelCategorySchema,
  worktreePath: z.string().optional(),
  pid: z.number().int().optional(),
  status: taskStatusSchema,
  attempts: z.number().int().nonnegative(),
  startedAt: z.string().datetime({ offset: true }).optional(),
  lastHeartbeat: z.string().datetime({ offset: true }).optional(),
  finishedAt: z.string().datetime({ offset: true }).optional(),
  result: taskResultSchema.optional(),
  waitingQuestionId: ulidSchema.optional(),
  abortedReason: z.string().optional(),
});
export type ApiV1InflightTask = z.infer<typeof apiV1InflightTaskSchema>;

export const apiV1DirectiveDetailResponseSchema = z.object({
  directive: directiveSchema,
  timeline: z.object({
    tasks: z.array(apiV1InflightTaskSchema),
    /**
     * Currently open (unanswered) questions for this directive. The full
     * open-and-answered list lives under `/api/v1/pending-questions` in 9.5.
     */
    openQuestions: z.array(pendingQuestionSchema),
    modelUsage: z.object({
      totalCostUsd: z.number().nonnegative(),
      callCount: z.number().int().nonnegative(),
    }),
  }),
});
export type ApiV1DirectiveDetailResponse = z.infer<typeof apiV1DirectiveDetailResponseSchema>;

// -----------------------------------------------------------------------------
// GET /api/v1/pending-questions  (web UI, ADR 0025 sub-step 9.5)
// -----------------------------------------------------------------------------

/**
 * Query string for `GET /api/v1/pending-questions`. All fields optional.
 *
 *   ?limit=20       page size, clamped server-side to [1, 100]
 *   ?offset=0       rows to skip (>= 0)
 *   ?status=open    default; alternatives: `answered`, `all`
 *   ?directiveId=…  optional directive scope
 */
export const apiV1PendingQuestionsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  status: z.enum(['open', 'answered', 'all']).optional(),
  directiveId: ulidSchema.optional(),
});
export type ApiV1PendingQuestionsListQuery = z.infer<typeof apiV1PendingQuestionsListQuerySchema>;

export const apiV1PendingQuestionsListResponseSchema = z.object({
  items: z.array(pendingQuestionSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  status: z.enum(['open', 'answered', 'all']),
});
export type ApiV1PendingQuestionsListResponse = z.infer<
  typeof apiV1PendingQuestionsListResponseSchema
>;

// -----------------------------------------------------------------------------
// GET /api/v1/pending-questions/:id  (web UI, ADR 0025 sub-step 9.5)
// -----------------------------------------------------------------------------

export const apiV1PendingQuestionDetailResponseSchema = z.object({
  question: pendingQuestionSchema,
});
export type ApiV1PendingQuestionDetailResponse = z.infer<
  typeof apiV1PendingQuestionDetailResponseSchema
>;

// -----------------------------------------------------------------------------
// Error envelope (returned with non-2xx responses)
// -----------------------------------------------------------------------------

export const ipcErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type IpcError = z.infer<typeof ipcErrorSchema>;
