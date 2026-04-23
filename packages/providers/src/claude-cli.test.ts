import { describe, expect, it } from 'vitest';

import {
  buildClaudeArgs,
  composePromptText,
  extractUsage,
  parseClaudeJsonResult,
} from './claude-cli.js';
import type { ProviderRequest } from './types.js';

function baseReq(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    model: 'claude-opus-4-7',
    systemPrompt: 'You are helpful.',
    messages: [{ role: 'user', content: 'Hi.' }],
    ...overrides,
  };
}

describe('composePromptText', () => {
  it('includes a SYSTEM block when systemPrompt is non-empty', () => {
    const out = composePromptText('be concise', [{ role: 'user', content: 'hello' }]);
    expect(out).toContain('=== SYSTEM ===');
    expect(out).toContain('be concise');
    expect(out).toContain('=== USER ===');
    expect(out).toContain('hello');
  });

  it('omits the SYSTEM block when systemPrompt is empty/whitespace', () => {
    const out = composePromptText('   \n', [{ role: 'user', content: 'hi' }]);
    expect(out).not.toContain('=== SYSTEM ===');
    expect(out).toContain('=== USER ===');
  });

  it('preserves role order and multiple messages', () => {
    const out = composePromptText('', [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'mid' },
      { role: 'user', content: 'second' },
    ]);
    const firstIdx = out.indexOf('first');
    const midIdx = out.indexOf('mid');
    const secondIdx = out.indexOf('second');
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(midIdx).toBeGreaterThan(firstIdx);
    expect(secondIdx).toBeGreaterThan(midIdx);
    expect(out).toContain('=== ASSISTANT ===');
  });

  it('terminates with a trailing newline', () => {
    const out = composePromptText('s', [{ role: 'user', content: 'u' }]);
    expect(out.endsWith('\n')).toBe(true);
  });
});

describe('buildClaudeArgs', () => {
  it('produces -p --output-format json and model for call()', () => {
    const args = buildClaudeArgs(baseReq(), [], 'json');
    expect(args).toEqual(['-p', '--output-format', 'json', '--model', 'claude-opus-4-7']);
  });

  it('adds --verbose for stream-json', () => {
    const args = buildClaudeArgs(baseReq(), [], 'stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('stream-json');
  });

  it('appends extra args at the end', () => {
    const args = buildClaudeArgs(baseReq(), ['--foo', 'bar'], 'json');
    expect(args.slice(-2)).toEqual(['--foo', 'bar']);
  });

  it('omits --model when model string is empty', () => {
    const args = buildClaudeArgs(baseReq({ model: '' }), [], 'json');
    expect(args).not.toContain('--model');
  });

  it('adds --allowedTools as a comma-separated list when present', () => {
    const args = buildClaudeArgs(
      baseReq({ allowedTools: ['Read', 'Write', 'Edit'] }),
      [],
      'stream-json',
    );
    expect(args).toContain('--allowedTools');
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,Write,Edit');
  });

  it('emits --dangerously-skip-permissions for bypassPermissions mode', () => {
    const args = buildClaudeArgs(
      baseReq({ permissionMode: 'bypassPermissions' }),
      [],
      'stream-json',
    );
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('emits --permission-mode <mode> for non-bypass modes', () => {
    const args = buildClaudeArgs(baseReq({ permissionMode: 'acceptEdits' }), [], 'stream-json');
    expect(args).toContain('--permission-mode');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
  });

  it('adds --max-turns only for stream-json output', () => {
    const streamArgs = buildClaudeArgs(baseReq(), [], 'stream-json', { maxTurns: 10 });
    expect(streamArgs).toContain('--max-turns');
    expect(streamArgs[streamArgs.indexOf('--max-turns') + 1]).toBe('10');
    const jsonArgs = buildClaudeArgs(baseReq(), [], 'json', { maxTurns: 10 });
    expect(jsonArgs).not.toContain('--max-turns');
  });

  it('passes a per-request maxTurns override through to --max-turns', () => {
    // The provider merges req.maxTurns with its own default before calling
    // buildClaudeArgs; this test simulates that merge via explicit passthrough.
    const args = buildClaudeArgs(baseReq({ maxTurns: 55 }), [], 'stream-json', {
      maxTurns: 55,
    });
    expect(args).toContain('--max-turns');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('55');
  });

  it('does not add tool/permission flags when they are absent', () => {
    const args = buildClaudeArgs(baseReq(), [], 'json');
    expect(args).not.toContain('--allowedTools');
    expect(args).not.toContain('--permission-mode');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--mcp-config');
  });

  it('adds --mcp-config <path> when ProviderRequest.mcpConfigPath is set', () => {
    const args = buildClaudeArgs(
      baseReq({ mcpConfigPath: '/abs/worktree/.factory5-mcp.json' }),
      [],
      'stream-json',
    );
    expect(args).toContain('--mcp-config');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('/abs/worktree/.factory5-mcp.json');
  });

  it('omits --mcp-config when mcpConfigPath is the empty string', () => {
    const args = buildClaudeArgs(baseReq({ mcpConfigPath: '' }), [], 'stream-json');
    expect(args).not.toContain('--mcp-config');
  });
});

describe('parseClaudeJsonResult', () => {
  it('parses a well-formed success envelope', () => {
    const payload = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1234,
      num_turns: 1,
      result: 'hello world',
      session_id: 's1',
      total_cost_usd: 0.0042,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const parsed = parseClaudeJsonResult(payload);
    expect(parsed.result).toBe('hello world');
    expect(parsed.total_cost_usd).toBeCloseTo(0.0042);
    expect(parsed.usage?.input_tokens).toBe(10);
  });

  it('accepts envelopes missing optional fields', () => {
    const payload = JSON.stringify({
      type: 'result',
      subtype: 'success',
    });
    expect(() => parseClaudeJsonResult(payload)).not.toThrow();
  });

  it('throws on empty output with a helpful message', () => {
    expect(() => parseClaudeJsonResult('   ')).toThrow(/empty stdout/i);
  });

  it('throws on invalid JSON with a preview of the output', () => {
    expect(() => parseClaudeJsonResult('not json')).toThrow(/not json/);
  });
});

describe('extractUsage', () => {
  it('prefers total_cost_usd over cost_usd', () => {
    const u = extractUsage({
      type: 'result',
      subtype: 'success',
      cost_usd: 0.01,
      total_cost_usd: 0.05,
    });
    expect(u.costUsd).toBeCloseTo(0.05);
  });

  it('falls back to cost_usd when total is absent', () => {
    const u = extractUsage({
      type: 'result',
      subtype: 'success',
      cost_usd: 0.02,
    });
    expect(u.costUsd).toBeCloseTo(0.02);
  });

  it('defaults token counts to 0 when usage absent', () => {
    const u = extractUsage({ type: 'result', subtype: 'success' });
    expect(u.inputTokens).toBe(0);
    expect(u.outputTokens).toBe(0);
    expect(u.costUsd).toBe(0);
  });
});
