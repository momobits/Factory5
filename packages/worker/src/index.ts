/**
 * @factory5/worker — per-task subprocess wrapper.
 *
 * Phase 1 implementation will spawn `claude -p` and stream its output.
 * For now this is a scaffold.
 *
 * @packageDocumentation
 */

import type { Task, TaskResult } from '@factory5/core';
import { createLogger } from '@factory5/logger';

const log = createLogger('worker');

export interface WorkerOptions {
  task: Task;
  projectPath: string;
  /** Optional cancellation signal. */
  signal?: AbortSignal;
  /** Periodic heartbeat callback (every ~5s while running). */
  onHeartbeat?: (now: string) => void;
}

/** Stub. */
export async function runWorker(opts: WorkerOptions): Promise<TaskResult> {
  log.warn({ taskId: opts.task.id }, 'runWorker: stub — Phase 1 implementation pending');
  throw new Error('@factory5/worker.runWorker not yet implemented (Phase 1)');
}
