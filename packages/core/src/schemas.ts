/**
 * Zod schemas — the single source of truth for all data shapes.
 *
 * TypeScript types in `types.ts` are derived from these via `z.infer` so the
 * two never drift. Validate every payload that crosses a process boundary
 * (IPC, SQLite row, channel ingress, LLM JSON output) with the matching
 * schema; throw or surface a typed error on failure.
 */

import { z } from 'zod';

import { BUDGET_DEFAULTS, budgetsSchema } from './budget-defaults.js';
import {
  AGENT_ROLES,
  AUTONOMY_MODES,
  CHANNEL_IDS,
  DIRECTIVE_STATUSES,
  FINDING_STATUSES,
  INTENTS,
  MODEL_CATEGORIES,
  PLAN_STATUSES,
  SEVERITIES,
  TASK_STATUSES,
} from './constants.js';

// -----------------------------------------------------------------------------
// Primitives
// -----------------------------------------------------------------------------

export const channelIdSchema = z.enum(CHANNEL_IDS);
export const intentSchema = z.enum(INTENTS);
export const autonomyModeSchema = z.enum(AUTONOMY_MODES);
export const directiveStatusSchema = z.enum(DIRECTIVE_STATUSES);
export const severitySchema = z.enum(SEVERITIES);
export const findingStatusSchema = z.enum(FINDING_STATUSES);
export const planStatusSchema = z.enum(PLAN_STATUSES);
export const taskStatusSchema = z.enum(TASK_STATUSES);
export const agentRoleSchema = z.enum(AGENT_ROLES);
export const modelCategorySchema = z.enum(MODEL_CATEGORIES);

/** ISO8601 timestamp string. */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** A ULID (time-sortable, 26-char Crockford base32). Mirrors `ulid()`. */
export const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);

// -----------------------------------------------------------------------------
// Directive
// -----------------------------------------------------------------------------

/**
 * Per-directive budget ceilings (ADR 0020). Absent = unlimited, which
 * preserves pre-Phase-7 behaviour for directives that did not opt in.
 *
 *   - `maxUsd` — USD ceiling on the sum of `model_usage.cost_usd` rows
 *     scoped to this directive. Enforced pre-call by the brain.
 *   - `maxSteps` — call-count ceiling (one row per LLM call) scoped to
 *     this directive. Catches retry loops and stall-grind loops that
 *     do not otherwise trip `--max-turns` or the planner's task cap.
 */
export const directiveLimitsSchema = z.object({
  maxUsd: z.number().positive().optional(),
  maxSteps: z.number().int().positive().optional(),
});

/**
 * Per-project budget defaults at `<project>/.factory/project.json`
 * `metadata.budgetDefaults` (ADR 0027 §4 — write surface; ADR 0032 §1 — schema).
 *
 * **Phase 13.5 widened this to the full Phase 12 axis set.** Pre-13.5 the schema
 * carried only `maxUsd` + `maxSteps` (ADR 0027 era); Phase 13.5 swapped the
 * definition to {@link budgetsSchema} so the on-disk shape matches the on-wire
 * shape `directive.payload.budgets` carries (ADR 0032 §6 + §3 single-source-of-
 * truth contract). Backward compat: pre-Phase-13 projects with just
 * `{maxUsd, maxSteps}` parse unchanged; new projects can carry any of the six
 * axes including `maxTurnsScaffolder|Builder|Fixer` and `askUserDeadlineMs`.
 *
 * Resolution order on directive creation (CLI + Web UI):
 *   `--max-usd flag` → project `metadata.budgetDefaults` → config `[budget.defaults]` → unlimited.
 *
 * For `maxUsd`/`maxSteps` the resolution lands on `directive.limits` via
 * {@link wiki.resolveDirectiveLimits}; for the other four axes it lands on
 * `directive.payload.budgets` via {@link wiki.resolveDirectivePayloadBudgets}.
 * Same source key on disk; two consumers because the legacy ADR 0020 path
 * and the new ADR 0032 path persist to different directive fields.
 *
 * The Web UI write path is `PUT /api/v1/projects/:id/budget` with full-document
 * replacement semantics (ADR 0027 §1): the request body is the new state.
 */
