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

import { buildDefaultRegistry, triageDirective } from '@factory5/brain';
import { ClaudeCliProvider } from '@factory5/providers';
import type { Command } from 'commander';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('verify providers + environment (makes one quick Claude call)')
    .option('--skip-call', 'only check binary availability; do not call the model', false)
    .action(async (opts: { skipCall?: boolean }) => {
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
