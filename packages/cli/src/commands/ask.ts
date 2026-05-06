/**
 * `factory ask "<question>"` — single-shot chat (Phase 4.4).
 *
 * Mints one `intent=chat` directive, awaits the brain's reply, prints,
 * exits. The mint + notify + reply-poll cycle is shared with `factory
 * chat` via {@link submitOneDirective} — see chat.ts.
 *
 * Two output modes:
 *
 *   - default (plain text): the reply text on its own line. Designed for
 *     `factory ask "what's the spend?"` use directly in a shell.
 *
 *   - `--json`: a single JSON object on stdout (no leading log noise),
 *     shape:
 *
 *         { "directive": "01K...", "reply": "...", "status": "reply" }
 *         { "directive": "01K...", "reply": null, "status": "timeout" }
 *         { "directive": "01K...", "reply": null, "status": "terminal-no-reply",
 *           "directiveStatus": "failed" }
 *
 *     Designed for piping: `factory ask "..." --json | jq -r .reply`.
 *
 * Exit codes:
 *   0 — got a reply
 *   1 — timeout, terminal-no-reply, or hard error (operator should
 *       inspect the directive — `factory status` shows it)
 *   2 — daemon not running / db not reachable (preflight)
 */

import { existsSync } from 'node:fs';
import { exit, stdout } from 'node:process';

import { loadDaemonEndpoint } from '@factory5/brain';
import { newId, type AutonomyMode } from '@factory5/core';
import { readPidFile } from '@factory5/daemon';
import { createDaemonClient, type DaemonClient } from '@factory5/ipc';
import { defaultDbPath, openDatabase, runMigrations } from '@factory5/state';
import type { Command } from 'commander';

import {
  submitOneDirective,
  type SubmitOneDirectiveDeps,
  type SubmitOneDirectiveResult,
} from './chat.js';

export const ASK_EXIT = {
  OK: 0,
  GENERIC_FAILURE: 1,
  PREFLIGHT_FAILURE: 2,
} as const;

export type AskExitCode = (typeof ASK_EXIT)[keyof typeof ASK_EXIT];

export interface HandlerResult {
  stdout: string;
  exitCode: AskExitCode;
}

export interface AskOptions {
  question: string;
  /** Emit a single JSON object instead of the bare reply text. */
  json?: boolean;
  /** `chat` (default) | `assisted` | `autonomous`. */
  autonomy?: AutonomyMode;
}

interface AskJsonShape {
  directive: string;
  reply: string | null;
  status: SubmitOneDirectiveResult['status'];
  directiveStatus?: string;
}

/**
 * Pure handler — caller passes the DB + notify hook so tests can inject.
 * Production wraps via `runAskCommand` (the Commander action), which adds
 * the preflight checks, opens the real DB, and builds a real notify hook.
 */
export async function runAsk(
  opts: AskOptions,
  deps: SubmitOneDirectiveDeps,
): Promise<HandlerResult> {
  const sessionId = `ask-${newId().toLowerCase()}`;
  const result = await submitOneDirective(
    {
      message: opts.question,
      sessionId,
      ...(opts.autonomy !== undefined ? { autonomy: opts.autonomy } : {}),
    },
    deps,
  );

  if (opts.json === true) {
    const payload: AskJsonShape = {
      directive: result.directiveId,
      reply: result.reply ?? null,
      status: result.status,
      ...(result.directiveStatus !== undefined ? { directiveStatus: result.directiveStatus } : {}),
    };
    return {
      stdout: `${JSON.stringify(payload)}\n`,
      exitCode: result.status === 'reply' ? ASK_EXIT.OK : ASK_EXIT.GENERIC_FAILURE,
    };
  }

  if (result.status === 'reply') {
    return { stdout: `${result.reply ?? ''}\n`, exitCode: ASK_EXIT.OK };
  }
  if (result.status === 'timeout') {
    return {
      stdout: `factory ask: timed out waiting for reply (directive ${result.directiveId} may still be running — check \`factory status\`)\n`,
      exitCode: ASK_EXIT.GENERIC_FAILURE,
    };
  }
  // terminal-no-reply
  return {
    stdout: `factory ask: directive ${result.directiveId} ${result.directiveStatus ?? 'terminal'} with no reply (likely dispatched as a non-chat intent — check \`factory status\`)\n`,
    exitCode: ASK_EXIT.GENERIC_FAILURE,
  };
}

// -----------------------------------------------------------------------------
// Commander wiring
// -----------------------------------------------------------------------------

function dbIsReachable(): boolean {
  return existsSync(defaultDbPath());
}

function parseAutonomy(raw: string): AutonomyMode {
  if (raw === 'chat' || raw === 'assisted' || raw === 'autonomous') return raw;
  throw new Error(`--autonomy must be chat | assisted | autonomous, got: ${raw}`);
}

export function registerAskCommand(program: Command): void {
  program
    .command('ask <question>')
    .description('single-shot chat — mint one chat directive, wait for the reply, print, exit')
    .option('--json', 'emit a JSON object instead of the bare reply text', false)
    .option('--autonomy <mode>', 'chat | assisted | autonomous', 'chat')
    .addHelpText(
      'after',
      `
Examples:
  factory ask "what's the spend this week?"
  factory ask "list my projects" --json | jq -r .reply
  factory ask "draft a release-note for v0.5.0" --autonomy assisted
`,
    )
    .action(async (question: string, opts: { json: boolean; autonomy: string }) => {
      // Preflight: same checks `factory chat` runs.
      const info = readPidFile();
      if (info?.alive !== true) {
        stdout.write('factory ask: no running daemon — start one with `factory daemon start`.\n');
        exit(ASK_EXIT.PREFLIGHT_FAILURE);
      }
      if (!dbIsReachable()) {
        stdout.write(
          'factory ask: no factory.db found. Start the daemon first so it creates it.\n',
        );
        exit(ASK_EXIT.PREFLIGHT_FAILURE);
      }

      const autonomy = parseAutonomy(opts.autonomy);
      const db = openDatabase();
      runMigrations(db);
      try {
        const endpoint = await loadDaemonEndpoint();
        const client: DaemonClient = createDaemonClient({ ...endpoint, timeoutMs: 2000 });
        const result = await runAsk(
          { question, json: opts.json, autonomy },
          {
            db,
            notify: async (directiveId) => {
              await client.notifyDirective({ directiveId, reason: 'new' });
            },
          },
        );
        stdout.write(result.stdout);
        if (result.exitCode !== ASK_EXIT.OK) exit(result.exitCode);
      } finally {
        db.close();
      }
    });
}
