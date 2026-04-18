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

import type { Plan, Task } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import type { ProviderRegistry } from '@factory5/providers';
import { tasksInflight, type Database } from '@factory5/state';
import { writePlan } from '@factory5/wiki';
import { runWorker, type WorkerOutcome } from '@factory5/worker';

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
  tasksInflight.register(db, {
    id: task.id,
    directiveId,
    planId: plan.id,
    title: task.title,
    agent: task.agent,
    category: task.category,
    status: 'running',
    attempts: task.attempts + 1,
    startedAt: now(),
    lastHeartbeat: now(),
  });

  const hb = setInterval(() => {
    try {
      tasksInflight.heartbeat(db, task.id, now());
    } catch (err) {
      log.warn({ err, taskId: task.id }, 'pool: heartbeat write failed');
    }
  }, HEARTBEAT_INTERVAL_MS);

  log.info({ taskId: task.id, agent: task.agent, category: task.category }, 'pool: task started');

  let outcome: WorkerOutcome;
  try {
    outcome = await runWorker({
      task,
      projectPath: plan.projectPath,
      registry,
      systemPrompt,
      userPrompt,
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
    });
  }

  if (outcome.result.exitCode === 0) {
    tasksInflight.markComplete(db, task.id, outcome.result, now());
  } else {
    tasksInflight.markFailed(db, task.id, outcome.result, now());
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

    // Launch up to concurrency.
    while (running.size < concurrency) {
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
      // Nothing running, nothing ready — we must have a cycle or a bug; bail.
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

  // Persist the plan with updated task statuses + results.
  const mergedTasks: Task[] = opts.plan.tasks.map((t) => updatedTasks.get(t.id) ?? t);
  const anyFailed = [...results.values()].some((r) => r.exitCode !== 0);
  const final: Plan = {
    ...opts.plan,
    tasks: mergedTasks,
    status: anyFailed ? 'abandoned' : 'complete',
  };
  await writePlan(final);

  log.info(
    {
      total: order.length,
      succeeded: [...results.values()].filter((r) => r.exitCode === 0).length,
      failed: [...results.values()].filter((r) => r.exitCode !== 0).length,
    },
    'pool: complete',
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
