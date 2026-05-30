/**
 * Per-agent model-category override layer (ADR 0004 amendment, Phase 14 /
 * ADR 0033 §6 / ADR 0036).
 *
 * The `[agents]` table itself lives in `config.toml` (owned by
 * `@factory5/brain`'s `loadConfig`). This module holds only the pure
 * resolution helpers — `@factory5/brain` loads the TOML and passes the
 * `agents` block into {@link resolveAgentCategory}.
 *
 * Why this lives in `@factory5/state` and not `@factory5/brain`: the
 * dependency direction is brain → state → core (state never imports
 * brain). `resolveAgentCategory` is a pure function on a plain object — no
 * I/O — so `architect.ts` / `critic.ts` (in brain) can import it from state
 * without inverting that direction. Before ADR 0036 this module also owned a
 * `<dataDir>/config.json` reader/writer; that file was retired and folded
 * into `config.toml`, so the I/O is gone and only the resolver remains.
 */

import { modelCategorySchema, type ModelCategory } from '@factory5/core';
import { z } from 'zod';

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
// Shape must mirror the `agents` block in @factory5/brain's configSchema
// (config.toml) — co-change these when adding roles.
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
 * overridden via the `[agents]` table in `config.toml` (ADR 0036).
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