export const projectBudgetDefaultsSchema = budgetsSchema;
export type ProjectBudgetDefaults = z.infer<typeof projectBudgetDefaultsSchema>;

export const directiveSchema = z.object({
  id: ulidSchema,
  source: channelIdSchema,
  principal: z.string().min(1),
  channelRef: z.string().min(1),
  intent: intentSchema,
  payload: z.unknown(),
  autonomy: autonomyModeSchema,
  createdAt: isoDateTimeSchema,
  status: directiveStatusSchema,
  claimedBy: z.string().min(1).optional(),
  parentDirectiveId: ulidSchema.optional(),
  /**
   * Free-text explanation recorded when a directive transitions to `blocked`.
   * Set by the CLI `factory directive mark-blocked` command, the daemon
   * startup reconcile pass, and any future escalation flow that wants to
   * leave a breadcrumb for later inspection. Nullable — pre-migration rows
   * and most assisted-mode aborts leave it empty.
   */
  blockedReason: z.string().min(1).optional(),
  /**
   * Budget ceilings for this directive. See {@link directiveLimitsSchema}.
   * Absent means unlimited (pre-ADR-0020 behaviour).
   */
  limits: directiveLimitsSchema.optional(),
  /**
   * Stable project identity (ADR 0021) — the ULID from
   * `<project>/.factory/project.json`. Populated by directive-creation paths
   * (CLI build / resume) via `wiki.loadOrCreateProjectMetadata`. Optional
   * because chat / system directives are not tied to a project.
   */
  projectId: ulidSchema.optional(),
});

// -----------------------------------------------------------------------------
// Event
// -----------------------------------------------------------------------------

export const eventBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('git.commit'),
    repo: z.string(),
    sha: z.string(),
    summary: z.string(),
    branch: z.string(),
    author: z.string(),
  }),
  z.object({
    kind: z.literal('fs.changed'),
    path: z.string(),
    type: z.enum(['create', 'modify', 'delete']),
  }),
  z.object({
    kind: z.literal('channel.message'),
    channel: channelIdSchema,
    principal: z.string(),
    ref: z.string(),
    text: z.string(),
  }),
]);

export const eventSchema = z.object({
  id: ulidSchema,
  source: z.string().min(1),
  body: eventBodySchema,
  metadata: z.record(z.unknown()),
  receivedAt: isoDateTimeSchema,
});

// -----------------------------------------------------------------------------
// Finding
// -----------------------------------------------------------------------------

export const findingSchema = z.object({
  id: z.string().regex(/^F\d{3,}$/, 'Finding IDs are F001, F002, ... (project-scoped)'),
  source: agentRoleSchema,
  target: z.string().min(1),
  severity: severitySchema,
  status: findingStatusSchema,
  description: z.string().min(1),
  resolution: z.string().optional(),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.optional(),
  /**
   * Advisory findings do not contribute to the gate. Verifier-raised findings
   * default to `advisory: true` (see ADR 0018); other sources default to
   * `undefined` (treated as blocking). Consumers that surface findings to
   * operators may annotate advisory findings so a false CRITICAL from a
   * read-only agent doesn't look like a real blocker.
   */
  advisory: z.boolean().optional(),
});

// -----------------------------------------------------------------------------
// Plan / Task
// -----------------------------------------------------------------------------

