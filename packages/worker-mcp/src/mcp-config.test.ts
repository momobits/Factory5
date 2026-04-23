import { describe, expect, it } from 'vitest';

import { ASK_USER_TOOL_NAME, MCP_SERVER_NAME, buildMcpConfig } from './mcp-config.js';

describe('buildMcpConfig', () => {
  const validOpts = {
    scriptPath: '/abs/path/to/dist/server.js',
    brainRpcUrl: 'http://127.0.0.1:25295',
    brainRpcToken: 'hex-token-abc',
    taskId: '01J0TASK0000000000000000000',
    directiveId: '01J0DIRECTIVE000000000000000',
  };

  it('produces the canonical mcpServers shape claude-cli expects', () => {
    const config = buildMcpConfig(validOpts);
    expect(config.mcpServers).toBeDefined();
    expect(Object.keys(config.mcpServers)).toEqual([MCP_SERVER_NAME]);
    const server = config.mcpServers[MCP_SERVER_NAME];
    expect(server?.command).toBe('node');
    expect(server?.args).toEqual([validOpts.scriptPath]);
  });

  it('passes the four correlation env vars through to the server', () => {
    const config = buildMcpConfig(validOpts);
    const env = config.mcpServers[MCP_SERVER_NAME]?.env ?? {};
    expect(env.BRAIN_RPC_URL).toBe(validOpts.brainRpcUrl);
    expect(env.BRAIN_RPC_TOKEN).toBe(validOpts.brainRpcToken);
    expect(env.TASK_ID).toBe(validOpts.taskId);
    expect(env.DIRECTIVE_ID).toBe(validOpts.directiveId);
  });

  it('honours nodeBin override', () => {
    const config = buildMcpConfig({ ...validOpts, nodeBin: '/usr/local/bin/node' });
    expect(config.mcpServers[MCP_SERVER_NAME]?.command).toBe('/usr/local/bin/node');
  });

  it('exposes the tool name claude exposes to the agent', () => {
    expect(ASK_USER_TOOL_NAME).toBe(`mcp__${MCP_SERVER_NAME}__ask_user`);
  });

  it('serialises to JSON cleanly (no functions / undefineds in env)', () => {
    const config = buildMcpConfig(validOpts);
    expect(() => JSON.stringify(config)).not.toThrow();
    const reparsed = JSON.parse(JSON.stringify(config)) as typeof config;
    expect(reparsed).toEqual(config);
  });
});
