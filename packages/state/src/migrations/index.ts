/**
 * Migrations runner. Migrations are append-only TypeScript files that export
 * `{ id, name, up }`. The `migrations` table records which have been applied.
 *
 * To add a new migration:
 *  1. Create `NNN-description.ts` exporting `{ id, name, up }`.
 *  2. Append to the `migrations` array below.
 *  3. Never edit a shipped migration — write a new one to amend.
 */

import { createLogger } from '@factory5/logger';

import type { Database } from '../db.js';
import { migration001 } from './001-initial.js';
import { migration002 } from './002-directive-blocked-reason.js';
import { migration003 } from './003-findings-registry.js';
import { migration004 } from './004-model-usage-mode.js';
import { migration005 } from './005-directive-limits.js';
import { migration006 } from './006-project-identity.js';
import { migration007 } from './007-task-waiting-for-human.js';
import { migration008 } from './008-pending-questions-bot-message-id.js';

const log = createLogger('state.migrations');

export interface Migration {
  /** Stable numeric id; never reused. */
  id: number;
  /** Human-readable kebab name. */
  name: string;
  /** SQL applied to bring the schema to this version. */
  up: string;
  /**
   * Optional TypeScript-side post-step that runs after `up` in the same
   * transaction. Used when a migration needs to do work SQL alone cannot
   * express — generating ULIDs for backfilled rows, touching files outside
   * the database (e.g. ADR 0021's `.factory/project.json`), or executing
   * schema-changing DDL (`DROP`/`RENAME`) that depends on data movement
   * landing first.
   */
  post?: (db: Database) => void;
}

export const migrations: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
];

/** Highest migration id currently shipped. Useful for clients gating on schema. */
export const currentSchemaVersion: number = migrations.reduce(
  (max, m) => (m.id > max ? m.id : max),
  0,
);

export interface RunMigrationsOptions {
  /**
   * Apply only migrations whose `id` is `<= maxId`. Used by tests that need
   * to stage data at a particular schema version before triggering a
   * later migration's backfill. Production code never sets this — startup
   * applies the full list.
   */
  maxId?: number;
}

/**
 * Apply all pending migrations. Idempotent — safe to call on every startup.
 *
 * Throws on SQL error; the database is left in whatever state SQLite reached
 * before the failure (each migration runs in a transaction, so individual
 * migrations are atomic).
 */
export function runMigrations(db: Database, opts: RunMigrationsOptions = {}): void {
  const ceiling = opts.maxId ?? Number.POSITIVE_INFINITY;
  ensureMigrationsTable(db);
  const applied = new Set(
    db
      .prepare('SELECT id FROM migrations')
      .all()
      .map((r) => (r as { id: number }).id),
  );

  for (const m of migrations) {
    if (m.id > ceiling) break;
    if (applied.has(m.id)) continue;
    log.info({ id: m.id, name: m.name }, 'applying migration');
    const tx = db.transaction(() => {
      db.exec(m.up);
      m.post?.(db);
      db.prepare('INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        m.id,
        m.name,
        new Date().toISOString(),
      );
    });
    tx();
  }

  const total = (db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number }).c;
  log.info({ applied: total, currentVersion: currentSchemaVersion }, 'migrations up to date');
}

function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    );
  `);
}
