/**
 * Parallel task executor for the brain's inline pipeline.
 *
 * Given a {@link Plan} whose tasks have already been topologically ordered
 * (via {@link topoSortTasks}), this pool schedules independent ready-tasks
 * concurrently up to a configured limit, maintains `tasks_inflight` rows
 * with periodic heartbeats so stuck workers can be reaped by a future
 * supervisor, and respects an {@link AbortSignal} for graceful shutdown.
 *
 * Read-only agents (triage/architect/planner/reviewer/investigator/verifier)
 * make a single provider.call(); tool-using agents (scaffolder/builder/fixer)
 * spawn a subprocess inside a per-task worktree and stream. Both paths go
 * through `@factory5/worker/runWorker`; the pool is agnostic to which
 * variant the worker picks.
 *
 * Tier 15 / ADR 0034 — the per-task `error_max_turns` retry loop is GONE.
 * The dispatcher now derives live pool usage via `computePoolUsage` before
 * each launch and on every stream chunk via the worker's `onTurnComplete`
 * watchdog. When a tool-using agent's axis pool is exhausted, the directive
 * parks with a structured `blockedReason` (no askUser) and the `pool-resume`
 * watcher flips it back to running when the operator raises the cap on the
 * project page. When `autoIncreaseBudgets` is enabled, the dispatcher
 * auto-bumps the project default by one increment up to a safety ceiling
 * (`autoIncreaseCeilingMultiplier × projectDefault`) before parking.
 *
 * @packageDocumentation
 */

import { cpus } from 'node:os';
import { env } from 'node:process';

import type { Finding, Plan, Task, TaskResult } from '@factory5/core';
import {
  BUDGET_DEFAULTS,
  axisForAgent,
  type BudgetAxis,
  type MaxTurnsAxis,
} from '@factory5/core/budgets';
import { createLogger } from '@factory5/logger';
import type { DirectiveEventEmitter } from '@factory5/ipc';
import type { ProviderRegistry } from '@factory5/providers';
import {
  directives as directivesQ,
  modelUsage,
  tasksInflight,
  type Database,
  type UsageMode,
} from '@factory5/state';
import {
  listFindings,
  loadOrCreateProjectMetadata,
  updateProjectMetadata,
  writePlan,
  type ProjectMetadata,
} from '@factory5/wiki';
import {
  isToolUsingAgent,
  runWorker,
  type WorkerAskUserConfig,
  type WorkerOutcome,
} from '@factory5/worker';

import { computePoolUsage, resolveEffectiveCap, type ProjectBudgetsLike } from './pool-usage.js';
import { loadDaemonEndpoint } from './daemon-endpoint.js';
import { emitLogLine } from './emit.js';
import { buildAgentSystemPrompt } from './prompts.js';
import { recordUsage } from './usage.js';

const log = createLogger('brain.pool');

/** How often to refresh `tasks_inflight.last_heartbeat` while a task is running. */
const HEARTBEAT_INTERVAL_MS = 10_000;

export interface TaskOutcome {
  taskId: string;
  exitCode: number;
  error?: string;
  findingsRaised: string[];
  filesChanged: string[];
}

export interface PoolOptions {
  plan: Plan;
  registry: ProviderRegistry;
  db: Database;
  directiveId: string;
  /** Max concurrent workers. Defaults to `min(4, cpuCount)`. Floors to 1. */
  concurrency?: number;
  signal?: AbortSignal;
  /**
   * Per-directive SSE event emitter. When set, the pool emits
   * `task.started`, `task.completed`, `spend.updated`, and `pool.tally`
   * events at task lifecycle / usage transitions. Inline-only runs
   * (no daemon) leave it unset and the calls are silent no-op.
   */
  emitDirectiveEvent?: DirectiveEventEmitter;
}

/**
 * Map an agent's invocation mode. Read-only agents go through
 * `provider.call()`; the three tool-using agents spawn a `stream()`
 * subprocess. {@link isToolUsingAgent} from `@factory5/worker` is the
 * single source of truth for the split.
 */
function agentMode(agent: Task['agent']): UsageMode {
  return isToolUsingAgent(agent) ? 'stream' : 'call';
}

export function defaultConcurrency(): number {
  const n = Math.max(1, cpus().length);
  return Math.min(4, n);
}

/**
 * Emit a `finding.created` event for SSE subscribers. One call per finding
 * raised by a task; the canonical source of truth is the per-project
 * `findings.json`, so the caller passes a fully-loaded {@link Finding}
 * rather than a bare id (separates I/O from emission and lets a single
 * `listFindings(projectPath)` per task feed every emit).
 *
 * Same fire-and-forget shape as `emitLogLine` / `emitDirectiveCompleted`
 * in `loop.ts`: silent when no emitter is wired, never throws, never
 * awaits the SSE consumer.
 *
 * Exported for direct unit testing (see `pool.test.ts`); the integration
 * call site is in {@link executeTask} after the `task.completed` emit.
 */
