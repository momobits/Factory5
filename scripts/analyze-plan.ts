/**
 * Phase 5b analysis helper. Reads plan.json from a project workspace and
 * prints a structural summary used to validate ADR 0016 behaviours on a
 * live run.
 *
 * Not wired into the package scripts — invoked ad-hoc with tsx.
 */

import { readFile } from 'node:fs/promises';
import { exit, stdout } from 'node:process';

interface Task {
  id: string;
  title: string;
  agent: string;
  category: string;
  expectedOutputs: { files: string[]; signals: string[] };
  dependsOn: string[];
  status: string;
  attempts: number;
  maxTurns?: number;
  result?: {
    exitCode?: number;
    filesChanged?: string[];
    error?: string;
    notes?: string[];
  };
}

interface Plan {
  id: string;
  directiveId: string;
  tasks: Task[];
  status: string;
}

function shortId(id: string): string {
  return id.slice(-8).toLowerCase();
}

async function main(planPath: string): Promise<void> {
  const raw = await readFile(planPath, 'utf8');
  const plan = JSON.parse(raw) as Plan;
  const tasks = plan.tasks;

  const byAgent = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const toolUsingQuickViolations: string[] = [];
  const withMaxTurns: string[] = [];
  const fileOwners = new Map<string, string[]>();
  const overlapDepsPresent: string[] = [];
  const overlapDepsMissing: string[] = [];

  for (const t of tasks) {
    byAgent.set(t.agent, (byAgent.get(t.agent) ?? 0) + 1);
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + 1);
    if (
      (t.agent === 'builder' || t.agent === 'scaffolder' || t.agent === 'fixer') &&
      (t.category === 'quick' || t.category === 'documentation')
    ) {
      toolUsingQuickViolations.push(`${t.agent}:${shortId(t.id)} -> ${t.category}`);
    }
    if (t.maxTurns !== undefined) {
      withMaxTurns.push(`${t.title} (${t.agent}) maxTurns=${String(t.maxTurns)}`);
    }
    for (const f of t.expectedOutputs.files) {
      const norm = f.replace(/\\/g, '/').replace(/^\.\//, '');
      const list = fileOwners.get(norm) ?? [];
      list.push(t.id);
      fileOwners.set(norm, list);
    }
  }

  const idToTask = new Map(tasks.map((t) => [t.id, t]));
  const depsTransitive = (from: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...(idToTask.get(from)?.dependsOn ?? [])];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (out.has(id)) continue;
      out.add(id);
      const t = idToTask.get(id);
      if (t !== undefined) stack.push(...t.dependsOn);
    }
    return out;
  };

  for (const [file, owners] of fileOwners) {
    if (owners.length < 2) continue;
    for (let j = 1; j < owners.length; j++) {
      const later = owners[j] as string;
      const earlier = owners[j - 1] as string;
      const reach = depsTransitive(later);
      if (reach.has(earlier)) {
        overlapDepsPresent.push(
          `${file}: ${shortId(later)} -> ${shortId(earlier)} (reachable)`,
        );
      } else {
        overlapDepsMissing.push(
          `${file}: ${shortId(later)} has no path to ${shortId(earlier)} !!`,
        );
      }
    }
  }

  // Task outcome distribution (when run).
  const byStatus = new Map<string, number>();
  for (const t of tasks) {
    byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
  }

  stdout.write(`=== Plan ${shortId(plan.id)} (directive ${shortId(plan.directiveId)}) ===\n`);
  stdout.write(`status: ${plan.status}    tasks: ${String(tasks.length)}\n`);
  stdout.write(`\n-- Agent distribution --\n`);
  for (const [a, n] of [...byAgent.entries()].sort()) {
    stdout.write(`  ${a.padEnd(14)} ${String(n)}\n`);
  }
  stdout.write(`\n-- Category distribution --\n`);
  for (const [c, n] of [...byCategory.entries()].sort()) {
    stdout.write(`  ${c.padEnd(14)} ${String(n)}\n`);
  }
  stdout.write(`\n-- Status distribution --\n`);
  for (const [s, n] of [...byStatus.entries()].sort()) {
    stdout.write(`  ${s.padEnd(14)} ${String(n)}\n`);
  }

  stdout.write(`\n-- ADR 0016 check: builder/scaffolder/fixer on quick|documentation --\n`);
  if (toolUsingQuickViolations.length === 0) {
    stdout.write('  ✅ 0 violations (category floor enforced)\n');
  } else {
    stdout.write(`  ❌ ${String(toolUsingQuickViolations.length)} violations:\n`);
    for (const v of toolUsingQuickViolations) stdout.write(`    ${v}\n`);
  }

  stdout.write(`\n-- ADR 0016 check: file-ownership dependency edges --\n`);
  const sharedFiles = [...fileOwners.entries()].filter(([, v]) => v.length >= 2);
  stdout.write(`  ${String(sharedFiles.length)} file(s) claimed by multiple tasks\n`);
  for (const [f, owners] of sharedFiles) {
    stdout.write(`    "${f}" -> ${owners.map(shortId).join(', ')}\n`);
  }
  if (overlapDepsMissing.length === 0) {
    stdout.write('  ✅ 0 missing edges — every later writer reaches the first\n');
  } else {
    stdout.write(`  ❌ ${String(overlapDepsMissing.length)} missing edge(s):\n`);
    for (const m of overlapDepsMissing) stdout.write(`    ${m}\n`);
  }

  stdout.write(`\n-- ADR 0016 check: maxTurns usage --\n`);
  stdout.write(`  ${String(withMaxTurns.length)} / ${String(tasks.length)} tasks carry maxTurns\n`);
  for (const l of withMaxTurns) stdout.write(`    ${l}\n`);

  // Failures with error detail.
  const failed = tasks.filter((t) => (t.result?.exitCode ?? 0) !== 0);
  if (failed.length > 0) {
    stdout.write(`\n-- Failed tasks (${String(failed.length)}) --\n`);
    for (const t of failed) {
      const err = t.result?.error ?? '(no error)';
      stdout.write(`  ${shortId(t.id)} ${t.agent.padEnd(12)} ${t.title}\n`);
      stdout.write(`    exit=${String(t.result?.exitCode ?? '?')} error: ${err.slice(0, 160)}\n`);
    }
  }

  stdout.write('\n');
}

const planArg = process.argv[2];
if (planArg === undefined) {
  stdout.write('usage: tsx scripts/analyze-plan.ts <path-to-plan.json>\n');
  exit(2);
}
main(planArg).catch((err: unknown) => {
  stdout.write(`analyze-plan failed: ${String(err)}\n`);
  exit(1);
});
