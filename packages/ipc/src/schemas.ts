/**
 * Request / response schemas for daemon ↔ brain HTTP endpoints.
 *
 * Both sides validate at the boundary. Drift between client and server is
 * caught at request-time by the schema parse.
 */

import {
  agentRoleSchema,
  autonomyModeSchema,
  channelIdSchema,
  directiveLimitsSchema,
  directiveSchema,
  findingSchema,
  findingStatusSchema,
  modelCategorySchema,
  pendingQuestionSchema,
  projectBudgetDefaultsSchema,
  severitySchema,
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
// POST /api/v1/pending-questions/:id/answer  (web UI, ADR 0027 sub-step 11.2)
// -----------------------------------------------------------------------------

/**
 * Request body for answering a pending question via the web UI mutation
 * surface (ADR 0027 §1). Same path the Discord / Telegram channel
 * collectors take; the web UI is just one more inbound channel.
 *
 * Idempotency rules per ADR 0027 §2:
 *   - Re-POST with the same `answer` string → 200 no-op (idempotent).
 *   - Re-POST with a different `answer` → 409 `QUESTION_ALREADY_ANSWERED_DIFFERENTLY`;
 *     the original answer is preserved (never silently overwritten).
 */
export const apiV1AnswerPendingQuestionRequestSchema = z.object({
  answer: z.string().min(1),
});
export type ApiV1AnswerPendingQuestionRequest = z.infer<
  typeof apiV1AnswerPendingQuestionRequestSchema
>;

export const apiV1AnswerPendingQuestionResponseSchema = z.object({
  question: pendingQuestionSchema,
});
export type ApiV1AnswerPendingQuestionResponse = z.infer<
  typeof apiV1AnswerPendingQuestionResponseSchema
>;

// -----------------------------------------------------------------------------
// POST /api/v1/builds  (web UI, ADR 0027 sub-step 11.3)
// -----------------------------------------------------------------------------

/**
 * Request body for kicking off a build via the web UI mutation surface
 * (ADR 0027 §1). Mirrors `factory build <project>`'s argument set:
 *
 *   - `project` — project name (resolved against `defaultWorkspace()`)
 *     OR an absolute path. The route refuses to create new projects;
 *     operator must `factory init` first per the Phase 11 charter.
 *   - `language` — explicit assessor runtime override; falls through to
 *     `metadata.language` when absent (Phase 10.8 parity).
 *   - `autonomy` — `chat` | `assisted` | `autonomous`; defaults to
 *     `assisted` to match the CLI default.
 *   - `limits` — explicit per-directive budget ceiling (ADR 0020 shape).
 *     Body-only resolution in 11.3; 11.4 will add the project-tier
 *     fallback (`metadata.budgetDefaults`) shared with the CLI.
 *
 * Idempotency per ADR 0027 §2: builds are NOT idempotent — each POST
 * mints a new directive (the SPA's submit button disables on first
 * click to prevent operator double-submit).
 */
export const apiV1CreateBuildRequestSchema = z.object({
  project: z.string().min(1),
  language: z.enum(['python', 'node', 'go', 'rust']).optional(),
  autonomy: autonomyModeSchema.optional(),
  limits: directiveLimitsSchema.optional(),
});
export type ApiV1CreateBuildRequest = z.infer<typeof apiV1CreateBuildRequestSchema>;

export const apiV1CreateBuildResponseSchema = z.object({
  directive: directiveSchema,
});
export type ApiV1CreateBuildResponse = z.infer<typeof apiV1CreateBuildResponseSchema>;

// -----------------------------------------------------------------------------
// PUT /api/v1/projects/:id/budget  (web UI, ADR 0027 sub-step 11.4)
// -----------------------------------------------------------------------------

/**
 * Request body for setting per-project budget defaults via the web UI
 * mutation surface (ADR 0027 §1, §4). Body is the new state of the
 * `metadata.budgetDefaults` document under
 * `<project>/.factory/project.json` — full RFC-9110 PUT semantics.
 *
 *   - Both fields present → set both.
 *   - Only one field present → set that field, remove the other.
 *   - Empty body `{}` → clear both fields entirely.
 *
 * No PATCH-style partial-merge — see ADR 0027 §1's rejection of `{maxUsd: null}`.
 */
export const apiV1UpdateProjectBudgetRequestSchema = projectBudgetDefaultsSchema;
export type ApiV1UpdateProjectBudgetRequest = z.infer<typeof apiV1UpdateProjectBudgetRequestSchema>;

export const apiV1UpdateProjectBudgetResponseSchema = z.object({
  projectId: ulidSchema,
  budgetDefaults: projectBudgetDefaultsSchema,
});
export type ApiV1UpdateProjectBudgetResponse = z.infer<
  typeof apiV1UpdateProjectBudgetResponseSchema
>;

// -----------------------------------------------------------------------------
// GET /api/v1/spend  (web UI, ADR 0025 sub-step 9.6)
// -----------------------------------------------------------------------------

/**
 * Query string for `GET /api/v1/spend`. All fields optional; omit to get
 * all-time aggregates. Matches `SpendFilter` in `@factory5/state`.
 *
 *   ?since=…       ISO8601 inclusive lower bound on `called_at`
 *   ?until=…       ISO8601 exclusive upper bound on `called_at`
 *   ?projectId=…   restrict to a single project (ULID)
 */
export const apiV1SpendQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  projectId: ulidSchema.optional(),
});
export type ApiV1SpendQuery = z.infer<typeof apiV1SpendQuerySchema>;