export function emitFindingCreated(
  emit: DirectiveEventEmitter | undefined,
  directiveId: string,
  finding: Finding,
): void {
  if (emit === undefined) return;
  emit({
    type: 'finding.created',
    findingId: finding.id,
    directiveId,
    severity: finding.severity,
    status: finding.status,
    source: finding.source,
    target: finding.target,
    description: finding.description,
    advisory: finding.advisory === true,
  });
}

/**
 * Topologically sort tasks so each task comes after all of its dependencies.
 * Exported so callers (and the pool) share the same ordering logic and the
 * same cycle-detection error.
 */
export function topoSortTasks(tasks: readonly Task[]): Task[] {
  const byId = new Map<string, Task>();
  for (const t of tasks) byId.set(t.id, t);
  const order: Task[] = [];
  const visited = new Set<string>();
  const temp = new Set<string>();

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (temp.has(id)) throw new Error(`plan has a dependency cycle at task ${id}`);
    const t = byId.get(id);
    if (t === undefined) return;
    temp.add(id);
    for (const dep of t.dependsOn) visit(dep);
    temp.delete(id);
    visited.add(id);
    order.push(t);
  };

  for (const t of tasks) visit(t.id);
  return order;
}

interface RunningEntry {
  id: string;
  promise: Promise<{ id: string; outcome: WorkerOutcome; task: Task }>;
}

// ---------------------------------------------------------------------------
// Pool dispatcher helpers (Tier 15 / ADR 0034)
// ---------------------------------------------------------------------------

/**
 * Load the project's budget configuration (defaults + auto-increase policy)
 * from `<projectPath>/.factory/project.json`. Failure to read the file
 * (corrupt or absent) falls back to an empty config — the dispatcher's
 * cap resolution then drops through to {@link BUDGET_DEFAULTS}.
 */
async function loadProjectBudgets(projectPath: string): Promise<ProjectBudgetsLike> {
  try {
    const metadata = await loadOrCreateProjectMetadata(projectPath, '');
    return projectBudgetsFromMetadata(metadata);
  } catch (err) {
    log.warn(
      { err, projectPath },
      'pool: failed to load project.json — falling back to BUDGET_DEFAULTS',
    );
    return { budgetDefaults: {} };
  }
}

/** Pure transform — extract a {@link ProjectBudgetsLike} from raw metadata. */
function projectBudgetsFromMetadata(metadata: ProjectMetadata): ProjectBudgetsLike {
  const rawBudgetDefaults = metadata.metadata['budgetDefaults'];
  const budgetDefaults: Partial<Record<BudgetAxis, number>> = isRecord(rawBudgetDefaults)
    ? (rawBudgetDefaults as Partial<Record<BudgetAxis, number>>)
    : {};
  const autoIncreaseBudgets =
    typeof metadata.metadata['autoIncreaseBudgets'] === 'boolean'
      ? metadata.metadata['autoIncreaseBudgets']
      : undefined;
  const autoIncreaseCeilingMultiplier =
    typeof metadata.metadata['autoIncreaseCeilingMultiplier'] === 'number'
      ? metadata.metadata['autoIncreaseCeilingMultiplier']
      : undefined;
  return {
    budgetDefaults,
    ...(autoIncreaseBudgets !== undefined ? { autoIncreaseBudgets } : {}),
    ...(autoIncreaseCeilingMultiplier !== undefined ? { autoIncreaseCeilingMultiplier } : {}),
  };
}

/** Type-guard: `value` is a non-null `Record<string, unknown>`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Feature F2 — extract payload budgets from a directive's `payload_json`.
 * Used by the `maxUsdPerTask` pre-launch check to feed `resolveEffectiveCap`.
 */
function payloadBudgets(db: Database, directiveId: string): Partial<Record<BudgetAxis, number>> {
  const row = db.prepare(`SELECT payload_json FROM directives WHERE id = ?`).get(directiveId) as
    | { payload_json: string }
    | undefined;
  if (row === undefined) return {};
  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (isRecord(parsed) && isRecord(parsed['budgets'])) {
      return parsed['budgets'] as Partial<Record<BudgetAxis, number>>;
    }
  } catch {
    // Corrupt payload — fall through to empty.
  }
  return {};
}

/**
 * Write a new cap value to `<projectPath>/.factory/project.json`'s
 * `metadata.budgetDefaults[axis]` slot. Read-modify-write via
 * {@link updateProjectMetadata}; preserves every other key in `metadata`.
 *
 * Exported for the auto-increase path in {@link parkOrAutoIncrease}; the
 * `pool-resume` watcher will see the write and re-claim the directive.
 */