export const taskResultSchema = z.object({
  exitCode: z.number().int(),
  filesChanged: z.array(z.string()),
  findingsRaised: z.array(z.string()),
  signalsEmitted: z.array(z.string()),
  error: z.string().optional(),
  /**
   * Tier-12 / ADR 0032 §4 — typed error subtype the worker bubbles up from
   * the provider when the model layer reports a structured failure. Today
   * the only populator is the claude-cli provider's `error_max_turns`
   * result event, surfaced as `'error_max_turns'`. The pool reads this to
   * trigger the budget-escalation askUser flow instead of hard-failing
   * the task. Optional: read-only-agent failures + worker-internal errors
   * (worktree allocation, cleanup, sandbox) carry only `error` text.
   */
  errorSubtype: z.string().optional(),
  durationMs: z.number().int().nonnegative(),
});

export const taskSchema = z.object({
  id: ulidSchema,
  planId: ulidSchema,
  title: z.string().min(1),
  agent: agentRoleSchema,
  category: modelCategorySchema,
  inputs: z.object({
    files: z.array(z.string()),
    context: z.string(),
  }),
  expectedOutputs: z.object({
    files: z.array(z.string()),
    signals: z.array(z.string()),
  }),
  dependsOn: z.array(ulidSchema),
  status: taskStatusSchema,
  attempts: z.number().int().nonnegative(),
  worktreePath: z.string().optional(),
  result: taskResultSchema.optional(),
  /**
   * Per-task override for the tool-use turn budget. Applied only to
   * tool-using agents (scaffolder / builder / fixer); read-only agents
   * ignore it. When omitted, the provider's default ({@link
   * ClaudeCliProviderOptions.maxTurns}) is used. Planner-emitted. See
   * ADR 0016.
   */
  maxTurns: z.number().int().positive().optional(),
});

export const planSchema = z.object({
  id: ulidSchema,
  directiveId: ulidSchema,
  projectPath: z.string().min(1),
  tasks: z.array(taskSchema),
  createdAt: isoDateTimeSchema,
  status: planStatusSchema,
});

// -----------------------------------------------------------------------------
// Outbound message (brain → channel)
// -----------------------------------------------------------------------------

