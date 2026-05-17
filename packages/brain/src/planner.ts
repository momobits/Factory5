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
  MODEL_CATEGORY_RANKS,
  newId,
  planSchema,
  type AgentRole,
  type DirectiveLimits,
  type ModelCategory,
  type Plan,
  type Task,
} from '@factory5/core';
import { createLogger } from '@factory5/logger';
import type { ProviderRegistry } from '@factory5/providers';
import type { Database } from '@factory5/state';
import { projectPaths, readWiki, writePlan } from '@factory5/wiki';
import { z } from 'zod';

import type { DirectiveEventEmitter } from '@factory5/ipc';

import { getAgent } from './agents/registry.js';
import { assertBudget } from './budget.js';
import { emitLogLine } from './emit.js';
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
  /**
   * Optional per-task tool-use turn budget. Only honored for tool-using
   * agents (scaffolder / builder / fixer). Passed through to the provider.
   */
  maxTurns: z.number().int().positive().optional(),
});

const plannerJsonSchema = z.object({
  tasks: z.array(plannerTaskSchema).min(1),
});

/** Return whichever category ranks at-or-above the other. Floor wins ties. */
function maxCategory(a: ModelCategory, floor: ModelCategory): ModelCategory {
  return MODEL_CATEGORY_RANKS[a] >= MODEL_CATEGORY_RANKS[floor] ? a : floor;
}

/** Normalize a file path for overlap detection: drop leading "./", collapse backslashes. */
function normalizeFilePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/**
 * Rewrite a planner-raw task list so that any two tasks writing to the same
 * file are serialised, and so each task's `category` meets the agent-registry
 * floor.
 *
 * Returns the materialized {@link Task[]} plus a list of notes describing
 * every adjustment made (for logging + the session record).
 *
 * Category floor (ADR 0016):
 *   Every task is clamped to `max(plannerChoice, AGENTS[role].category)`.
 *   A `builder` task the LLM labelled `quick` becomes `deep`. The planner
 *   can still upgrade — a `reviewer` the LLM labelled `deep` stays `deep`.
 *
 * File ownership (ADR 0016):
 *   If two tasks both declare the same `expectedOutputs.files[]` entry and
 *   neither transitively depends on the other, the later-indexed task gets
 *   a synthetic dependency on the earlier one. Prevents two concurrent
 *   builders writing the same file inside parallel worktrees (which would
 *   produce merge conflicts at cleanup time).
 */
export function materialisePlannerTasks(
  raw: z.infer<typeof plannerTaskSchema>[],
  planId: string,
): { tasks: Task[]; notes: string[] } {
  const notes: string[] = [];
  const taskIds = raw.map(() => newId());

  // First pass: resolve dependsOn indexes to ULIDs and clamp category.
  const partial: Task[] = raw.map((t, i) => {
    const agentDef = getAgent(t.agent as AgentRole);
    const floor = agentDef.category;
    const clamped = maxCategory(t.category as ModelCategory, floor);
    if (clamped !== t.category) {
      notes.push(
        `task[${String(i)}] "${t.title}" (agent=${t.agent}): category ${t.category} -> ${clamped} (floor enforced)`,
      );
    }
    const dependsOn = t.dependsOn
      .filter((d) => d !== i && d >= 0 && d < taskIds.length)
      .map((d) => taskIds[d] as string);
    const task: Task = {
      id: taskIds[i] as string,
      planId,
      title: t.title,
      agent: t.agent as AgentRole,
      category: clamped,
      inputs: t.inputs,
      expectedOutputs: t.expectedOutputs,
      dependsOn,
      status: 'pending',
      attempts: 0,
    };
    if (t.maxTurns !== undefined) task.maxTurns = t.maxTurns;
    return task;
  });

  // Second pass: detect file-ownership conflicts. Two tasks writing the same
  // file must be serialised. We add a synthetic dependency from the later
  // task (higher index) to the earlier — the common case is that the later
  // task in the planner's ordering is the refinement.
  const indexById = new Map<string, number>();
  partial.forEach((t, i) => indexById.set(t.id, i));

  const reachable = (fromIdx: number, toIdx: number): boolean => {
    if (fromIdx === toIdx) return true;
    const stack = [partial[fromIdx]?.id].filter((v): v is string => v !== undefined);
    const seen = new Set<string>(stack);
    while (stack.length > 0) {
      const id = stack.pop() as string;
      const t = partial[indexById.get(id) ?? -1];
      if (t === undefined) continue;
      for (const dep of t.dependsOn) {
        if (seen.has(dep)) continue;
        const di = indexById.get(dep);
        if (di === toIdx) return true;
        seen.add(dep);
        stack.push(dep);
      }
    }
    return false;
  };

  const finalTasks: Task[] = partial.map((t) => ({ ...t, dependsOn: [...t.dependsOn] }));

  // For each file, track which task index first claims it. When a second
  // task claims the same file, either it (or one of its transitive deps)
  // must already reach the first task; if not, we add an edge.
  const firstWriter = new Map<string, number>();
  for (let i = 0; i < finalTasks.length; i++) {
    const t = finalTasks[i] as Task;
    for (const rawFile of t.expectedOutputs.files) {
      const file = normalizeFilePath(rawFile);
      if (file.length === 0) continue;
      const prev = firstWriter.get(file);
      if (prev === undefined) {
        firstWriter.set(file, i);
        continue;
      }
      if (reachable(i, prev)) continue;
      // Insert synthetic edge i -> prev (i depends on prev).
      const prevTask = finalTasks[prev] as Task;
      if (!t.dependsOn.includes(prevTask.id)) {
        t.dependsOn.push(prevTask.id);
        notes.push(
          `task[${String(i)}] "${t.title}" -> task[${String(prev)}] "${prevTask.title}": synthetic dependency for shared file "${file}"`,
        );
      }
    }
  }

  return { tasks: finalTasks, notes };
}

