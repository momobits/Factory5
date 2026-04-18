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
      if (!available) {
        stdout.write(
          '\n  Warning: `claude` CLI could not be reached. Install the Claude Code CLI or\n  re-run with --claude-cli-path pointing at your `claude` binary.\n',
        );
      }
    });
}
