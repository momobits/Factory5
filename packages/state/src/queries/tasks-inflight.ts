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
export function markComplete(
  db: Database,
  id: string,
  result: TaskResult,
  when: string,
): void {
  db.prepare(
    `UPDATE tasks_inflight
     SET status = 'complete', finished_at = ?, result_json = ?
     WHERE id = ?`,
  ).run(when, JSON.stringify(result), id);
}

/** Mark a task failed with its result. */
export function markFailed(
  db: Database,
  id: string,
  result: TaskResult,
  when: string,
): void {
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
