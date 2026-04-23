/**
 * `askUserHandler` — the HTTP layer behind the MCP `ask_user` tool. Separated
 * from the MCP server wiring so it can be unit-tested without a real MCP
 * transport.
 *
 * Reads the brain RPC endpoint + bearer token + task/directive correlation
 * from the env block claude-cli passes through (see ADR 0024 §1 + §3). The
 * `env` argument is normally `process.env` but is injected here for tests.
 */

export interface AskUserHandlerEnv {
  /** Daemon's IPC base URL, e.g. `http://127.0.0.1:25295`. */
  BRAIN_RPC_URL?: string;
  /** Per-startup bearer token from `FACTORY5_WORKER_AUTH_TOKEN`. */
  BRAIN_RPC_TOKEN?: string;
  /** ULID of the task this MCP server is serving. */
  TASK_ID?: string;
  /** ULID of the parent directive. */
  DIRECTIVE_ID?: string;
}

export interface AskUserToolInput {
  question: string;
  options?: string[];
  /**
   * Per-question soft deadline in seconds. Optional — when omitted, the
   * daemon falls back to its configured default (1 hour per ADR 0024 §2).
   */
  deadlineSeconds?: number;
}

export interface AskUserToolOutput {
  /** The answer text the operator wrote. Empty string when `timedOut` or `aborted`. */
  answer: string;
  /** True when no answer arrived before the soft deadline. */
  timedOut: boolean;
  /** True when the wait was aborted (brain shutdown, signal). */
  aborted: boolean;
  /** Question id — surfaces in the operator's view of the question. */
  questionId: string;
}

export interface AskUserHandlerOptions {
  env: AskUserHandlerEnv;
  /**
   * Inject for tests. Defaults to global `fetch`. Signature must match
   * the standard fetch.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Validation error: env is missing one of the required correlation fields.
 * Surfaces as a structured MCP tool error so the agent sees a useful
 * message rather than a generic "request failed".
 */
export class AskUserEnvError extends Error {
  override readonly name = 'AskUserEnvError';
  constructor(
    public readonly missing: readonly string[],
    public readonly env: AskUserHandlerEnv,
  ) {
    super(
      `worker-mcp: missing required env var(s): ${missing.join(', ')} — ` +
        `worker spawn must set BRAIN_RPC_URL, BRAIN_RPC_TOKEN, TASK_ID, DIRECTIVE_ID`,
    );
  }
}

/**
 * HTTP-layer error: the brain RPC route returned a non-2xx envelope or
 * the network call itself failed. Carries the upstream code/message when
 * available so the agent can decide whether to retry or fall back.
 */
export class AskUserRpcError extends Error {
  override readonly name = 'AskUserRpcError';
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface BrainErrorEnvelope {
  error?: { code?: string; message?: string };
}

interface BrainOkEnvelope {
  questionId: string;
  answer?: string;
  timedOut: boolean;
  aborted: boolean;
}

/**
 * Validate env and POST to the brain RPC route. Returns a tool-result-shaped
 * payload the MCP server hands back to claude. Throws {@link AskUserEnvError}
 * for missing env (programmer error in the worker spawn) or
 * {@link AskUserRpcError} for HTTP / brain-side failures.
 */
export async function askUserHandler(
  input: AskUserToolInput,
  opts: AskUserHandlerOptions,
): Promise<AskUserToolOutput> {
  const { env } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const missing: string[] = [];
  if (env.BRAIN_RPC_URL === undefined || env.BRAIN_RPC_URL.length === 0) {
    missing.push('BRAIN_RPC_URL');
  }
  if (env.BRAIN_RPC_TOKEN === undefined || env.BRAIN_RPC_TOKEN.length === 0) {
    missing.push('BRAIN_RPC_TOKEN');
  }
  if (env.TASK_ID === undefined || env.TASK_ID.length === 0) {
    missing.push('TASK_ID');
  }
  if (env.DIRECTIVE_ID === undefined || env.DIRECTIVE_ID.length === 0) {
    missing.push('DIRECTIVE_ID');
  }
  if (missing.length > 0) {
    throw new AskUserEnvError(missing, env);
  }

  // Body uses the daemon's wire schema (see workerAskUserRequestSchema in
  // @factory5/ipc). Only include `options` / `deadlineSeconds` when set.
  const body: Record<string, unknown> = {
    taskId: env.TASK_ID,
    directiveId: env.DIRECTIVE_ID,
    question: input.question,
  };
  if (input.options !== undefined && input.options.length > 0) {
    body.options = input.options;
  }
  if (input.deadlineSeconds !== undefined) {
    body.deadlineSeconds = input.deadlineSeconds;
  }

  const url = trimSlash(env.BRAIN_RPC_URL ?? '') + '/worker/ask-user';
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.BRAIN_RPC_TOKEN ?? ''}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AskUserRpcError(
      0,
      'NETWORK_ERROR',
      `worker-mcp: HTTP call to ${url} failed: ${(err as Error).message}`,
    );
  }

  if (!response.ok) {
    let upstreamCode = 'UPSTREAM_ERROR';
    let upstreamMessage = `brain RPC returned HTTP ${String(response.status)}`;
    try {
      const errBody = (await response.json()) as BrainErrorEnvelope;
      if (errBody.error?.code !== undefined) upstreamCode = errBody.error.code;
      if (errBody.error?.message !== undefined) upstreamMessage = errBody.error.message;
    } catch {
      // Body wasn't JSON — keep the generic message.
    }
    throw new AskUserRpcError(response.status, upstreamCode, upstreamMessage);
  }

  const okBody = (await response.json()) as BrainOkEnvelope;
  return {
    questionId: okBody.questionId,
    answer: okBody.answer ?? '',
    timedOut: okBody.timedOut,
    aborted: okBody.aborted,
  };
}

function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
