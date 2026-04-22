#!/usr/bin/env tsx
/**
 * Live smoke test for the Telegram channel plugin (Phase 7c.6).
 *
 * Run with: `pnpm tsx scripts/telegram-smoke.ts`
 *
 * Exercises the real HTTP path end-to-end — no stub — against the
 * operator's real `[channels.telegram]` block in `config.toml`:
 *
 *   1. Load the user's real config.toml, extract `botToken` +
 *      `testChatId`.
 *   2. Boot a `TelegramChannel` instance with autoPoll=true against
 *      an in-memory SQLite db (so we don't touch the production
 *      factory.db).
 *   3. Send a kick-off message to the test chat: "smoke: reply 'pong'
 *      within 60s to pass".
 *   4. Wait up to 60s for an inbound message to fire onInbound; echo
 *      it back via `plugin.send` (proves both inbound + outbound).
 *   5. Stop the plugin, report pass/fail.
 *
 * Zero LLM spend — Telegram's API is HTTP, not an LLM surface.
 */

import { exit, stdout } from 'node:process';

import type { Directive } from '@factory5/core';
import { channelConfigFor, loadConfig } from '@factory5/brain';
import {
  createTelegramChannel,
  telegramConfigSchema,
  type TelegramPluginConfig,
} from '@factory5/channels';
import { createLogger, initLogger } from '@factory5/logger';
import { openDatabase, runMigrations } from '@factory5/state';

const DEADLINE_MS = 60_000;

async function main(): Promise<void> {
  initLogger({ processName: 'telegram-smoke', noConsole: false });
  const log = createLogger('telegram-smoke');

  // 1. Real config.
  const cfg = await loadConfig();
  if (cfg === undefined) {
    stdout.write('FAIL: no config.toml — run `factory init --telegram-token <t>` first.\n');
    exit(1);
  }
  const rawBlock = channelConfigFor(cfg, 'telegram');
  if (rawBlock === undefined) {
    stdout.write('FAIL: no [channels.telegram] block in config.toml.\n');
    exit(1);
  }
  let tgConfig: TelegramPluginConfig;
  try {
    tgConfig = telegramConfigSchema.parse(rawBlock);
  } catch (err) {
    stdout.write(
      `FAIL: [channels.telegram] failed schema validation: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    exit(1);
  }
  if (tgConfig.testChatId === undefined) {
    stdout.write(
      'FAIL: [channels.telegram].testChatId is required for the live smoke.\n  Set it with `factory init --telegram-test-chat <id>`.\n',
    );
    exit(1);
  }

  // 2. In-memory db so we don't touch production state.
  const db = openDatabase(':memory:');
  runMigrations(db);

  stdout.write(`\nTelegram live-smoke — chat ${String(tgConfig.testChatId)}\n`);
  stdout.write('  Starting plugin against api.telegram.org…\n');

  let inbound: Directive | undefined;
  const plugin = createTelegramChannel({ db, autoPoll: true });
  await plugin.start(
    {
      log,
      onInbound: (d) => {
        if (inbound !== undefined) return;
        inbound = d;
        log.info(
          {
            directiveId: d.id,
            intent: d.intent,
            principal: d.principal,
            channelRef: d.channelRef,
          },
          'smoke: received inbound directive',
        );
      },
    },
    tgConfig,
  );

  // 3. Kick-off message.
  const kickoff = await plugin.send({
    id: 'smoke-kickoff',
    targetChannel: 'telegram',
    targetRef: String(tgConfig.testChatId),
    text: `smoke: reply anything within ${Math.floor(DEADLINE_MS / 1000).toString()}s to pass`,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  if (!kickoff.delivered) {
    stdout.write(`FAIL: kickoff send failed: ${kickoff.error ?? '(unknown)'}\n`);
    await plugin.stop();
    db.close();
    exit(1);
  }
  stdout.write(`  ✓ kickoff sent (message_id ${String(kickoff.externalId ?? '?')})\n`);
  stdout.write(`  Waiting up to ${Math.floor(DEADLINE_MS / 1000).toString()}s for your reply…\n`);

  // 4. Wait for inbound.
  const start = Date.now();
  while (inbound === undefined && Date.now() - start < DEADLINE_MS) {
    await new Promise((r) => setTimeout(r, 250));
  }
  if (inbound === undefined) {
    stdout.write('FAIL: no inbound message within deadline.\n');
    await plugin.stop();
    db.close();
    exit(2);
  }
  stdout.write(
    `  ✓ inbound received — intent=${inbound.intent} channelRef=${inbound.channelRef}\n`,
  );

  // 5. Echo back to prove outbound-on-thread works.
  const echo = await plugin.send({
    id: 'smoke-echo',
    targetChannel: 'telegram',
    targetRef: inbound.channelRef,
    text: `ack: received ${(inbound.payload as { text?: string }).text ?? '(?)'}`,
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  if (!echo.delivered) {
    stdout.write(`FAIL: echo send failed: ${echo.error ?? '(unknown)'}\n`);
    await plugin.stop();
    db.close();
    exit(3);
  }
  stdout.write(`  ✓ echo sent (message_id ${String(echo.externalId ?? '?')})\n`);

  await plugin.stop();
  db.close();
  stdout.write('\nAll checks passed — Telegram round-trip works end-to-end.\n');
}

main().catch((err: unknown) => {
  stdout.write(`telegram-smoke: unhandled error: ${(err as Error).message}\n`);
  stdout.write(`${(err as Error).stack ?? ''}\n`);
  exit(1);
});
