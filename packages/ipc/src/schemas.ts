/**
 * Request / response schemas for daemon ↔ brain HTTP endpoints.
 *
 * Both sides validate at the boundary. Drift between client and server is
 * caught at request-time by the schema parse.
 */

import {
  agentRoleSchema,
  autonomyModeSchema,
  budgetsSchema,
  channelIdSchema,
  directiveLimitsSchema,
  directiveLogLineSchema,
  directiveSchema,
  findingSchema,
  findingStatusSchema,
  modelCategorySchema,
  pendingQuestionSchema,
  projectBudgetDefaultsSchema,
  projectSchema,
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
// POST /directives/:id/cancel  (operator → daemon — Phase 2.4)
// -----------------------------------------------------------------------------

/**
 * Request body for `POST /directives/:id/cancel`. Both fields optional —
 * an empty body is the canonical "kill it now, no reason" form.
 *
 *   - `reason` — free-text, persisted to `directives.blocked_reason`.
 *     Defaults to `"cancelled"` server-side when omitted / empty.
 *
 * Distinct from `POST /directives/notify { reason: 'cancelled' }` — that
 * is a doorbell *event* telling the brain "look at this directive again";
 * this route is the active-cancel CRUD surface that flips the row to
 * `failed` AND fires the brain's per-directive AbortController.
 */
export const cancelDirectiveRequestSchema = z.object({
  reason: z.string().min(1).optional(),
});
export type CancelDirectiveRequest = z.infer<typeof cancelDirectiveRequestSchema>;

export const cancelDirectiveResponseSchema = z.object({
  directive: directiveSchema,
  /**
   * `true` iff the daemon was hosting the brain that was running this
   * directive — i.e. an in-process AbortController existed and fired,
   * which propagates to the worker subprocess. `false` means the DB row
   * was updated but no in-flight worker was found in this process; the
   * directive may be running in a separate `factory build --inline`
   * shell that the daemon can't signal cross-process.
   */
  abortFired: z.boolean(),
});
export type CancelDirectiveResponse = z.infer<typeof cancelDirectiveResponseSchema>;

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
// GET /ui-token  (operator → daemon — for `factory ui-token` CLI command)
// -----------------------------------------------------------------------------

/**
 * Response shape for the daemon's `/ui-token` endpoint. Exposes the live
 * `FACTORY5_UI_TOKEN` so the operator can recover the dashboard URL after
 * losing terminal scrollback (per ADR 0025 §2 — the token rotates per
 * daemon startup).
 *
 * Threat model: route is loopback-only (preHandler IP guard) and
 * unauthenticated, matching `/status` and `/healthz`. Local users that
 * can run a shell on the host can already read the token from the
 * daemon's process env, so the loopback bind is the real boundary.
 * Cross-origin browser tabs that hit this route over loopback cannot
 * read the JSON response under the default same-origin policy (no CORS
 * headers are set).
 *
 * `url` is the operator-friendly factoryd-hosted dashboard URL when a
 * static SPA bundle is present; otherwise the dev-server URL the
 * operator can hit directly while running `pnpm --filter factory-web dev`.
 * `hasStaticBundle` lets the CLI tag the URL with a "build the SPA"
 * hint when false.
 */
export const uiTokenResponseSchema = z.object({
  token: z.string().min(1),
  url: z.string().min(1),
  hasStaticBundle: z.boolean(),
});
export type UiTokenResponse = z.infer<typeof uiTokenResponseSchema>;

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
 *   ?limit=20            page size, clamped server-side to [1, 100]
 *   ?offset=0            rows to skip (>= 0)
 *   ?status=...          filter by directive status (pending | running | complete | ...)
 *   ?projectId=<ulid>    server-side filter — only directives for this project
 *   ?includeSpend=true   add `costUsd` to each item (LEFT JOIN to model_usage)
 */
export const apiV1DirectivesListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  status: directiveSchema.shape.status.optional(),
  /** Server-side project scope — ULID of the project to filter by. */
  projectId: ulidSchema.optional(),
  /**
   * Opt-in spend rollup. When `"true"`, each item in `items` carries a
   * `costUsd` field (SUM of `model_usage.cost_usd` for that directive).
   * Directives with no model_usage rows get `costUsd: 0`. Omit or pass
   * any falsy value to get the bare directive rows without spend data.
   */
  includeSpend: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ApiV1DirectivesListQuery = z.infer<typeof apiV1DirectivesListQuerySchema>;

/**
 * A directive row as returned by the list endpoint. When the caller passes
 * `?includeSpend=true`, each item carries an optional `costUsd` rollup.
 */
const directiveListItemSchema = directiveSchema.extend({
  /**
   * Total spend in USD for this directive. Present only when the caller
   * passed `?includeSpend=true`. Directives with no model_usage rows
   * receive `0`.
   */
  costUsd: z.number().nonnegative().optional(),
});

export const apiV1DirectivesListResponseSchema = z.object({
  items: z.array(directiveListItemSchema),
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

// -----------------------------------------------------------------------------
// Structured blocked-reason union (Tier 15 / ADR 0034 §6)
// -----------------------------------------------------------------------------

/**
 * Structured `directive.blockedReason` carried on `GET /api/v1/directives/:id`
 * responses. The DB column is a free-form TEXT; Tier 15 added a JSON-encoded
 * structured value for `kind: 'pool-exhausted'`. Legacy free-text values
 * (e.g. `'cancelled-from-web-ui'`) round-trip as the union's string branch
 * so the SPA can render either shape without a schema migration.
 *
 * The pool dispatcher (`packages/brain/src/pool.ts`) stamps the structured
 * shape when it parks a directive on pool exhaustion. Other writers — the
 * cancel route, the CLI `factory directive mark-blocked` verb, the daemon
 * startup reconcile pass — continue to stamp free-text and arrive at the
 * string branch automatically.
 */
export const directiveBlockedReasonSchema = z.union([
  z.object({
    kind: z.literal('pool-exhausted'),
    axis: z.string(),
    usedAtPark: z.number(),
    capAtPark: z.number(),
  }),
  z.string(),
]);
export type DirectiveBlockedReason = z.infer<typeof directiveBlockedReasonSchema>;

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
  /**
   * Tier 15.9 / ADR 0034 §6 — parsed structured form of
   * `directives.blocked_reason`. Present whenever the raw DB column is set
   * (regardless of directive status — `failed` directives stamped by
   * `factory cancel` carry a string `'cancelled'` too). The parsed shape
   * is either a structured `pool-exhausted` object the pool dispatcher
   * writes, or the raw string for every legacy free-text reason. Distinct
   * from `directive.blockedReason` (which keeps the raw DB string for
   * back-compat); the SPA reads this field to render the parked banner.
   */
  blockedReason: directiveBlockedReasonSchema.optional(),
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
  /**
   * Operator-facing Tier-12 budgets (ADR 0032 §1). Optional partial — every
   * axis the operator did NOT override is filled in from {@link BUDGET_DEFAULTS}
   * downstream. Persisted on the resulting directive at `payload.budgets`
   * per ADR 0032 §6. Distinct from {@link directiveLimitsSchema}: `limits`
   * stays the directive-level `maxUsd` / `maxSteps` shape that ADR 0020 pins;
   * `budgets` carries the full Tier-12 axis set including the four that
   * `limits` doesn't cover.
   */
  budgets: budgetsSchema.optional(),
});
export type ApiV1CreateBuildRequest = z.infer<typeof apiV1CreateBuildRequestSchema>;

export const apiV1CreateBuildResponseSchema = z.object({
  directive: directiveSchema,
});
export type ApiV1CreateBuildResponse = z.infer<typeof apiV1CreateBuildResponseSchema>;

// -----------------------------------------------------------------------------
// POST /api/v1/directives/:id/resume  (web UI, ADR 0027 + Tier 10)
// -----------------------------------------------------------------------------

/**
 * Request body for resuming a prior (failed / blocked / complete)
 * directive via the web UI. HTTP mirror of `factory resume <project>`
 * (`packages/cli/src/commands/resume.ts`).
 *
 * The route locates the prior directive by id, extracts its
 * `projectPath` / `projectId` / `language` from the payload, and mints
 * a child directive with `parentDirectiveId` + `payload.resumeFrom` set.
 * The brain skips the architect when the wiki is already on disk and
 * skips already-complete tasks in the plan — same resume semantics as
 * the CLI.
 *
 * Body is optional; when omitted the child inherits the prior's
 * `autonomy` verbatim. Refuses the resume when:
 *   - prior directive not found (404 `DIRECTIVE_NOT_FOUND`)
 *   - prior is still `running` or `pending` (409 `DIRECTIVE_NOT_TERMINAL`)
 *   - prior's `payload.projectPath` no longer exists on disk
 *     (422 `PROJECT_NOT_FOUND`)
 */
export const apiV1ResumeRequestSchema = z.object({
  /** Override autonomy on the resumed run (defaults to the prior's). */
  autonomy: autonomyModeSchema.optional(),
  /**
   * Tier-12 operator overrides on the resumed run. The daemon inherits the
   * prior directive's `payload.budgets` and merges these in per-axis (body
   * wins). Missing axes inherit verbatim from the prior. ADR 0032 §6.
   */
  budgets: budgetsSchema.optional(),
  /**
   * ADR 0020 `limits` (maxUsd / maxSteps) override on the resumed run. The
   * daemon inherits the prior directive's `limits` and merges these in
   * per-field. Distinct from `budgets`; the `limits` shape is the pre-call
   * enforcement surface, separate from the Tier-12 budget axes.
   */
  limits: directiveLimitsSchema.optional(),
});
export type ApiV1ResumeRequest = z.infer<typeof apiV1ResumeRequestSchema>;

export const apiV1ResumeResponseSchema = z.object({
  directive: directiveSchema,
});
export type ApiV1ResumeResponse = z.infer<typeof apiV1ResumeResponseSchema>;

// -----------------------------------------------------------------------------
// GET /api/v1/directives/:id/logs  (web UI, Tier 11 — directive-log replay)
// -----------------------------------------------------------------------------

/**
 * Query string for `GET /api/v1/directives/:id/logs`. Both fields
 * optional. The FE bootstrap on directive-detail fetches once with
 * `?limit=5000` (no `since`) to replay history before attaching SSE;
 * later refreshes / partial reconnects can pass a `since` cursor to
 * resume cleanly.
 *
 *   ?since=<iso>   strict-greater-than filter on `ts` (matches the FE
 *                  join-cursor contract — events with `ts <= since` are
 *                  excluded so a replay-then-SSE join doesn't
 *                  double-render at the boundary)
 *   ?limit=5000    page size, clamped server-side to [1, 5000]
 *                  (matches `DEFAULT_LOG_LINE_LIMIT` in
 *                  `@factory5/state`; full directive history is rarely
 *                  larger and the FE never asks for more)
 */
export const apiV1DirectiveLogsQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});
export type ApiV1DirectiveLogsQuery = z.infer<typeof apiV1DirectiveLogsQuerySchema>;

