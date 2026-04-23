/**
 * Typed CRUD for the `pending_questions` table — `ask_user` calls awaiting reply.
 */

import { pendingQuestionSchema, type PendingQuestion, type TaskStatus } from '@factory5/core';

import type { Database } from '../db.js';
import { getById as getTaskById, isTerminalStatus } from './tasks-inflight.js';

interface Row {
  id: string;
  directive_id: string;
  task_id: string | null;
  question: string;
  options_json: string | null;
  channel: string;
  channel_ref: string;
  created_at: string;
  deadline_at: string | null;
  answered_at: string | null;
  answer: string | null;
}

function rowToQuestion(row: Row): PendingQuestion {
  return pendingQuestionSchema.parse({
    id: row.id,
    directiveId: row.directive_id,
    ...(row.task_id !== null ? { taskId: row.task_id } : {}),
    question: row.question,
    ...(row.options_json !== null ? { options: JSON.parse(row.options_json) } : {}),
    channel: row.channel,
    channelRef: row.channel_ref,
    createdAt: row.created_at,
    ...(row.deadline_at !== null ? { deadlineAt: row.deadline_at } : {}),
    ...(row.answered_at !== null ? { answeredAt: row.answered_at } : {}),
    ...(row.answer !== null ? { answer: row.answer } : {}),
  });
}

/** Insert a new pending question. */
export function create(db: Database, q: PendingQuestion): void {
  const validated = pendingQuestionSchema.parse(q);
  db.prepare(
    `INSERT INTO pending_questions
       (id, directive_id, task_id, question, options_json, channel, channel_ref,
        created_at, deadline_at, answered_at, answer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    validated.id,
    validated.directiveId,
    validated.taskId ?? null,
    validated.question,
    validated.options !== undefined ? JSON.stringify(validated.options) : null,
    validated.channel,
    validated.channelRef,
    validated.createdAt,
    validated.deadlineAt ?? null,
    validated.answeredAt ?? null,
    validated.answer ?? null,
  );
}

/** Fetch a pending question by id. */
export function getById(db: Database, id: string): PendingQuestion | undefined {
  const row = db.prepare('SELECT * FROM pending_questions WHERE id = ?').get(id) as Row | undefined;
  return row !== undefined ? rowToQuestion(row) : undefined;
}

/** Find unanswered questions for a directive. */
export function openForDirective(db: Database, directiveId: string): PendingQuestion[] {
  const rows = db
    .prepare(
      `SELECT * FROM pending_questions
       WHERE directive_id = ? AND answered_at IS NULL
       ORDER BY created_at ASC`,
    )
    .all(directiveId) as Row[];
  return rows.map(rowToQuestion);
}

/** Record an answer. */
export function answer(db: Database, id: string, answer: string, when: string): void {
  db.prepare('UPDATE pending_questions SET answered_at = ?, answer = ? WHERE id = ?').run(
    when,
    answer,
    id,
  );
}

/**
 * After writing an answer, check whether the question's linked task is in
 * a terminal state — meaning no worker subprocess is alive to consume the
 * answer. Returns the task id + status when orphaned, undefined when the
 * answer will reach a live consumer (or when there's no linked task at
 * all, e.g. brain-originated questions).
 *
 * Used by channel collectors (Discord / Telegram / CLI) to surface the
 * "answered after task ended" condition (ADR 0024 §4). The answer row
 * stays for forensic value either way; this helper just tells the
 * collector whether to log a warning.
 */
export function detectOrphanedAnswer(
  db: Database,
  questionId: string,
): { taskId: string; taskStatus: TaskStatus } | undefined {
  const q = getById(db, questionId);
  if (q?.taskId === undefined) return undefined;
  const task = getTaskById(db, q.taskId);
  if (task === undefined) {
    // No matching task row at all — treat as orphaned so the collector
    // surfaces it. Consistent with ADR 0024's "log + no-op" intent.
    return { taskId: q.taskId, taskStatus: 'aborted' };
  }
  if (!isTerminalStatus(task.status)) return undefined;
  return { taskId: q.taskId, taskStatus: task.status };
}
