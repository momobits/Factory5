/**
 * Typed CRUD for the `learnings` table — cross-project patterns extracted
 * from past builds.
 *
 * Learnings are short, structured strings (one fact per row) keyed by topic
 * (e.g., "python-imports", "discord-rate-limit"). The architect/planner
 * agents query relevant learnings before each build.
 */

import type { Database } from '../db.js';

export interface Learning {
  id: string;
  topic: string;
  lesson: string;
  sourceProject?: string;
  createdAt: string;
  timesApplied: number;
}

interface Row {
  id: string;
  topic: string;
  lesson: string;
  source_project: string | null;
  created_at: string;
  times_applied: number;
}

function rowToLearning(row: Row): Learning {
  const l: Learning = {
    id: row.id,
    topic: row.topic,
    lesson: row.lesson,
    createdAt: row.created_at,
    timesApplied: row.times_applied,
  };
  if (row.source_project !== null) l.sourceProject = row.source_project;
  return l;
}

/** Record a new learning. */
export function record(db: Database, l: Learning): void {
  db.prepare(
    `INSERT INTO learnings (id, topic, lesson, source_project, created_at, times_applied)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(l.id, l.topic, l.lesson, l.sourceProject ?? null, l.createdAt, l.timesApplied);
}

/** Find learnings for a topic. */
export function byTopic(db: Database, topic: string, limit = 20): Learning[] {
  const rows = db
    .prepare(
      `SELECT * FROM learnings
       WHERE topic = ?
       ORDER BY times_applied DESC, created_at DESC
       LIMIT ?`,
    )
    .all(topic, limit) as Row[];
  return rows.map(rowToLearning);
}

/** Increment times_applied for a learning that just got used. */
export function applied(db: Database, id: string): void {
  db.prepare('UPDATE learnings SET times_applied = times_applied + 1 WHERE id = ?').run(id);
}
