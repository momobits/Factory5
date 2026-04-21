import type { Migration } from './index.js';

/**
 * Add a `mode` column to `model_usage` so the pre-call cost estimator
 * (ADR 0020) can bucket rolling averages by invocation mode — one-shot
 * `provider.call()` vs tool-using `provider.stream()`. Those two modes
 * differ by an order of magnitude in cost per invocation; pooling them
 * into one bucket would make the rolling average meaningless.
 *
 * Nullable on purpose. Pre-migration rows have no way to be backfilled —
 * the provider/agent that recorded them is already gone. The estimator
 * query filters on `mode IS NOT NULL` so historical rows don't pollute
 * the average with unknown-mode noise; a cold-start with all-NULL rows
 * falls back to the baked-in `DEFAULT_CATEGORY_COST` table in
 * `packages/brain/src/budget.ts` (authored in step 7a.4).
 *
 * CHECK constraint intentionally narrow: `'call'` or `'stream'`. NULL
 * bypasses the CHECK (SQLite's three-valued logic), so pre-migration
 * rows stay readable.
 *
 * No schema rewrite on `directives` here; that lands in a later 7a
 * migration once the CLI flags are wired (step 7a.4).
 */
export const migration004: Migration = {
  id: 4,
  name: 'model-usage-mode',
  up: `
    ALTER TABLE model_usage ADD COLUMN mode TEXT CHECK (mode IN ('call','stream'));
    CREATE INDEX idx_usage_category_mode ON model_usage(category, mode);
  `,
};
