/**
 * `factory cancel <directive-id> [--reason text]` — Phase 2.4 active-cancel.
 *
 * Two paths, prefer-IPC:
 *
 *   1. Daemon up → `POST /directives/:id/cancel` over IPC. The daemon's
 *      route flips the row to `failed` AND fires the brain's per-directive
 *      `AbortController`, which propagates to the worker subprocess
 *      (SIGTERM, then SIGKILL after the 5 s grace window in the
 *      claude-cli provider). The whole cancel completes inside the 10 s
 *      acceptance budget.
 *   2. Daemon down → `state.cancelDirective(db, id, reason)` writes the
 *      row directly. The worker subprocess (if any, in another shell)
 *      keeps running until it self-checks the directive's status —
 *      degraded experience, but the row is reconciled immediately for
 *      anyone querying state.
 *
 * Distinct from `factory directive mark-blocked <id>`:
 *
 *   - `cancel`         → flips to `failed`, kills the worker (when daemon-mediated)
 *   - `mark-blocked`   → flips to `blocked`, never touches in-flight work
 */

import process, { exit, stdout } from 'node:process';

import { loadDaemonEndpoint } from '@factory5/brain';
import { readPidFile } from '@factory5/daemon';
import { IpcRequestError, createDaemonClient, type DaemonClient } from '@factory5/ipc';
import { createLogger } from '@factory5/logger';
import {
  CancelDirectiveError,
  directives as directivesQ,
  openDatabase,
  runMigrations,
  type Database,
} from '@factory5/state';
import type { Command } from 'commander';

const log = createLogger('cli.cancel');

export const CANCEL_EXIT = {
  OK: 0,
  GENERIC_FAILURE: 1,
  NOT_FOUND: 2,
  ALREADY_TERMINAL: 3,
} as const;

export type CancelExitCode = (typeof CANCEL_EXIT)[keyof typeof CANCEL_EXIT];

export interface RunCancelOptions {
  directiveId: string;
  reason?: string;
  /** Output stream. Defaults to `process.stdout`. */
  stdout?: { write(chunk: string): boolean | void };
  /** Pidfile reader. Override for tests. Defaults to `readPidFile`. */
  readPidFile?: () => { pid: number; alive: boolean } | undefined;
  /** Endpoint loader. Override for tests. Defaults to `loadDaemonEndpoint`. */
  loadEndpoint?: () => Promise<{ host: string; port: number }>;
  /** Daemon-client factory. Override for tests. Defaults to `createDaemonClient`. */
  createClient?: typeof createDaemonClient;
  /** Database handle for the DB-fallback path. Tests pass their own; production opens the default. */
  db?: Database;
}

/**
 * Pure logic for `factory cancel`. Returns the exit code instead of
 * calling `process.exit`, mirroring {@link runUiToken}'s shape so the
 * command is straightforward to drive from tests.
 */
export async function runCancel(opts: RunCancelOptions): Promise<CancelExitCode> {
  const out = opts.stdout ?? process.stdout;
  const readPid = opts.readPidFile ?? readPidFile;

  // -------- Daemon path --------
  const info = readPid();
  if (info?.alive === true) {
    const loadEndpoint = opts.loadEndpoint ?? loadDaemonEndpoint;
    const createClient = opts.createClient ?? createDaemonClient;
    const endpoint = await loadEndpoint();
    const client: DaemonClient = createClient({ ...endpoint, timeoutMs: 5000 });
    try {
      const resp = await client.cancelDirective(opts.directiveId, {
        ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      });
      out.write(
        `factory cancel: ${resp.directive.id} → failed` +
          (resp.directive.blockedReason !== undefined
            ? ` (reason: ${resp.directive.blockedReason})`
            : '') +
          (resp.abortFired
            ? '\n  worker abort signalled — subprocess will exit within ~5 s.\n'
            : '\n  no in-flight worker found in the daemon — DB row updated.\n'),
      );
      return CANCEL_EXIT.OK;
    } catch (err) {
      if (err instanceof IpcRequestError) {
        if (err.code === 'NOT_FOUND') {
          out.write(`factory cancel: ${err.message}\n`);
          return CANCEL_EXIT.NOT_FOUND;
        }
        if (err.code === 'ALREADY_TERMINAL') {
          out.write(`factory cancel: ${err.message}\n`);
          return CANCEL_EXIT.ALREADY_TERMINAL;
        }
        out.write(
          `factory cancel: daemon returned ${String(err.httpStatus)} ${err.code} — ${err.message}\n`,
        );
        return CANCEL_EXIT.GENERIC_FAILURE;
      }
      // Connection-refused / network — fall through to DB-direct so the
      // operator gets a row update even if the daemon's wedged.
      log.warn(
        { err, directiveId: opts.directiveId },
        'cancel: IPC failed — falling through to DB-direct',
      );
      out.write(
        `factory cancel: daemon unreachable — falling back to DB-direct (worker may continue running).\n`,
      );
      // fall through
    }
  }

  // -------- DB-direct fallback --------
  const ownsDb = opts.db === undefined;
  const db = opts.db ?? openDatabase();
  try {
    if (ownsDb) runMigrations(db);
    const updated = directivesQ.cancelDirective(db, opts.directiveId, opts.reason);
    out.write(
      `factory cancel: ${updated.id} → failed` +
        (updated.blockedReason !== undefined ? ` (reason: ${updated.blockedReason})` : '') +
        '\n  (DB-direct write only — workers in another process may continue until their next directive-status check)\n',
    );
    return CANCEL_EXIT.OK;
  } catch (err) {
    if (err instanceof CancelDirectiveError) {
      out.write(`factory cancel: ${err.message}\n`);
      return err.code === 'NOT_FOUND' ? CANCEL_EXIT.NOT_FOUND : CANCEL_EXIT.ALREADY_TERMINAL;
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, directiveId: opts.directiveId }, 'cancel: DB-direct failed');
    out.write(`factory cancel: error: ${msg}\n`);
    return CANCEL_EXIT.GENERIC_FAILURE;
  } finally {
    if (ownsDb) db.close();
  }
}

export function registerCancelCommand(program: Command): void {
  program
    .command('cancel <directiveId>')
    .description(
      'actively cancel a directive — flip to `failed` and kill the worker (use `factory directive mark-blocked` to flip a stuck row without killing anything)',
    )
    .option('--reason <text>', 'free-text reason persisted to the directive')
    .addHelpText(
      'after',
      `
Examples:
  factory cancel 01KQ…ULID
  factory cancel 01KQ…ULID --reason "wrong project"
  factory cancel 01KQ…ULID --reason "out of budget"

Exit codes:
  0  cancelled
  1  hard error
  2  directive id not found
  3  directive already terminal (complete | failed | blocked)
`,
    )
    .action(async (directiveId: string, opts: { reason?: string }) => {
      const code = await runCancel({
        directiveId,
        ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
      });
      if (code !== CANCEL_EXIT.OK) exit(code);
    });
}

// Tiny re-export so `registerCancelCommand` callers can format their own
// "factory cancel: …" lines without re-stating the prefix.
export const CANCEL_OUTPUT_PREFIX = 'factory cancel:';
void stdout; // silence unused-import lint when the registration helper isn't called
