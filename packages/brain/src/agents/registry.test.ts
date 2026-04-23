import { describe, expect, it } from 'vitest';

import { allAgents, ASK_USER_MCP_TOOL, getAgent } from './registry.js';

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

  describe('ADR 0024 §5 — ask_user tool exposure', () => {
    it('exposes ASK_USER_MCP_TOOL to scaffolder/builder/fixer/investigator', () => {
      const enabled: ReadonlyArray<
        typeof allAgents extends () => readonly { role: infer R }[] ? R : never
      > = ['scaffolder', 'builder', 'fixer', 'investigator'];
      for (const role of enabled) {
        const agent = getAgent(role);
        expect(agent.tools, `${role} should have ${ASK_USER_MCP_TOOL}`).toContain(
          ASK_USER_MCP_TOOL,
        );
      }
    });

    it('does NOT expose ASK_USER_MCP_TOOL to brain-checkpointed agents', () => {
      // architect/planner/reviewer/verifier already use brain-level
      // escalateBlocked between phases — adding ask_user here would create
      // two paths to the same outcome. triage has no tools by design.
      for (const role of ['triage', 'architect', 'planner', 'reviewer', 'verifier'] as const) {
        const agent = getAgent(role);
        expect(agent.tools, `${role} should NOT have ${ASK_USER_MCP_TOOL}`).not.toContain(
          ASK_USER_MCP_TOOL,
        );
      }
    });

    it("includes 'ask-user' in defaultSkills for the four enabled agents", () => {
      for (const role of ['scaffolder', 'builder', 'fixer', 'investigator'] as const) {
        const agent = getAgent(role);
        expect(agent.defaultSkills, `${role} should load the ask-user skill`).toContain('ask-user');
      }
    });

    it("does NOT include 'ask-user' in defaultSkills for brain-checkpointed agents", () => {
      for (const role of ['triage', 'architect', 'planner', 'reviewer', 'verifier'] as const) {
        const agent = getAgent(role);
        expect(agent.defaultSkills).not.toContain('ask-user');
      }
    });

    it('exports the canonical MCP tool name claude-cli expects', () => {
      expect(ASK_USER_MCP_TOOL).toBe('mcp__factory5-ask-user__ask_user');
    });
  });
});
