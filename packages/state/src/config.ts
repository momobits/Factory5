/**
 * Daemon-wide config file — `<dataDir>/config.json`.
 *
 * Single source of read/write for the small set of operator-tunable
 * runtime knobs that don't fit in CLAUDE.md (per-project specs) or in
 * the SQLite schema (runtime data). Currently: just `askUserDeadlineMs`,
 * the ADR 0030 auto-answer deadline.
 *
 * The file lives next to `factory.db` in `dataDir()` so a single
 * "factory home" directory carries all of factory5's persistent state.
 * Placement here in `@factory5/state` (rather than `@factory5/core`)
 * keeps `core` free of I/O and groups the two path-aware accessors
 * (`defaultDbPath` and `loadConfig`) in one module boundary.
 *
 * Read semantics: missing file or missing key falls back to defaults.
 * Invalid JSON throws (corrupt files are an operator action, not a
 * silent fallback). Invalid schema (e.g. `askUserDeadlineMs: "5m"`
 * instead of milliseconds) throws via Zod.
 *
 * Write semantics: atomic via tmp + rename, so a partial-write doesn't
 * corrupt the file. Test injection passes an explicit `dataDirPath`
 * argument so tests don't touch the real `dataDir()`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pid } from 'node:process';

import {
  DEFAULT_ASK_USER_DEADLINE_MS,
  factoryConfigFileSchema,
  modelCategorySchema,
  type FactoryConfig,
  type ModelCategory,
} from '@factory5/core';
import { dataDir } from '@factory5/logger/paths';
import { z } from 'zod';

export { DEFAULT_ASK_USER_DEADLINE_MS };
export type { FactoryConfig };

// ----------------------------------------------------------------------------
// Per-agent category override layer (ADR 0004 amendment, Phase 14)
// ----------------------------------------------------------------------------

/**
 * Per-agent category override layer (ADR 0004 amendment, Phase 14).
 *
 * Lets operators flip an agent's resolved category without touching the
 * global `[categories.*]` table. `.strict()` so adding a third overridable
 * agent later requires a deliberate schema bump.
 */
// Must mirror factoryConfigFileSchema.agents in @factory5/core — co-change these when adding roles.
export const agentsConfigSchema = z
  .object({
    architect: modelCategorySchema.optional(),
    critic: modelCategorySchema.optional(),
  })
  .strict()
  .optional();

/**
 * Built-in defaults used when `config.agents[role]` is absent.
 *
 * Tier 14 flipped `architect` from `reasoning` (Opus) to `planning` (Sonnet);
 * `critic` is new in Tier 14 and defaults to `reasoning` (Opus). Both can be
 * overridden via the `[agents.*]` table in `<dataDir>/config.json`.
 */
export const DEFAULT_AGENT_CATEGORIES = {
  architect: 'planning',
  critic: 'reasoning',
} as const satisfies Record<'architect' | 'critic', ModelCategory>;

/** The agent roles that can have their category overridden via config. */
export type ConfigurableAgentRole = keyof typeof DEFAULT_AGENT_CATEGORIES;

/**
 * Resolve an agent role to its model category, applying the override-then-
 * default precedence from the ADR 0004 amendment.
 *
 * Resolution order:
 * 1. `config.agents?.[role]` if present
 * 2. `DEFAULT_AGENT_CATEGORIES[role]`
 */
export function resolveAgentCategory(
  config: {
    agents?: { architect?: ModelCategory | undefined; critic?: ModelCategory | undefined };
  },
  role: ConfigurableAgentRole,
): ModelCategory {
  return config.agents?.[role] ?? DEFAULT_AGENT_CATEGORIES[role];
}

/**
 * Default location of `<dataDir>/config.json`. Same root `factory.db`
 * lives in (`@factory5/logger/paths` `dataDir()`).
 */
export function defaultConfigPath(): string {
  return join(dataDir(), 'config.json');
}

/**
 * Read and validate `<dataDir>/config.json`. Returns a fully-resolved
 * config with defaults filled in for any missing keys. Pass `dataDirPath`
 * to override the root (tests pass a `mkdtemp` directory; production
 * callers omit and use {@link dataDir} via {@link defaultConfigPath}).
 *
 * Throws on:
 *   - Invalid JSON (corrupt file)
 *   - Schema mismatch (e.g. wrong type for `askUserDeadlineMs`)
 *
 * Returns defaults on:
 *   - Missing file
 *   - Empty file (treated as `{}`)
 */
export function loadConfig(dataDirPath?: string): FactoryConfig {
  const path = dataDirPath !== undefined ? join(dataDirPath, 'config.json') : defaultConfigPath();
  if (!existsSync(path)) {
    return { askUserDeadlineMs: DEFAULT_ASK_USER_DEADLINE_MS };
  }
  const raw = readFileSync(path, 'utf8').trim();
  const parsed = raw.length === 0 ? {} : (JSON.parse(raw) as unknown);
  const validated = factoryConfigFileSchema.parse(parsed);
  return {
    askUserDeadlineMs: validated.askUserDeadlineMs ?? DEFAULT_ASK_USER_DEADLINE_MS,
    ...(validated.agents !== undefined ? { agents: validated.agents } : {}),
  };
}

/**
 * Write a (partial) config to `<dataDir>/config.json`. Merges with the
 * existing file's content if present so partial writes don't drop
 * unrelated keys. Atomic via tmp + rename.
 *
 * Pass `dataDirPath` to override the root (tests).
 */
export function writeConfig(partial: Partial<FactoryConfig>, dataDirPath?: string): void {
  const root = dataDirPath ?? dataDir();
  mkdirSync(root, { recursive: true });
  const path = join(root, 'config.json');
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8').trim();
    if (raw.length > 0) {
      existing = JSON.parse(raw) as Record<string, unknown>;
    }
  }
  const merged = { ...existing, ...partial };
  // Validate before write so we never persist an invalid file.
  factoryConfigFileSchema.parse(merged);
  const tmp = `${path}.tmp.${String(pid)}`;
  writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
  renameSync(tmp, path);
}
