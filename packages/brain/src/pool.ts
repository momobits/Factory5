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
 */

import { cpus } from 'node:os';
import { env } from 'node:process';

import type { DirectiveLimits, Plan, Task } from '@factory5/core';
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
import { writePlan } from '@factory5/wiki';
import {
  isToolUsingAgent,
  runWorker,
  type WorkerAskUserConfig,
  type WorkerOutcome,
} from '@factory5/worker';

import { assertBudget, BudgetExceededError } from './budget.js';
import { loadDaemonEndpoint } from './daemon-endpoint.js';
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
   * Per-directive budget ceilings (ADR 0020). When set, the pool calls
   * {@link assertBudget} before dispatching each task. A throwing check
   * stops new dispatches, lets in-flight tasks drain, marks remaining
   * pending tasks as blocked with a budget-specific reason, and
   * re-raises the {@link BudgetExceededError} from `runPlanPool` so
   * `loop.runInline` can flip the directive to `blocked`.
   */
  limits?: DirectiveLimits;
  /**
   * Per-directive SSE event emitter (Phase 3 / step 3.1). When set, the
   * pool emits `task.started`, `task.completed`, and `spend.updated`
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

/**
 * Execute one task end-to-end: register it as inflight, run the worker with
 * heartbeats, then mark it complete or failed. Returns the `WorkerOutcome`
 * along with the (updated) task so the pool can persist plan.json.
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

  // Resolve the directive's projectId once per task to attach to the
  // findings-registry binding. One small SELECT per task is cheaper than
  // threading the value through every PoolOptions invocation, and keeps
  // the pool's call signature stable.
  const directive = directivesQ.getById(db, directiveId);
  const projectId = directive?.projectId;

  // Per ADR 0024 sub-step 8.3: when the daemon is running with a worker
  // auth token (set by factoryd's main.ts at startup), build an
  // askUserConfig so the in-stream agent gets `mcp__factory5-ask-user__ask_user`.
  // Skipped silently when the token is absent — covers tests and
  // standalone scripts that drive the brain without the daemon shell.
  const askUserConfig = isToolUsingAgent(task.agent)
    ? await buildAskUserConfig(directiveId)
    : undefined;

  let outcome: WorkerOutcome;
  try {
    outcome = await runWorker({
      task,
      projectPath: plan.projectPath,
      registry,
      systemPrompt,
      userPrompt,
      findingRegistry: {
        db,
        // Project identity (ADR 0021). Pulled from the directive — populated
        // either at directive creation (CLI build) or by migration 006's
        // backfill. Undefined only for legacy directives that predate the
        // backfill running (which would be a deployment in an unmigrated
        // state). Wiki's `mirrorToRegistry` skips the registry write
        // when projectId is undefined rather than falling back to basename
        // (which was the I008 collision trap).
        ...(projectId !== undefined ? { projectId } : {}),
        originDirectiveId: directiveId,
      },
      ...(askUserConfig !== undefined ? { askUserConfig } : {}),
      ...(signal !== undefined ? { signal } : {}),
    });
  } finally {
    clearInterval(hb);
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
  /**
   * Set when a {@link BudgetExceededError} trips during dispatch. Stops
   * further launches; in-flight tasks finish; remaining pending tasks
   * are marked blocked with a budget-specific reason; the error is
   * re-raised from `runPlanPool` after the pool drains.
   */
  let budgetError: BudgetExceededError | undefined;

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
      // The task never ran — keep `attempts` as-is so retry budgets aren't
      // consumed by upstream failures the task can't do anything about.
      updatedTasks.set(taskId, { ...t, status: 'failed' });
    }
    pending.delete(taskId);
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

    // If a prior dispatch tripped the budget, do not launch anything else;
    // drain the in-flight set and mark the remainder blocked when we fall
    // out of this outer while loop.
    if (budgetError !== undefined) {
      for (const id of [...pending]) {
        markBlocked(id, `budget_exceeded: ${budgetError.detail.kind} — aborted before start`);
      }
    }

    // Launch up to concurrency.
    while (running.size < concurrency && budgetError === undefined) {
      if (opts.signal?.aborted === true) break;
      const id = [...pending].find((tid) => {
        const t = byId.get(tid);
        return t !== undefined && isReady(t);
      });
      if (id === undefined) break;
      const task = byId.get(id) as Task;

      if (opts.limits !== undefined) {
        try {
          assertBudget({
            db: opts.db,
            directiveId: opts.directiveId,
            ...(opts.limits.maxUsd !== undefined ? { maxUsd: opts.limits.maxUsd } : {}),
            ...(opts.limits.maxSteps !== undefined ? { maxSteps: opts.limits.maxSteps } : {}),
            category: task.category,
            mode: agentMode(task.agent),
            agent: task.agent,
          });
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            log.warn(
              { taskId: id, detail: err.detail },
              'pool: budget ceiling reached — halting further dispatch',
            );
            budgetError = err;
            break;
          }
          throw err;
        }
      }

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
      // Budget-halted: label the pending rows with the budget reason
      // rather than the deadlock reason (which is meant for cycles /
      // unsatisfiable dependencies, not a deliberate stop).
      if (budgetError !== undefined) {
        for (const id of [...pending]) {
          markBlocked(id, `budget_exceeded: ${budgetError.detail.kind} — aborted before start`);
        }
        break;
      }
      // Otherwise: nothing running, nothing ready — cycle or bug; bail.
      if (pending.size > 0) {
        log.error(
          { pending: [...pending] },
          'pool: deadlock — pending tasks with no ready dependencies',
        );
        for (const id of [...pending]) markBlocked(id, 'deadlock (unsatisfiable dependencies)');
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

  // If dispatch tripped the budget, make sure every task that never
  // ran is marked blocked before we persist plan.json.
  if (budgetError !== undefined) {
    for (const id of [...pending]) {
      markBlocked(id, `budget_exceeded: ${budgetError.detail.kind} — aborted before start`);
    }
  }

  // Persist the plan with updated task statuses + results.
  const mergedTasks: Task[] = opts.plan.tasks.map((t) => updatedTasks.get(t.id) ?? t);
  const anyFailed = [...results.values()].some((r) => r.exitCode !== 0);
  const final: Plan = {
    ...opts.plan,
    tasks: mergedTasks,
    status: anyFailed || budgetError !== undefined ? 'abandoned' : 'complete',
  };
  await writePlan(final);

  log.info(
    {
      total: order.length,
      succeeded: [...results.values()].filter((r) => r.exitCode === 0).length,
      failed: [...results.values()].filter((r) => r.exitCode !== 0).length,
      budgetHalted: budgetError !== undefined,
    },
    'pool: complete',
  );

  if (budgetError !== undefined) throw budgetError;

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
 * without the `ask_user` MCP tool. Endpoint resolution mirrors how the CLI
 * resolves it; values stay in sync with the daemon's bind address.
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
