/**
 * `factory init` — first-time setup. Writes `config.toml` with sensible
 * defaults. Non-interactive by design so it runs clean in CI / scripts.
 *
 * Flags:
 *   --workspace <path>        where projects get created (default: ~/factory5-workspace)
 *   --claude-cli-path <path>  explicit claude CLI binary (else autodetect via PATH)
 *   --autonomy <mode>         chat | assisted | autonomous  (default: assisted)
 *   --force                   overwrite an existing config.toml
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { exit, stdout } from 'node:process';

import { AUTONOMY_MODES, type AutonomyMode } from '@factory5/core';
import { configExists, configPath, defaultConfig, saveConfig } from '@factory5/brain';
import { ClaudeCliProvider } from '@factory5/providers';
import type { Command } from 'commander';

interface InitOptions {
  workspace?: string;
  claudeCliPath?: string;
  autonomy: string;
  force?: boolean;
  discordToken?: string;
  discordApplicationId?: string;
  discordGuild?: string;
  discordDefaultChannel?: string;
  telegramToken?: string;
  telegramAllowedChat?: string[];
  telegramTestChat?: string;
  telegramPollTimeoutSec?: string;
}

/** Parse a decimal integer flag string; throws with the flag name on failure. */
function parseIntFlag(flag: string, raw: string): number {
  const trimmed = raw.trim();
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || String(n) !== trimmed) {
    throw new Error(`${flag} must be an integer (got ${JSON.stringify(raw)})`);
  }
  return n;
}

/** Commander collector for a repeatable `<value>` flag. */
function collectRepeatable(value: string, previous: string[] | undefined): string[] {
  return (previous ?? []).concat([value]);
}

