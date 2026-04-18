/**
 * Load agent + skill prompt files from the repo's `prompts/` and `skills/`
 * directories. Resolution strategy: walk up from the package's own source
 * location until we find `prompts/agents/<role>.md` — this keeps brain code
 * decoupled from an absolute path and works both in dev (tsx) and in
 * compiled `dist/` output.
 */

import { readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentRole } from '@factory5/core';
import { createLogger } from '@factory5/logger';

import { getAgent } from './agents/registry.js';

const log = createLogger('brain.prompts');

let cachedRepoRoot: string | undefined;

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from this file until we find a directory containing both
 * `prompts/agents/` and `skills/`. Used as the anchor for all prompt loads.
 *
 * Can be overridden via `FACTORY5_PROMPTS_ROOT` env var (useful for tests).
 */
async function findRepoRoot(): Promise<string> {
  if (cachedRepoRoot !== undefined) return cachedRepoRoot;

  const envOverride = process.env['FACTORY5_PROMPTS_ROOT'];
  if (envOverride !== undefined && envOverride.length > 0) {
    cachedRepoRoot = envOverride;
    return envOverride;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  let dir = resolve(here);
  while (true) {
    if (
      (await fileExists(join(dir, 'prompts', 'agents'))) &&
      (await fileExists(join(dir, 'skills')))
    ) {
      cachedRepoRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `brain.prompts: could not locate prompts/ + skills/ walking up from ${here}. Set FACTORY5_PROMPTS_ROOT.`,
      );
    }
    dir = parent;
  }
}

/** Read a skill file (`skills/<id>.md`) and return its body. */
export async function loadSkill(id: string): Promise<string> {
  if (/[\\/]/.test(id) || id.includes('..')) {
    throw new Error(`loadSkill: unsafe id ${JSON.stringify(id)}`);
  }
  const root = await findRepoRoot();
  const path = join(root, 'skills', `${id}.md`);
  return readFile(path, 'utf8');
}

/** Read the agent prompt file registered for `role`. */
export async function loadAgentPrompt(role: AgentRole): Promise<string> {
  const agent = getAgent(role);
  const root = await findRepoRoot();
  const path = join(root, 'prompts', 'agents', agent.promptPath);
  return readFile(path, 'utf8');
}

/**
 * Build the complete system prompt for an agent: the agent prompt itself
 * followed by each default skill appended under a `## Skill: <id>` header.
 */
export async function buildAgentSystemPrompt(role: AgentRole): Promise<string> {
  const agent = getAgent(role);
  const [agentBody, ...skillBodies] = await Promise.all([
    loadAgentPrompt(role),
    ...agent.defaultSkills.map((s) => loadSkill(s)),
  ]);
  const parts: string[] = [agentBody];
  agent.defaultSkills.forEach((id, i) => {
    const body = skillBodies[i];
    if (body === undefined) return;
    parts.push(`\n\n---\n\n## Skill: ${id}\n\n${body}`);
  });
  const prompt = parts.join('');
  log.debug(
    { role, skills: agent.defaultSkills.length, bytes: prompt.length },
    'system prompt composed',
  );
  return prompt;
}
