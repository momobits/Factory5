import { describe, expect, it } from 'vitest';

import { AGENT_ROLES } from './constants.js';

describe('AGENT_ROLES — agent registry', () => {
  it('contains critic', () => {
    expect(AGENT_ROLES).toContain('critic');
  });
  it('contains coherence-reviewer (Tier 15.13)', () => {
    expect(AGENT_ROLES).toContain('coherence-reviewer');
  });
  it('has the expected count', () => {
    expect(AGENT_ROLES.length).toBe(11);
  });
});
