import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_CATEGORIES, agentsConfigSchema, resolveAgentCategory } from './config.js';

// ---------------------------------------------------------------------------
// Agent category override layer (ADR 0004 amendment, Phase 14 / ADR 0036).
// The `[agents]` table now lives in config.toml (@factory5/brain); this module
// keeps only the pure resolver, so these are the tests that remain here.
// ---------------------------------------------------------------------------

describe('agentsConfigSchema', () => {
  it('accepts an empty object', () => {
    expect(() => agentsConfigSchema.parse({})).not.toThrow();
  });

  it('accepts a single role override', () => {
    const result = agentsConfigSchema.parse({ architect: 'planning' });
    expect(result).toEqual({ architect: 'planning' });
  });

  it('accepts both role overrides', () => {
    const result = agentsConfigSchema.parse({ architect: 'deep', critic: 'reasoning' });
    expect(result).toEqual({ architect: 'deep', critic: 'reasoning' });
  });

  it('rejects an unknown agent role', () => {
    expect(() => agentsConfigSchema.parse({ triage: 'quick' })).toThrow();
  });

  it('rejects an unknown category', () => {
    expect(() => agentsConfigSchema.parse({ architect: 'cheap' })).toThrow();
  });
});

describe('DEFAULT_AGENT_CATEGORIES', () => {
  it('architect defaults to planning', () => {
    expect(DEFAULT_AGENT_CATEGORIES.architect).toBe('planning');
  });

  it('critic defaults to reasoning', () => {
    expect(DEFAULT_AGENT_CATEGORIES.critic).toBe('reasoning');
  });
});

describe('resolveAgentCategory', () => {
  it('returns the override when present', () => {
    expect(resolveAgentCategory({ agents: { architect: 'deep' } }, 'architect')).toBe('deep');
  });

  it('returns the default when no override', () => {
    expect(resolveAgentCategory({}, 'architect')).toBe('planning');
    expect(resolveAgentCategory({}, 'critic')).toBe('reasoning');
  });

  it('falls back to the default when a different role is overridden', () => {
    expect(resolveAgentCategory({ agents: { critic: 'deep' } }, 'architect')).toBe('planning');
  });
});
