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
      if (!available) {
        stdout.write(
          '\n  Warning: `claude` CLI could not be reached. Install the Claude Code CLI or\n  re-run with --claude-cli-path pointing at your `claude` binary.\n',
        );
      }
    });
}
