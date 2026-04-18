/**
 * Database connection — opens (or creates) the SQLite file with WAL mode and
 * the standard set of pragmas factory5 expects.
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { dataDir } from '@factory5/logger/paths';
import { createLogger } from '@factory5/logger';
import BetterSqlite3, { type Database as BetterSqlite3Database } from 'better-sqlite3';

const log = createLogger('state.db');

/** Re-export of better-sqlite3's Database type. */
export type Database = BetterSqlite3Database;

/** Default location of factory5's runtime SQLite file. */
export function defaultDbPath(): string {
  return join(dataDir(), 'factory.db');
}

/**
 * Open (or create) the SQLite database with WAL mode and the standard pragmas.
 * Idempotent — safe to call once per process. Callers should `closeDatabase`
 * on graceful shutdown.
 */
export function openDatabase(path?: string): Database {
  const dbPath = path ?? defaultDbPath();
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  log.info({ dbPath }, 'opening sqlite database');
  const db = new BetterSqlite3(dbPath);

  // Pragmas tuned for the factory5 workload (single machine, multiple
  // long-lived processes, modest write throughput).
  db.pragma('journal_mode = WAL'); // concurrent readers, single writer
  db.pragma('synchronous = NORMAL'); // good durability without fsync per commit
  db.pragma('foreign_keys = ON'); // FKs are off by default in SQLite
  db.pragma('busy_timeout = 5000'); // wait up to 5s on lock contention

  return db;
}

/** Close the database. Logs any error but does not throw. */
export function closeDatabase(db: Database): void {
  try {
    db.close();
    log.info('sqlite database closed');
  } catch (err) {
    log.error({ err }, 'error closing sqlite database');
  }
}
