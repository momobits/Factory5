/**
 * Provider registry + 4-step resolution (ADR 0004).
 *
 * Phase 1 will add proactive availability checks at startup and reactive
 * fallback on runtime errors. For v0 this is the API surface plus a stub.
 */

import type { ModelCategory } from '@factory5/core';
import { createLogger } from '@factory5/logger';

import type { CategoryResolution, ModelProvider } from './types.js';

const log = createLogger('providers.registry');

export interface ChainEntry {
  /** Provider id matching `ModelProvider.id`. */
  provider: string;
  /** Model in the provider's native vocabulary. */
  model: string;
}

export interface ProviderRegistryConfig {
  /** Provider implementations keyed by `ModelProvider.id`. */
  providers: Record<string, ModelProvider>;
  /** Default chain per category — first entry is preferred, fall back in order. */
  fallbackChains: Record<ModelCategory, ChainEntry[]>;
  /** Optional system-wide override for a specific category. */
  defaultOverrides?: Partial<Record<ModelCategory, ChainEntry>>;
}

export class ProviderRegistry {
  constructor(private readonly cfg: ProviderRegistryConfig) {}

  /**
   * Resolve a category to a provider+model. Tries default override → first
   * available chain entry. Phase 1 adds richer availability + override-by-directive.
   */
  async resolve(
    category: ModelCategory,
    perDirectiveOverride?: ChainEntry,
  ): Promise<CategoryResolution> {
    const candidates: ChainEntry[] = [];
    if (perDirectiveOverride !== undefined) candidates.push(perDirectiveOverride);
    const override = this.cfg.defaultOverrides?.[category];
    if (override !== undefined) candidates.push(override);
    candidates.push(...(this.cfg.fallbackChains[category] ?? []));

    for (let i = 0; i < candidates.length; i++) {
      const entry = candidates[i];
      if (entry === undefined) continue;
      const provider = this.cfg.providers[entry.provider];
      if (provider === undefined) {
        log.debug({ category, entry }, 'provider not registered, skipping');
        continue;
      }
      try {
        if (await provider.available()) {
          return {
            provider,
            model: entry.model,
            chainIndex: i,
            category,
          };
        }
      } catch (err) {
        log.warn({ err, category, entry }, 'availability check threw');
      }
    }

    throw new Error(
      `no available provider for category "${category}" — checked ${String(candidates.length)} entries`,
    );
  }
}
