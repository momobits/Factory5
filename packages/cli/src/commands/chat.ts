/**
 * `factory chat` — interactive REPL against the running daemon.
 *
 * Each turn:
 *   1. Read a line from stdin.
 *   2. Mint a `Directive` with `intent=chat`, payload `{ text }`,
 *      `channelRef` = our session id.
 *   3. Ring `POST /directives/notify` so the daemon's brain picks it up
 *      immediately instead of waiting for the next poll.
 *   4. Poll `outbound_messages` rows addressed to this session
 *      (`targetChannel='cli'`, `targetRef=sessionId`) and render any that
 *      arrive.
 *
 * The REPL intentionally uses SQLite polling for inbound delivery — simple
 * and independent from Fastify's SSE story. The CLI-RPC channel plugin
 * returns `delivered: false` when no live session is registered, so the
 * outbound row stays in the queue long enough for this poll to pick it up.
 *
 * The per-turn mint + notify + reply-poll cycle is exposed as
 * {@link submitOneDirective} so `factory ask "<question>"` (Phase 4.4) can
 * reuse it for single-shot mode without re-implementing the polling
 * dance.
 */

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import process, { exit, stdin, stdout } from 'node:process';

import { loadDaemonEndpoint } from '@factory5/brain';
import {
  directiveSchema,
  newId,
  type AutonomyMode,
  type Directive,
  type Intent,
} from '@factory5/core';
import { readPidFile } from '@factory5/daemon';
import { createDaemonClient, type DaemonClient } from '@factory5/ipc';
import { createLogger } from '@factory5/logger';
import {
  defaultDbPath,
  directives as directivesQ,
  openDatabase,
  outbound,
  runMigrations,
  type Database,
} from '@factory5/state';
import type { Command } from 'commander';

const log = createLogger('cli.chat');

/** Default poll cadence for the outbound-message reply check. */
export const DEFAULT_POLL_INTERVAL_MS = 250;
/** Default per-turn timeout: how long to wait for the daemon to reply. */
export const DEFAULT_TURN_TIMEOUT_MS = 120_000;

function dbIsReachable(): boolean {
  // SQLite file lives under the factory5 data dir; if the daemon hasn't
  // started once the file may not exist yet.
  return existsSync(defaultDbPath());
}

export interface SubmitOneDirectiveArgs {
  /** User-provided message text. Becomes the directive's `payload.text`. */
  message: string;
  /** Session id (`channelRef` on the directive); used to route the reply back. */
  sessionId: string;
  /** Default `'chat'`; chat surfaces accept the broader autonomy enum to mirror channels. */
  autonomy?: AutonomyMode;
  /** Override `process.env.USER`. Defaults to that or `'cli-user'`. */
  principal?: string;
}

export interface SubmitOneDirectiveDeps {
  /** Open SQLite handle. Caller owns the lifecycle. Tests pass their in-memory db. */
  db: Database;
  /**
   * Optional daemon-notify hook — fires after the directive is inserted to
   * shave the brain's poll latency. Failures are swallowed (logged at warn);
   * the poll loop still picks up the directive without it.
   */
  notify?: (directiveId: string) => Promise<void>;
  /** Override the poll cadence (ms). Tests pass small values for fast iteration. */
  pollIntervalMs?: number;
  /** Override the per-turn deadline (ms). Tests pass small values to exercise timeout. */
  turnTimeoutMs?: number;
  /** Test injection: deterministic clock for the deadline math. */
  now?: () => number;
}

export interface SubmitOneDirectiveResult {
  directiveId: string;
  /** Reply text when one arrives; `undefined` for `timeout` and `terminal-no-reply`. */
  reply: string | undefined;
  status: 'reply' | 'timeout' | 'terminal-no-reply';
  /** Populated only when status is `terminal-no-reply` — the directive's terminal status. */
  directiveStatus?: Directive['status'];
}

/**
 * Mint one chat directive, optionally ring the daemon, and poll for the
 * reply. Returned status discriminates the three outcomes a caller cares
 * about: `reply` (got a reply text), `timeout` (turn deadline passed
 * without anything appearing in `outbound_messages`), and
 * `terminal-no-reply` (the directive went `complete` / `failed` without
 * producing a chat reply — typical when the brain dispatched a non-chat
 * intent like a status read).
 *
 * The caller owns the DB and decides what to do with each outcome — chat
 * renders to stdout, ask formats JSON / plain text per `--json`.
 */
