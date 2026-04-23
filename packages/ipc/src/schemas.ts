/**
 * Request / response schemas for daemon ↔ brain HTTP endpoints.
 *
 * Both sides validate at the boundary. Drift between client and server is
 * caught at request-time by the schema parse.
 */

import { channelIdSchema, ulidSchema } from '@factory5/core';
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
