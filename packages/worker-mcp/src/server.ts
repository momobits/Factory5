/**
 * MCP server entry — claude-cli spawns this as a child process via
 * `--mcp-config`. Runs an MCP server over stdio that exposes one tool:
 * `ask_user`. The tool body is a thin wrapper over {@link askUserHandler}
 * (the actual HTTP layer); see ADR 0024 §1 for the route choice.
 *
 * Lifecycle:
 *   1. Claude reads the mcp-config and spawns this script via `node <path>`.
 *   2. The MCP SDK speaks JSON-RPC over stdio: handshake, list tools, call.
 *   3. When the agent calls `mcp__factory5-ask-user__ask_user`, this server's
 *      `tools/call` handler runs `askUserHandler` which POSTs to brain RPC.
 *   4. The HTTP call blocks (potentially for up to the daemon's per-question
 *      soft deadline, default 1h per ADR 0024 §2) until the operator answers.
 *   5. The answer flows back as the tool result; claude continues the stream.
 *
 * Env vars read at startup (passed in via the mcp-config block):
 *   BRAIN_RPC_URL, BRAIN_RPC_TOKEN, TASK_ID, DIRECTIVE_ID
 *
 * No tests for this entry directly — the HTTP layer is tested via
 * `handler.test.ts`, the config is tested via `mcp-config.test.ts`, and
 * the end-to-end claude→MCP→brain roundtrip is covered by sub-step 8.7's
 * live validation.
 */

import process, { env } from 'node:process';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { AskUserEnvError, AskUserRpcError, askUserHandler } from './handler.js';
import { MCP_SERVER_NAME } from './mcp-config.js';

const TOOL_NAME = 'ask_user';

const TOOL_DESCRIPTION = [
  'Pause the current task and ask the operator a clarifying question.',
  'Use when the spec is ambiguous, a design choice between two valid options',
  'must be made, a missing input value needs to be supplied, or two equally',
  'plausible root causes need disambiguation. Do NOT use for typos, sensible',
  'defaults, or stylistic preferences not pinned in the spec — those should',
  'be resolved without escalation.',
  '',
  'Returns the operator’s answer as a string. May time out (default 1h)',
  'if no answer is provided; on timeout, fall back to a sensible default and',
  'continue, or raise a finding if the work cannot proceed.',
].join('\n');

const TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description: 'The clarifying question, in operator-facing language.',
    },
    options: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional enumerated choices the operator can pick from.',
    },
    deadlineSeconds: {
      type: 'integer',
      minimum: 1,
      description:
        'Optional per-question soft deadline in seconds. Omit to use the daemon’s default (1 hour).',
    },
  },
  required: ['question'],
  additionalProperties: false,
} as const;

interface ToolCallArgs {
  question?: unknown;
  options?: unknown;
  deadlineSeconds?: unknown;
}

function coerceArgs(raw: unknown): {
  question: string;
  options?: string[];
  deadlineSeconds?: number;
} {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('ask_user: arguments must be an object');
  }
  const args = raw as ToolCallArgs;
  if (typeof args.question !== 'string' || args.question.length === 0) {
    throw new Error('ask_user: `question` is required and must be a non-empty string');
  }
  const out: { question: string; options?: string[]; deadlineSeconds?: number } = {
    question: args.question,
  };
  if (args.options !== undefined) {
    if (!Array.isArray(args.options) || !args.options.every((o) => typeof o === 'string')) {
      throw new Error('ask_user: `options` must be an array of strings');
    }
    out.options = args.options as string[];
  }
  if (args.deadlineSeconds !== undefined) {
    if (typeof args.deadlineSeconds !== 'number' || !Number.isInteger(args.deadlineSeconds)) {
      throw new Error('ask_user: `deadlineSeconds` must be an integer');
    }
    out.deadlineSeconds = args.deadlineSeconds;
  }
  return out;
}

async function main(): Promise<void> {
  const server = new Server(
    { name: MCP_SERVER_NAME, version: '0.0.1' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        inputSchema: TOOL_INPUT_SCHEMA,
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== TOOL_NAME) {
      throw new Error(`worker-mcp: unknown tool '${request.params.name}'`);
    }
    let input: { question: string; options?: string[]; deadlineSeconds?: number };
    try {
      input = coerceArgs(request.params.arguments);
    } catch (err) {
      return {
        content: [{ type: 'text', text: (err as Error).message }],
        isError: true,
      };
    }
    try {
      const result = await askUserHandler(input, { env });
      if (result.timedOut) {
        return {
          content: [
            {
              type: 'text',
              text: `(question ${result.questionId}) timed out — no operator answer received before deadline. Fall back to a sensible default or raise a finding if you cannot proceed.`,
            },
          ],
          isError: true,
        };
      }
      if (result.aborted) {
        return {
          content: [
            {
              type: 'text',
              text: `(question ${result.questionId}) aborted — the wait was cancelled (likely brain shutdown). Stop and let the brain handle directive recovery.`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: result.answer }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isEnv = err instanceof AskUserEnvError;
      const isRpc = err instanceof AskUserRpcError;
      return {
        content: [
          {
            type: 'text',
            text:
              isEnv || isRpc
                ? `worker-mcp: ${message}`
                : `worker-mcp: unexpected error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  // Last-resort handler — anything that escapes the MCP SDK's own boundary.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`worker-mcp: fatal: ${message}\n`);
  process.exit(1);
});
