/**
 * Typed CRUD for the `tasks_inflight` table — running worker tasks.
 */

import type { AgentRole, ModelCategory, TaskResult, TaskStatus } from '@factory5/core';

import type { Database } from '../db.js';

export interface InflightTask {
  id: string;
  directiveId: string;
  planId: string;
  title: string;
  agent: AgentRole;
  category: ModelCategory;
  worktreePath?: string;
  pid?: number;
  status: TaskStatus;
  attempts: number;
  startedAt?: string;
  lastHeartbeat?: string;
  finishedAt?: string;
  result?: TaskResult;
  /** Pending-question id this task is waiting on (ADR 0024 §4). */
  waitingQuestionId?: string;
  /** Why this task was aborted (ADR 0024 §4 — e.g. `'brain_restart_during_human_wait'`). */
  abortedReason?: string;
}

/** Terminal task statuses — once a task hits one of these it's done forever. */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'complete',
  'failed',
  'blocked',
  'aborted',
]);

/** True iff the task's status is in a terminal state. */
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

interface Row {
  id: string;
  directive_id: string;
  plan_id: string;
  title: string;
  agent: string;
  category: string;
  worktree_path: string | null;
  pid: number | null;
  status: string;
  attempts: number;
  started_at: string | null;
  last_heartbeat: string | null;
  finished_at: string | null;
  result_json: string | null;
  waiting_question_id: string | null;
  aborted_reason: string | null;
}

function rowToTask(row: Row): InflightTask {
  const t: InflightTask = {
    id: row.id,
    directiveId: row.directive_id,
    planId: row.plan_id,
    title: row.title,
    agent: row.agent as AgentRole,
    category: row.category as ModelCategory,
    status: row.status as TaskStatus,
    attempts: row.attempts,
  };
  if (row.worktree_path !== null) t.worktreePath = row.worktree_path;
  if (row.pid !== null) t.pid = row.pid;
  if (row.started_at !== null) t.startedAt = row.started_at;
  if (row.last_heartbeat !== null) t.lastHeartbeat = row.last_heartbeat;
  if (row.finished_at !== null) t.finishedAt = row.finished_at;
  if (row.result_json !== null) t.result = JSON.parse(row.result_json) as TaskResult;
  if (row.waiting_question_id !== null) t.waitingQuestionId = row.waiting_question_id;
  if (row.aborted_reason !== null) t.abortedReason = row.aborted_reason;
  return t;
}

/** Register a task as inflight. */
export function register(db: Database, t: InflightTask): void {
  db.prepare(
    `INSERT INTO tasks_inflight
       (id, directive_id, plan_id, title, agent, category, worktree_path, pid,
        status, attempts, started_at, last_heartbeat, finished_at, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    t.id,
    t.directiveId,
    t.planId,
    t.title,
    t.agent,
    t.category,
    t.worktreePath ?? null,
    t.pid ?? null,
    t.status,
    t.attempts,
    t.startedAt ?? null,
    t.lastHeartbeat ?? null,
    t.finishedAt ?? null,
    t.result !== undefined ? JSON.stringify(t.result) : null,
  );
}

/** Heartbeat a running task. */
export function heartbeat(db: Database, id: string, when: string): void {
  db.prepare('UPDATE tasks_inflight SET last_heartbeat = ? WHERE id = ?').run(when, id);
}

/** Mark a task complete with its result. */
export function markComplete(db: Database, id: string, result: TaskResult, when: string): void {
  db.prepare(
    `UPDATE tasks_inflight
     SET status = 'complete', finished_at = ?, result_json = ?
     WHERE id = ?`,
  ).run(when, JSON.stringify(result), id);
}

/** Mark a task failed with its result. */
export function markFailed(db: Database, id: string, result: TaskResult, when: string): void {
  db.prepare(
    `UPDATE tasks_inflight
     SET status = 'failed', finished_at = ?, result_json = ?
     WHERE id = ?`,
  ).run(when, JSON.stringify(result), id);
}

/** All running tasks for a directive. */
export function listByDirective(db: Database, directiveId: string): InflightTask[] {
  const rows = db
    .prepare('SELECT * FROM tasks_inflight WHERE directive_id = ? ORDER BY started_at')
    .all(directiveId) as Row[];
  return rows.map(rowToTask);
}

/** Get a single task by id; returns undefined if not present. */
export function getById(db: Database, id: string): InflightTask | undefined {
  const row = db.prepare('SELECT * FROM tasks_inflight WHERE id = ?').get(id) as Row | undefined;
  if (row === undefined) return undefined;
  return rowToTask(row);
}

/**
 * Mark a task as paused waiting for a human answer (ADR 0024 §4). Records
 * the `pending_questions.id` it's blocked on so brain-startup recovery can
 * cross-reference. Pre-condition: task must be in `'running'` (no-op if
 * not, since transitions out of terminal states would be a bug). Heartbeat
 * is touched at the same time so the supervisor's stuck-task heuristic
 * doesn't reap a legitimately-paused task.
 */
export function markWaitingForHuman(
  db: Database,
  id: string,
  questionId: string,
  when: string,
): void {
  db.prepare(
    `UPDATE tasks_inflight
        SET status = 'waiting_for_human',
            waiting_question_id = ?,
            last_heartbeat = ?
      WHERE id = ?
        AND status = 'running'`,
  ).run(questionId, when, id);
}

/**
 * Flip a task back to `'running'` after the answer arrives (ADR 0024 §4).
 * Clears `waiting_question_id` and refreshes the heartbeat. No-op if the
 * task isn't currently waiting (handles the brain-restart race where
 * orphan cleanup already aborted it).
 */
export function markRunningAfterAnswer(db: Database, id: string, when: string): void {
  db.prepare(
    `UPDATE tasks_inflight
        SET status = 'running',
            waiting_question_id = NULL,
            last_heartbeat = ?
      WHERE id = ?
        AND status = 'waiting_for_human'`,
  ).run(when, id);
}

/**
 * Mark a task aborted with a machine-friendly reason tag (ADR 0024 §4).
 * Used by the brain-startup orphan-cleanup pass and any future external-
 * halt path. Sets `finished_at` so the row is unambiguously terminal.
 */
export function markAborted(db: Database, id: string, reason: string, when: string): void {
  db.prepare(
    `UPDATE tasks_inflight
        SET status = 'aborted',
            aborted_reason = ?,
            finished_at = ?
      WHERE id = ?`,
  ).run(reason, when, id);
}

/**
 * Brain-startup orphan-cleanup query (ADR 0024 §4). Returns every task
 * still flagged `waiting_for_human` — by definition orphaned, since the
 * worker subprocess that owned the wait was a child of the previous
 * brain process and can't survive it.
 */
export function findOrphanedHumanWaits(db: Database): InflightTask[] {
  const rows = db
    .prepare(`SELECT * FROM tasks_inflight WHERE status = 'waiting_for_human'`)
    .all() as Row[];
  return rows.map(rowToTask);
}
