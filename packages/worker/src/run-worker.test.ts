import { describe, expect, it } from 'vitest';

import { isToolUsingAgent } from './run-worker.js';

describe('isToolUsingAgent', () => {
  it('returns true for scaffolder, builder, fixer', () => {
    expect(isToolUsingAgent('scaffolder')).toBe(true);
    expect(isToolUsingAgent('builder')).toBe(true);
    expect(isToolUsingAgent('fixer')).toBe(true);
  });

  it('returns false for read-only agents', () => {
    expect(isToolUsingAgent('triage')).toBe(false);
    expect(isToolUsingAgent('architect')).toBe(false);
    expect(isToolUsingAgent('planner')).toBe(false);
    expect(isToolUsingAgent('reviewer')).toBe(false);
    expect(isToolUsingAgent('investigator')).toBe(false);
    expect(isToolUsingAgent('verifier')).toBe(false);
  });
});