export const apiV1DirectiveLogsResponseSchema = z.object({
  items: z.array(directiveLogLineSchema),
  /** Number of rows returned (= `items.length`); echoed for UI convenience. */
  count: z.number().int().nonnegative(),
  /** Limit actually applied after server-side clamping. */
  limit: z.number().int().positive(),
});
export type ApiV1DirectiveLogsResponse = z.infer<typeof apiV1DirectiveLogsResponseSchema>;

// -----------------------------------------------------------------------------
// POST /api/v1/projects  (web UI, Phase 3 step 3.7 — browser mirror of `factory init`)
// -----------------------------------------------------------------------------

/**
 * Request body for scaffolding a new project via the web UI. Mirrors
 * `factory init <name> [--language <lang>]`'s argument set; the actual
 * scaffold work runs in `wiki.createProject` so CLI and daemon share
 * the same refuse-overwrite + identity-claim semantics.
 *
 *   - `name` — bare project name, joined under `defaultWorkspace()`.
 *     The route does NOT honour absolute / relative paths — those are a
 *     CLI-only convenience; the web flow trusts the daemon's workspace
 *     config so the operator can't sidestep it.
 *   - `language` — required; drives both the per-language `CLAUDE.md`
 *     scaffold and `metadata.language` (read by the assessor on
 *     subsequent builds, ADR 0026).
 *   - `claudeMd` — optional override for the default scaffold (e.g.
 *     when the operator pastes their own spec into the form).
 *
 * Idempotency: NOT idempotent — each POST claims a fresh ULID. The
 * route refuses with 409 `ALREADY_EXISTS` when a project at that path
 * already has identity or `CLAUDE.md`, mirroring the CLI's exit-2
 * behaviour. Operators rename or pick a different name to retry.
 */
