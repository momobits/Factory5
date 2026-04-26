/**
 * @factory5/state — SQLite-backed runtime state for factory5.
 *
 * @packageDocumentation
 */

export { openDatabase, closeDatabase, defaultDbPath } from './db.js';
export type { Database } from './db.js';

export { runMigrations, currentSchemaVersion } from './migrations/index.js';

// Per-table query helpers
export * as directives from './queries/directives.js';
export { MarkBlockedError } from './queries/directives.js';
export * as events from './queries/events.js';
export * as outbound from './queries/outbound.js';
export * as sessions from './queries/sessions.js';
export * as pendingQuestions from './queries/pending-questions.js';
export * as tasksInflight from './queries/tasks-inflight.js';
export type { InflightTask } from './queries/tasks-inflight.js';
export * as projects from './queries/projects.js';
export * as learnings from './queries/learnings.js';
export * as modelUsage from './queries/model-usage.js';
export type { UsageMode, UsageRecord } from './queries/model-usage.js';
export * as findingsRegistry from './queries/findings-registry.js';
export type {
  FindingsRegistryUpsertInput,
  ListFilter as FindingsRegistryListFilter,
  RegistryEntry as FindingsRegistryEntry,
} from './queries/findings-registry.js';
export * as spend from './queries/spend.js';
export type {
  SpendFilter,
  PerProjectSpend,
  PerDirectiveSpend,
  PerDaySpend,
  PerModelSpend,
} from './queries/spend.js';
