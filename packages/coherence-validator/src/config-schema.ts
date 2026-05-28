/**
 * Validator config JSON schema. Used by the coherence validator's
 * three-tier config resolution (shipped default → project override →
 * agent-generated). Defines per-runtime doc-fiction + dead-code rules.
 */

import { z } from 'zod';

const codeBlockRunnerSchema = z.object({
  command: z.array(z.string().min(1)).min(1),
  timeout_ms: z.number().int().positive().optional(),
  wrapper_template: z.string().optional(),
  binary_lookup: z.string().optional(),
  failure_pattern: z.string().optional(),
});

const docFictionSchema = z.object({
  section_headings: z.string().min(1),
  code_block_runners: z.record(z.string(), codeBlockRunnerSchema),
});

const exposureSourceSchema = z.object({
  kind: z.enum(['entry_points', 'explicit_export', 'feature_surface']),
  source: z.string().min(1),
});

const callerScanSchema = z.object({
  method: z.enum(['ast_imports_and_calls']),
  exclude_globs: z.array(z.string()).default([]),
});

const deadCodeSchema = z.object({
  package_globs: z.array(z.string().min(1)).min(1),
  public_symbol_rule: z.enum(['no_underscore_prefix']),
  exposed_via: z.array(exposureSourceSchema).default([]),
  caller_scan: callerScanSchema,
});

export const validatorConfigSchema = z.object({
  runtime: z.string().min(1),
  interpreter: z.string().min(1),
  doc_globs: z.array(z.string().min(1)).min(1),
  doc_fiction: docFictionSchema.optional(),
  dead_code: deadCodeSchema.optional(),
});

export type ValidatorConfig = z.infer<typeof validatorConfigSchema>;
