/**
 * @factory5/worker-mcp — exports the helpers the worker uses to wire the
 * MCP server. The server entry itself lives at `./server` (loaded as a
 * subprocess by claude-cli; not imported in-process).
 *
 * @packageDocumentation
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  AskUserEnvError,
  AskUserRpcError,
  askUserHandler,
  type AskUserHandlerEnv,
  type AskUserHandlerOptions,
  type AskUserToolInput,
  type AskUserToolOutput,
} from './handler.js';

export {
  ASK_USER_TOOL_NAME,
  MCP_SERVER_NAME,
  buildMcpConfig,
  type BuildMcpConfigOptions,
  type McpConfig,
  type McpServerConfig,
} from './mcp-config.js';

/**
 * Returns the absolute path to the compiled MCP server entry (`dist/server.js`
 * inside this package). Workers pass it as `args[0]` to `node` in the
 * mcp-config block.
 *
 * Uses `import.meta.url` to locate the package's own dist/ directory;
 * survives across pnpm hoisting layouts and works whether the package is
 * installed as a workspace symlink or as a real `node_modules/` entry.
 */
export function getServerScriptPath(): string {
  const here = fileURLToPath(import.meta.url);
  return join(dirname(here), 'server.js');
}
