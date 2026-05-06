/**
 * `factory doctor` — one-shot environment check. Verifies:
 *   - The Claude CLI is installed and reports a version
 *   - `claude-cli` provider reports `available()`
 *   - A cheap `triage` call succeeds (quick-tier, round-trip JSON)
 *
 * Handy on first-time setup and for validating the provider stack before
 * burning a real build's worth of tokens.
 */

import { stdout, exit } from 'node:process';

import {
  buildDefaultRegistry,
  channelConfigFor,
  loadConfig,
  triageDirective,
} from '@factory5/brain';
import { ClaudeCliProvider } from '@factory5/providers';
import { defaultTelegramApiFactory } from '@factory5/channels';
import { Client, Events, GatewayIntentBits, REST, Routes } from 'discord.js';
import type { Command } from 'commander';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('verify providers + channels + environment (makes one quick Claude call)')
    .option('--skip-call', 'only check binary availability; do not call the model', false)
    .option('--skip-discord', 'skip the Discord probe even if a token is configured', false)
    .option('--skip-telegram', 'skip the Telegram probe even if a token is configured', false)
    .addHelpText(
      'after',
      `
Examples:
  factory doctor                       # full check: provider + channels + triage
  factory doctor --skip-call           # binary availability only — no model spend
  factory doctor --skip-discord        # offline / no Discord token configured
`,
    )
    .action(async (opts: { skipCall?: boolean; skipDiscord?: boolean; skipTelegram?: boolean }) => {
      const provider = new ClaudeCliProvider();
      stdout.write('Checking claude-cli provider…\n');
      const available = await provider.available();
      stdout.write(`  available(): ${String(available)}\n`);
      if (!available) {
        stdout.write(
          '\nclaude-cli is not available. Install the Claude Code CLI, or set FACTORY5_CLAUDE_CLI_PATH.\n',
        );
        exit(1);
      }

      // Discord probe (only when [channels.discord].token is configured).
      const cfg = await loadConfig().catch(() => undefined);
      const discord = channelConfigFor(cfg, 'discord') as
        | { token?: string; guildId?: string }
        | undefined;
      const hasToken = typeof discord?.token === 'string' && discord.token.length > 0;
      if (hasToken && opts.skipDiscord !== true) {
        stdout.write('\nChecking Discord (channel)…\n');
        const ok = await probeDiscord(discord!.token!, discord?.guildId);
        stdout.write(
          `  rest:       ${ok.restOk ? 'ok (token accepted)' : 'FAILED (token rejected)'}\n`,
        );
        stdout.write(`  login:      ${ok.login ? 'ok' : 'FAILED (gateway)'}\n`);
        if (ok.tag !== undefined) {
          stdout.write(`  bot:        ${ok.tag}\n`);
        }
        if (ok.guilds !== undefined) {
          stdout.write(`  guilds:     ${String(ok.guilds)} visible\n`);
        }
        if (ok.guildMatch !== undefined) {
          stdout.write(`  guildId:    ${ok.guildMatch ? 'reachable' : 'NOT REACHABLE'}\n`);
        }
        if (ok.error !== undefined) {
          stdout.write(`  error:      ${ok.error}\n`);
        }
        if (ok.hint !== undefined) {
          stdout.write(`  hint:       ${ok.hint}\n`);
        }
        if (!ok.login) {
          exit(2);
        }
      } else if (hasToken && opts.skipDiscord === true) {
        stdout.write('\nDiscord probe skipped (--skip-discord)\n');
      }

      // Telegram probe (only when [channels.telegram].botToken is configured).
      const telegram = channelConfigFor(cfg, 'telegram') as
        | { botToken?: string; testChatId?: number }
        | undefined;
      const hasTelegramToken =
        typeof telegram?.botToken === 'string' && telegram.botToken.length > 0;
      if (hasTelegramToken && opts.skipTelegram !== true) {
        stdout.write('\nChecking Telegram (channel)…\n');
        const tgResult = await probeTelegram(telegram!.botToken!);
        stdout.write(
          `  getMe:      ${tgResult.ok ? 'ok (token accepted)' : 'FAILED (token rejected)'}\n`,
        );
        if (tgResult.username !== undefined) {
          stdout.write(`  bot:        @${tgResult.username}\n`);
        }
        if (telegram?.testChatId !== undefined) {
          stdout.write(`  testChatId: ${String(telegram.testChatId)}\n`);
        }
        if (tgResult.error !== undefined) {
          stdout.write(`  error:      ${tgResult.error}\n`);
        }
        if (!tgResult.ok) exit(3);
      } else if (hasTelegramToken && opts.skipTelegram === true) {
        stdout.write('\nTelegram probe skipped (--skip-telegram)\n');
      }

      if (opts.skipCall === true) {
        stdout.write('\n--skip-call set; done.\n');
        return;
      }

      stdout.write('\nCalling triage (quick tier) with a test directive…\n');
      const registry = buildDefaultRegistry();
      const result = await triageDirective('build me a weather CLI', { registry });
      stdout.write(`  intent:     ${result.intent}\n`);
      stdout.write(`  confidence: ${String(result.confidence)}\n`);
      stdout.write(`  reasoning:  ${result.reasoning}\n`);
      stdout.write('\nAll checks passed.\n');
    });
}

