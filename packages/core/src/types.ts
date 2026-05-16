/**
 * TypeScript types — derived from Zod schemas in `schemas.ts`.
 *
 * Always use `z.infer<typeof X>` to prevent drift between runtime validation
 * and compile-time types. Never write a parallel TypeScript type for something
 * that has a schema.
 */

import type { z } from 'zod';

import type {
  agentRoleSchema,
  autonomyModeSchema,
  channelIdSchema,
  directiveLimitsSchema,
  directiveLogLineInputSchema,
  directiveLogLineSchema,
  directiveSchema,
  directiveStatusSchema,
  eventBodySchema,
  eventSchema,
  findingSchema,
  findingStatusSchema,
  intentSchema,
  modelCategorySchema,
  outboundMessageSchema,
  pendingQuestionSchema,
  planSchema,
  planStatusSchema,
  projectSchema,
  severitySchema,
  taskResultSchema,
  taskSchema,
  taskStatusSchema,
} from './schemas.js';

// -----------------------------------------------------------------------------
// Primitives
// -----------------------------------------------------------------------------

export type ChannelId = z.infer<typeof channelIdSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type AutonomyMode = z.infer<typeof autonomyModeSchema>;
export type DirectiveStatus = z.infer<typeof directiveStatusSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type FindingStatus = z.infer<typeof findingStatusSchema>;
export type PlanStatus = z.infer<typeof planStatusSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type AgentRole = z.infer<typeof agentRoleSchema>;
export type ModelCategory = z.infer<typeof modelCategorySchema>;

// -----------------------------------------------------------------------------
// Composite shapes
// -----------------------------------------------------------------------------

export type Directive = z.infer<typeof directiveSchema>;
export type DirectiveLimits = z.infer<typeof directiveLimitsSchema>;
export type EventBody = z.infer<typeof eventBodySchema>;
export type Event = z.infer<typeof eventSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type TaskResult = z.infer<typeof taskResultSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Plan = z.infer<typeof planSchema>;
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;
export type PendingQuestion = z.infer<typeof pendingQuestionSchema>;
export type Project = z.infer<typeof projectSchema>;
export type DirectiveLogLine = z.infer<typeof directiveLogLineSchema>;
export type DirectiveLogLineInput = z.infer<typeof directiveLogLineInputSchema>;
