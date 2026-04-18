import { describe, expect, it } from 'vitest';

import { allAgents, getAgent } from './registry.js';

describe('agent registry', () => {
  it('has every role', () => {
    const roles = allAgents().map((a) => a.role);
    expect(roles).toContain('triage');
    expect(roles).toContain('architect');
    expect(roles).toContain('planner');
    expect(roles).toContain('builder');
    expect(roles).toContain('reviewer');
    expect(roles).toContain('fixer');
    expect(roles).toContain('investigator');
    expect(roles).toContain('verifier');
    expect(roles).toContain('scaffolder');
  });

  it('every agent declares a category', () => {
    for (const a of allAgents()) {
      expect(a.category).toBeTruthy();
    }
  });

  it('getAgent throws on unknown role', () => {
    // @ts-expect-error testing runtime guard
    expect(() => getAgent('not-real')).toThrow();
  });
});