export async function bumpProjectCap(
  projectPath: string,
  axis: MaxTurnsAxis,
  newCap: number,
): Promise<void> {
  await updateProjectMetadata(projectPath, (meta) => {
    const existingBudgets = isRecord(meta.metadata['budgetDefaults'])
      ? { ...(meta.metadata['budgetDefaults'] as Record<string, unknown>) }
      : {};
    existingBudgets[axis] = newCap;
    return {
      ...meta,
      metadata: {
        ...meta.metadata,
        budgetDefaults: existingBudgets,
      },
    };
  });
}

export interface ParkOrAutoIncreaseOptions {
  db: Database;
  directiveId: string;
  projectPath: string;
  axis: MaxTurnsAxis;
  /** Current pool snapshot computed by the caller (avoids a duplicate query). */
  pool: { perAxis: Record<BudgetAxis, { used: number; cap: number }> };
  projectBudgets: ProjectBudgetsLike;
  emit?: DirectiveEventEmitter;
}

/**
 * The outcome of one {@link parkOrAutoIncrease} call:
 *   - `bumped` — the project default was raised; caller should re-attempt
 *     the executeTask invocation (the project now has more headroom).
 *   - `parked` — the directive was flipped to `blocked` with a structured
 *     `pool-exhausted` reason; caller returns a failed TaskResult and lets
 *     the pool-resume watcher re-enqueue the directive when the operator
 *     raises the cap.
 */
export type ParkOrAutoIncreaseResult =
  | { kind: 'bumped'; newCap: number; oldCap: number }
  | { kind: 'parked'; capAtPark: number; usedAtPark: number };

/** Default ceiling multiplier when `autoIncreaseCeilingMultiplier` is unset (ADR 0034 §5). */
const DEFAULT_CEILING_MULTIPLIER = 5;

/**
 * Tier 15 / ADR 0034 — when a tool-using task can't dispatch because its
 * `maxTurns*` axis pool is exhausted, either:
 *
 *   1. Auto-increase: raise the project default by one `BUDGET_DEFAULTS`
 *      increment if `autoIncreaseBudgets === true` AND the current cap is
 *      still under the safety ceiling
 *      (`projectCap × autoIncreaseCeilingMultiplier`). Returns `'bumped'`.
 *   2. Park: flip the directive to `'blocked'` with a structured
 *      `pool-exhausted` reason. The `pool-resume` watcher (in serve mode)
 *      re-claims it when the operator raises the cap on the project page.
 *      Returns `'parked'`.
 */
export async function parkOrAutoIncrease(
  opts: ParkOrAutoIncreaseOptions,
): Promise<ParkOrAutoIncreaseResult> {
  const { db, directiveId, projectPath, axis, pool, projectBudgets, emit } = opts;
  const defaultDelta = BUDGET_DEFAULTS[axis].value;
  const projectCap = projectBudgets.budgetDefaults[axis] ?? defaultDelta;
  const ceilingMultiplier =
    projectBudgets.autoIncreaseCeilingMultiplier ?? DEFAULT_CEILING_MULTIPLIER;
  const ceiling = projectCap * ceilingMultiplier;
  const currentCap = pool.perAxis[axis].cap;
  const usedAtPark = pool.perAxis[axis].used;

  if (projectBudgets.autoIncreaseBudgets === true && currentCap < ceiling) {
    const newCap = currentCap + defaultDelta;
    try {
      await bumpProjectCap(projectPath, axis, newCap);
    } catch (err) {
      log.warn(
        { err, projectPath, axis, newCap, currentCap },
        'pool: bumpProjectCap failed — parking directive instead',
      );
      // Fall through to the park path below.
    }
    if (newCap > currentCap) {
      emitLogLine(
        emit,
        directiveId,
        'info',
        'brain.pool',
        `pool: auto-bumped ${axis} to ${String(newCap)} (was ${String(currentCap)})`,
        { axis, oldCap: currentCap, newCap },
      );
      return { kind: 'bumped', newCap, oldCap: currentCap };
    }
  }

  const blockedReason = JSON.stringify({
    kind: 'pool-exhausted',
    axis,
    usedAtPark,
    capAtPark: currentCap,
  });
  db.prepare(`UPDATE directives SET status = 'blocked', blocked_reason = ? WHERE id = ?`).run(
    blockedReason,
    directiveId,
  );
  emitLogLine(
    emit,
    directiveId,
    'warn',
    'brain.pool',
    `pool: ${axis} exhausted at ${String(currentCap)} — directive parked; raise cap on project page to resume`,
    { axis, capAtPark: currentCap, usedAtPark, nextBumpTo: currentCap + defaultDelta },
  );
  return { kind: 'parked', capAtPark: currentCap, usedAtPark };
}

/**
 * Emit the `pool.tally` SSE event after each task settles. Carries the
 * post-task per-axis usage snapshot so the FE Live tab can update without
 * an HTTP round-trip.
 */