interface TelegramProbeResult {
  ok: boolean;
  username?: string;
  error?: string;
}

async function probeTelegram(botToken: string): Promise<TelegramProbeResult> {
  const api = defaultTelegramApiFactory(botToken);
  try {
    const identity = await api.getMe();
    return { ok: true, username: identity.username };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface DiscordProbeResult {
  restOk: boolean;
  login: boolean;
  tag?: string;
  guilds?: number;
  guildMatch?: boolean;
  error?: string;
  /** Last gateway warning / debug hint captured while waiting for READY. */
  hint?: string;
}

async function probeDiscord(token: string, targetGuild?: string): Promise<DiscordProbeResult> {
  // Step 1: validate the token via REST (/users/@me). This tells us token
  // validity without touching the gateway, so we can distinguish a bad token
  // from a missing privileged intent.
  const rest = new REST({ version: '10' }).setToken(token);
  let restUser: { username?: string; discriminator?: string } | undefined;
  try {
    restUser = (await rest.get(Routes.user('@me'))) as {
      username?: string;
      discriminator?: string;
    };
  } catch (err) {
    return {
      restOk: false,
      login: false,
      error: `REST /users/@me failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Step 2: gateway login with diagnostic listeners.
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  let hint: string | undefined;
  const captureHint = (prefix: string, msg: unknown): void => {
    const text = typeof msg === 'string' ? msg : ((msg as Error)?.message ?? String(msg));
    if (text.length > 0 && hint === undefined) hint = `${prefix}: ${text.slice(0, 500)}`;
  };
  client.on('error', (err) => captureHint('error', err));
  client.on('shardError', (err) => captureHint('shardError', err));
  client.on('invalidated', () => captureHint('invalidated', 'session invalidated by discord'));
  client.on('shardDisconnect', (event, shardId) =>
    captureHint(
      'shardDisconnect',
      `shard ${String(shardId)} code=${String(event.code)} reason=${event.reason ?? '(none)'}`,
    ),
  );
  client.on('shardReconnecting', (shardId) =>
    captureHint('shardReconnecting', `shard ${String(shardId)} reconnecting`),
  );
  client.on('shardResume', (shardId) =>
    captureHint('shardResume', `shard ${String(shardId)} resumed`),
  );
  // Keep ALL debug lines as a ring buffer; print the last few on timeout so we
  // can see what happened right before READY stalled.
  const debugLines: string[] = [];
  client.on('debug', (line: string) => {
    debugLines.push(line);
    if (debugLines.length > 20) debugLines.shift();
  });

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const tail = debugLines.slice(-6).join(' | ');
      reject(new Error(`ClientReady timed out (45s). Last debug: ${tail}`));
    }, 45_000);
    client.once(Events.ClientReady, () => {
      clearTimeout(timer);
      resolve();
    });
  });
  try {
    await client.login(token);
    await readyPromise;
    const visible = client.guilds.cache.size;
    const result: DiscordProbeResult = {
      restOk: true,
      login: true,
      ...(client.user?.tag !== undefined ? { tag: client.user.tag } : {}),
      guilds: visible,
    };
    if (targetGuild !== undefined && targetGuild.length > 0) {
      try {
        const g = await client.guilds.fetch(targetGuild);
        result.guildMatch = g !== null && g !== undefined;
      } catch {
        result.guildMatch = false;
      }
    }
    return result;
  } catch (err) {
    const tagFromRest =
      restUser?.username !== undefined
        ? `${restUser.username}${restUser.discriminator !== undefined && restUser.discriminator !== '0' ? `#${restUser.discriminator}` : ''}`
        : undefined;
    return {
      restOk: true,
      login: false,
      ...(tagFromRest !== undefined ? { tag: tagFromRest } : {}),
      error: err instanceof Error ? err.message : String(err),
      ...(hint !== undefined ? { hint } : {}),
    };
  } finally {
    try {
      await client.destroy();
    } catch {
      // ignore
    }
  }
}
