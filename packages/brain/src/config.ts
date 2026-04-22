/**
 * Read/write `~/.factory5/config.toml` (or `%LOCALAPPDATA%\factory5\config.toml`
 * on Windows). Validated with Zod.
 *
 * TOML was chosen in ADR 0004; `smol-toml` is the parser.
 *
 * The config is entirely optional — if the file doesn't exist,
 * {@link buildDefaultRegistry} falls back to baked-in Claude CLI defaults.
 */

import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  AUTONOMY_MODES,
  MODEL_CATEGORIES,
  type AutonomyMode,
  type ModelCategory,
} from '@factory5/core';
import { createLogger, dataDir } from '@factory5/logger';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { z } from 'zod';

const log = createLogger('brain.config');

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const categoryEntrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

/**
 * Budget defaults applied to every directive that does not specify its
 * own `--max-usd` / `--max-steps` on the CLI (ADR 0020). Absent or
 * null-valued = unlimited, preserving pre-Phase-7 behaviour on a fresh
 * install.
 */
const budgetDefaultsSchema = z
  .object({
    maxUsd: z.number().positive().optional(),
    maxSteps: z.number().int().positive().optional(),
  })
  .default({});

export const configSchema = z.object({
  general: z
    .object({
      workspace: z.string().optional(),
      autonomy: z.enum(AUTONOMY_MODES).default('assisted'),
    })
    .default({ autonomy: 'assisted' as AutonomyMode }),
  providers: z
    .object({
      claudeCliPath: z.string().optional(),
    })
    .default({}),
  categories: z.record(z.enum(MODEL_CATEGORIES), categoryEntrySchema).default({}),
  fallbackChains: z.record(z.enum(MODEL_CATEGORIES), z.array(categoryEntrySchema)).default({}),
  /**
   * Budget ceilings applied to every directive unless the CLI overrides
   * them per-invocation (ADR 0020). Read by `factory build` in
   * `packages/cli/src/commands/build.ts`. Explicit CLI flag wins over
   * the default.
   */
  budget: z
    .object({
      defaults: budgetDefaultsSchema,
    })
    .default({ defaults: {} }),
  /**
   * Per-channel config blocks. Keyed by the channel plugin's `id` field
   * (e.g. `cli`, `discord`, `telegram`). Each plugin validates its own
   * block via its `configSchema` when the daemon hands it over — values
   * here are passed through as-is and validated lazily.
   */
  channels: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  /**
   * Daemon bind endpoint. When factoryd starts and when the CLI's
   * daemon client is instantiated, host + port are read from this
   * block (with the `FACTORY5_DAEMON_HOST` / `FACTORY5_DAEMON_PORT`
   * env vars winning over config, and the core defaults winning if
   * both are absent). Populate distinct ports per instance to run
   * multiple factories in parallel (ADR 0023).
   */
  daemon: z
    .object({
      host: z.string().optional(),
      port: z.number().int().positive().max(65535).optional(),
    })
    .default({}),
});

export type FactoryConfig = z.infer<typeof configSchema>;
export type CategoryEntry = z.infer<typeof categoryEntrySchema>;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Absolute path of the config file on this platform. */
export function configPath(): string {
  return join(dataDir(), 'config.toml');
}

export async function configExists(): Promise<boolean> {
  try {
    await access(configPath(), fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Load and validate the config file. Returns `undefined` if it doesn't exist.
 * Throws (with a useful message) on parse / schema error.
 */
export async function loadConfig(): Promise<FactoryConfig | undefined> {
  const path = configPath();
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  let parsedToml: unknown;
  try {
    parsedToml = parseToml(raw);
  } catch (err) {
    throw new Error(`config: could not parse ${path}: ${(err as Error).message}`);
  }
  try {
    const cfg = configSchema.parse(parsedToml);
    log.debug({ path }, 'config loaded');
    return cfg;
  } catch (err) {
    throw new Error(`config: ${path} failed schema validation: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write the config atomically. Creates the parent directory as needed.
 * The output is a round-tripable TOML document — safe to hand-edit later.
 */
export async function saveConfig(cfg: FactoryConfig): Promise<string> {
  const validated = configSchema.parse(cfg);
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });

  // smol-toml's stringify accepts plain JSON-ish objects. Strip `undefined`
  // values so empty tables don't render as broken syntax.
  const body = stringifyToml(stripUndefined(validated));
  const header =
    '# factory5 config — hand-editable. Regenerated by `factory init`.\n# Lives at: ' +
    path +
    '\n\n';
  await writeFile(path, header + body, 'utf8');
  log.info({ path }, 'config saved');
  return path;
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** The default category→model mapping shipped when no config exists. */
export const DEFAULT_CATEGORIES: Record<ModelCategory, CategoryEntry> = {
  quick: { provider: 'claude-cli', model: 'claude-haiku-4-5' },
  planning: { provider: 'claude-cli', model: 'claude-sonnet-4-6' },
  reasoning: { provider: 'claude-cli', model: 'claude-opus-4-7' },
  deep: { provider: 'claude-cli', model: 'claude-opus-4-7' },
  documentation: { provider: 'claude-cli', model: 'claude-haiku-4-5' },
};

/** Build a fresh default config (used by `factory init`). */
export function defaultConfig(): FactoryConfig {
  return configSchema.parse({
    general: { autonomy: 'assisted' },
    providers: {},
    categories: { ...DEFAULT_CATEGORIES },
    fallbackChains: {},
    budget: { defaults: {} },
    channels: {},
    daemon: {},
  });
}

/**
 * Return the config block for a specific channel plugin (keyed by its
 * `ChannelPlugin.id`). Returns `undefined` if the user's `config.toml`
 * doesn't have a block for that channel.
 */
export function channelConfigFor(
  cfg: FactoryConfig | undefined,
  channelId: string,
): Record<string, unknown> | undefined {
  if (cfg === undefined) return undefined;
  const block = cfg.channels[channelId];
  return block;
}
