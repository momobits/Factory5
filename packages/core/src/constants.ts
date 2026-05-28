/**
 * Literal sets used across the codebase. Kept here so schemas, types, and
 * runtime checks all reference the same source.
 */

/**
 * All channels factory can ingest from / reply to.
 *
 * `telegram` is forward-declared for Phase 7c; `discord` ships today; `cli`
 * is the default. `github` and `webhook` were retired by ADR 0019 — see
 * that ADR for the rationale and for the durable doctrine that factory's
 * side-effects in the world are operator-directed per-directive, not
 * pattern-driven.
 */
export const CHANNEL_IDS = ['cli', 'discord', 'telegram'] as const;

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
export const TASK_STATUSES = [
  'pending',
  'running',
  'complete',
  'failed',
  'blocked',
  // ADR 0024 §4 — task is paused inside a worker subprocess waiting for the
  // operator to answer an `ask_user` question. Distinct from `blocked`
  // (which is a directive-wide halt); this is a per-task pause that flips
  // back to `running` once the answer arrives.
  'waiting_for_human',
  // ADR 0024 §4 — task halted by an external event (brain restart while
  // it was waiting on a human, signal, etc.). Distinct from `failed` (which
  // implies the task itself produced bad output); `aborted` is "not the
  // task's fault, but it didn't finish either."
  'aborted',
] as const;

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
  'critic',
  'coherence-reviewer',
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

/**
 * Capability ranking over {@link MODEL_CATEGORIES}. Higher = more capable.
 *
 * Used by the planner to clamp tool-using agents against their agent-registry
 * floor (a `builder` task the LLM labelled `quick` is upgraded to the agent's
 * declared minimum). See ADR 0016.
 *
 * `quick` and `documentation` are both cheap/Haiku-class; `planning` is
 * Sonnet-class; `reasoning` and `deep` are both Opus-class. Ties are broken
 * by string equality (max(a, b) prefers `a` when ranks match), so the callers
 * that want a specific disambiguation must pass categories in the right order.
 */
export const MODEL_CATEGORY_RANKS: Readonly<Record<(typeof MODEL_CATEGORIES)[number], number>> = {
  quick: 0,
  documentation: 0,
  planning: 1,
  reasoning: 2,
  deep: 2,
};

/** Default port the daemon listens on for IPC. Override via env `FACTORY5_DAEMON_PORT`. */
export const DEFAULT_DAEMON_PORT = 25295;

/** Default daemon bind address. Override via env `FACTORY5_DAEMON_HOST`. */
export const DEFAULT_DAEMON_HOST = '127.0.0.1';