export interface PlannerResult {
  plan: Plan;
  rawResponse: string;
  /** Planner-clamp + synthetic-dependency notes, one per adjustment. Empty when the raw plan passed through untouched. */
  adjustments: string[];
}

export interface PlannerOptions {
  registry: ProviderRegistry;
  projectPath: string;
  directiveId: string;
  db?: Database;
  category?: ModelCategory;
  /** Per-directive budget ceilings (ADR 0020). See {@link TriageOptions.limits}. */
  limits?: DirectiveLimits;
  /**
   * Optional SSE emitter (ADR 0029 / ADR 0031). When wired, the planner
   * surfaces `log.line` events at stage entry, JSON-parse-fail and
   * Zod-fail (carrying first 500 chars of LLM output as `attrs.detail`),
   * and plan-written.
   */
  emit?: DirectiveEventEmitter;
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
    'Each task has:',
    '  - `title` — short human-readable name',
    '  - `agent` — one of: scaffolder, builder, reviewer, fixer, investigator, verifier',
    '  - `category` — model tier: quick / planning / reasoning / deep / documentation',
    '       DEFAULTS per agent (use these unless the work plainly warrants a stronger tier):',
    '         scaffolder=planning, builder=deep, reviewer=reasoning,',
    '         fixer=reasoning, investigator=reasoning, verifier=planning',
    '       NEVER pick `quick` or `documentation` for builder/scaffolder/fixer. Factory',
    '       enforces a category floor and will upgrade you, but picking correctly up-front',
    '       lets your plan reflect the real execution tier.',
    '  - `inputs.files` — relative paths the task reads',
    '  - `inputs.context` — 1-2 sentence description',
    '  - `expectedOutputs.files` — relative paths the task writes (BE COMPLETE — see rule below)',
    '  - `expectedOutputs.signals` — tokens like "pytest-green" / "build-ok" / "lint-clean"',
    '  - `dependsOn` — 0-based INDEXES into this tasks array for prerequisites',
    '  - `maxTurns` (optional) — integer 10-160. Only for builder/scaffolder/fixer.',
    '       Use >40 when the task is a large multi-module implementation or a broad fixer',
    '       pass over many files. Use <=20 for narrow single-file changes.',
    '  - `estimatedUsd` (optional) — your best-guess model spend in USD for this task.',
    '       Emit when the directive carries a `maxUsdPerTask` cap so the brain can',
    '       escalate via askUser BEFORE launching an expensive task. Reasonable',
    '       baselines: scaffolder $0.30-1.50, builder $0.20-1.00, fixer $0.10-0.50.',
    '',
    'DEPENDENCY RULES (two rules of equal weight — both about real data flow):',
    '  1. FILE OWNERSHIP — If two tasks write to ANY of the same `expectedOutputs.files[]`,',
    '     the later task MUST list the earlier task in its `dependsOn`. Do NOT run two',
    '     builders on the same file in parallel — they allocate isolated worktrees and the',
    '     merges will collide. For progressive refinement, chain: task A writes foo.ts,',
    '     task B (dependsOn: [indexOfA]) refines foo.ts.',
    '  2. NO FALSE DEPENDENCIES — Chain only on declared data flow. A task B that does NOT',
    "     read A's output files and does NOT write any file A writes MUST NOT have A in its",
    '     `dependsOn`. "Safer to sequence when uncertain" is WRONG — the file-ownership',
    '     rule covers the real hazards; extra edges just serialise work the pool could run',
    '     in parallel. The pool is fast when you let it be.',
    '',
    'GOOD (parallel siblings — the default for independent modules):',
    '  scaffolder (task 0) → both builders `models` (task 1) and `ui` (task 2) have',
    '  `dependsOn: [0]` only, no edge between them. Then `cli` (task 3) reads BOTH',
    '  models.py and ui.py so `dependsOn: [0, 1, 2]`.',
    '',
    'BAD (false serial chain):',
    '  scaffolder → models → ui → cli where `ui` does NOT read models.py. Adding an edge',
    '  ui→models just because it "feels safer" costs real wall-clock. DO NOT DO THIS.',
    '',
    'SCOPE:',
    '  Prefer fewer, larger tasks over many tiny ones. A good `builder` task covers one',
    '  cohesive module (related files, one responsibility). Avoid splitting a single',
    '  module across multiple builders — that guarantees file-ownership conflicts.',
    '',
    'Respond with a SINGLE JSON object in this exact shape (no prose outside the object):',
    '',
    '{',
    '  "tasks": [',
    '    { "title": "...", "agent": "scaffolder", "category": "planning",',
    '      "inputs": {"files": [], "context": "..."},',
    '      "expectedOutputs": {"files": ["..."], "signals": []},',
    '      "dependsOn": [] },',
    '    { "title": "...", "agent": "builder", "category": "deep",',
    '      "inputs": {"files": [], "context": "..."},',
    '      "expectedOutputs": {"files": ["..."], "signals": ["pytest-green"]},',
    '      "dependsOn": [0], "maxTurns": 60 }',
    '  ]',
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
  emitLogLine(
    opts.emit,
    opts.directiveId,
    'info',
    'brain.planner',
    `planner: calling ${resolution.model}`,
    { provider: resolution.provider.id },
  );

