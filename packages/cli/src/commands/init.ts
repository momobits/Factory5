/**
 * `factory init` — initialise a factory instance, OR scaffold a new project.
 *
 * Four modes, selected by argument + flags + existing state:
 *
 *   1. **Template-copy (default, no existing config, no project arg).**
 *      Copies `config.example.toml` from the repo root into the instance's
 *      data dir as `config.toml`. The dev edits the copy then re-runs
 *      `factory init` (or `factory doctor`) to validate.
 *
 *   2. **Validate (existing config, no --force, no project arg).** Zod-parses
 *      the existing `config.toml` and probes `claude-cli` / Discord /
 *      Telegram the same way `factory doctor --skip-call` does.
 *
 *   3. **Flag-driven generation (--force OR config flags given, no project
 *      arg).** Build a config from `defaultConfig()` + CLI flags, save it.
 *
 *   4. **Project scaffold (project arg present)** — Phase 10.8 / ADR 0026.
 *      `factory init <name> [--language python|node|go|rust]` creates
 *      `<workspace>/<name>/` with a language-specific CLAUDE.md and a
 *      `project.json` whose `metadata.language` drives the assessor runtime
 *      on subsequent `factory build` calls. Default language: python.
 *
 * The instance's data dir is resolved by `configPath()` at call time,
 * which walks up from cwd looking for a `.factory/` dir (ADR 0023).
 * Set `FACTORY5_DATA_DIR` to override. Use `cd` to select between
 * several instances.
 *
 * Flags (all optional):
 *   --workspace <path>        where projects get created (also used by mode 4)
 *   --claude-cli-path <path>  explicit claude CLI binary
 *   --autonomy <mode>         chat | assisted | autonomous
 *   --force                   overwrite an existing config.toml
 *   --language <lang>         mode 4 only — python | node | go | rust
 *   --discord-*               Discord channel config
 *   --telegram-*              Telegram channel config
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { cwd as processCwd, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import { AUTONOMY_MODES, type AutonomyMode } from '@factory5/core';
import {
  channelConfigFor,
  configExists,
  configPath,
  defaultConfig,
  loadConfig,
  saveConfig,
} from '@factory5/brain';
import { ClaudeCliProvider } from '@factory5/providers';
import {
  CreateProjectAlreadyExistsError,
  createProject,
  type CreateProjectResult,
} from '@factory5/wiki';
import type { Command } from 'commander';

/**
 * Languages the project-creation mode supports. Mirror of
 * `@factory5/wiki`'s `ProjectLanguage` union; inlined here to keep the
 * Commander option-parsing surface explicit.
 */
type InitLanguage = 'python' | 'node' | 'go' | 'rust';

interface InitOptions {
  workspace?: string;
  claudeCliPath?: string;
  autonomy: string;
  force?: boolean;
  language?: string;
  discordToken?: string;
  discordApplicationId?: string;
  discordGuild?: string;
  discordDefaultChannel?: string;
  telegramToken?: string;
  telegramAllowedChat?: string[];
  telegramTestChat?: string;
  telegramPollTimeoutSec?: string;
}

