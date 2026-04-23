/**
 * Builds the JSON object claude-cli expects from `--mcp-config <path>`. The
 * worker writes the result to a temp file inside the per-task worktree
 * before invoking claude.
 *
 * Schema (matches claude-cli's expectation):
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "<server-name>": {
 *       "command": "node",
 *       "args": ["<absolute path to dist/server.js>"],
 *       "env": { "BRAIN_RPC_URL": "...", "BRAIN_RPC_TOKEN": "...", ... }
 *     }
 *   }
 * }
 * ```
 *
 * Tool naming (per claude-cli convention): the `ask_user` tool exposed by the
 * `factory5-ask-user` server appears to the agent as `mcp__factory5-ask-user__ask_user`.
 * Sub-step 8.4 adds that name to the relevant agent tool whitelists.
 */

/** Stable server name claude exposes the tool under (`mcp__<name>__<tool>`). */
export const MCP_SERVER_NAME = 'factory5-ask-user';

/** Tool name as claude sees it once the MCP server is registered. */
export const ASK_USER_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__ask_user`;

export interface BuildMcpConfigOptions {
  /** Absolute path to this package's `dist/server.js`. */
  scriptPath: string;
  /** Daemon's IPC base URL (e.g. `http://127.0.0.1:25295`). */
  brainRpcUrl: string;
  /** Per-startup bearer token from `FACTORY5_WORKER_AUTH_TOKEN`. */
  brainRpcToken: string;
  /** ULID of the running task. */
  taskId: string;
  /** ULID of the parent directive. */
  directiveId: string;
  /**
   * Optional override for the `node` binary used to launch the server.
   * Defaults to `'node'` (claude resolves it on PATH); tests pass an
   * absolute path so spawned subprocesses don't rely on the env's PATH.
   */
  nodeBin?: string;
}

export interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

/**
 * Build the mcp-config JSON. Pure: no fs / process.env reads.
 */
export function buildMcpConfig(opts: BuildMcpConfigOptions): McpConfig {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: opts.nodeBin ?? 'node',
        args: [opts.scriptPath],
        env: {
          BRAIN_RPC_URL: opts.brainRpcUrl,
          BRAIN_RPC_TOKEN: opts.brainRpcToken,
          TASK_ID: opts.taskId,
          DIRECTIVE_ID: opts.directiveId,
        },
      },
    },
  };
}
