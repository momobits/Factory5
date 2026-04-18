/**
 * Default provider registry configuration used by the inline-build path.
 *
 * Resolution order for each category:
 *   1. Caller override (`opts.categories`)
 *   2. Loaded config file (`config.categories[category]`)
 *   3. Built-in defaults (`DEFAULT_CATEGORIES`, claude-cli + sensible Claude models)
 *
 * Fallback chains from the config are honored if present; otherwise each
 * category is a single-entry chain. Additional providers land in Phase 2
 * alongside proactive availability checks (see ADR 0004).
 */

import process from 'node:process';

import { MODEL_CATEGORIES, type ModelCategory } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import {
  ClaudeCliProvider,
  ProviderRegistry,
  StubProvider,
  type ChainEntry,
  type ModelProvider,
} from '@factory5/providers';

import { DEFAULT_CATEGORIES, type FactoryConfig, loadConfig } from './config.js';

const log = createLogger('brain.provider-config');

export interface DefaultRegistryOptions {
  /** Override individual category defaults (highest priority). */
  categories?: Partial<Record<ModelCategory, ChainEntry>>;
  /** Inject additional providers (keyed by id). */
  extraProviders?: Record<string, ModelProvider>;
  /**
   * Pre-loaded config (e.g. from tests). When omitted, `buildDefaultRegistry`
   * tries `loadConfig()` synchronously via the sync variant; callers that
   * want the loaded-from-disk path should use {@link buildRegistryFromDisk}.
   */
  config?: FactoryConfig;
}

function resolveClaudeCliProvider(config: FactoryConfig | undefined): ClaudeCliProvider {
  const binaryPath = config?.providers.claudeCliPath;
  return new ClaudeCliProvider(binaryPath !== undefined ? { binaryPath } : {});
}

/**
 * Build a `ProviderRegistry` synchronously using caller-supplied or baked-in
 * defaults. Does NOT read the config file — use {@link buildRegistryFromDisk}
 * for that.
 *
 * When `FACTORY5_TEST_PROVIDER=stub` is set, returns a stub-only registry
 * that routes every category to the in-memory {@link StubProvider}. Used by
 * the e2e daemon script and any test that must not hit a real model.
 */
export function buildDefaultRegistry(opts: DefaultRegistryOptions = {}): ProviderRegistry {
  if (process.env['FACTORY5_TEST_PROVIDER'] === 'stub') {
    log.info('FACTORY5_TEST_PROVIDER=stub — building stub-only registry');
    return buildStubRegistry();
  }
  const config = opts.config;
  const claudeCli = resolveClaudeCliProvider(config);

  const chains: Record<ModelCategory, ChainEntry[]> = {} as Record<ModelCategory, ChainEntry[]>;
  for (const c of MODEL_CATEGORIES) {
    const override = opts.categories?.[c];
    const configEntry = config?.categories[c];
    const configChain = config?.fallbackChains[c];
    const base: ChainEntry = override ?? configEntry ?? DEFAULT_CATEGORIES[c];
    chains[c] =
      configChain !== undefined && configChain.length > 0 ? [base, ...configChain] : [base];
  }

  return new ProviderRegistry({
    providers: {
      'claude-cli': claudeCli,
      ...(opts.extraProviders ?? {}),
    },
    fallbackChains: chains,
  });
}

/** Build a registry whose every category resolves to the in-memory stub. */
export function buildStubRegistry(): ProviderRegistry {
  const stub = new StubProvider();
  const chains: Record<ModelCategory, ChainEntry[]> = {} as Record<ModelCategory, ChainEntry[]>;
  for (const c of MODEL_CATEGORIES) {
    chains[c] = [{ provider: 'stub', model: 'stub' }];
  }
  return new ProviderRegistry({
    providers: { stub },
    fallbackChains: chains,
  });
}

/**
 * Like {@link buildDefaultRegistry} but reads `~/.factory5/config.toml`
 * first. Falls back to built-in defaults if no config exists.
 */
export async function buildRegistryFromDisk(
  opts: Omit<DefaultRegistryOptions, 'config'> = {},
): Promise<ProviderRegistry> {
  let cfg: FactoryConfig | undefined;
  try {
    cfg = await loadConfig();
  } catch (err) {
    log.warn({ err }, 'buildRegistryFromDisk: config load failed — falling back to defaults');
  }
  return buildDefaultRegistry({ ...opts, ...(cfg !== undefined ? { config: cfg } : {}) });
}
