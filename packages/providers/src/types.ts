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
  /**
   * Per-request override for the maximum tool-use turns. Only honored by
   * streaming/tool-using provider modes (claude-cli `stream()`); text-only
   * paths ignore it. When omitted, the provider's own default is used.
   */
  maxTurns?: number;
  /**
   * Path to an MCP config JSON file to pass via claude-cli's `--mcp-config`
   * flag. When set, claude spawns the listed MCP servers and exposes their
   * tools to the agent under `mcp__<server>__<tool>` names. The
   * corresponding tool name(s) must also appear in {@link allowedTools}
   * (or the agent won't be allowed to call them). Honored only by
   * subprocess-style providers; HTTP providers ignore it.
   *
   * See ADR 0024 — `@factory5/worker-mcp` produces the file the worker
   * passes here so the in-stream agent can call `ask_user`.
   */
  mcpConfigPath?: string;
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
  /**
   * Tier 15 / ADR 0034 — number of agentic tool-use turns the provider
   * reported (sourced from claude-cli's terminal `result` event's
   * `num_turns`). Optional because providers that don't track turn counts
   * leave it absent; absent is treated as 0 in pool aggregation paths.
   */
  numTurns?: number;
}

export interface ProviderStreamChunk {
  /** Incremental text since last chunk. */
  delta: string;
  /** Final usage; only present in the terminal chunk. */
  usage?: ProviderUsage;
  /**
   * Tier 15 / ADR 0034 — number of agentic tool-use turns the provider
   * reported on its terminal `result` event. Only present on the
   * terminal chunk (the same chunk that carries `usage`); absent on
   * every intermediate delta chunk and on providers that don't track
   * turn counts. The worker reads this to populate
   * {@link TaskResult.turnsUsed}.
   */
  numTurns?: number;
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