const perProjectSpendSchema = z.object({
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  display: z.string(),
  totalUsd: z.number().nonnegative(),
  callCount: z.number().int().nonnegative(),
  directiveCount: z.number().int().nonnegative(),
});

const perDirectiveSpendSchema = z.object({
  directiveId: ulidSchema,
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  totalUsd: z.number().nonnegative(),
  callCount: z.number().int().nonnegative(),
  firstCalledAt: z.string().datetime({ offset: true }),
  lastCalledAt: z.string().datetime({ offset: true }),
});

const perDaySpendSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalUsd: z.number().nonnegative(),
  callCount: z.number().int().nonnegative(),
});

const perModelSpendSchema = z.object({
  provider: z.string(),
  model: z.string(),
  totalUsd: z.number().nonnegative(),
  callCount: z.number().int().nonnegative(),
});

export const apiV1SpendResponseSchema = z.object({
  perProject: z.array(perProjectSpendSchema),
  perDirective: z.array(perDirectiveSpendSchema),
  perDay: z.array(perDaySpendSchema),
  perModel: z.array(perModelSpendSchema),
  filter: z.object({
    since: z.string().datetime({ offset: true }).optional(),
    until: z.string().datetime({ offset: true }).optional(),
    projectId: ulidSchema.optional(),
  }),
});
export type ApiV1SpendResponse = z.infer<typeof apiV1SpendResponseSchema>;

// -----------------------------------------------------------------------------
// GET /api/v1/findings  (web UI, ADR 0025 sub-step 9.7)
// -----------------------------------------------------------------------------

/**
 * Query string for `GET /api/v1/findings`. All fields optional.
 *
 *   ?severity=…    filter by severity (LOW/MEDIUM/HIGH/CRITICAL)
 *   ?status=…      filter by status (OPEN/FIXED/ACCEPTED/...)
 *   ?project=…     exact project_id, or glob with * and ?
 *   ?advisory=true|false   boolean filter; omit for both
 *   ?limit=100     clamped to [1, 1000] server-side
 *
 * Matches `ListFilter` in `@factory5/state/findings-registry`.
 */
export const apiV1FindingsListQuerySchema = z.object({
  severity: severitySchema.optional(),
  status: findingStatusSchema.optional(),
  project: z.string().min(1).optional(),
  advisory: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});
export type ApiV1FindingsListQuery = z.infer<typeof apiV1FindingsListQuerySchema>;

const registryEntrySchema = z.object({
  projectId: z.string(),
  projectPath: z.string(),
  finding: findingSchema,
  originDirectiveId: ulidSchema.optional(),
  updatedAt: z.string().datetime({ offset: true }),
});

export const apiV1FindingsListResponseSchema = z.object({
  items: z.array(registryEntrySchema),
  filter: z.object({
    severity: severitySchema.optional(),
    status: findingStatusSchema.optional(),
    project: z.string().optional(),
    advisory: z.boolean().optional(),
    limit: z.number().int().positive(),
  }),
});
export type ApiV1FindingsListResponse = z.infer<typeof apiV1FindingsListResponseSchema>;

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
