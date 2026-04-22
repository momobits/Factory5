/**
 * `factory chat` — interactive REPL against the running daemon.
 *
 * Each turn:
 *   1. Read a line from stdin.
 *   2. Write a `Directive` with `intent=chat`, payload `{ text }`,
 *      `channelRef` = our session id.
 *   3. Ring `POST /directives/notify` so the daemon's brain picks it up
 *      immediately instead of waiting for the next poll.
 *   4. Poll `outbound_messages` rows addressed to this session (targetChannel
 *      = 'cli', targetRef = sessionId) and render any that arrive.
 *
 * The REPL intentionally uses SQLite polling for inbound delivery — simple
 * and independent from Fastify's SSE story. The CLI-RPC channel plugin
 * returns `delivered: false` when no live session is registered, so the
 * outbound row stays in the queue long enough for this poll to pick it up.
 */

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import process, { exit, stdin, stdout } from 'node:process';

import { readPidFile } from '@factory5/daemon';
import { directiveSchema, newId, type AutonomyMode, type Intent } from '@factory5/core';
import { loadDaemonEndpoint } from '@factory5/brain';
import { createDaemonClient } from '@factory5/ipc';
import { createLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  outbound,
  runMigrations,
  defaultDbPath,
} from '@factory5/state';
import type { Command } from 'commander';

const log = createLogger('cli.chat');

/** Polls every 250 ms for outbound messages addressed to our session. */
const POLL_INTERVAL_MS = 250;
/** Hard cap for a single turn: how long to wait for the daemon to reply. */
const TURN_TIMEOUT_MS = 120_000;

function dbIsReachable(): boolean {
  // SQLite file lives under the factory5 data dir; if the daemon hasn't
  // started once the file may not exist yet.
  const path = defaultDbPath();
  return existsSync(path);
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
      const client = createDaemonClient({ ...endpoint, timeoutMs: 2000 });

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

          const directive = directiveSchema.parse({
            id: newId(),
            source: 'cli',
            principal: process.env['USER'] ?? 'cli-user',
            channelRef: sessionId,
            intent: 'chat' satisfies Intent,
            payload: { text: line },
            autonomy,
            createdAt: new Date().toISOString(),
            status: 'pending',
          });
          directivesQ.insert(db, directive);

          // Wake the daemon — failures are non-fatal (the claim loop still
          // polls every 250 ms, so chat still works without the HTTP round
          // trip).
          try {
            await client.notifyDirective({ directiveId: directive.id, reason: 'new' });
          } catch (err) {
            log.warn(
              { err, directiveId: directive.id },
              'notifyDirective failed — relying on poll',
            );
          }

          const reply = await awaitReply(sessionId, directive.id);
          if (reply === undefined) {
            stdout.write('  (no reply within 2 min — directive may still be running)\n');
          } else {
            stdout.write(`daemon> ${reply}\n`);
          }
        }
      } finally {
        rl.close();
        db.close();
      }
      stdout.write('bye.\n');
    });

  // Helper: poll outbound_messages for messages to this session. Marks rows
  // as delivered as we read them so they don't loop.
  async function awaitReply(sessionId: string, directiveId: string): Promise<string | undefined> {
    const deadline = Date.now() + TURN_TIMEOUT_MS;
    const db = openDatabase();
    try {
      while (Date.now() < deadline) {
        const pending = outbound.listPending(db, 50);
        const mine = pending.filter((m) => m.targetChannel === 'cli' && m.targetRef === sessionId);
        if (mine.length > 0) {
          const now = new Date().toISOString();
          for (const m of mine) outbound.markDelivered(db, m.id, now);
          return mine.map((m) => m.text).join('\n');
        }
        // Also give up early if the directive went terminal without a reply
        // (brain may short-circuit intents it doesn't handle).
        const d = directivesQ.getById(db, directiveId);
        if (d !== undefined && (d.status === 'complete' || d.status === 'failed')) {
          // Give a short grace for a reply row that races the status update.
          await sleep(POLL_INTERVAL_MS * 2);
          const late = outbound
            .listPending(db)
            .filter((m) => m.targetChannel === 'cli' && m.targetRef === sessionId);
          if (late.length > 0) {
            const now = new Date().toISOString();
            for (const m of late) outbound.markDelivered(db, m.id, now);
            return late.map((m) => m.text).join('\n');
          }
          return `(directive ${d.status} — no reply)`;
        }
        await sleep(POLL_INTERVAL_MS);
      }
      return undefined;
    } finally {
      db.close();
    }
  }
}

function parseAutonomy(raw: string): AutonomyMode {
  if (raw === 'chat' || raw === 'assisted' || raw === 'autonomous') return raw;
  throw new Error(`--autonomy must be chat | assisted | autonomous, got: ${raw}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
