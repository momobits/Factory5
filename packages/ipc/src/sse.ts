/**
 * Zod schemas + inferred types for the SSE event stream pushed over
 * `GET /api/v1/directives/:id/stream` (Phase 3 / Step 3.1).
 *
 * The wire shape is documented in
 * `UPGRADE/specs/sse-directive-stream.md`. This module is the canonical
 * runtime contract: producer (brain emit helper) and consumer (browser
 * EventSource wrapper) both validate via these schemas so drift between
 * sides shows up as a parse error rather than silently bad rendering.
 *
 * The discriminated union {@link directiveStreamEventSchema} covers all
 * nine event types (`task.started`, `task.completed`, `task.retried`,
 * `finding.created`, `spend.updated`, `transcript.line`, `log.line`,
 * `pool.tally`, `directive.completed`). Adding a new event type:
 *
 *   1. Add a `*EventSchema` for the new payload.
 *   2. Add it to `directiveStreamEventSchema`'s discriminated array.
 *   3. Update the spec doc.
 *   4. Wire emission and add a test that exercises the new path.
 */

import {
  agentRoleSchema,
  directiveStatusSchema,
  findingStatusSchema,
  modelCategorySchema,
  severitySchema,
  taskStatusSchema,
  ulidSchema,
} from '@factory5/core';
import { z } from 'zod';

// -----------------------------------------------------------------------------
// task.started
// -----------------------------------------------------------------------------

/**
 * Emitted when `tasksInflight.register(...)` writes a fresh row in the
 * brain's pool. One event per task. The agent / category fields drive the
 * dashboard's per-row icon + colour treatment in the FE wiring (Step 3.2).
 */
export const taskStartedEventSchema = z.object({
  type: z.literal('task.started'),
  taskId: ulidSchema,
  directiveId: ulidSchema,
  title: z.string().min(1),
  agent: agentRoleSchema,
  category: modelCategorySchema,
  startedAt: z.string().datetime({ offset: true }),
});
export type TaskStartedEvent = z.infer<typeof taskStartedEventSchema>;

// -----------------------------------------------------------------------------
// task.completed
// -----------------------------------------------------------------------------

/**
 * Emitted when a task reaches a terminal state — either via
 * `tasksInflight.markComplete` (exit 0) or `markFailed` (non-zero) /
 * abort. `error` is the worker outcome's error string when present;
 * `null` on clean completion.
 */
export const taskCompletedEventSchema = z.object({
  type: z.literal('task.completed'),
  taskId: ulidSchema,
  directiveId: ulidSchema,
  status: taskStatusSchema,
  exitCode: z.number().int(),
  finishedAt: z.string().datetime({ offset: true }),
  error: z.string().nullable(),
});
export type TaskCompletedEvent = z.infer<typeof taskCompletedEventSchema>;

// -----------------------------------------------------------------------------
// finding.created
// -----------------------------------------------------------------------------

/**
 * Emitted once per finding registered for this directive. The
 * `directiveId` is the *origin* directive — re-raises by future
 * directives still emit on the origin's stream (subscribers to the
 * later directive don't see them). Brain emission is deferred in
 * Step 3.1; the FE refreshes findings on `task.completed` until then.
 */
export const findingCreatedEventSchema = z.object({
  type: z.literal('finding.created'),
  findingId: z.string().regex(/^F\d{3,}$/),
  directiveId: ulidSchema,
  severity: severitySchema,
  status: findingStatusSchema,
  source: agentRoleSchema,
  target: z.string().min(1),
  description: z.string().min(1),
  advisory: z.boolean(),
});
export type FindingCreatedEvent = z.infer<typeof findingCreatedEventSchema>;

// -----------------------------------------------------------------------------
// spend.updated
// -----------------------------------------------------------------------------

/**
 * Emitted after every `recordUsage(...)` in the brain's pool. The
 * rollup fields (`totalCostUsd`, `callCount`) are recomputed from the
 * canonical `model_usage` table; `deltaUsd` is the cost of the call
 * that triggered this emit so the FE can briefly highlight new charges.
 */