export const apiV1CreateProjectRequestSchema = z.object({
  name: z.string().min(1),
  language: z.enum(['python', 'node', 'go', 'rust']),
  claudeMd: z.string().optional(),
});
export type ApiV1CreateProjectRequest = z.infer<typeof apiV1CreateProjectRequestSchema>;

export const apiV1CreateProjectResponseSchema = z.object({
  id: ulidSchema,
  path: z.string().min(1),
});
export type ApiV1CreateProjectResponse = z.infer<typeof apiV1CreateProjectResponseSchema>;

// -----------------------------------------------------------------------------
// GET /api/v1/projects  (web UI, ADR 0027 sub-step 11.5 — SPA prerequisite)
// -----------------------------------------------------------------------------

/**
 * Lists every project in the daemon's registry, most-recently touched first.
 * Powers the SPA's project-list page and the build form's project dropdown
 * (operator picks by name; SPA needs name → ULID for the budget route per
 * ADR 0027 §1). Read-only; bearer-gated under the same `requireUiAuth` as
 * every other `/api/v1/*` route.
 */
export const apiV1ProjectsListResponseSchema = z.object({
  items: z.array(projectSchema),
});
export type ApiV1ProjectsListResponse = z.infer<typeof apiV1ProjectsListResponseSchema>;

