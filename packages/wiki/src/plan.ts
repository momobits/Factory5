/**
 * Plan persistence — `<project>/.factory/plan.json` is the machine-readable
 * DAG; `plan.md` is the human-readable rendering.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { planSchema, type Plan, type Task } from '@factory5/core';

import { projectPaths } from './paths.js';

function renderPlanMarkdown(plan: Plan): string {
  const lines: string[] = [
    `# Plan ${plan.id}`,
    '',
    `- **Directive:** ${plan.directiveId}`,
    `- **Project:** ${plan.projectPath}`,
    `- **Created:** ${plan.createdAt}`,
    `- **Status:** ${plan.status}`,
    '',
    '## Tasks',
    '',
  ];
  if (plan.tasks.length === 0) {
    lines.push('_No tasks yet._');
  } else {
    lines.push('| # | ID | Title | Agent | Category | Status | Depends on |');
    lines.push('|---|----|-------|-------|----------|--------|-----------|');
    plan.tasks.forEach((t: Task, i: number) => {
      const deps = t.dependsOn.length === 0 ? '—' : t.dependsOn.join(', ');
      lines.push(
        `| ${String(i + 1)} | ${t.id} | ${t.title.replace(/\|/g, '\\|')} | ${t.agent} | ${t.category} | ${t.status} | ${deps} |`,
      );
    });
  }
  lines.push('');
  return lines.join('\n');
}

/** Write both `plan.json` and `plan.md`. Creates `.factory/` as needed. */
export async function writePlan(plan: Plan): Promise<void> {
  const validated = planSchema.parse(plan);
  const { planJson, plan: planMd } = projectPaths(validated.projectPath);
  await mkdir(dirname(planJson), { recursive: true });
  await writeFile(planJson, JSON.stringify(validated, null, 2), 'utf8');
  await writeFile(planMd, renderPlanMarkdown(validated), 'utf8');
}

/** Load a plan from `plan.json`, or return `undefined` if no plan exists. */
export async function readPlan(projectPath: string): Promise<Plan | undefined> {
  const { planJson } = projectPaths(projectPath);
  try {
    const raw = await readFile(planJson, 'utf8');
    return planSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}
