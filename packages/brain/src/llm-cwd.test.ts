/**
 * Unit tests for {@link resolveLlmCwd} — the defensive fallback that keeps
 * claude-cli from inheriting factoryd's own repo cwd.
 *
 * Background: the pythonetl resume incident (directive
 * 01KSD0VNPZ0KD8DHKP82XS2C48, 2026-05-24) showed that when a brain agent
 * spawns claude-cli without an explicit `cwd`, the subprocess inherits
 * `process.cwd()` from factoryd — which is the factory5 repo itself —
 * and the model reads factory5's `CLAUDE.md` / `.control/STATE.md`
 * instead of the target project's spec. This helper makes the fallback
 * explicit so no agent ever forgets to set `cwd`.
 */

import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { resolveLlmCwd } from './llm-cwd.js';

describe('resolveLlmCwd', () => {
  it('returns the projectPath when defined and non-empty', () => {
    expect(resolveLlmCwd('/work/myproj')).toBe('/work/myproj');
  });

  it('returns os.tmpdir() when projectPath is undefined', () => {
    expect(resolveLlmCwd(undefined)).toBe(tmpdir());
  });

  it('returns os.tmpdir() when projectPath is an empty string', () => {
    expect(resolveLlmCwd('')).toBe(tmpdir());
  });

  it('never returns undefined (return type is `string`, runtime invariant)', () => {
    expect(resolveLlmCwd(undefined)).not.toBeUndefined();
    expect(resolveLlmCwd('')).not.toBeUndefined();
    expect(resolveLlmCwd('/x')).not.toBeUndefined();
  });
});