// -----------------------------------------------------------------------------
// GET /api/v1/projects/:id  (web UI, ADR 0027 sub-step 11.5 — SPA prerequisite)
// -----------------------------------------------------------------------------

/**
 * Single project by canonical ULID. Returns the registry row plus the
 * extracted `budgetDefaults` and `language` from the on-disk `project.json`
 * `metadata` blob — pre-shaped so the SPA detail page can pre-fill its
 * forms without parsing free-form `metadata` client-side.
 *
 * Best-effort on the disk read: if `project.json` is absent or corrupt, the
 * registry row is still returned with `budgetDefaults` / `language` absent
 * (the SPA renders an inline note rather than failing the whole page). The
 * mutation routes (PUT /api/v1/projects/:id/budget) surface those failures
 * loudly with `PROJECT_PATH_UNREADABLE` / `PROJECT_METADATA_CORRUPT`.
 */
export const apiV1ProjectDetailResponseSchema = z.object({
  project: projectSchema,
  budgetDefaults: projectBudgetDefaultsSchema.optional(),
  language: z.enum(['python', 'node', 'go', 'rust']).optional(),
});
export type ApiV1ProjectDetailResponse = z.infer<typeof apiV1ProjectDetailResponseSchema>;

// -----------------------------------------------------------------------------
// PUT /api/v1/projects/:id/budget  (web UI, ADR 0027 sub-step 11.4 + Tier 15.9)
// -----------------------------------------------------------------------------

