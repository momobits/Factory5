/**
 * Literal sets used across the codebase. Kept here so schemas, types, and
 * runtime checks all reference the same source.
 */

/** All channels factory can ingest from / reply to. */
export const CHANNEL_IDS = ['cli', 'discord', 'telegram', 'github', 'webhook'] as const;

/** All intents the triage agent can classify a directive into. */
export const INTENTS = [
  'build',
  'fix',
  'review',
  'investigate',
  'chat',
  'status',
  'resume',
  'cancel',
] as const;

/** Autonomy modes — how much human-in-the-loop the brain expects. */
export const AUTONOMY_MODES = ['chat', 'assisted', 'autonomous'] as const;

/** Directive lifecycle status. */
export const DIRECTIVE_STATUSES = [
  'pending',
  'claimed',
  'running',
  'blocked',
  'complete',
  'failed',
] as const;

/** Finding severity. Ordering: LOW < MEDIUM < HIGH < CRITICAL. */
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/** Finding lifecycle status. */
export const FINDING_STATUSES = ['OPEN', 'FIXED', 'VERIFIED', 'WONTFIX'] as const;

/** Plan lifecycle status. */
export const PLAN_STATUSES = ['draft', 'active', 'complete', 'abandoned'] as const;

/** Task lifecycle status. */
export const TASK_STATUSES = ['pending', 'running', 'complete', 'failed', 'blocked'] as const;

/** Agent roles in the build pipeline. */
export const AGENT_ROLES = [
  'triage',
  'architect',
  'planner',
  'scaffolder',
  'builder',
  'reviewer',
  'fixer',
  'investigator',
  'verifier',
] as const;

/**
 * Model categories — declarative routing. Agents declare a category;
 * the provider layer resolves category → provider+model via user config.
 * See ADR 0004.
 */
export const MODEL_CATEGORIES = [
  'quick',
  'planning',
  'reasoning',
  'deep',
  'documentation',
] as const;

/** Default port the daemon listens on for IPC. Override via env `FACTORY5_DAEMON_PORT`. */
export const DEFAULT_DAEMON_PORT = 25295;

/** Default daemon bind address. Override via env `FACTORY5_DAEMON_HOST`. */
export const DEFAULT_DAEMON_HOST = '127.0.0.1';
