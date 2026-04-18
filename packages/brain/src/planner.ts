/**
 * Planner agent — decompose the wiki + spec into a Task DAG. Runs on the
 * `planning` tier. Writes `.factory/plan.json` + `plan.md` via `@factory5/wiki`.
 *
 * Output contract: the planner returns a list of task descriptors. We stamp
 * ULIDs locally so the agent can reference tasks by index if it wants to
 * encode dependencies, but dependencies in the final plan are always by ULID.
 */

import { readFile } from 'node:fs/promises';

import {
  AGENT_ROLES,
  MODEL_CATEGORIES,
  newId,
  planSchema,
  type AgentRole,
  type ModelCategory,
  type Plan,
  type Task,
} from '@factory5/core';
import { createLogger } from '@factory5/logger';
import type { ProviderRegistry } from '@factory5/providers';
import type { Database } from '@factory5/state';
import { projectPaths, readWiki, writePlan } from '@factory5/wiki';
import { z } from 'zod';

import { buildAgentSystemPrompt } from './prompts.js';
import { extractJsonObject } from './triage.js';
import { recordUsage } from './usage.js';

const log = createLogger('brain.planner');

const plannerTaskSchema = z.object({
  title: z.string().min(1),
  agent: z.enum(AGENT_ROLES),
  category: z.enum(MODEL_CATEGORIES),
  inputs: z
    .object({
      files: z.array(z.string()).default([]),
      context: z.string().default(''),
    })
    .default({ files: [], context: '' }),
  expectedOutputs: z
    .object({
      files: z.array(z.string()).default([]),
      signals: z.array(z.string()).default([]),
    })
    .default({ files: [], signals: [] }),
  /** Indexes into the `tasks` array (0-based). Resolved to ULIDs when we materialize. */
  dependsOn: z.array(z.number().int().nonnegative()).default([]),
});

const plannerJsonSchema = z.object({
  tasks: z.array(plannerTaskSchema).min(1),
});

export interface PlannerResult {
  plan: Plan;
  rawResponse: string;
}

export interface PlannerOptions {
  registry: ProviderRegistry;
  projectPath: string;
  directiveId: string;
  db?: Database;
  category?: ModelCategory;
}

export async function runPlanner(opts: PlannerOptions): Promise<PlannerResult> {
  const category = opts.category ?? 'planning';
  const resolution = await opts.registry.resolve(category);
  const systemPrompt = await buildAgentSystemPrompt('planner');

  const { claudeMd } = projectPaths(opts.projectPath);
  const spec = await readFile(claudeMd, 'utf8').catch(() => '(no CLAUDE.md found)');
  const pages = await readWiki(opts.projectPath);
  const wikiDigest = pages
    .map((p) => `--- ${p.slug} ---\n${p.content.slice(0, 3000)}`)
    .join('\n\n');

  const userPrompt = [
    'Produce a Task DAG for building this project.',
    '',
    'Each task has: a title, an `agent` role (one of: scaffolder, builder, reviewer, fixer,',
    'investigator, verifier), a `category` (quick / planning / reasoning / deep / documentation),',
    '`inputs.files` the task should read, `inputs.context` a short description, `expectedOutputs.files`',
    'files the task will write, `expectedOutputs.signals` tokens like "pytest-green" / "build-ok",',
    'and `dependsOn`: an array of INDEXES into the tasks array (0-based) for prerequisites.',
    '',
    'Respond with a SINGLE JSON object in this exact shape (no prose outside the object):',
    '',
    '{',
    '  "tasks": [ { "title": "...", "agent": "scaffolder", "category": "planning", ',
    '               "inputs": {...}, "expectedOutputs": {...}, "dependsOn": [] }, ... ]',
    '}',
    '',
    '--- CLAUDE.md ---',
    spec,
    '--- end CLAUDE.md ---',
    '',
    '--- WIKI ---',
    wikiDigest.length > 0 ? wikiDigest : '(wiki is empty)',
    '--- end WIKI ---',
  ].join('\n');

  log.info(
    { projectPath: opts.projectPath, provider: resolution.provider.id, model: resolution.model },
    'planner: calling planning provider',
  );

  const started = Date.now();
  const response = await resolution.provider.call({
    model: resolution.model,
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.1,
  });
  const durationMs = Date.now() - started;

  if (opts.db !== undefined) {
    recordUsage({
      db: opts.db,
      directiveId: opts.directiveId,
      category,
      resolution,
      response,
      durationMs,
    });
  }

  const jsonText = extractJsonObject(response.text);
  if (jsonText === undefined) {
    throw new Error(
      `planner: response contained no JSON object. First 500 chars: ${response.text.slice(0, 500)}`,
    );
  }
  const parsed = plannerJsonSchema.parse(JSON.parse(jsonText));

  const planId = newId();
  const taskIds = parsed.tasks.map(() => newId());
  const tasks: Task[] = parsed.tasks.map((t, i) => {
    const dependsOn = t.dependsOn
      .filter((d) => d !== i && d >= 0 && d < taskIds.length)
      .map((d) => taskIds[d] as string);
    return {
      id: taskIds[i] as string,
      planId,
      title: t.title,
      agent: t.agent as AgentRole,
      category: t.category as ModelCategory,
      inputs: t.inputs,
      expectedOutputs: t.expectedOutputs,
      dependsOn,
      status: 'pending',
      attempts: 0,
    };
  });

  const plan: Plan = planSchema.parse({
    id: planId,
    directiveId: opts.directiveId,
    projectPath: opts.projectPath,
    tasks,
    createdAt: new Date().toISOString(),
    status: 'draft',
  });

  await writePlan(plan);
  log.info(
    { planId, taskCount: tasks.length, projectPath: opts.projectPath },
    'planner: plan written',
  );

  return { plan, rawResponse: response.text };
}
