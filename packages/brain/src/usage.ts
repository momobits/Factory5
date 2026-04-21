/**
 * Helper for recording a provider call's usage into the `model_usage`
 * SQLite table. Separates that plumbing from agent code.
 */

import type { ModelCategory } from '@factory5/core';
import { newId } from '@factory5/core';
import { modelUsage, type Database, type UsageMode } from '@factory5/state';
import type { CategoryResolution, ProviderResponse } from '@factory5/providers';

export interface RecordUsageInput {
  db: Database;
  directiveId?: string;
  taskId?: string;
  category: ModelCategory;
  resolution: CategoryResolution;
  response: ProviderResponse;
  durationMs: number;
  error?: string;
  /**
   * Invocation mode (`call` or `stream`). Required for the Phase 7a
   * rolling-average estimator (ADR 0020) to bucket correctly. Optional
   * at the type level to keep legacy call sites working during rollout;
   * those rows persist with `mode = NULL` and are filtered out of the
   * estimator's sample window.
   */
  mode?: UsageMode;
}

export function recordUsage(input: RecordUsageInput): void {
  const row: Parameters<typeof modelUsage.record>[1] = {
    id: newId(),
    provider: input.resolution.provider.id,
    model: input.resolution.model,
    category: input.category,
    inputTokens: input.response.usage.inputTokens,
    outputTokens: input.response.usage.outputTokens,
    costUsd: input.response.usage.costUsd,
    durationMs: input.durationMs,
    calledAt: new Date().toISOString(),
  };
  if (input.directiveId !== undefined) row.directiveId = input.directiveId;
  if (input.taskId !== undefined) row.taskId = input.taskId;
  if (input.mode !== undefined) row.mode = input.mode;
  if (input.error !== undefined) row.error = input.error;
  modelUsage.record(input.db, row);
}
