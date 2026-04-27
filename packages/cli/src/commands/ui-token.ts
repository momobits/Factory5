/**
 * `factory ui-token` — print the live dashboard URL with the current
 * `FACTORY5_UI_TOKEN` (per ADR 0025 §2). The token rotates per daemon
 * startup, so operators who close the terminal lose the URL from
 * scrollback. This command queries the running daemon for its current
 * token via the loopback-only `/ui-token` endpoint and prints the
 * dashboard URL.
 *
 * Output shapes:
 *
 *   - Static SPA bundle present (`pnpm --filter factory-web build`):
 *     `http://127.0.0.1:<port>/app/?t=<token>`
 *   - Static bundle missing: dev-server URL plus a hint to run
 *     `pnpm --filter factory-web build` or
 *     `pnpm --filter factory-web dev`.
 *   - No daemon running: hint to run `factory daemon start`.
 *   - Daemon running CLI-only (no UI): hint that this build is CLI-only.
 *
 * `--token-only` prints just the token (no URL, no hint) for piping
 * into env vars or curl `Authorization: Bearer ...` headers.
 */

import { loadDaemonEndpoint } from '@factory5/brain';
import { readPidFile } from '@factory5/daemon';
import { IpcRequestError, createDaemonClient } from '@factory5/ipc';
import type { Command } from 'commander';

export interface RunUiTokenOptions {
  /** When true, print just the token (no URL, no hint). */
  tokenOnly?: boolean;
  /** Stream to write CLI output to. Defaults to `process.stdout`. */
  stdout?: { write(chunk: string): boolean | void };
  /** Pidfile reader. Override for tests. Defaults to `readPidFile`. */
  readPidFile?: () => { pid: number; alive: boolean } | undefined;
  /** Endpoint loader. Override for tests. Defaults to `loadDaemonEndpoint`. */
  loadEndpoint?: () => Promise<{ host: string; port: number }>;
  /** Daemon-client factory. Override for tests. Defaults to `createDaemonClient`. */
  createClient?: typeof createDaemonClient;
}

/** Exit codes used by {@link runUiToken}. `0` = ok, non-zero = error class. */
export const UI_TOKEN_EXIT = {
  OK: 0,
  GENERIC_FAILURE: 1,
  DAEMON_NOT_RUNNING: 2,
  UI_DISABLED: 3,
} as const;

export type UiTokenExitCode = (typeof UI_TOKEN_EXIT)[keyof typeof UI_TOKEN_EXIT];

/**
 * Pure logic for `factory ui-token`. Returns the exit code instead of
 * calling `process.exit`, so it's straightforward to drive from tests.
 */
export async function runUiToken(opts: RunUiTokenOptions = {}): Promise<UiTokenExitCode> {
  const out = opts.stdout ?? process.stdout;
  const readPid = opts.readPidFile ?? readPidFile;
  const loadEndpoint = opts.loadEndpoint ?? loadDaemonEndpoint;
  const createClient = opts.createClient ?? createDaemonClient;

  const info = readPid();
  if (info?.alive !== true) {
    out.write('factory ui-token: no running daemon — start one with `factory daemon start`.\n');
    return UI_TOKEN_EXIT.DAEMON_NOT_RUNNING;
  }

  const endpoint = await loadEndpoint();
  const client = createClient({ ...endpoint, timeoutMs: 2000 });
  let resp;
  try {
    resp = await client.uiToken();
  } catch (err) {
    if (err instanceof IpcRequestError && err.code === 'UI_DISABLED') {
      out.write('factory ui-token: daemon is running CLI-only (no UI bundle configured).\n');
      return UI_TOKEN_EXIT.UI_DISABLED;
    }
    const msg = err instanceof Error ? err.message : String(err);
    out.write(`factory ui-token: failed to reach daemon — ${msg}\n`);
    return UI_TOKEN_EXIT.GENERIC_FAILURE;
  }

  if (opts.tokenOnly === true) {
    out.write(`${resp.token}\n`);
    return UI_TOKEN_EXIT.OK;
  }

  out.write(`${resp.url}\n`);
  if (!resp.hasStaticBundle) {
    out.write(
      "  (SPA bundle missing — run 'pnpm --filter factory-web build' to host from factoryd, or 'pnpm --filter factory-web dev' to use this URL)\n",
    );
  }
  return UI_TOKEN_EXIT.OK;
}

export function registerUiTokenCommand(program: Command): void {
  program
    .command('ui-token')
    .description('print the live dashboard URL with the current FACTORY5_UI_TOKEN')
    .option('--token-only', 'print just the token (for piping into env vars)', false)
    .action(async (opts: { tokenOnly: boolean }) => {
      const code = await runUiToken({ tokenOnly: opts.tokenOnly });
      if (code !== UI_TOKEN_EXIT.OK) process.exit(code);
    });
}