function emitPoolTally(
  emit: DirectiveEventEmitter | undefined,
  directiveId: string,
  pool: ReturnType<typeof computePoolUsage>,
): void {
  if (emit === undefined) return;
  emit({
    type: 'pool.tally',
    directiveId,
    perAxis: pool.perAxis,
    ...(pool.parkedReason !== undefined ? { parkedReason: pool.parkedReason } : {}),
  });
}

/**
 * Synthesize a failed-TaskResult for a task that never launched because
 * the pool was exhausted. The `pool-exhausted` errorSubtype lets the
 * downstream pool loop tell "blocked because we parked" from "blocked
 * because of upstream failure".
 */
function synthesizePoolExhaustedResult(axis: MaxTurnsAxis, capAtPark: number): TaskResult {
  return {
    exitCode: 1,
    filesChanged: [],
    findingsRaised: [],
    signalsEmitted: [],
    error: `pool exhausted on ${axis} at cap ${String(capAtPark)} — directive parked`,
    errorSubtype: 'pool-exhausted',
    durationMs: 0,
  };
}

// ---------------------------------------------------------------------------
// executeTask — the per-task entry point
// ---------------------------------------------------------------------------

/**
 * Execute one task end-to-end: register it as inflight, run the worker with
 * heartbeats + pool watchdog, then mark it complete or failed. Returns the
 * {@link WorkerOutcome} along with the (updated) task so the pool can
 * persist plan.json.
 *
 * Tier 15 / ADR 0034 dispatcher:
 *   1. Load project budgets + payload budgets via {@link computePoolUsage}.
 *   2. Pre-launch check: if the task's `maxTurns*` axis pool is exhausted,
 *      call {@link parkOrAutoIncrease}. On `'bumped'`, re-enter via
 *      recursion to re-compute pool. On `'parked'`, return synthesized
 *      failed TaskResult.
 *   3. Run the worker with `onTurnComplete` watchdog that re-checks pool
 *      after each stream chunk and aborts mid-stream on cap-cross.
 *   4. Emit `pool.tally` post-task so the FE Live tab updates.
 */
async function executeTask(
  task: Task,
  plan: Plan,
  registry: ProviderRegistry,
  db: Database,
  directiveId: string,
  signal?: AbortSignal,
  emit?: DirectiveEventEmitter,
): Promise<{ id: string; outcome: WorkerOutcome; task: Task }> {
  return executeTaskWithBudgetGuard(
    task,
    plan,
    registry,
    db,
    directiveId,
    signal,
    emit,
    /* autoBumpDepth */ 0,
  );
}

/**
 * Safety cap on consecutive auto-bump recursions inside a single
 * `executeTask` invocation. Each auto-bump raises `project.json` by one
 * default increment; the next call's cap-resolution rule sees the new
 * value and tries again. The ceiling-multiplier check in
 * {@link parkOrAutoIncrease} bounds the bump series naturally, but this
 * cap is the belt-and-suspenders against a degenerate case (e.g. ceiling
 * never reachable due to a write failure).
 */
const MAX_AUTO_BUMP_DEPTH = 16;

