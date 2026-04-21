import type { Migration } from './index.js';

/**
 * Add per-directive budget columns to `directives` so the CLI's
 * `--max-usd` / `--max-steps` flags have somewhere to live and the
 * brain's pre-call check can read them off the directive row.
 *
 * Both nullable on purpose — NULL means "unlimited," which matches
 * pre-migration behaviour. Phase 7a is a strict no-op for operators
 * who don't pass the flag or set a config default (ADR 0020 §4).
 *
 * `max_usd REAL` — USD ceiling on total cost for this directive.
 * `max_steps INTEGER` — call-count ceiling (one row per LLM call).
 *
 * No CHECK constraints; validation happens at the Zod boundary
 * (`directiveSchema`).
 */
export const migration005: Migration = {
  id: 5,
  name: 'directive-limits',
  up: `
    ALTER TABLE directives ADD COLUMN max_usd REAL;
    ALTER TABLE directives ADD COLUMN max_steps INTEGER;
  `,
};
