/**
 * Pure parsers for `claude -p --output-format stream-json` NDJSON events.
 *
 * The CLI emits one JSON object per line; each object has a `type` discriminator:
 *   - `system/init`     — session metadata; ignored by this layer
 *   - `assistant`       — an assistant message (content blocks: text | tool_use)
 *   - `user`            — a synthesised tool-result turn; ignored
 *   - `result`          — terminal event with final text + aggregated usage
 *
 * `parseStreamJsonLine` does NDJSON-safe parsing (returns `undefined` for
 * empty / non-JSON lines). `eventToChunks` maps a parsed event to zero or
 * more {@link ProviderStreamChunk}s for the provider to yield downstream.
 *
 * Kept in a standalone module so it can be unit-tested without spawning a
 * subprocess.
 */

import { z } from 'zod';

import type { ProviderStreamChunk, ProviderUsage } from './types.js';

// ---------------------------------------------------------------------------
// Event schema
// ---------------------------------------------------------------------------

const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const toolUseBlockSchema = z
  .object({
    type: z.literal('tool_use'),
    name: z.string(),
  })
  .passthrough();

const assistantContentBlockSchema = z.union([
  textBlockSchema,
  toolUseBlockSchema,
  z.object({ type: z.string() }).passthrough(),
]);

const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const assistantEventSchema = z
  .object({
    type: z.literal('assistant'),
    message: z
      .object({
        content: z.array(assistantContentBlockSchema).default([]),
      })
      .passthrough(),
  })
  .passthrough();

const resultEventSchema = z
  .object({
    type: z.literal('result'),
    subtype: z.string(),
    is_error: z.boolean().optional(),
    duration_ms: z.number().nonnegative().optional(),
    num_turns: z.number().int().nonnegative().optional(),
    result: z.string().optional(),
    session_id: z.string().optional(),
    total_cost_usd: z.number().nonnegative().optional(),
    cost_usd: z.number().nonnegative().optional(),
    usage: usageSchema.optional(),
    error: z.string().optional(),
  })
  .passthrough();

const systemEventSchema = z
  .object({
    type: z.literal('system'),
    subtype: z.string().optional(),
  })
  .passthrough();

const userEventSchema = z
  .object({
    type: z.literal('user'),
  })
  .passthrough();

const streamEventSchema = z.discriminatedUnion('type', [
  systemEventSchema,
  assistantEventSchema,
  userEventSchema,
  resultEventSchema,
]);

export type StreamEvent = z.infer<typeof streamEventSchema>;
export type AssistantEvent = z.infer<typeof assistantEventSchema>;
export type ResultEvent = z.infer<typeof resultEventSchema>;

// ---------------------------------------------------------------------------
// Line → event
// ---------------------------------------------------------------------------

/**
 * Parse a single NDJSON line. Returns `undefined` for blank lines or lines
 * that can't be parsed as JSON (the CLI occasionally emits non-JSON log
 * fragments when `--verbose` is tripped unexpectedly — we skip rather than
 * abort the stream).
 */
export function parseStreamJsonLine(line: string): StreamEvent | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const parsed = streamEventSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------
// Event → chunks
// ---------------------------------------------------------------------------

export function usageFromResult(r: ResultEvent): ProviderUsage {
  return {
    inputTokens: r.usage?.input_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
    costUsd: r.total_cost_usd ?? r.cost_usd ?? 0,
  };
}

/**
 * Map a parsed stream event to zero or more chunks to yield downstream.
 * - `assistant` with text blocks → one chunk per text block (delta = text).
 * - `result` → terminal chunk (delta = '', usage populated; numTurns when present).
 * - everything else → no chunks (system/init, tool_use blocks, user turns).
 */
export function eventToChunks(evt: StreamEvent): ProviderStreamChunk[] {
  if (evt.type === 'assistant') {
    const chunks: ProviderStreamChunk[] = [];
    for (const block of evt.message.content) {
      if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
        const text = (block as { text: string }).text;
        if (text.length > 0) chunks.push({ delta: text });
      }
    }
    return chunks;
  }
  if (evt.type === 'result') {
    const chunk: ProviderStreamChunk = { delta: '', usage: usageFromResult(evt) };
    if (evt.num_turns !== undefined) chunk.numTurns = evt.num_turns;
    return [chunk];
  }
  return [];
}

/**
 * True iff the event's `result` subtype or `is_error` flag indicates the CLI
 * reported an error rather than a successful completion. Callers should
 * abort the stream with a descriptive error when this fires.
 */
export function resultIsError(r: ResultEvent): boolean {
  if (r.is_error === true) return true;
  if (r.subtype === 'error' || r.subtype === 'error_max_turns') return true;
  return false;
}
