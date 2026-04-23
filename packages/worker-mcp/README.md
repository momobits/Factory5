# @factory5/worker-mcp

A small MCP (Model Context Protocol) server that exposes one tool to the Claude CLI subprocess: **`ask_user`**. This is the worker-side half of [ADR 0024](../../docs/decisions/0024-worker-subprocess-ask-user.md) — sub-step 8.3.

## Why

Brain-side `askUser()` (`packages/brain/src/ask-user.ts`, Phase 4) lets the brain pause execution between phases until the operator answers a question. But a tool-using worker (a `claude -p --output-format stream-json` subprocess running scaffolder / builder / fixer / investigator) cannot escalate mid-stream — it has to either guess or abandon the run.

This package is what gives the in-stream agent an `ask_user` tool: claude-cli spawns the MCP server via `--mcp-config`, the agent calls `mcp__factory5-ask-user__ask_user`, the server proxies the call to the brain's existing `askUser()` over the daemon's `POST /worker/ask-user` route (sub-step 8.2, bearer-gated), and the answer flows back through the MCP tool result into the agent's next turn.

## How the worker uses it

The worker package (`@factory5/worker`) writes an mcp-config JSON file inside the per-task worktree before spawning claude-cli:

```json
{
  "mcpServers": {
    "factory5-ask-user": {
      "command": "node",
      "args": ["<absolute path to this package's dist/server.js>"],
      "env": {
        "BRAIN_RPC_URL": "http://127.0.0.1:25295",
        "BRAIN_RPC_TOKEN": "<per-startup hex token from FACTORY5_WORKER_AUTH_TOKEN>",
        "TASK_ID": "<ULID of the running task>",
        "DIRECTIVE_ID": "<ULID of the parent directive>"
      }
    }
  }
}
```

Then it adds `--mcp-config <path>` to the claude-cli argv. Claude reads the config, spawns the MCP server as its own child process, and the tool becomes available to the agent.

## Public API

- **`buildMcpConfig({ scriptPath, brainRpcUrl, brainRpcToken, taskId, directiveId })`** — builds the JSON object the worker writes to disk.
- **`getServerScriptPath()`** — returns the absolute path to `dist/server.js`. Worker uses this to fill `args` in the config.
- **`askUserHandler({ question, options? }, env)`** — the HTTP layer (exported separately for testability; the MCP server's `tools/call` handler is a thin wrapper over this).

## Tests

`handler.test.ts` covers the HTTP roundtrip with a stubbed `fetch`; `mcp-config.test.ts` covers the config builder. The MCP server entry (`server.ts`) is exercised end-to-end by sub-step 8.7's live validation rather than by unit tests, since unit-testing requires either a real claude-cli subprocess or a fake MCP client (deferred to integration scope).