export async function submitOneDirective(
  args: SubmitOneDirectiveArgs,
  deps: SubmitOneDirectiveDeps,
): Promise<SubmitOneDirectiveResult> {
  const autonomy: AutonomyMode = args.autonomy ?? 'chat';
  const directive = directiveSchema.parse({
    id: newId(),
    source: 'cli',
    principal: args.principal ?? process.env['USER'] ?? 'cli-user',
    channelRef: args.sessionId,
    intent: 'chat' satisfies Intent,
    payload: { text: args.message },
    autonomy,
    createdAt: new Date().toISOString(),
    status: 'pending',
  });
  directivesQ.insert(deps.db, directive);

  if (deps.notify !== undefined) {
    try {
      await deps.notify(directive.id);
    } catch (err) {
      log.warn({ err, directiveId: directive.id }, 'submitOneDirective: notify failed');
    }
  }

  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const turnTimeoutMs = deps.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  const now = deps.now ?? ((): number => Date.now());
  const deadline = now() + turnTimeoutMs;

  const drainReply = (): string | undefined => {
    const pending = outbound.listPending(deps.db, 50);
    const mine = pending.filter((m) => m.targetChannel === 'cli' && m.targetRef === args.sessionId);
    if (mine.length === 0) return undefined;
    const ts = new Date().toISOString();
    for (const m of mine) outbound.markDelivered(deps.db, m.id, ts);
    return mine.map((m) => m.text).join('\n');
  };

  while (now() < deadline) {
    const reply = drainReply();
    if (reply !== undefined) {
      return { directiveId: directive.id, reply, status: 'reply' };
    }

    // Short-circuit: brain marked the directive terminal without a chat
    // reply (e.g., it dispatched as `intent=status` instead). Give a brief
    // grace window for a reply row that races the status flip, then
    // surface the terminal status to the caller.
    const d = directivesQ.getById(deps.db, directive.id);
    if (d !== undefined && (d.status === 'complete' || d.status === 'failed')) {
      await sleep(pollIntervalMs * 2);
      const lateReply = drainReply();
      if (lateReply !== undefined) {
        return { directiveId: directive.id, reply: lateReply, status: 'reply' };
      }
      return {
        directiveId: directive.id,
        reply: undefined,
        status: 'terminal-no-reply',
        directiveStatus: d.status,
      };
    }

    await sleep(pollIntervalMs);
  }

  return { directiveId: directive.id, reply: undefined, status: 'timeout' };
}

export function registerChatCommand(program: Command): void {
  program
    .command('chat')
    .description('interactive chat against factoryd')
    .option('--autonomy <mode>', 'chat | assisted | autonomous', 'chat')
    .action(async (opts: { autonomy: string }) => {
      const info = readPidFile();
      if (info?.alive !== true) {
        stdout.write('factory chat: no running daemon — start one with `factory daemon start`.\n');
        exit(2);
      }
      if (!dbIsReachable()) {
        stdout.write(
          'factory chat: no factory.db found. Start the daemon first so it creates it.\n',
        );
        exit(2);
      }

      const autonomy = parseAutonomy(opts.autonomy);
      const sessionId = `chat-${newId().toLowerCase()}`;
      const db = openDatabase();
      runMigrations(db);

      const endpoint = await loadDaemonEndpoint();
      const client: DaemonClient = createDaemonClient({ ...endpoint, timeoutMs: 2000 });

      stdout.write(`factory chat — session ${sessionId}\n`);
      stdout.write(`  autonomy: ${autonomy}\n`);
      stdout.write('  type /quit to exit.\n\n');

      const rl = createInterface({ input: stdin, output: stdout });
      try {
        while (true) {
          let line: string;
          try {
            line = (await rl.question('you> ')).trim();
          } catch {
            // EOF (Ctrl-D or stdin closed).
            break;
          }
          if (line.length === 0) continue;
          if (line === '/quit' || line === '/exit') break;

          const result = await submitOneDirective(
            { message: line, sessionId, autonomy },
            {
              db,
              notify: async (directiveId) => {
                await client.notifyDirective({ directiveId, reason: 'new' });
              },
            },
          );

          if (result.status === 'reply') {
            stdout.write(`daemon> ${result.reply ?? ''}\n`);
          } else if (result.status === 'timeout') {
            stdout.write('  (no reply within 2 min — directive may still be running)\n');
          } else {
            stdout.write(`  (directive ${result.directiveStatus ?? 'terminal'} — no reply)\n`);
          }
        }
      } finally {
        rl.close();
        db.close();
      }
      stdout.write('bye.\n');
    });
}

function parseAutonomy(raw: string): AutonomyMode {
  if (raw === 'chat' || raw === 'assisted' || raw === 'autonomous') return raw;
  throw new Error(`--autonomy must be chat | assisted | autonomous, got: ${raw}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
