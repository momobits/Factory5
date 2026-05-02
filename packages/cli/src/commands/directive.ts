/**
 * `factory directive …` — operator-facing subcommands for inspecting and
 * repairing directive state.
 *
 * Current surface:
 *
 *   factory directive mark-blocked <id> [--reason <text>]
 *     Flip a non-terminal directive to `blocked` and optionally record a
 *     reason. Handy when the brain left a directive stuck `running` after
 *     an escalation-kill (shell timeout, ctrl-C, background-task kill) and
 *     you want a clean status instead of a manual SQL poke. **Does not**
 *     touch in-flight worker subprocesses; the row simply changes status.
 *     Use {@link registerCancelCommand `factory cancel <id>`} (Phase 2.4)
 *     when you want the actual workers killed in addition to the row
 *     flipping — that path goes through the daemon's
 *     `POST /directives/:id/cancel` and propagates an AbortSignal into
 *     the worker subprocess.
 *
 * This is a straight SQL command — works whether or not factoryd is
 * running. The brain's own serve loop only touches `pending` and `claimed`
 * rows, so flipping a `running` row from underneath it is safe.
 */

import { exit, stdout } from 'node:process';

import { createLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  MarkBlockedError,
  openDatabase,
  runMigrations,
} from '@factory5/state';
import type { Command } from 'commander';

const log = createLogger('cli.directive');

export function registerDirectiveCommand(program: Command): void {
  const group = program.command('directive').description('inspect or repair directive state');

  group
    .command('mark-blocked <id>')
    .description(
      'flip a non-terminal directive to blocked (manual recovery for stuck `running` rows)',
    )
    .option('--reason <text>', 'free-text explanation stored on the directive')
    .action((id: string, opts: { reason?: string }) => {
      const db = openDatabase();
      try {
        runMigrations(db);

        const existing = directivesQ.getById(db, id);
        if (existing === undefined) {
          stdout.write(`factory directive mark-blocked: no directive with id ${id}\n`);
          exit(2);
        }
        if (existing.status !== 'running') {
          stdout.write(
            `factory directive mark-blocked: directive ${id} is ${existing.status}; ` +
              'refusing to mark blocked (only `running` directives can be recovered this way).\n',
          );
          exit(2);
        }

        const updated = directivesQ.markBlocked(db, id, opts.reason);
        stdout.write(
          `factory directive mark-blocked: ${id} → blocked` +
            (updated.blockedReason !== undefined ? ` (reason: ${updated.blockedReason})` : '') +
            '\n',
        );
      } catch (err) {
        if (err instanceof MarkBlockedError) {
          // The pre-check above already filtered NOT_FOUND and most
          // ALREADY_TERMINAL cases, but a concurrent writer could still race
          // us — report cleanly instead of crashing.
          stdout.write(`factory directive mark-blocked: ${err.message}\n`);
          exit(2);
        }
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ err }, 'directive mark-blocked failed');
        stdout.write(`factory directive mark-blocked: error: ${msg}\n`);
        exit(1);
      } finally {
        db.close();
      }
    });
}