export const spendUpdatedEventSchema = z.object({
  type: z.literal('spend.updated'),
  directiveId: ulidSchema,
  totalCostUsd: z.number().nonnegative(),
  callCount: z.number().int().nonnegative(),
  deltaUsd: z.number().nonnegative(),
});
export type SpendUpdatedEvent = z.infer<typeof spendUpdatedEventSchema>;

// -----------------------------------------------------------------------------
// transcript.line
// -----------------------------------------------------------------------------

/**
 * Emitted on each raw NDJSON line the worker tees to the per-task
 * transcript file.  Fire-and-forget — no persistence to
 * `directive_log_lines`; the transcript file (via `GET .../transcript`)
 * is the durable store.  The FE uses `lineIndex` to detect gaps on
 * reconnect and falls back to a full transcript re-fetch.
 */
export const transcriptLineEventSchema = z.object({
  type: z.literal('transcript.line'),
  taskId: ulidSchema,
  directiveId: ulidSchema,
  line: z.unknown(),
  lineIndex: z.number().int().nonnegative(),
});
export type TranscriptLineEvent = z.infer<typeof transcriptLineEventSchema>;

// -----------------------------------------------------------------------------
// task.retried
// -----------------------------------------------------------------------------

/**
 * Emitted when an operator retries a failed task via `POST
 * /api/v1/directives/:directiveId/tasks/:taskId/retry`. The event carries
 * the retry mode (`resume` keeps the worktree; `clean` wipes it), the new
 * attempt counter, and the list of cascade-reset downstream tasks so the
 * FE can update their badge colours in-place without a full detail refetch.
 */
export const taskRetriedEventSchema = z.object({
  type: z.literal('task.retried'),
  taskId: ulidSchema,
  directiveId: ulidSchema,
  mode: z.enum(['resume', 'clean']),
  attempt: z.number().int().positive(),
  cascadeReset: z.array(ulidSchema),
});
export type TaskRetriedEvent = z.infer<typeof taskRetriedEventSchema>;

// -----------------------------------------------------------------------------
// log.line
// -----------------------------------------------------------------------------

/**
 * Selective forward of pino log lines tagged with this directive's
 * correlationId. `attrs` is the pino bindings/properties bag minus the
 * fields already captured (ts / level / component / msg). Forwarder
 * wiring is deferred in Step 3.1; only the schema ships now so 3.2 can
 * land emission without a schema change.
 */
export const logLineEventSchema = z.object({
  type: z.literal('log.line'),
  directiveId: ulidSchema,
  ts: z.string().datetime({ offset: true }),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
  component: z.string().min(1),
  msg: z.string(),
  attrs: z.record(z.unknown()).optional(),
});
export type LogLineEvent = z.infer<typeof logLineEventSchema>;

// -----------------------------------------------------------------------------
// pool.tally (Tier 15 / ADR 0034)
// -----------------------------------------------------------------------------

/**
 * Per-axis snapshot included in `pool.tally`. Matches `PoolAxisUsage` from
 * `@factory5/brain/pool-usage` (kept independently typed here so the IPC
 * surface doesn't take a brain dependency — the wire shape is the
 * canonical contract; both sides validate via this schema).
 */
export const poolAxisUsageWireSchema = z.object({
  used: z.number().nonnegative(),
  cap: z.number().nonnegative(),
  pct: z.number().min(0).max(100),
  tasks: z.array(
    z.object({
      taskId: ulidSchema,
      title: z.string(),
      agent: z.string(),
      contribution: z.number().nonnegative(),
    }),
  ),
  status: z.enum(['ok', 'warn', 'exhausted']),
});

/**
 * Structured parking reason emitted on `pool.tally` when the directive is
 * blocked with a `pool-exhausted` reason. Mirrors `ParkedReason` from
 * `@factory5/brain/pool-usage`.
 */
export const poolParkedReasonWireSchema = z.object({
  axis: z.string(),
  usedAtPark: z.number().nonnegative(),
  capAtPark: z.number().nonnegative(),
  nextBumpTo: z.number().nonnegative(),
});

