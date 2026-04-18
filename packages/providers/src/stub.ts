/**
 * `StubProvider` — a canned in-memory `ModelProvider` useful for tests,
 * the e2e daemon script, and any smoke that must not burn tokens.
 *
 * Enabled by the e2e script via `FACTORY5_TEST_PROVIDER=stub`; the brain's
 * `buildDefaultRegistry` (or a daemon supplied `providerRegistry`) routes
 * every category to this stub when the env flag is set.
 *
 * Behaviour:
 *   - If the system prompt mentions "triage", the response is the canned
 *     JSON `{"intent":"chat","confidence":0.9,"signals":[],"rationale":"stub"}`.
 *   - Otherwise the response is a short deterministic acknowledgement.
 *   - `usage` is always zero — the stub never touches the model bill.
 */

import type {
  ModelProvider,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
  ProviderUsage,
} from './types.js';

export interface StubProviderOptions {
  id?: string;
  /** Override the default triage response. */
  triageText?: string;
  /** Override the default non-triage response. */
  defaultText?: string;
}

const DEFAULT_TRIAGE_TEXT = JSON.stringify({
  intent: 'chat',
  confidence: 0.9,
  signals: [],
  rationale: 'stub provider',
});

const DEFAULT_TEXT = 'stub response';

export class StubProvider implements ModelProvider {
  readonly id: string;
  private readonly triageText: string;
  private readonly defaultText: string;

  constructor(opts: StubProviderOptions = {}) {
    this.id = opts.id ?? 'stub';
    this.triageText = opts.triageText ?? DEFAULT_TRIAGE_TEXT;
    this.defaultText = opts.defaultText ?? DEFAULT_TEXT;
  }

  async available(): Promise<boolean> {
    return Promise.resolve(true);
  }

  async call(req: ProviderRequest): Promise<ProviderResponse> {
    const text = this.responseFor(req);
    const usage: ProviderUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    return Promise.resolve({
      text,
      usage,
      resolvedProvider: this.id,
      resolvedModel: req.model,
    });
  }

  async *stream(req: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const text = this.responseFor(req);
    yield {
      delta: text,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    };
  }

  private responseFor(req: ProviderRequest): string {
    const sys = req.systemPrompt.toLowerCase();
    if (sys.includes('triage') || sys.includes('intent classification')) {
      return this.triageText;
    }
    return this.defaultText;
  }
}

export function createStubProvider(opts: StubProviderOptions = {}): StubProvider {
  return new StubProvider(opts);
}
