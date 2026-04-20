/**
 * Zod schemas — the single source of truth for all data shapes.
 *
 * TypeScript types in `types.ts` are derived from these via `z.infer` so the
 * two never drift. Validate every payload that crosses a process boundary
 * (IPC, SQLite row, channel ingress, LLM JSON output) with the matching
 * schema; throw or surface a typed error on failure.
 */

import { z } from 'zod';

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
});

// -----------------------------------------------------------------------------
// Event
// -----------------------------------------------------------------------------

export const eventBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('github.issue.opened'),
    repo: z.string(),
    number: z.number().int().positive(),
    title: z.string(),
    author: z.string(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal('github.issue.commented'),
    repo: z.string(),
    number: z.number().int().positive(),
    commentId: z.string(),
    author: z.string(),
    body: z.string(),
  }),
  z.object({
    kind: z.literal('github.pr.status'),
    repo: z.string(),
    number: z.number().int().positive(),
    status: z.string(),
    conclusion: z.string().optional(),
    sha: z.string(),
  }),
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
});

// -----------------------------------------------------------------------------
// Project registry
// -----------------------------------------------------------------------------

export const projectSchema = z.object({
  name: z.string().min(1),
  workspacePath: z.string().min(1),
  status: z.enum(['active', 'paused', 'complete', 'archived']),
  createdAt: isoDateTimeSchema,
  lastTouchedAt: isoDateTimeSchema,
  metadata: z.record(z.unknown()).optional(),
});