function parseInitLanguage(raw: string): InitLanguage {
  if (raw === 'python' || raw === 'node' || raw === 'go' || raw === 'rust') return raw;
  throw new Error(`--language must be python | node | go | rust, got: ${raw}`);
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

/** True iff any config-shaping flag was passed on the CLI. */
function anyGenerationFlagGiven(opts: InitOptions): boolean {
  return (
    opts.workspace !== undefined ||
    opts.claudeCliPath !== undefined ||
    opts.discordToken !== undefined ||
    opts.discordApplicationId !== undefined ||
    opts.discordGuild !== undefined ||
    opts.discordDefaultChannel !== undefined ||
    opts.telegramToken !== undefined ||
    (opts.telegramAllowedChat !== undefined && opts.telegramAllowedChat.length > 0) ||
    opts.telegramTestChat !== undefined ||
    opts.telegramPollTimeoutSec !== undefined
  );
}

/**
 * Walk up from this module's directory looking for the factory5 repo
 * root (marked by `pnpm-workspace.yaml`). Returns the path to the
 * shipped `config.example.toml` if found, `undefined` otherwise.
 */
function locateTemplate(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 16; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      const template = join(dir, 'config.example.toml');
      return existsSync(template) ? template : undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

export function registerInitCommand(program: Command): void {
  program
    .command('init [project]')
    .description(
      'initialise a factory instance (no arg) — or scaffold a new project (with arg + --language)',
    )
    .option('--workspace <path>', 'projects root directory')
    .option('--claude-cli-path <path>', 'explicit claude binary path (skip autodetect)')
    .option('--autonomy <mode>', 'default autonomy mode (chat | assisted | autonomous)', 'assisted')
    .option('--force', 'overwrite an existing config.toml (use with flags for CI-friendly gen)')
    .option(
      '--language <lang>',
      'project mode only — python | node | go | rust. Default python (back-compat).',
    )
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
    .action(async (project: string | undefined, opts: InitOptions) => {
      // Mode 4 (ADR 0026 / Phase 10.8): scaffold a new project with a
      // language picker. Triggered by the positional argument; entirely
      // independent of the instance-config modes below.
      if (project !== undefined && project.length > 0) {
        await runProjectInit(project, opts);
        return;
      }

      const path = configPath();
      const exists = await configExists();
      const genFlags = anyGenerationFlagGiven(opts);

      // Mode 2: validate existing config (no --force, config.toml already present).
      if (exists && opts.force !== true) {
        await runValidate(path);
        return;
      }

      // Mode 3: flag-driven generation (--force, or flags passed without an existing file).
      if (opts.force === true || genFlags) {
        await runGenerate(opts);
        return;
      }

      // Mode 1: template-copy (default — no existing config, no flags).
      await runTemplateCopy(path);
    });
}

// ---------------------------------------------------------------------------
// Mode 1 — template-copy
// ---------------------------------------------------------------------------

async function runTemplateCopy(path: string): Promise<void> {
  const template = locateTemplate();
  if (template === undefined) {
    stdout.write(
      'factory init: could not locate config.example.toml (expected at the repo root).\n' +
        '  Either run from within the factory5 repo, or use `factory init --force` with flags\n' +
        '  (e.g. --discord-token, --telegram-token) to generate a config from defaults.\n',
    );
    exit(1);
  }

  mkdirSync(dirname(path), { recursive: true });
  const body = readFileSync(template, 'utf8');
  writeFileSync(path, body, 'utf8');

  stdout.write(`factory init: copied template to ${path}\n`);
  stdout.write('\nNext steps:\n');
  stdout.write(`  1. Edit ${path} to fill in your workspace path + bot tokens\n`);
  stdout.write('     (see inline comments in the file; walkthrough in docs/ONBOARDING.md)\n');
  stdout.write('  2. Run `factory init` again to validate, or `factory doctor` for full probes\n');
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Mode 2 — validate existing
// ---------------------------------------------------------------------------

async function runValidate(path: string): Promise<void> {
  let parsed: Awaited<ReturnType<typeof loadConfig>>;
  try {
    parsed = await loadConfig();
  } catch (err) {
    stdout.write(
      `factory init: ${path} failed schema validation:\n  ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    exit(2);
  }
  if (parsed === undefined) {
    // Shouldn't happen — configExists returned true — but handle for robustness.
    stdout.write(`factory init: ${path} disappeared between existence check and read.\n`);
    exit(2);
  }

  stdout.write(`factory init: ${path}\n`);
  stdout.write(`  workspace:    ${parsed.general.workspace ?? '(unset)'}\n`);
  stdout.write(`  autonomy:     ${parsed.general.autonomy}\n`);

  const probe = new ClaudeCliProvider(
    parsed.providers.claudeCliPath !== undefined
      ? { binaryPath: parsed.providers.claudeCliPath }
      : {},
  );
  const available = await probe.available();
  stdout.write(`  claude-cli:   ${available ? 'available' : 'NOT AVAILABLE'}\n`);

  const discord = channelConfigFor(parsed, 'discord') as { token?: unknown } | undefined;
  if (discord !== undefined) {
    const hasToken = typeof discord.token === 'string' && (discord.token as string).length > 0;
    stdout.write(`  discord:      ${hasToken ? 'configured' : '(partial — no token)'}\n`);
  }
  const telegram = channelConfigFor(parsed, 'telegram') as { botToken?: unknown } | undefined;
  if (telegram !== undefined) {
    const hasToken =
      typeof telegram.botToken === 'string' && (telegram.botToken as string).length > 0;
    stdout.write(`  telegram:     ${hasToken ? 'configured' : '(partial — no token)'}\n`);
  }

  if (!available) {
    stdout.write(
      '\n  Warning: `claude` CLI could not be reached. Install the Claude Code CLI or\n  set providers.claudeCliPath in config to your `claude` binary.\n',
    );
    exit(3);
  }

  stdout.write('\n  Config looks healthy. Run `factory doctor` for full channel probes.\n');
}

// ---------------------------------------------------------------------------
// Mode 3 — flag-driven generation (legacy / CI)
// ---------------------------------------------------------------------------

async function runGenerate(opts: InitOptions): Promise<void> {
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
    cfg.providers.claudeCliPath !== undefined ? { binaryPath: cfg.providers.claudeCliPath } : {},
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
}

// ---------------------------------------------------------------------------
// Mode 4 — project-init (Phase 10.8: language picker)
// ---------------------------------------------------------------------------

/**
 * `factory init <project> [--language <lang>]` — scaffold a new project under
 * the configured workspace with a language-appropriate CLAUDE.md spec and a
 * `project.json` that records the language choice. Subsequent `factory build`
 * runs read `project.json.metadata.language` to pick the assessor runtime
 * (ADR 0026), so the operator does not need to repeat `--language` per build.
 *
 * Path resolution: an explicit absolute / relative path wins; bare names
 * resolve under the configured workspace. The actual scaffold work runs in
 * `wiki.createProject` so the daemon's `POST /api/v1/projects` route shares
 * the same refuse-overwrite + identity-claim semantics.
 */
async function runProjectInit(project: string, opts: InitOptions): Promise<void> {
  const language: InitLanguage =
    opts.language !== undefined ? parseInitLanguage(opts.language) : 'python';

  const cfg = await loadConfig().catch(() => undefined);
  const workspace =
    opts.workspace ?? cfg?.general.workspace ?? join(homedir(), 'factory5-workspace');
  const projectPath = isAbsolute(project)
    ? project
    : project.startsWith('./') || project.startsWith('../')
      ? resolve(processCwd(), project)
      : join(workspace, project);

  let result: CreateProjectResult;
  try {
    result = await createProject({ projectPath, name: project, language });
  } catch (err) {
    if (err instanceof CreateProjectAlreadyExistsError) {
      if (err.reason === 'existing-metadata') {
        stdout.write(
          `factory init: ${err.projectPath} already has a project identity (${err.existingProjectId}). ` +
            `Refusing to overwrite — delete .factory/project.json to claim a new identity, or pick a different name.\n`,
        );
      } else {
        stdout.write(
          `factory init: ${err.projectPath}/CLAUDE.md already exists. Refusing to overwrite — pick a different name or remove it manually.\n`,
        );
      }
      exit(2);
    }
    throw err;
  }

  stdout.write(`factory init: scaffolded ${project} (${language})\n`);
  stdout.write(`  path:     ${result.path}\n`);
  stdout.write(`  spec:     ${result.claudeMdPath}\n`);
  stdout.write(`  language: ${language} (recorded in .factory/project.json)\n`);
  stdout.write('\nNext steps:\n');
  stdout.write(`  1. Edit ${result.claudeMdPath} to describe what you want built\n`);
  stdout.write(
    `  2. Run \`factory build ${project}\` — the assessor runtime is already wired to ${language}\n`,
  );
}
