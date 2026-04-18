/**
 * Agent registry — declarative definitions of every agent role.
 *
 * Each agent has a category (model resolution), a tool whitelist, a default
 * skill set, and a prompt path (relative to the `prompts/` directory).
 *
 * See `docs/AGENTS.md` for the catalog.
 */

import type { AgentRole, ModelCategory } from '@factory5/core';

export interface AgentDefinition {
  role: AgentRole;
  category: ModelCategory;
  /**
   * Whitelisted tools the agent may call. Subset of all available tools.
   * Tool names are claude/codex-side conventions: Read, Write, Edit, Bash, Glob, Grep, etc.
   */
  tools: readonly string[];
  /** Default skill IDs to inject into the system prompt. */
  defaultSkills: readonly string[];
  /** Path to system prompt (relative to `prompts/agents/`). */
  promptPath: string;
}

const AGENTS: Record<AgentRole, AgentDefinition> = {
  triage: {
    role: 'triage',
    category: 'quick',
    tools: [],
    defaultSkills: [],
    promptPath: 'triage.md',
  },
  architect: {
    role: 'architect',
    category: 'reasoning',
    tools: ['Read', 'Write', 'Glob', 'Grep'],
    defaultSkills: ['architect', 'documentation', 'brainstorming'],
    promptPath: 'architect.md',
  },
  planner: {
    role: 'planner',
    category: 'planning',
    tools: ['Read', 'Glob', 'Grep'],
    defaultSkills: ['progress-tracking'],
    promptPath: 'planner.md',
  },
  scaffolder: {
    role: 'scaffolder',
    category: 'planning',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob'],
    defaultSkills: ['scaffolding', 'dependency-install'],
    promptPath: 'scaffolder.md',
  },
  builder: {
    role: 'builder',
    category: 'deep',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    defaultSkills: ['tdd', 'progress-tracking', 'work-verification'],
    promptPath: 'builder.md',
  },
  reviewer: {
    role: 'reviewer',
    category: 'reasoning',
    tools: ['Read', 'Write', 'Glob', 'Grep'],
    defaultSkills: ['code-review'],
    promptPath: 'reviewer.md',
  },
  fixer: {
    role: 'fixer',
    category: 'reasoning',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
    defaultSkills: ['error-recovery', 'tdd'],
    promptPath: 'fixer.md',
  },
  investigator: {
    role: 'investigator',
    category: 'reasoning',
    tools: ['Read', 'Bash', 'Glob', 'Grep'],
    defaultSkills: ['error-recovery'],
    promptPath: 'investigator.md',
  },
  verifier: {
    role: 'verifier',
    category: 'planning',
    tools: ['Read', 'Bash', 'Glob', 'Grep'],
    defaultSkills: ['work-verification', 'integration-testing', 'documentation'],
    promptPath: 'verifier.md',
  },
};

/** Look up an agent definition by role. Throws on unknown role. */
export function getAgent(role: AgentRole): AgentDefinition {
  const a = AGENTS[role];
  if (a === undefined) throw new Error(`unknown agent role: ${String(role)}`);
  return a;
}

/** All agent definitions. */
export function allAgents(): readonly AgentDefinition[] {
  return Object.values(AGENTS);
}
