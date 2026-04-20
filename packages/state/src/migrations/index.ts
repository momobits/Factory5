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

const log = createLogger('state.migrations');

export interface Migration {
  /** Stable numeric id; never reused. */
  id: number;
  /** Human-readable kebab name. */
  name: string;
  /** SQL applied to bring the schema to this version. */
  up: string;
}

export const migrations: readonly Migration[] = [migration001, migration002];

/** Highest migration id currently shipped. Useful for clients gating on schema. */
export const currentSchemaVersion: number = migrations.reduce(
  (max, m) => (m.id > max ? m.id : max),
  0,
);

/**
 * Apply all pending migrations. Idempotent — safe to call on every startup.
 *
 * Throws on SQL error; the database is left in whatever state SQLite reached
 * before the failure (each migration runs in a transaction, so individual
 * migrations are atomic).
 */
export function runMigrations(db: Database): void {
  ensureMigrationsTable(db);
  const applied = new Set(
    db
      .prepare('SELECT id FROM migrations')
      .all()
      .map((r) => (r as { id: number }).id),
  );

  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    log.info({ id: m.id, name: m.name }, 'applying migration');
    const tx = db.transaction(() => {
      db.exec(m.up);
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
