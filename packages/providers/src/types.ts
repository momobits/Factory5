/**
 * `ModelProvider` — uniform contract for any LLM provider (HTTP API or
 * subprocess CLI).
 */

import type { ModelCategory } from '@factory5/core';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ProviderMessage {
  role: Role;
  content: string;
  /** Tool-call results / tool-use blocks. Provider-specific shape. */
  metadata?: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON schema. */
  parameters: Record<string, unknown>;
}

export interface ProviderRequest {
  /** Model identifier in the provider's native vocabulary, e.g. "claude-opus-4-7". */
  model: string;
  systemPrompt: string;
  messages: ProviderMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  /** Reasoning effort hint. Providers that don't support it ignore. */
  reasoning?: 'low' | 'medium' | 'high' | 'max';
  /**
   * Cancellation signal. Provider implementations MUST honor this by killing
   * their subprocess / aborting their HTTP request and rejecting the `call`
   * promise (or ending the `stream` iterable) with an AbortError.
   */
  signal?: AbortSignal;
  /**
   * Working directory for subprocess-style providers (e.g. claude-cli inside
   * a per-task worktree). HTTP providers ignore this.
   */
  cwd?: string;
  /**
   * Whitelist of tool names the provider may use. Only meaningful for
   * tool-using provider modes (claude-cli `stream()`); unused by pure
   * text-completion paths.
   */
  allowedTools?: readonly string[];
  /**
   * Permission mode for subprocess-style providers that support it
   * (claude-cli: 'bypassPermissions' skips per-tool prompts; suitable when
   * the worker runs inside an isolated worktree). Providers that don't
   * understand the flag ignore it.
   */
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface ProviderResponse {
  text: string;
  toolCalls?: { name: string; arguments: Record<string, unknown> }[];
  usage: ProviderUsage;
  /** Provider/model that actually responded (may differ from requested due to fallback). */
  resolvedProvider: string;
  resolvedModel: string;
}

export interface ProviderStreamChunk {
  /** Incremental text since last chunk. */
  delta: string;
  /** Final usage; only present in the terminal chunk. */
  usage?: ProviderUsage;
}

export interface ModelProvider {
  /** Stable id like "claude-cli", "anthropic-api". */
  id: string;
  /** Quick check: is this provider configured & reachable right now? */
  available(): Promise<boolean>;
  /** One-shot call. */
  call(req: ProviderRequest): Promise<ProviderResponse>;
  /** Streaming call (delta chunks); throws if provider doesn't support streaming. */
  stream(req: ProviderRequest): AsyncIterable<ProviderStreamChunk>;
}

export interface CategoryResolution {
  provider: ModelProvider;
  /** Provider's native model id. */
  model: string;
  /** The chain entry index used (for telemetry / fallback annotations). */
  chainIndex: number;
  category: ModelCategory;
}