/**
 * Request body for setting per-project budget defaults via the web UI
 * mutation surface (ADR 0027 §1, §4 + ADR 0034 §1). Body is the new state of
 * the `metadata.budgetDefaults` document under
 * `<project>/.factory/project.json` plus the two Tier 15 auto-increase scalars —
 * full RFC-9110 PUT semantics. Strict mode: unknown keys are rejected so a
 * schema drift surfaces loudly at the boundary.
 *
 * Tier 15.9 expanded the legacy {maxUsd?, maxSteps?} body to a structured
 * wrapper so the auto-increase policy travels alongside the per-axis defaults.
 *
 *   - `budgetDefaults` — Phase 13.5's full 8-axis partial. Absent or empty
 *     `{}` clears the on-disk `metadata.budgetDefaults` document entirely.
 *   - `autoIncreaseBudgets` — when `true`, the pool dispatcher auto-bumps
 *     exhausted axes instead of parking the directive. ADR 0034 §5.
 *   - `autoIncreaseCeilingMultiplier` — safety ceiling for the auto-bump
 *     loop. The bump aborts when the effective cap would exceed
 *     `projectDefault × multiplier`. Minimum 1.
 *
 * No PATCH-style partial-merge — see ADR 0027 §1's rejection of `{maxUsd: null}`.
 * Each PUT replaces the entire `budgetDefaults` document (and the two scalars).
 */
export const apiV1ProjectBudgetDefaultsPutBodySchema = z
  .object({
    budgetDefaults: budgetsSchema.optional(),
    autoIncreaseBudgets: z.boolean().optional(),
    autoIncreaseCeilingMultiplier: z.number().min(1).optional(),
  })
  .strict();
export type ApiV1ProjectBudgetDefaultsPutBody = z.infer<
  typeof apiV1ProjectBudgetDefaultsPutBodySchema
>;

/**
 * Pre-Tier-15 alias for the PUT body schema. Kept as a re-export so any
 * downstream consumer that still imports the old name compiles; the schema
 * now accepts the wrapped shape so callers must update their request bodies.
 *
 * @deprecated Use {@link apiV1ProjectBudgetDefaultsPutBodySchema} directly.
 */
export const apiV1UpdateProjectBudgetRequestSchema = apiV1ProjectBudgetDefaultsPutBodySchema;
export type ApiV1UpdateProjectBudgetRequest = z.infer<typeof apiV1UpdateProjectBudgetRequestSchema>;

/**
 * Response shape for `PUT /api/v1/projects/:id/budget`. Echoes the persisted
 * `metadata.budgetDefaults` document plus the two Tier-15 scalars so the SPA
 * can confirm its form state matches disk. The `budgetDefaults` field is
 * always present (possibly `{}`); the two scalars are omitted when the
 * project has no auto-increase policy set.
 */
export const apiV1UpdateProjectBudgetResponseSchema = z.object({
  projectId: ulidSchema,
  budgetDefaults: projectBudgetDefaultsSchema,
  autoIncreaseBudgets: z.boolean().optional(),
  autoIncreaseCeilingMultiplier: z.number().min(1).optional(),
});
export type ApiV1UpdateProjectBudgetResponse = z.infer<
  typeof apiV1UpdateProjectBudgetResponseSchema
>;

// -----------------------------------------------------------------------------
// GET /api/v1/directives/:id/pool-usage  (web UI, Tier 15 / ADR 0034 §6)
// -----------------------------------------------------------------------------

/**
 * Per-task contribution toward a turn-pool axis. Mirrors `PoolTaskContribution`
 * from `@factory5/brain/pool-usage` — the brain owns the runtime type; this
 * is the wire shape both producer and consumer pin to.
 */
const apiV1PoolTaskContributionSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  agent: z.string(),
  contribution: z.number(),
});