  if (opts.db !== undefined) {
    assertBudget({
      db: opts.db,
      directiveId: opts.directiveId,
      ...(opts.limits?.maxUsd !== undefined ? { maxUsd: opts.limits.maxUsd } : {}),
      ...(opts.limits?.maxSteps !== undefined ? { maxSteps: opts.limits.maxSteps } : {}),
      category,
      mode: 'call',
      agent: 'planner',
    });
  }

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
      mode: 'call',
    });
  }

  const jsonText = extractJsonObject(response.text);
  if (jsonText === undefined) {
    const detail = response.text.slice(0, 500);
    emitLogLine(
      opts.emit,
      opts.directiveId,
      'error',
      'brain.planner',
      'planner: no JSON in response',
      { detail },
    );
    throw new Error(`planner: response contained no JSON object. First 500 chars: ${detail}`);
  }
  let parsed;
  try {
    parsed = plannerJsonSchema.parse(JSON.parse(jsonText));
  } catch (err) {
    const detail = response.text.slice(0, 500);
    const zodIssues =
      err instanceof z.ZodError ? err.issues.slice(0, 3) : [{ message: String(err) }];
    emitLogLine(
      opts.emit,
      opts.directiveId,
      'error',
      'brain.planner',
      'planner: schema parse failed',
      { detail, zodIssues },
    );
    throw err;
  }

  const planId = newId();
  const { tasks, notes } = materialisePlannerTasks(parsed.tasks, planId);

  const plan: Plan = planSchema.parse({
    id: planId,
    directiveId: opts.directiveId,
    projectPath: opts.projectPath,
    tasks,
    createdAt: new Date().toISOString(),
    status: 'draft',
  });

  await writePlan(plan);
  if (notes.length > 0) {
    log.warn(
      { planId, projectPath: opts.projectPath, adjustments: notes.length, notes },
      'planner: applied post-LLM adjustments',
    );
  }
  log.info(
    { planId, taskCount: tasks.length, projectPath: opts.projectPath, adjustments: notes.length },
    'planner: plan written',
  );
  emitLogLine(
    opts.emit,
    opts.directiveId,
    'info',
    'brain.planner',
    `planner: ${String(tasks.length)} task${tasks.length === 1 ? '' : 's'} queued`,
    { planId, adjustments: notes.length },
  );

  return { plan, rawResponse: response.text, adjustments: notes };
}
