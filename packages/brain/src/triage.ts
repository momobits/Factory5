/**
 * Triage agent — classify a free-form directive text into one of the
 * canonical {@link Intent} values. Runs on the `quick` model category.
 *
 * The agent is expected to respond with a single JSON object matching
 * {@link triageJsonSchema}. We are permissive about prose around the JSON
 * (we try to extract the object) so the prompt and agent behavior can
 * harden independently.
 */

import type { Intent, ModelCategory } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import type { ProviderRegistry } from '@factory5/providers';
import type { Database } from '@factory5/state';
import { z } from 'zod';

import { buildAgentSystemPrompt } from './prompts.js';
import { recordUsage } from './usage.js';

const log = createLogger('brain.triage');

const triageJsonSchema = z.object({
  intent: z.enum(['build', 'fix', 'review', 'investigate', 'chat', 'status', 'resume', 'cancel']),
  confidence: z.number().min(0).max(1).default(0.5),
  reasoning: z.string().default(''),
});

export interface TriageResult {
  intent: Intent;
  confidence: number;
  reasoning: string;
  /** Raw model text (for debugging / audit). */
  raw: string;
}

export interface TriageOptions {
  registry: ProviderRegistry;
  /** Persist usage into this database if provided. */
  db?: Database;
  /** Directive id for correlation + usage attribution. */
  directiveId?: string;
  /** Override the default `quick` category, e.g. during tests. */
  category?: ModelCategory;
}

/**
 * Extract the first JSON object from an arbitrary string. Returns `undefined`
 * if no balanced object is found.
 */
export function extractJsonObject(s: string): string | undefined {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

/** Classify a directive's free-form text into an {@link Intent}. */
export async function triageDirective(text: string, opts: TriageOptions): Promise<TriageResult> {
  const category = opts.category ?? 'quick';
  const resolution = await opts.registry.resolve(category);
  const systemPrompt = await buildAgentSystemPrompt('triage');

  const userPrompt = `Directive text:\n\n${text}\n\nRespond with ONLY a JSON object: {"intent": "...", "confidence": 0.0-1.0, "reasoning": "..."}.`;

  const started = Date.now();
  let response;
  try {
    response = await resolution.provider.call({
      model: resolution.model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0,
      maxTokens: 256,
    });
  } catch (err) {
    log.error({ err, category }, 'triage provider call failed');
    throw err;
  }
  const durationMs = Date.now() - started;

  if (opts.db !== undefined) {
    recordUsage({
      db: opts.db,
      ...(opts.directiveId !== undefined ? { directiveId: opts.directiveId } : {}),
      category,
      resolution,
      response,
      durationMs,
    });
  }

  const raw = response.text;
  const jsonText = extractJsonObject(raw);
  if (jsonText === undefined) {
    log.warn({ raw: raw.slice(0, 500) }, 'triage: no JSON object in response');
    return { intent: 'chat', confidence: 0, reasoning: 'could not parse JSON', raw };
  }

  let parsed;
  try {
    parsed = triageJsonSchema.parse(JSON.parse(jsonText));
  } catch (err) {
    log.warn({ err, jsonText: jsonText.slice(0, 500) }, 'triage: JSON failed schema');
    return { intent: 'chat', confidence: 0, reasoning: 'schema parse failed', raw };
  }

  // Low-confidence → fall back to `chat` so the brain asks for clarification.
  if (parsed.confidence < 0.7 && parsed.intent !== 'chat') {
    log.info(
      { originalIntent: parsed.intent, confidence: parsed.confidence },
      'triage: low confidence → chat',
    );
    return {
      intent: 'chat',
      confidence: parsed.confidence,
      reasoning: `low-confidence ${parsed.intent}: ${parsed.reasoning}`,
      raw,
    };
  }

  log.info({ intent: parsed.intent, confidence: parsed.confidence }, 'triage complete');
  return {
    intent: parsed.intent,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    raw,
  };
}
