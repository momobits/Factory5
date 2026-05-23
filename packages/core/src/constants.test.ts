import { describe, expect, it } from 'vitest';

import { AGENT_ROLES } from './constants.js';

describe('AGENT_ROLES — adds critic', () => {
  it('includes critic at length 10', () => {
    expect(AGENT_ROLES).toContain('critic');
    expect(AGENT_ROLES.length).toBe(10);
  });
});