async function executeTaskWithBudgetGuard(
  task: Task,
  plan: Plan,
  registry: ProviderRegistry,
  db: Database,
  directiveId: string,
  signal: AbortSignal | undefined,
  emit: DirectiveEventEmitter | undefined,
  autoBumpDepth: number,
): Promise<{ id: string; outcome: WorkerOutcome; task: Task }> {
  const systemPrompt = await buildAgentSystemPrompt(task.agent);
  const userPrompt = [
    `Task: ${task.title}`,
    '',
    `Context: ${task.inputs.context}`,
    `Inputs (files): ${JSON.stringify(task.inputs.files)}`,
    `Expected outputs (files): ${JSON.stringify(task.expectedOutputs.files)}`,
    `Expected signals: ${JSON.stringify(task.expectedOutputs.signals)}`,
  ].join('\n');

  const now = (): string => new Date().toISOString();
  const startedAt = now();
  tasksInflight.register(db, {
    id: task.id,
    directiveId,
    planId: plan.id,
    title: task.title,
    agent: task.agent,
    category: task.category,
    status: 'running',
    attempts: task.attempts + 1,
    startedAt,
    lastHeartbeat: startedAt,
  });
  emit?.({
    type: 'task.started',
    taskId: task.id,
    directiveId,
    title: task.title,
    agent: task.agent,
    category: task.category,
    startedAt,
  });

  const hb = setInterval(() => {
    try {
      tasksInflight.heartbeat(db, task.id, now());
    } catch (err) {
      log.warn({ err, taskId: task.id }, 'pool: heartbeat write failed');
    }
  }, HEARTBEAT_INTERVAL_MS);

  log.info({ taskId: task.id, agent: task.agent, category: task.category }, 'pool: task started');

  // Resolve the directive + projectId for downstream wiring.
  const directive = directivesQ.getById(db, directiveId);
  const projectId = directive?.projectId;
  const projectPath = plan.projectPath;

  // Per ADR 0024 sub-step 8.3: build askUserConfig when the daemon is
  // running with a worker auth token; skipped silently for tests / standalone
  // scripts.
  const askUserConfig = isToolUsingAgent(task.agent)
    ? await buildAskUserConfig(directiveId)
    : undefined;

  // Tier 15 / ADR 0034 — pre-launch pool check for tool-using agents.
  // Read-only agents skip the check entirely (no maxTurns axis applies).
  const axis = axisForAgent(task.agent);
  const projectBudgets: ProjectBudgetsLike = await loadProjectBudgets(projectPath);
  let outcome: WorkerOutcome;

  // Feature F2 / Relay issue #1 — maxUsdPerTask resurrection. Per-task safety:
  // if the planner emitted an `estimatedUsd` for this task, check it against
  // the unified resolution of `maxUsdPerTask`. Task FAILS immediately (not
  // directive parks) when the estimate exceeds the cap. When `estimatedUsd` is
  // undefined (planner didn't emit it) or cap is 0 (unlimited), the check is
  // a no-op.
  const maxUsdPerTaskCap = resolveEffectiveCap(
    'maxUsdPerTask',
    projectBudgets,
    payloadBudgets(db, directiveId),
  );
  if (
    maxUsdPerTaskCap > 0 &&
    task.estimatedUsd !== undefined &&
    task.estimatedUsd > maxUsdPerTaskCap
  ) {
    clearInterval(hb);
    const result: TaskResult = {
      exitCode: 1,
      filesChanged: [],
      findingsRaised: [],
      signalsEmitted: [],
      error: `Task "${task.title}" estimated $${String(task.estimatedUsd)} exceeds maxUsdPerTask cap $${String(maxUsdPerTaskCap)}`,
      errorSubtype: 'per-task-usd-exceeded',
      durationMs: 0,
    };
    tasksInflight.markFailed(db, task.id, result, now());
    emit?.({
      type: 'task.completed',
      taskId: task.id,
      directiveId,
      status: 'failed',
      exitCode: result.exitCode,
      finishedAt: now(),
      error: result.error ?? null,
    });
    outcome = { result };
    const updatedTask: Task = {
      ...task,
      status: 'failed',
      attempts: task.attempts + 1,
      result,
    };
    return { id: task.id, outcome, task: updatedTask };
  }

  if (axis !== undefined) {
    const preLaunchPool = computePoolUsage(db, directiveId, projectBudgets);
    const axisPre = preLaunchPool.perAxis[axis];

    if (axisPre.used >= axisPre.cap) {
      // Pool exhausted before we even launch. Park-or-bump and either
      // re-enter (on bump) or return synthesized failure (on park).
      clearInterval(hb);
      const decision = await parkOrAutoIncrease({
        db,
        directiveId,
        projectPath,
        axis,
        pool: { perAxis: preLaunchPool.perAxis },
        projectBudgets,
        ...(emit !== undefined ? { emit } : {}),
      });
      if (decision.kind === 'bumped' && autoBumpDepth < MAX_AUTO_BUMP_DEPTH) {
        // Re-enter: with the new cap, the pool may now have headroom.
        // The prior `register` call left a row in tasks_inflight (status
        // 'running'). We mark it failed first so the audit trail is clean,
        // then delete the row so the next `register` (plain INSERT) does not
        // hit a UNIQUE constraint on task.id.
        tasksInflight.markFailed(
          db,
          task.id,
          synthesizePoolExhaustedResult(axis, decision.oldCap),
          now(),
        );
        tasksInflight.deleteById(db, task.id);
        // Recurse — fresh register on the new attempt.
        return executeTaskWithBudgetGuard(
          task,
          plan,
          registry,
          db,
          directiveId,
          signal,
          emit,
          autoBumpDepth + 1,
        );
      }
      // Parked (or hit recursion safety cap). Synthesize failed result.
      const capAtPark = decision.kind === 'parked' ? decision.capAtPark : axisPre.cap;
      const result = synthesizePoolExhaustedResult(axis, capAtPark);
      tasksInflight.markFailed(db, task.id, result, now());
      emit?.({
        type: 'task.completed',
        taskId: task.id,
        directiveId,
        status: 'failed',
        exitCode: result.exitCode,
        finishedAt: now(),
        error: result.error ?? null,
      });
      // Emit final tally so the FE reflects the parked state.
      try {
        const postPool = computePoolUsage(db, directiveId, projectBudgets);
        emitPoolTally(emit, directiveId, postPool);
      } catch (err) {
        log.warn(
          { err, directiveId },
          'pool: post-park computePoolUsage failed — tally emit skipped',
        );
      }
      outcome = { result };
      const updatedTask: Task = {
        ...task,
        status: 'failed',
        attempts: task.attempts + 1,
        result,
      };
      return { id: task.id, outcome, task: updatedTask };
    }
  }

  // Build the watchdog callback for tool-using agents. Pure no-op for
  // read-only agents — they don't stream, so `runWorker` never calls it.
  const onTurnComplete =
    axis !== undefined
      ? (): { interrupt: boolean } => {
          try {
            const live = computePoolUsage(db, directiveId, projectBudgets);
            const axisLive = live.perAxis[axis];
            return { interrupt: axisLive.used >= axisLive.cap };
          } catch (err) {
            log.warn(
              { err, taskId: task.id, axis },
              'pool: watchdog computePoolUsage threw — letting stream continue',
            );
            return { interrupt: false };
          }
        }
      : undefined;

  try {
    outcome = await runWorker({
      task,
      projectPath,
      registry,
      systemPrompt,
      userPrompt,
      findingRegistry: {
        db,
        ...(projectId !== undefined ? { projectId } : {}),
        originDirectiveId: directiveId,
      },
      ...(askUserConfig !== undefined ? { askUserConfig } : {}),
      ...(signal !== undefined ? { signal } : {}),
      ...(onTurnComplete !== undefined ? { onTurnComplete } : {}),
    });
  } finally {
    clearInterval(hb);
  }

  // Tier 15 / ADR 0034 — when the watchdog interrupted mid-stream, the
  // worker tagged the outcome with `errorSubtype: 'pool-exhausted-midstream'`.
  // Park the directive (auto-bump path is intentionally not taken here —
  // mid-stream interrupts mean the agent burned through the entire
  // already-bumped cap inside one task; a further bump-and-retry would just
  // burn the same budget again. Park, let the operator triage).
  if (
    outcome.result.errorSubtype === 'pool-exhausted-midstream' &&
    axis !== undefined &&
    signal?.aborted !== true
  ) {
    try {
      const postPool = computePoolUsage(db, directiveId, projectBudgets);
      const blockedReason = JSON.stringify({
        kind: 'pool-exhausted',
        axis,
        usedAtPark: postPool.perAxis[axis].used,
        capAtPark: postPool.perAxis[axis].cap,
      });
      db.prepare(`UPDATE directives SET status = 'blocked', blocked_reason = ? WHERE id = ?`).run(
        blockedReason,
        directiveId,
      );
      emitLogLine(
        emit,
        directiveId,
        'warn',
        'brain.pool',
        `pool: ${axis} exhausted mid-stream at ${String(postPool.perAxis[axis].cap)} — directive parked`,
        {
          axis,
          capAtPark: postPool.perAxis[axis].cap,
          usedAtPark: postPool.perAxis[axis].used,
        },
      );
    } catch (err) {
      log.warn(
        { err, directiveId, taskId: task.id },
        'pool: failed to park directive on mid-stream watchdog interrupt',
      );
    }
  }

  if (outcome.usage !== undefined) {
    recordUsage({
      db,
      directiveId,
      taskId: task.id,
      category: task.category,
      resolution: outcome.usage.resolution,
      response: outcome.usage.response,
      durationMs: outcome.usage.durationMs,
      mode: agentMode(task.agent),
    });
    if (emit !== undefined) {
      emit({
        type: 'spend.updated',
        directiveId,
        totalCostUsd: modelUsage.totalCostForDirective(db, directiveId),
        callCount: modelUsage.countForDirective(db, directiveId),
        deltaUsd: outcome.usage.response.usage.costUsd,
      });
    }
  }

  const finishedAt = now();
  if (outcome.result.exitCode === 0) {
    tasksInflight.markComplete(db, task.id, outcome.result, finishedAt);
  } else {
    tasksInflight.markFailed(db, task.id, outcome.result, finishedAt);
  }
  emit?.({
    type: 'task.completed',
    taskId: task.id,
    directiveId,
    status: outcome.result.exitCode === 0 ? 'complete' : 'failed',
    exitCode: outcome.result.exitCode,
    finishedAt,
    error: outcome.result.error ?? null,
  });

  // Tier 15 / ADR 0034 — emit `pool.tally` after each task settles so the
  // FE Live tab reflects the new per-axis usage without an HTTP round-trip.
  // For read-only tasks this is a useful USD/steps update; for tool-using
  // tasks it's the authoritative source of the `maxTurns*` delta.
  try {
    const postPool = computePoolUsage(db, directiveId, projectBudgets);
    emitPoolTally(emit, directiveId, postPool);
  } catch (err) {
    log.warn(
      { err, directiveId, taskId: task.id },
      'pool: post-task computePoolUsage failed — tally emit skipped',
    );
  }

  // Emit `finding.created` per finding raised by this task.
  if (emit !== undefined && outcome.result.findingsRaised.length > 0) {
    try {
      const all = await listFindings(plan.projectPath);
      const byId = new Map<string, Finding>(all.map((f) => [f.id, f]));
      for (const findingId of outcome.result.findingsRaised) {
        const finding = byId.get(findingId);
        if (finding === undefined) continue;
        emitFindingCreated(emit, directiveId, finding);
      }
    } catch (err) {
      log.warn(
        { err, taskId: task.id, projectPath: plan.projectPath },
        'pool: emit finding.created failed — non-fatal (FE refresh-on-task.completed remains)',
      );
    }
  }

  const updatedTask: Task = {
    ...task,
    status: outcome.result.exitCode === 0 ? 'complete' : 'failed',
    attempts: task.attempts + 1,
    result: outcome.result,
    ...(outcome.worktree !== undefined ? { worktreePath: outcome.worktree.path } : {}),
  };
  return { id: task.id, outcome, task: updatedTask };
}

