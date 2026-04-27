/**
 * `factory questions ...` — operator-facing maintenance commands for the
 * `pending_questions` table.
 *
 * Current surface:
 *
 *   factory questions cleanup [--since <iso-date>] [--dry-run]
 *     Mark `ask_user` / escalation rows whose parent directive ended in a
 *     terminal state (`complete` / `failed` / `blocked`) as answered with
 *     a synthetic note. These are escalations the operator never replied
 *     to — by the time anyone does, the brain has long since moved on,
 *     so the row is just noise on `factory status` etc. Marking them
 *     answered (rather than deleting) preserves forensic value while
 *     getting them out of the open-questions view.
 *
 * Straight SQL — works whether or not factoryd is running.
 */

import process, { exit, stdout as defaultStdout } from 'node:process';

import { createLogger } from '@factory5/logger';
import { openDatabase, pendingQuestions, runMigrations, type Database } from '@factory5/state';
import type { Command } from 'commander';

const log = createLogger('cli.questions');

interface Stdoutish {
  write(chunk: string): boolean;
}

export interface RunQuestionsCleanupOptions {
  db: Database;
  /** ISO-8601 date/datetime; rows created strictly before this are eligible. */
  since?: string;
  /** When true: list orphans but don't write. */
  dryRun?: boolean;
  stdout?: Stdoutish;
  /** Override clock — useful for tests that want a deterministic stamp. */
  now?: () => Date;
}

export interface RunQuestionsCleanupResult {
  /** Total orphans found. */
  found: number;
  /** Rows actually written (0 in dry-run). */
  marked: number;
  /** Exit code: 0 success, 2 invalid input. */
  exitCode: 0 | 2;
}

/**
 * Pure, testable form of `factory questions cleanup`. The thin Commander
 * wrapper below opens the database, threads stdout, and exits the process.
 */
export function runQuestionsCleanup(opts: RunQuestionsCleanupOptions): RunQuestionsCleanupResult {
  const out: Stdoutish = opts.stdout ?? defaultStdout;
  const now = opts.now ?? ((): Date => new Date());

  if (opts.since !== undefined && Number.isNaN(Date.parse(opts.since))) {
    out.write(
      `factory questions cleanup: --since must be an ISO-8601 date/datetime, got ${JSON.stringify(opts.since)}\n`,
    );
    return { found: 0, marked: 0, exitCode: 2 };
  }

  const orphans = pendingQuestions.findOrphaned(
    opts.db,
    opts.since !== undefined ? { since: opts.since } : {},
  );

  if (orphans.length === 0) {
    out.write('factory questions cleanup: no orphaned questions found.\n');
    return { found: 0, marked: 0, exitCode: 0 };
  }

  out.write(`Found ${String(orphans.length)} orphaned question(s):\n`);
  for (const o of orphans) {
    const summary = truncate(firstLine(o.question), 80);
    out.write(
      `  ${o.id}  directive=${o.directiveId} (${o.directiveStatus}, ${o.directiveSource})  created=${o.createdAt}\n`,
    );
    out.write(`    "${summary}"\n`);
  }

  if (opts.dryRun === true) {
    out.write(`\nDry run — no rows written. Re-run without --dry-run to mark them answered.\n`);
    return { found: orphans.length, marked: 0, exitCode: 0 };
  }

  const when = now().toISOString();
  for (const o of orphans) {
    pendingQuestions.markOrphanAnswered(opts.db, o, when);
  }
  out.write(`\nMarked ${String(orphans.length)} question(s) as answered with a synthetic note.\n`);
  return { found: orphans.length, marked: orphans.length, exitCode: 0 };
}

interface CleanupCliOptions {
  since?: string;
  dryRun?: boolean;
}

export function registerQuestionsCommand(program: Command): void {
  const group = program
    .command('questions')
    .description('inspect or repair pending-question state');

  group
    .command('cleanup')
    .description(
      'mark un-answered questions whose directive already ended (complete/failed/blocked) as answered with a synthetic note',
    )
    .option(
      '--since <iso-date>',
      'only sweep rows created strictly before this ISO-8601 date/datetime',
    )
    .option('--dry-run', 'list what would change without writing')
    .action((opts: CleanupCliOptions) => {
      const db = openDatabase();
      try {
        runMigrations(db);
        const result = runQuestionsCleanup({
          db,
          ...(opts.since !== undefined ? { since: opts.since } : {}),
          ...(opts.dryRun === true ? { dryRun: true } : {}),
        });
        if (result.exitCode !== 0) {
          exit(result.exitCode);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err }, 'questions cleanup failed');
        defaultStdout.write(`factory questions cleanup: error: ${msg}\n`);
        exit(1);
      } finally {
        db.close();
      }
      // Graceful exit — Commander may leave the event loop pinned.
      process.exitCode ??= 0;
    });
}

function firstLine(s: string): string {
  const i = s.indexOf('\n');
  return i < 0 ? s : s.slice(0, i);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
