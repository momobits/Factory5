/**
 * Tests for `runArchitectWithCritique` — the architect→critic retry wrapper.
 *
 * All dependencies are injected as `vi.fn()` mocks; no real providers, no
 * DB, no filesystem I/O. The wrapper's testability comes entirely from DI.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WikiCritique } from '@factory5/core';
import { initLogger } from '@factory5/logger';

import { runArchitectWithCritique, WikiReadinessAbortError } from './architect-loop.js';

beforeAll(() => {
  initLogger({ processName: 'architect-loop-test', noFile: true, noConsole: true });
});

describe('runArchitectWithCritique', () => {
  it('passes on attempt 1 — one architect + one critic call', async () => {
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const crit = vi.fn().mockResolvedValue(passing());
    const result = await runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser: vi.fn(),
      readClaudeMd: vi.fn().mockResolvedValue('# md'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'x',
      maxAttempts: 3,
    });
    expect(result.attempts).toBe(1);
    expect(result.exhausted).toBe(false);
    expect(arch).toHaveBeenCalledTimes(1);
    expect(crit).toHaveBeenCalledTimes(1);
  });

  it('passes on attempt 2 — second architect call gets priorCritique', async () => {
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const crit = vi.fn().mockResolvedValueOnce(failing('major')).mockResolvedValueOnce(passing());
    const result = await runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser: vi.fn(),
      readClaudeMd: vi.fn().mockResolvedValue('# md'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'x',
      maxAttempts: 3,
    });
    expect(result.attempts).toBe(2);
    expect(arch).toHaveBeenCalledTimes(2);
    expect(arch.mock.calls[1][0].priorCritique).toBeDefined();
    expect(arch.mock.calls[0][0].priorCritique).toBeUndefined();
  });

  it('exhausts after 3 attempts and calls askUser with rendered critique', async () => {
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const crit = vi.fn().mockResolvedValue(failing('major'));
    const askUser = vi.fn().mockResolvedValue('continue');
    await runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser,
      readClaudeMd: vi.fn().mockResolvedValue('# md'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'x',
      maxAttempts: 3,
    });
    expect(arch).toHaveBeenCalledTimes(3);
    expect(crit).toHaveBeenCalledTimes(3);
    expect(askUser).toHaveBeenCalled();
    // Inspect the first call's args
    const askUserCallArgs = askUser.mock.calls[0][0];
    expect(askUserCallArgs.prompt).toContain('[CRITIC]');
  });

  it('operator continue → returns exhausted: true', async () => {
    const result = await runWithExhaustionAnswer('continue');
    expect(result.exhausted).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('operator abort → throws WikiReadinessAbortError', async () => {
    await expect(runWithExhaustionAnswer('abort')).rejects.toBeInstanceOf(WikiReadinessAbortError);
  });

  it('operator extend-3 → 3 more attempts', async () => {
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const crit = vi.fn().mockResolvedValue(failing('major'));
    let asked = 0;
    const askUser = vi.fn().mockImplementation(() => {
      asked += 1;
      return Promise.resolve(asked === 1 ? 'extend-3' : 'continue');
    });
    const result = await runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser,
      readClaudeMd: vi.fn().mockResolvedValue('# md'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'x',
      maxAttempts: 3,
    });
    expect(arch).toHaveBeenCalledTimes(6);
    expect(askUser).toHaveBeenCalledTimes(2);
    expect(result.exhausted).toBe(true);
    expect(result.attempts).toBe(6);
  });

  it('unrecognized answer falls through to continue (ADR 0030 default)', async () => {
    const result = await runWithExhaustionAnswer('banana');
    expect(result.exhausted).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it('extend-3 passes the last critique forward to the first extended attempt', async () => {
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const lastBeforeExtend = failing('blocking');
    const crit = vi
      .fn()
      .mockResolvedValueOnce(failing('major')) // attempt 1 (fails)
      .mockResolvedValueOnce(failing('major')) // attempt 2 (fails)
      .mockResolvedValueOnce(lastBeforeExtend) // attempt 3 (fails — exhausted)
      .mockResolvedValueOnce(passing()); // attempt 4 (first extended — passes)
    const askUser = vi.fn().mockResolvedValue('extend-3');
    await runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser,
      readClaudeMd: vi.fn().mockResolvedValue('# md'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'x',
      maxAttempts: 3,
    });
    // The 4th architect call (first of extended round) should receive the last critique from before extend
    expect(arch.mock.calls[3][0].priorCritique).toBe(lastBeforeExtend);
  });

  it('maxAttempts: 0 (unlimited) — passes after N attempts without askUser', async () => {
    let i = 0;
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const crit = vi
      .fn()
      .mockImplementation(() => Promise.resolve(++i === 7 ? passing() : failing('major')));
    const askUser = vi.fn();
    const result = await runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser,
      readClaudeMd: vi.fn().mockResolvedValue('# md'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'x',
      maxAttempts: 0,
    });
    expect(result.attempts).toBe(7);
    expect(askUser).not.toHaveBeenCalled();
  });

  it('maxAttempts: 1 — first fail triggers immediate askUser, no retry', async () => {
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const crit = vi.fn().mockResolvedValue(failing('major'));
    const askUser = vi.fn().mockResolvedValue('continue');
    await runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser,
      readClaudeMd: vi.fn().mockResolvedValue('# md'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'x',
      maxAttempts: 1,
    });
    expect(arch).toHaveBeenCalledTimes(1);
    expect(crit).toHaveBeenCalledTimes(1);
    expect(askUser).toHaveBeenCalledTimes(1);
  });

  it('emits a per-attempt log line', async () => {
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const crit = vi.fn().mockResolvedValueOnce(failing('major')).mockResolvedValueOnce(passing());
    const emit = vi.fn();
    await runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser: vi.fn(),
      readClaudeMd: vi.fn().mockResolvedValue('# md'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'x',
      maxAttempts: 3,
      directiveId: '01TEST',
      emit,
    });
    // Verify the emit function was called with messages containing "attempt 1/3" and "attempt 2/3"
    const msgs = emit.mock.calls.map((c) => (c[0] as { msg?: string }).msg ?? '');
    expect(msgs.some((m) => m.includes('attempt 1/3'))).toBe(true);
    expect(msgs.some((m) => m.includes('attempt 2/3'))).toBe(true);
  });

  it('exhaustion log line carries last critique summary', async () => {
    const emit = vi.fn();
    await runWithExhaustionAnswer('continue', emit);
    const msgs = emit.mock.calls.map(
      (c) => (c[0] as { msg?: string; attrs?: { lastSummary?: string } }) ?? {},
    );
    const exhaustedMsg = msgs.find((m) => m.msg?.includes('exhausted'));
    expect(exhaustedMsg).toBeDefined();
    expect(exhaustedMsg?.msg).toMatch(/exhausted.*3.*attempts/i);
    // The summary is in attrs.lastSummary per the emitLogLine call
    const summaryPresent = msgs.some((m) => m.attrs?.lastSummary?.includes('wiki not ready'));
    expect(summaryPresent).toBe(true);
  });

  it('throws if architect throws on first attempt', async () => {
    const arch = vi.fn().mockRejectedValue(new Error('architect blew up'));
    await expect(
      runArchitectWithCritique({
        runArchitect: arch,
        runWikiCritic: vi.fn(),
        askUser: vi.fn(),
        readClaudeMd: vi.fn().mockResolvedValue('# md'),
        registry: {} as any,
        projectPath: '/p',
        directiveBody: 'x',
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/architect blew up/);
  });

  it('priorCritique flows through to second-attempt architect', async () => {
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const failing1 = failing('major');
    const crit = vi.fn().mockResolvedValueOnce(failing1).mockResolvedValueOnce(passing());
    await runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser: vi.fn(),
      readClaudeMd: vi.fn().mockResolvedValue('# md'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'x',
      maxAttempts: 3,
    });
    expect(arch.mock.calls[1][0].priorCritique).toBe(failing1);
  });

  it('passes config + limits + emit through to architect and critic', async () => {
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const crit = vi.fn().mockResolvedValue(passing());
    const config = { agents: { architect: 'deep' as const } };
    const limits = { maxUsd: 5 };
    const emit = vi.fn();
    await runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser: vi.fn(),
      readClaudeMd: vi.fn().mockResolvedValue('# md'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'x',
      maxAttempts: 3,
      config,
      limits,
      emit,
      directiveId: '01X',
    });
    expect(arch.mock.calls[0][0].config).toEqual(config);
    expect(arch.mock.calls[0][0].limits).toEqual(limits);
    expect(arch.mock.calls[0][0].directiveId).toBe('01X');
    expect(crit.mock.calls[0][0].config).toEqual(config);
    expect(crit.mock.calls[0][0].limits).toEqual(limits);
  });

  it('critic receives directiveBody and claudeMd from wrapper', async () => {
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const crit = vi.fn().mockResolvedValue(passing());
    await runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser: vi.fn(),
      readClaudeMd: vi.fn().mockResolvedValue('# CLAUDE_MD_MARKER'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'DIRECTIVE_BODY_MARKER',
      maxAttempts: 3,
    });
    expect(crit.mock.calls[0][0].claudeMd).toContain('CLAUDE_MD_MARKER');
    expect(crit.mock.calls[0][0].directiveBody).toBe('DIRECTIVE_BODY_MARKER');
    expect(crit.mock.calls[0][0].pages).toEqual([
      { slug: 'overview.md', path: '/p/x', content: '# x' },
    ]);
  });

  // --- helpers ---

  async function runWithExhaustionAnswer(answer: string, emit?: ReturnType<typeof vi.fn>) {
    const arch = vi.fn().mockResolvedValue({
      projectPath: '/p',
      pages: [{ slug: 'overview.md', path: '/p/x', content: '# x' }],
      rawResponse: '',
    });
    const crit = vi.fn().mockResolvedValue(failing('major'));
    const askUser = vi.fn().mockResolvedValue(answer);
    return runArchitectWithCritique({
      runArchitect: arch,
      runWikiCritic: crit,
      askUser,
      readClaudeMd: vi.fn().mockResolvedValue('# md'),
      registry: {} as any,
      projectPath: '/p',
      directiveBody: 'x',
      maxAttempts: 3,
      ...(emit !== undefined ? { directiveId: '01EX', emit } : {}),
    });
  }

  function passing(): WikiCritique {
    return { passes: true, severity: 'pass', findings: [], summary: 'ok' };
  }

  function failing(severity: 'minor' | 'major' | 'blocking'): WikiCritique {
    return {
      passes: false,
      severity,
      findings: [{ aspect: 'modules', gap: 'g', suggestion: 's' }],
      summary: `wiki not ready (${severity})`,
    };
  }
});