/**
 * Run a plan's tasks in parallel subject to dependency ordering and an
 * optional concurrency ceiling. Persists an updated plan.json at the end.
 * Returns one {@link TaskOutcome} per task (including skipped/blocked ones).
 *
 * Tier 15 / ADR 0034 — dependent tasks see a `blocked` directive (when a
 * sibling parked the pool) and skip their own launch; the pool drains and
 * `runPlanPool` returns. The `pool-resume` watcher (wired in
 * `serve.ts`) re-enqueues the directive when the operator raises the cap,
 * and a fresh `runBrain` invocation picks up the resume path.
 */
export async function runPlanPool(opts: PoolOptions): Promise<TaskOutcome[]> {
  const order = topoSortTasks(opts.plan.tasks);
  const byId = new Map<string, Task>();
  for (const t of order) byId.set(t.id, t);

  const results = new Map<string, TaskOutcome>();
  const updatedTasks = new Map<string, Task>();
  const pending = new Set<string>(order.map((t) => t.id));
  const running = new Map<string, RunningEntry>();
  const concurrency = Math.max(1, opts.concurrency ?? defaultConcurrency());

  // Resume path: treat already-complete tasks as no-ops.
  for (const t of order) {
    if (t.status === 'complete' && t.result !== undefined) {
      results.set(t.id, {
        taskId: t.id,
        exitCode: t.result.exitCode,
        findingsRaised: t.result.findingsRaised,
        filesChanged: t.result.filesChanged,
      });
      updatedTasks.set(t.id, t);
      pending.delete(t.id);
    }
  }

  log.info(
    {
      total: order.length,
      preCompleted: results.size,
      concurrency,
      projectPath: opts.plan.projectPath,
    },
    'pool: starting',
  );
  emitLogLine(
    opts.emitDirectiveEvent,
    opts.directiveId,
    'info',
    'brain.pool',
    `pool: dispatching ${String(order.length)} task${order.length === 1 ? '' : 's'} (concurrency=${String(concurrency)})`,
    { preCompleted: results.size },
  );

  const isReady = (t: Task): boolean => t.dependsOn.every((dep) => results.has(dep));
  const hasFailedDep = (t: Task): boolean =>
    t.dependsOn.some((dep) => {
      const r = results.get(dep);
      return r !== undefined && r.exitCode !== 0;
    });

  const markBlocked = (taskId: string, reason: string): void => {
    results.set(taskId, {
      taskId,
      exitCode: 2,
      error: reason,
      findingsRaised: [],
      filesChanged: [],
    });
    const t = byId.get(taskId);
    if (t !== undefined) {
      updatedTasks.set(taskId, { ...t, status: 'failed' });
    }
    pending.delete(taskId);
  };

  // Tier 15 / ADR 0034 — observe the directive's status between dispatches.
  // If `executeTask` parked the directive on pool exhaustion, the directive
  // row flips to `blocked`. Refuse to launch new tasks against a blocked
  // directive — they'd just park again — and let the running set drain so
  // the pool resolves cleanly.
  const directiveIsParked = (): boolean => {
    const d = directivesQ.getById(opts.db, opts.directiveId);
    return d !== undefined && d.status === 'blocked';
  };

  while (pending.size > 0 || running.size > 0) {
    if (opts.signal?.aborted === true && running.size === 0) {
      for (const id of [...pending]) markBlocked(id, 'aborted before start');
      break;
    }

    // Fail fast on tasks whose deps already failed.
    for (const id of [...pending]) {
      const task = byId.get(id);
      if (task === undefined) continue;
      if (isReady(task) && hasFailedDep(task)) {
        log.warn({ taskId: id }, 'pool: skipping — upstream dependency failed');
        markBlocked(id, 'upstream failure');
      }
    }

    // Tier 15 — directive parked: don't launch anything new. Drain in-flight.
    const parked = directiveIsParked();
    if (parked) {
      for (const id of [...pending]) {
        markBlocked(id, 'directive parked (pool exhausted)');
      }
    }

    // Launch up to concurrency.
    while (running.size < concurrency && !parked) {
      if (opts.signal?.aborted === true) break;
      const id = [...pending].find((tid) => {
        const t = byId.get(tid);
        return t !== undefined && isReady(t);
      });
      if (id === undefined) break;
      const task = byId.get(id) as Task;

      pending.delete(id);
      const promise = executeTask(
        task,
        opts.plan,
        opts.registry,
        opts.db,
        opts.directiveId,
        opts.signal,
        opts.emitDirectiveEvent,
      ).catch((err: unknown) => {
        // executeTask usually bubbles a caught error back through the worker,
        // but if it throws, translate into a failed outcome so the pool can
        // keep draining the rest of the DAG.
        log.error({ err, taskId: task.id }, 'pool: task threw — recording as failure');
        const message = err instanceof Error ? err.message : String(err);
        emitLogLine(
          opts.emitDirectiveEvent,
          opts.directiveId,
          'error',
          'brain.pool',
          `pool: task ${task.title} threw — ${message.slice(0, 200)}`,
          { taskId: task.id, agent: task.agent },
        );
        const result = {
          exitCode: 1,
          filesChanged: [],
          findingsRaised: [],
          signalsEmitted: [],
          error: message,
          durationMs: 0,
        };
        return {
          id: task.id,
          outcome: { result } as WorkerOutcome,
          task: {
            ...task,
            status: 'failed' as const,
            attempts: task.attempts + 1,
            result,
          },
        };
      });
      running.set(id, { id, promise });
    }

    if (running.size === 0) {
      // Nothing running, nothing ready — cycle, parked directive, or bug; bail.
      if (pending.size > 0) {
        if (!parked) {
          log.error(
            { pending: [...pending] },
            'pool: deadlock — pending tasks with no ready dependencies',
          );
          for (const id of [...pending]) {
            markBlocked(id, 'deadlock (unsatisfiable dependencies)');
          }
        }
      }
      break;
    }

    const settled = await Promise.race([...running.values()].map((e) => e.promise));
    running.delete(settled.id);

    const exit = settled.outcome.result.exitCode;
    results.set(settled.id, {
      taskId: settled.id,
      exitCode: exit,
      findingsRaised: settled.outcome.result.findingsRaised,
      filesChanged: settled.outcome.result.filesChanged,
      ...(settled.outcome.result.error !== undefined
        ? { error: settled.outcome.result.error }
        : {}),
    });
    updatedTasks.set(settled.id, settled.task);

    log.info(
      {
        taskId: settled.id,
        exitCode: exit,
        findings: settled.outcome.result.findingsRaised.length,
        filesChanged: settled.outcome.result.filesChanged.length,
      },
      'pool: task finished',
    );
  }

  // Persist the plan with updated task statuses + results.
  const mergedTasks: Task[] = opts.plan.tasks.map((t) => updatedTasks.get(t.id) ?? t);
  const anyFailed = [...results.values()].some((r) => r.exitCode !== 0);
  const final: Plan = {
    ...opts.plan,
    tasks: mergedTasks,
    status: anyFailed ? 'abandoned' : 'complete',
  };
  await writePlan(final);

  const succeededCount = [...results.values()].filter((r) => r.exitCode === 0).length;
  const failedCount = [...results.values()].filter((r) => r.exitCode !== 0).length;
  log.info(
    {
      total: order.length,
      succeeded: succeededCount,
      failed: failedCount,
    },
    'pool: complete',
  );
  emitLogLine(
    opts.emitDirectiveEvent,
    opts.directiveId,
    failedCount > 0 ? 'warn' : 'info',
    'brain.pool',
    `pool: complete — ${String(succeededCount)} passed, ${String(failedCount)} failed`,
  );

  // Return in the original plan order for stable output.
  return opts.plan.tasks.map(
    (t) =>
      results.get(t.id) ?? {
        taskId: t.id,
        exitCode: 2,
        error: 'never scheduled',
        findingsRaised: [],
        filesChanged: [],
      },
  );
}

/**
 * Build the per-task askUserConfig (ADR 0024 sub-step 8.3) from the daemon's
 * runtime state. Returns `undefined` when the bearer token isn't present in
 * env — that's the signal that we're running standalone (tests, ad-hoc
 * scripts) rather than inside `factoryd`'s shell, so the worker should run
 * without the `ask_user` MCP tool.
 */
async function buildAskUserConfig(directiveId: string): Promise<WorkerAskUserConfig | undefined> {
  const token = env['FACTORY5_WORKER_AUTH_TOKEN'];
  if (token === undefined || token.length === 0) return undefined;
  const endpoint = await loadDaemonEndpoint();
  return {
    brainRpcUrl: `http://${endpoint.host}:${String(endpoint.port)}`,
    brainRpcToken: token,
    directiveId,
  };
}