function parseAutonomy(raw: string): AutonomyMode {
  if ((AUTONOMY_MODES as readonly string[]).includes(raw)) return raw as AutonomyMode;
  throw new Error(`--autonomy must be one of ${AUTONOMY_MODES.join(' | ')} (got ${raw})`);
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('write ~/.factory5/config.toml with sensible defaults')
    .option('--workspace <path>', 'projects root directory')
    .option('--claude-cli-path <path>', 'explicit claude binary path (skip autodetect)')
    .option('--autonomy <mode>', 'default autonomy mode (chat | assisted | autonomous)', 'assisted')
    .option('--force', 'overwrite an existing config.toml')
    .option('--discord-token <token>', 'Discord bot token (stored under [channels.discord])')
    .option('--discord-application-id <id>', 'Discord application id')
    .option('--discord-guild <id>', 'Scope the bot to a single guild id')
    .option(
      '--discord-default-channel <id>',
      'Default Discord channel id for directive-less replies',
    )
    .option(
      '--telegram-token <token>',
      'Telegram bot token from @BotFather (stored under [channels.telegram])',
    )
    .option(
      '--telegram-allowed-chat <id>',
      'Allow-list entry for a Telegram chat id — repeat to add several. Empty allowlist ⇒ accept any chat the bot can reach',
      collectRepeatable,
    )
    .option(
      '--telegram-test-chat <id>',
      'Chat id used by the live-run / doctor probes (recorded under testChatId)',
    )
    .option(
      '--telegram-poll-timeout-sec <seconds>',
      'Long-poll timeout passed to getUpdates (0–60s; default 30)',
    )
    .action(async (opts: InitOptions) => {
      const path = configPath();
      if ((await configExists()) && opts.force !== true) {
        stdout.write(`factory init: ${path} already exists — re-run with --force to overwrite.\n`);
        exit(1);
      }

      const autonomy = parseAutonomy(opts.autonomy);
      const cfg = defaultConfig();
      cfg.general.autonomy = autonomy;
      cfg.general.workspace = opts.workspace ?? join(homedir(), 'factory5-workspace');

      if (opts.claudeCliPath !== undefined && opts.claudeCliPath.length > 0) {
        cfg.providers.claudeCliPath = opts.claudeCliPath;
      }

      // Build [channels.discord] block if the user supplied anything.
      if (
        opts.discordToken !== undefined ||
        opts.discordApplicationId !== undefined ||
        opts.discordGuild !== undefined ||
        opts.discordDefaultChannel !== undefined
      ) {
        const discord: Record<string, unknown> = {};
        if (opts.discordToken !== undefined && opts.discordToken.length > 0) {
          discord['token'] = opts.discordToken;
        }
        if (opts.discordApplicationId !== undefined && opts.discordApplicationId.length > 0) {
          discord['applicationId'] = opts.discordApplicationId;
        }
        if (opts.discordGuild !== undefined && opts.discordGuild.length > 0) {
          discord['guildId'] = opts.discordGuild;
        }
        if (opts.discordDefaultChannel !== undefined && opts.discordDefaultChannel.length > 0) {
          discord['defaultChannelId'] = opts.discordDefaultChannel;
        }
        cfg.channels['discord'] = discord;
      }

      // Build [channels.telegram] block if the user supplied anything.
      if (
        opts.telegramToken !== undefined ||
        (opts.telegramAllowedChat !== undefined && opts.telegramAllowedChat.length > 0) ||
        opts.telegramTestChat !== undefined ||
        opts.telegramPollTimeoutSec !== undefined
      ) {
        const telegram: Record<string, unknown> = {};
        if (opts.telegramToken !== undefined && opts.telegramToken.length > 0) {
          telegram['botToken'] = opts.telegramToken;
        }
        if (opts.telegramAllowedChat !== undefined && opts.telegramAllowedChat.length > 0) {
          telegram['allowedChatIds'] = opts.telegramAllowedChat.map((raw) =>
            parseIntFlag('--telegram-allowed-chat', raw),
          );
        }
        if (opts.telegramTestChat !== undefined && opts.telegramTestChat.length > 0) {
          telegram['testChatId'] = parseIntFlag('--telegram-test-chat', opts.telegramTestChat);
        }
        if (opts.telegramPollTimeoutSec !== undefined && opts.telegramPollTimeoutSec.length > 0) {
          const seconds = parseIntFlag('--telegram-poll-timeout-sec', opts.telegramPollTimeoutSec);
          if (seconds < 0 || seconds > 60) {
            throw new Error('--telegram-poll-timeout-sec must be between 0 and 60');
          }
          telegram['pollTimeoutSec'] = seconds;
        }
        cfg.channels['telegram'] = telegram;
      }

      // Verify the provider is actually reachable so users don't save a broken
      // config by accident.
      const probe = new ClaudeCliProvider(
        cfg.providers.claudeCliPath !== undefined
          ? { binaryPath: cfg.providers.claudeCliPath }
          : {},
      );
      const available = await probe.available();

      const written = await saveConfig(cfg);
      stdout.write(`factory init: wrote ${written}\n`);
      stdout.write(`  workspace:    ${cfg.general.workspace ?? '(unset)'}\n`);
      stdout.write(`  autonomy:     ${cfg.general.autonomy}\n`);
      stdout.write(`  claude-cli:   ${available ? 'available' : 'NOT AVAILABLE'}\n`);
      const discordBlock = cfg.channels['discord'] as Record<string, unknown> | undefined;
      if (discordBlock !== undefined) {
        const hasToken = typeof discordBlock['token'] === 'string';
        stdout.write(`  discord:      ${hasToken ? 'configured' : '(partial — no token)'}\n`);
      }
      const telegramBlock = cfg.channels['telegram'] as Record<string, unknown> | undefined;
      if (telegramBlock !== undefined) {
        const hasToken = typeof telegramBlock['botToken'] === 'string';
        stdout.write(`  telegram:     ${hasToken ? 'configured' : '(partial — no token)'}\n`);
      }
      if (!available) {
        stdout.write(
          '\n  Warning: `claude` CLI could not be reached. Install the Claude Code CLI or\n  re-run with --claude-cli-path pointing at your `claude` binary.\n',
        );
      }
    });
}
