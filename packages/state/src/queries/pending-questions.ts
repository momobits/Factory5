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
  bot_message_id: string | null;
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
    ...(row.bot_message_id !== null ? { botMessageId: row.bot_message_id } : {}),
  });
}

/** Insert a new pending question. */
export function create(db: Database, q: PendingQuestion): void {
  const validated = pendingQuestionSchema.parse(q);
  db.prepare(
    `INSERT INTO pending_questions
       (id, directive_id, task_id, question, options_json, channel, channel_ref,
        created_at, deadline_at, answered_at, answer, bot_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    validated.botMessageId ?? null,
  );
}

/**
 * Stamp the bot's outbound message id on the question — called by the
 * outbound worker after a successful delivery so {@link findOpenByBotMessageId}
 * can later disambiguate Reply-feature answers (I012). Idempotent: a
 * second call with the same id is a no-op; calling against an already-
 * answered or non-existent row updates 0 rows and silently succeeds.
 */
export function setBotMessageId(db: Database, id: string, botMessageId: string): void {
  db.prepare('UPDATE pending_questions SET bot_message_id = ? WHERE id = ?').run(botMessageId, id);
}

/**
 * Find the open question whose outbound was delivered with this provider
 * message id. Returns `undefined` if none — caller must fall back to the
 * legacy channel_ref / LIKE rungs for rows that pre-date migration 008
 * or for outbounds whose delivery failed before stamping. (I012)
 */
export function findOpenByBotMessageId(
  db: Database,
  channel: string,
  botMessageId: string,
): PendingQuestion | undefined {
  const row = db
    .prepare(
      `SELECT * FROM pending_questions
        WHERE channel = ? AND bot_message_id = ? AND answered_at IS NULL
        LIMIT 1`,
    )
    .get(channel, botMessageId) as Row | undefined;
  return row !== undefined ? rowToQuestion(row) : undefined;
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

export type QuestionListStatus = 'open' | 'answered' | 'all';

export interface ListPagedFilter {
  /** Page size. Clamped to [1, 100]. Default 20. */
  limit?: number;
  /** Rows to skip. Clamped to >= 0. Default 0. */
  offset?: number;
  /** `open` (default) shows only unanswered; `answered` flips it; `all` both. */
  status?: QuestionListStatus;
  /** Optional directive scope. */
  directiveId?: string;
}

export interface ListPagedResult {
  items: PendingQuestion[];
  /** Total matching rows ignoring pagination. */
  total: number;
}

/**
 * Paged list of pending questions, newest first. Backs the web UI's
 * `/api/v1/pending-questions` endpoint (ADR 0025, sub-step 9.5). Brain
 * and channel callers continue to use {@link openForDirective} /
 * {@link getById}; this helper exists so the UI doesn't hit full table
 * scans on growing Q&A history.
 */
export function listPaged(db: Database, filter: ListPagedFilter = {}): ListPagedResult {
  const limit = Math.max(1, Math.min(100, filter.limit ?? 20));
  const offset = Math.max(0, filter.offset ?? 0);
  const status = filter.status ?? 'open';

  const wheres: string[] = [];
  const params: unknown[] = [];
  if (status === 'open') {
    wheres.push('answered_at IS NULL');
  } else if (status === 'answered') {
    wheres.push('answered_at IS NOT NULL');
  }
  if (filter.directiveId !== undefined) {
    wheres.push('directive_id = ?');
    params.push(filter.directiveId);
  }
  const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';

  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM pending_questions ${whereClause}`)
    .get(...params) as { count: number };
  const rows = db
    .prepare(
      `SELECT * FROM pending_questions ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Row[];
  return { items: rows.map(rowToQuestion), total: countRow.count };
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

// -----------------------------------------------------------------------------
// Orphan sweep (Phase 14.4)
// -----------------------------------------------------------------------------

/**
 * Summary row for {@link findOrphaned}. Joined fields from the parent
 * directive are kept here (rather than fetching directive rows separately)
 * so an operator-facing CLI can render a one-line digest per orphan.
 */
export interface OrphanedQuestion {
  id: string;
  directiveId: string;
  directiveStatus: string;
  directiveSource: string;
  channel: string;
  question: string;
  createdAt: string;
}

/**
 * Find unanswered questions whose parent directive is in a terminal state
 * (`complete` / `failed` / `blocked`). These are escalations / `ask_user`
 * prompts that the operator never answered before the directive ended on
 * its own — by the time anyone replies, no consumer remains. Used by the
 * `factory questions cleanup` CLI sweep.
 *
 * Returns rows oldest first so the CLI can show the longest-stale entries
 * up top. The optional `since` filter (ISO-8601 date or datetime) clamps
 * the scan to rows created strictly before the cutoff — useful for
 * "older than 90 days" sweeps that leave the last few days alone.
 */
export function findOrphaned(db: Database, options: { since?: string } = {}): OrphanedQuestion[] {
  const wheres = [`pq.answered_at IS NULL`, `d.status IN ('complete','failed','blocked')`];
  const params: unknown[] = [];
  if (options.since !== undefined) {
    wheres.push(`pq.created_at < ?`);
    params.push(options.since);
  }
  const rows = db
    .prepare(
      `SELECT pq.id           AS id,
              pq.directive_id  AS directiveId,
              d.status         AS directiveStatus,
              d.source         AS directiveSource,
              pq.channel       AS channel,
              pq.question      AS question,
              pq.created_at    AS createdAt
         FROM pending_questions pq
         JOIN directives d ON d.id = pq.directive_id
        WHERE ${wheres.join(' AND ')}
        ORDER BY pq.created_at ASC`,
    )
    .all(...params) as OrphanedQuestion[];
  return rows;
}

/**
 * Mark an orphaned question as answered with a synthetic note. Preserves
 * the row for forensic value and ensures the matcher's `answered_at IS
 * NULL` predicate skips it. Caller passes the orphan record so we can
 * build a self-describing answer string without a second lookup.
 */
export function markOrphanAnswered(
  db: Database,
  orphan: { id: string; directiveId: string; directiveStatus: string },
  when: string,
): void {
  const note = `[orphaned by factory questions cleanup at ${when}: directive ${orphan.directiveId} ended ${orphan.directiveStatus}]`;
  db.prepare(
    'UPDATE pending_questions SET answered_at = ?, answer = ? WHERE id = ? AND answered_at IS NULL',
  ).run(when, note, orphan.id);
}