/**
 * Emitted after every task settles. Carries the post-task per-axis usage
 * snapshot so the FE Live tab can update without an HTTP round-trip. ADR
 * 0034 §6 — the canonical mechanism by which the FE learns that a
 * directive parked (the structured `parkedReason` field fires when the
 * pool dispatcher flips the directive to blocked).
 */
export const poolTallyEventSchema = z.object({
  type: z.literal('pool.tally'),
  directiveId: ulidSchema,
  perAxis: z.record(poolAxisUsageWireSchema),
  parkedReason: poolParkedReasonWireSchema.optional(),
});
export type PoolTallyEvent = z.infer<typeof poolTallyEventSchema>;

// -----------------------------------------------------------------------------
// directive.completed
// -----------------------------------------------------------------------------

/**
 * Emitted exactly once per directive run, after `loop.runInline` (or the
 * serve loop's per-directive runner) sets a terminal status. The SSE
 * handler closes the response stream after forwarding this event;
 * subsequent reconnects on the same directive return immediately with a
 * synthesized `directive.completed` from the backfill path.
 *
 * `blockedReason` mirrors `directives.blocked_reason` and is non-null
 * for `blocked` outcomes plus `failed` outcomes produced by
 * `factory cancel` (Phase 2.4 stamps `blocked_reason='cancelled'`).
 */
export const directiveCompletedEventSchema = z.object({
  type: z.literal('directive.completed'),
  directiveId: ulidSchema,
  status: directiveStatusSchema,
  /**
   * Raw, un-parsed `directives.blocked_reason` string as stored in the DB
   * — a *serialized JSON string* on this SSE channel, NOT the structured
   * union the directive-detail HTTP endpoint exposes as
   * `directiveBlockedReason`. Latent contract drift: the two surfaces carry
   * the same datum in different shapes. A consumer that needs the
   * structured reason must `JSON.parse` this string itself (and tolerate a
   * bare token like `'cancelled'`), or read the detail endpoint instead of
   * relying on this field.
   */
  blockedReason: z.string().nullable(),
});
export type DirectiveCompletedEvent = z.infer<typeof directiveCompletedEventSchema>;

// -----------------------------------------------------------------------------
// Discriminated union — one type to rule them all
// -----------------------------------------------------------------------------

/**
 * Discriminated union over every directive-stream event the SSE route
 * forwards. Producers (`hub.emit`, brain emit helper) and consumers
 * (browser EventSource wrapper) both pin to this union for type
 * coverage; adding a new event type and forgetting to update one side
 * surfaces as a TypeScript error.
 */
export const directiveStreamEventSchema = z.discriminatedUnion('type', [
  taskStartedEventSchema,
  taskCompletedEventSchema,
  taskRetriedEventSchema,
  findingCreatedEventSchema,
  spendUpdatedEventSchema,
  transcriptLineEventSchema,
  logLineEventSchema,
  poolTallyEventSchema,
  directiveCompletedEventSchema,
]);
export type DirectiveStreamEvent = z.infer<typeof directiveStreamEventSchema>;

/**
 * Callback signature plumbed into `BrainOptions.emitDirectiveEvent`.
 * Brain code calls this at every state transition; daemon's brain-
 * supervisor wires it to `hub.emit(event)`. Inline brain runs (no
 * daemon) leave it unset — emit calls are silently no-op.
 *
 * Synchronous return — emission is fire-and-forget; the brain never
 * awaits the SSE plumbing. The hub itself dispatches synchronously
 * so a slow subscriber can't backpressure the brain.
 */
export type DirectiveEventEmitter = (event: DirectiveStreamEvent) => void;

/**
 * Convenience extractor for the discriminator key. Useful in switch
 * statements that want exhaustive coverage:
 *
 * ```ts
 * function handle(event: DirectiveStreamEvent): void {
 *   switch (event.type) {
 *     case 'task.started':    // ...
 *     case 'task.completed':  // ...
 *     // ...
 *   }
 * }
 * ```
 */
export type DirectiveStreamEventType = DirectiveStreamEvent['type'];