export const outboundMessageSchema = z.object({
  id: ulidSchema,
  directiveId: ulidSchema.optional(),
  targetChannel: channelIdSchema,
  targetRef: z.string().min(1),
  text: z.string(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: isoDateTimeSchema,
  deliveredAt: isoDateTimeSchema.optional(),
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
});

// -----------------------------------------------------------------------------
// Pending question (ask_user)
// -----------------------------------------------------------------------------

export const pendingQuestionSchema = z.object({
  id: ulidSchema,
  directiveId: ulidSchema,
  taskId: ulidSchema.optional(),
  question: z.string(),
  options: z.array(z.string()).optional(),
  channel: channelIdSchema,
  channelRef: z.string(),
  createdAt: isoDateTimeSchema,
  deadlineAt: isoDateTimeSchema.optional(),
  answeredAt: isoDateTimeSchema.optional(),
  answer: z.string().optional(),
  /**
   * Provider-side message id of the outbound that carried this question
   * (Telegram `message_id`, Discord snowflake). Stamped by the outbound
   * worker on successful delivery; lets the channel matcher disambiguate
   * Reply-feature answers when multiple questions are open in the same
   * chat (I012).
   */
  botMessageId: z.string().min(1).optional(),
  /**
   * Who (or what) wrote the answer. Populated when `answeredAt` is set.
   * `'user'` is the operator-driven answer (CLI / channel / web); `'agent'`
   * is the Tier 8 LLM auto-answer (ADR 0030); `'agent-failed'` is the
   * synthetic written when the auto-answer LLM call failed both attempts;
   * `'orphan-sweep'` is the retroactive close from `factory questions
   * cleanup`. NULL on unanswered rows. Read-side stays optional for
   * forward compatibility with pre-Tier-8 datasets that may carry NULL on
   * historically-answered rows the migration backfill missed.
   */
  answeredBy: z.enum(['user', 'agent', 'agent-failed', 'orphan-sweep']).optional(),
});

// -----------------------------------------------------------------------------
// Directive log line (Tier 11 / U031)
// -----------------------------------------------------------------------------

/**
 * Persisted row shape for `directive_log_lines` (migration 010). Mirrors the
 * SSE `logLineEventSchema` field set so a row round-trips cleanly to/from a
 * live event, but drops the `type` literal (not stored) and adds the
 * surrogate `id` (SQLite-assigned) so callers can break ties on identical
 * timestamps and correlate downstream operations.
 *
 * Read path: the daemon's `GET /api/v1/directives/:id/logs` route renders
 * a list of these for the FE to replay on connect (Tier 11 §11.5–11.6).
 *
 * Write path: the daemon's `DirectiveStreamHub.emit` tee site builds a
 * {@link DirectiveLogLineInput} (no `id` — auto-assigned) and calls
 * `appendLogLine` before fan-out (Tier 11 §11.4).
 */
export const directiveLogLineSchema = z.object({
  id: z.number().int().positive(),
  directiveId: ulidSchema,
  ts: isoDateTimeSchema,
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
  component: z.string().min(1),
  msg: z.string(),
  attrs: z.record(z.unknown()).optional(),
});

/** Insert shape — `id` is auto-assigned by SQLite (`INTEGER PRIMARY KEY AUTOINCREMENT`). */
export const directiveLogLineInputSchema = directiveLogLineSchema.omit({ id: true });

// -----------------------------------------------------------------------------
// Daemon-wide config file (ADR 0030)
// -----------------------------------------------------------------------------

/**
 * Default `ask_user` deadline, milliseconds. ADR 0030 §2 — 5 minutes.
 * Pre-Tier-8 deployments without `<dataDir>/config.json` use this; missing
 * keys in a present file fall back to this too.
 *
 * Re-exports the Tier-12 {@link BUDGET_DEFAULTS} value so the single-
 * source-of-truth contract (ADR 0032 §3) holds — editing this value
 * means editing the explainer too, and the explainer lives only in
 * `budget-defaults.ts`.
 */
export const DEFAULT_ASK_USER_DEADLINE_MS = BUDGET_DEFAULTS.askUserDeadlineMs.value;

/**
 * The shape `<dataDir>/config.json` is parsed against. All fields are
 * optional on disk; readers fill in defaults for any missing keys. Adding
 * a new key here must update the resolved {@link FactoryConfig} shape too.
 */
export const factoryConfigFileSchema = z.object({
  /** ADR 0030 §2 — auto-answer deadline. Positive integer milliseconds. */
  askUserDeadlineMs: z.number().int().positive().optional(),
});

/**
 * The fully-resolved shape returned to callers — every field present,
 * defaults applied. Distinct from {@link factoryConfigFileSchema} which
 * mirrors the on-disk shape (every field optional).
 */
export interface FactoryConfig {
  /** ADR 0030 §2 — auto-answer deadline in ms. Defaults to 5 min. */
  askUserDeadlineMs: number;
}

// -----------------------------------------------------------------------------
// Project registry
// -----------------------------------------------------------------------------

/**
 * Project registry entry. ADR 0021 made `id` (ULID) the canonical key,
 * superseding the prior `name`-keyed shape:
 *
 *   - `id` — ULID; the canonical handle. Stable across path moves; matches
 *     `<project>/.factory/project.json` `id`.
 *   - `name` — human-readable label. Not unique, never used for joins.
 *   - `workspacePath` — current workspace path. Snapshot only; identity
 *     does not derive from it.
 *   - `lastWorkspacePath` — advisory snapshot of the most recent workspace
 *     path seen for this project, populated when factory cannot read the
 *     identity file at `workspacePath` (e.g. moved/deleted without
 *     factory's knowledge). Operator-facing diagnostic only.
 */
export const projectSchema = z.object({
  id: ulidSchema,
  name: z.string().min(1),
  workspacePath: z.string().min(1),
  lastWorkspacePath: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'complete', 'archived']),
  createdAt: isoDateTimeSchema,
  lastTouchedAt: isoDateTimeSchema,
  metadata: z.record(z.unknown()).optional(),
});