/**
 * Usage snapshot for a single budget axis on `GET /pool-usage`. Mirrors
 * `PoolAxisUsage` from `@factory5/brain/pool-usage`. The `tasks` array is
 * empty for axes that aren't per-agent-class (`maxUsd`, `maxSteps`).
 */
const apiV1PoolAxisUsageSchema = z.object({
  used: z.number(),
  cap: z.number(),
  pct: z.number(),
  tasks: z.array(apiV1PoolTaskContributionSchema),
  status: z.enum(['ok', 'warn', 'exhausted']),
});

/**
 * Response shape for `GET /api/v1/directives/:id/pool-usage` — the live tally
 * the Web UI's Live tab renders. Per ADR 0034 §6: brain derives the tally on
 * every call from `tasks_inflight` + `model_usage` + `project.json` via
 * `computePoolUsage`. The daemon is a thin pass-through.
 *
 *   - `directiveId` — echoes the path param for self-describing rendering.
 *   - `computedAt` — ISO8601 timestamp set at compute-time (not request-time);
 *     useful for client-side staleness checks against the `pool.tally` SSE.
 *   - `perAxis` — keyed by `BudgetAxis` (open record because the closed-set
 *     lives in `@factory5/core`; the consumer iterates whatever keys appear).
 *   - `parkedReason` — present only when the directive is `blocked` with a
 *     structured `pool-exhausted` reason. Carries the bump target the
 *     "Raise cap to {N}" button computes against.
 */
export const apiV1PoolUsageResponseSchema = z.object({
  directiveId: z.string(),
  computedAt: z.string(),
  perAxis: z.record(apiV1PoolAxisUsageSchema),
  parkedReason: z
    .object({
      axis: z.string(),
      usedAtPark: z.number(),
      capAtPark: z.number(),
      nextBumpTo: z.number(),
    })
    .optional(),
});
export type ApiV1PoolUsageResponse = z.infer<typeof apiV1PoolUsageResponseSchema>;

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

const perDayPerProjectSpendSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  display: z.string(),
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
  perDayPerProject: z.array(perDayPerProjectSpendSchema),
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
// POST /api/v1/chat/messages  (web UI, Phase 3 / step 3.5)
// -----------------------------------------------------------------------------

/**
 * Request body for posting a chat message from the web UI. The route
 * mints an `intent=chat` directive on the brain's standard chat path —
 * the same minting shape Discord/Telegram inbound takes — and returns
 * the directive id so the SPA can subscribe to its SSE stream for the
 * streamed reply.
 *
 *   - `message` — non-empty user text. Hard upper bound at 8 KB to keep
 *     malformed requests cheap to reject; real chat messages cap at a
 *     few hundred chars in practice. The bound is generous so the SPA
 *     never has to validate length client-side.
 *   - `conversationId` — optional ULID linking this turn to a prior
 *     directive. Reserved for future "resume the conversation thread"
 *     wiring; the 3.5 surface stores it on the new directive's payload
 *     but does not yet read it (each post mints a fresh top-level
 *     directive). Kept in the schema so the SPA can start passing it
 *     opportunistically without a contract churn.
 */
export const apiV1ChatMessageRequestSchema = z.object({
  message: z.string().min(1).max(8192),
  conversationId: ulidSchema.optional(),
});
export type ApiV1ChatMessageRequest = z.infer<typeof apiV1ChatMessageRequestSchema>;

/**
 * Response shape for `POST /api/v1/chat/messages`. The directive's `id`
 * is the SPA's subscription handle: the chat page opens an EventSource
 * on `/api/v1/directives/<id>/stream` and renders one bubble per
 * `log.line` event tagged with `component: 'brain.chat'` (emitted by
 * the brain's chat-path log-line wiring shipped in step 3.5 commit 1).
 * `directive.completed` closes the conversation back to "type your
 * next message" on the SPA.
 */
export const apiV1ChatMessageResponseSchema = z.object({
  directive: directiveSchema,
});
export type ApiV1ChatMessageResponse = z.infer<typeof apiV1ChatMessageResponseSchema>;

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
