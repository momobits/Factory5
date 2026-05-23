/**
 * Agent registry — declarative definitions of every agent role.
 *
 * Each agent has a category (model resolution), a tool whitelist, a default
 * skill set, and a prompt path (relative to the `prompts/` directory).
 *
 * See `docs/AGENTS.md` for the catalog.
 */

import type { AgentRole, ModelCategory } from '@factory5/core';

/**
 * The MCP-exposed `ask_user` tool name as claude-cli surfaces it to agents
 * (`mcp__<server>__<tool>`). Mirrors `ASK_USER_TOOL_NAME` in
 * `@factory5/worker-mcp` — kept here as a literal to avoid a runtime dep
 * from `@factory5/brain` on the worker-mcp package. ADR 0024 §5.
 */
export const ASK_USER_MCP_TOOL = 'mcp__factory5-ask-user__ask_user';

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
  // Pool-path category for task-spawning architects (NOT runArchitect's direct
  // call, which defaults to 'planning' per ADR 0033 §6 via resolveAgentCategory).
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
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', ASK_USER_MCP_TOOL],
    defaultSkills: ['scaffolding', 'dependency-install', 'ask-user'],
    promptPath: 'scaffolder.md',
  },
  builder: {
    role: 'builder',
    category: 'deep',
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', ASK_USER_MCP_TOOL],
    defaultSkills: ['tdd', 'progress-tracking', 'work-verification', 'ask-user'],
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
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', ASK_USER_MCP_TOOL],
    defaultSkills: ['error-recovery', 'tdd', 'ask-user'],
    promptPath: 'fixer.md',
  },
  investigator: {
    role: 'investigator',
    category: 'reasoning',
    tools: ['Read', 'Bash', 'Glob', 'Grep', ASK_USER_MCP_TOOL],
    defaultSkills: ['error-recovery', 'ask-user'],
    promptPath: 'investigator.md',
  },
  verifier: {
    role: 'verifier',
    category: 'planning',
    tools: ['Read', 'Bash', 'Glob', 'Grep'],
    defaultSkills: ['work-verification', 'integration-testing', 'documentation'],
    promptPath: 'verifier.md',
  },
  // New in Tier 14 (ADR 0033). promptPath `critic.md` is created in step 14.5.
  critic: {
    role: 'critic',
    category: 'reasoning',
    tools: ['Read', 'Glob', 'Grep'],
    defaultSkills: ['documentation'],
    promptPath: 'critic.md',
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
