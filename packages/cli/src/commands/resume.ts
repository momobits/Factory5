/**
 * `factory resume <project>` — re-enter the inline pipeline for a project.
 *
 * Behavior:
 *   1. Look up the most recent directive whose `payload.projectPath` or
 *      `payload.project` matches the argument (or whose `project` row
 *      matches by name).
 *   2. Create a *new* directive with `parentDirectiveId` pointing at the
 *      original and `intent: 'resume'` in the payload (but the brain still
 *      runs the `build` path — resume is about the pipeline, not intent).
 *   3. Invoke the brain inline. The brain already skips the architect when
 *      the wiki is ready and skips completed tasks in the plan.
 *
 * If no matching directive is found, offers to start a fresh build instead.
 */

import { isAbsolute, resolve } from 'node:path';
import { cwd, exit, stdout } from 'node:process';

import { runBrain } from '@factory5/brain';
import { directiveSchema, newId, type Directive, type Intent } from '@factory5/core';
import { type BudgetAxis } from '@factory5/core/budgets';
import { createLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  projects as projectsQ,
  runMigrations,
} from '@factory5/state';
import type { Command } from 'commander';

import { addBudgetFlags, collectBudgetFlags, type BudgetOptions } from './budget-flags.js';

const log = createLogger('cli.resume');

function extractProjectPath(d: Directive): string | undefined {
  if (typeof d.payload !== 'object' || d.payload === null) return undefined;
  const p = d.payload as Record<string, unknown>;
  const candidate = p['projectPath'] ?? p['project'];
  return typeof candidate === 'string' ? candidate : undefined;
}

function findMatchingDirective(
  recent: readonly Directive[],
  name: string,
  projectPath: string | undefined,
): Directive | undefined {
  const nameLower = name.toLowerCase();
  const pathLower = projectPath?.toLowerCase();

  // Prefer non-terminal directives (running/blocked/claimed/pending).
  const sortedByPriority = [...recent].sort((a, b) => {
    const pri = (d: Directive): number =>
      d.status === 'running'
        ? 0
        : d.status === 'blocked'
          ? 1
          : d.status === 'claimed' || d.status === 'pending'
            ? 2
            : 3;
    return pri(a) - pri(b);
  });

  for (const d of sortedByPriority) {
    if (typeof d.payload !== 'object' || d.payload === null) continue;
    const p = d.payload as Record<string, unknown>;
    const projectName = typeof p['project'] === 'string' ? p['project'].toLowerCase() : undefined;
    const dirPath =
      typeof p['projectPath'] === 'string' ? p['projectPath'].toLowerCase() : undefined;
    if (projectName === nameLower) return d;
    if (pathLower !== undefined && dirPath === pathLower) return d;
  }
  return undefined;
}

export function registerResumeCommand(program: Command): void {
  const cmd = program
    .command('resume <project>')
    .description('resume the most recent build for a project (reuses wiki + plan)')
    .option(
      '--workspace <path>',
      'workspace to search for the project (defaults to the workspace recorded on the project)',
    )
    .option('--autonomy <mode>', 'override autonomy on the resumed run', 'assisted');

  // Tier 12 / ADR 0032 §3 — six budget flags mirroring `factory build`.
  // Resume operators commonly hit this path after a `maxTurns` trip; the
  // matching flags let them bump per-axis without re-specifying the rest.
  // 12.7 wires the inheritance of `prior.payload.budgets` so resumes
  // start from the original's resolved set instead of bare defaults.
  addBudgetFlags(cmd);

  cmd
    .addHelpText(
      'after',
      `
Examples:
  factory resume my-app
  factory resume my-app --autonomy autonomous
  factory resume my-app --workspace ~/projects
  factory resume my-app --max-turns-scaffolder 160    # bump after a maxTurns trip

Budgets (ADR 0032 §1) on resume override the original directive's resolved
set per-axis. Omitted flags inherit from the prior directive (Tier 12.7).
`,
    )
    .action(
      async (
        project: string,
        options: { workspace?: string; autonomy: string } & BudgetOptions,
      ) => {
        try {
          const db = openDatabase();
          runMigrations(db);

          // Pull recent directives and the project record (if any). After
          // ADR 0021 `name` is non-unique, so `findByName` may return more
          // than one row; resume picks the most recently touched (the array
          // is ordered DESC by `last_touched_at`).
          const recent = directivesQ.listRecent(db, 200);
          const namedProjects = projectsQ.findByName(db, project);
          const projectRow = namedProjects[0];
          const absoluteArg = isAbsolute(project) ? project : resolve(cwd(), project);
          const projectPathHint = projectRow?.workspacePath ?? absoluteArg;

          const prior = findMatchingDirective(recent, project, projectPathHint);
          if (prior === undefined) {
            stdout.write(
              `factory resume: no prior directive found for "${project}".\n` +
                `  Tip: run \`factory build ${project}\` to start fresh.\n`,
            );
            db.close();
            exit(2);
          }

          const projectPath = extractProjectPath(prior) ?? projectRow?.workspacePath ?? absoluteArg;

          // Inherit project identity from the prior directive when present;
          // fall back to the projects-table lookup; otherwise leave undefined
          // (the resumed build will operate without a project_id, matching
          // pre-ADR-0021 behaviour for legacy directives that lack one).
          const inheritedProjectId = prior.projectId ?? projectRow?.id;

          // Carry the assessor runtime (ADR 0026) across resume so the brain's
          // assess() call keeps dispatching to the same language runtime as the
          // original build. Legacy directives without `language` resolve to
          // python via assess()'s default.
          const priorPayload =
            typeof prior.payload === 'object' && prior.payload !== null
              ? (prior.payload as Record<string, unknown>)
              : undefined;
          const priorLanguage = priorPayload?.['language'];
          const carriedLanguage =
            priorLanguage === 'python' ||
            priorLanguage === 'node' ||
            priorLanguage === 'go' ||
            priorLanguage === 'rust'
              ? priorLanguage
              : undefined;

          // Tier 12 / ADR 0032 §6 — collect operator-supplied budget overrides
          // for this resume. Note: 12.5 only writes the overrides; the
          // inheritance from `prior.payload.budgets` (so unset axes inherit
          // from the original directive's resolved set) is 12.7's contract.
          // Today an axis omitted on resume falls back to BUDGET_DEFAULTS at
          // brain-consumption time.
          const { limits: explicitLimits, budgets: budgetOverrides } = collectBudgetFlags(options);
          const hasLimits = Object.keys(explicitLimits).length > 0;
          const hasBudgets = Object.keys(budgetOverrides).length > 0;

          const directive = directiveSchema.parse({
            id: newId(),
            source: 'cli',
            principal: 'cli-user',
            channelRef: `resume-${String(process.pid)}`,
            intent: 'build' satisfies Intent, // pipeline is the build path
            payload: {
              project,
              projectPath,
              workspace: options.workspace ?? projectRow?.workspacePath ?? projectPath,
              resumeFrom: prior.id,
              ...(carriedLanguage !== undefined ? { language: carriedLanguage } : {}),
              ...(hasBudgets ? { budgets: budgetOverrides } : {}),
            },
            autonomy: options.autonomy as Directive['autonomy'],
            createdAt: new Date().toISOString(),
            status: 'pending' as const,
            parentDirectiveId: prior.id,
            ...(inheritedProjectId !== undefined ? { projectId: inheritedProjectId } : {}),
            ...(hasLimits
              ? {
                  limits: {
                    ...(explicitLimits.maxUsd !== undefined
                      ? { maxUsd: explicitLimits.maxUsd }
                      : {}),
                    ...(explicitLimits.maxSteps !== undefined
                      ? { maxSteps: explicitLimits.maxSteps }
                      : {}),
                  },
                }
              : {}),
          });
          directivesQ.insert(db, directive);

          const budgetsLine = hasBudgets
            ? `  budgets:       ${(Object.keys(budgetOverrides) as BudgetAxis[])
                .map((k) => `${k}=${String(budgetOverrides[k])}`)
                .join(' ')}\n`
            : '';
          stdout.write(
            `factory resume ${project}\n  resuming from: ${prior.id} (${prior.status})\n  new directive: ${directive.id}\n  path:          ${projectPath}\n${budgetsLine}\n`,
          );

          log.info(
            { directiveId: directive.id, parent: prior.id, priorStatus: prior.status },
            'resume starting',
          );

          const handle = await runBrain({ mode: 'inline', directiveId: directive.id, db });
          const result = await handle.done;

          if (result === undefined) {
            stdout.write('brain exited without a result (unexpected for inline mode)\n');
            db.close();
            exit(1);
          }

          stdout.write('\n=== Resume summary ===\n');
          stdout.write(`directive: ${result.directive.id} (resumed from ${prior.id})\n`);
          if (result.plan !== undefined) {
            const completed = result.plan.tasks.filter((t) => t.status === 'complete').length;
            stdout.write(
              `plan:      ${String(completed)}/${String(result.plan.tasks.length)} tasks complete\n`,
            );
          }
          const passed = result.taskResults.filter((r) => r.exitCode === 0).length;
          const failed = result.taskResults.filter((r) => r.exitCode !== 0).length;
          stdout.write(`tasks:     ${String(passed)} passed, ${String(failed)} failed this run\n`);
          if (result.assessment !== undefined) {
            const g = result.assessment.gateResults;
            stdout.write(
              `assessor:  build=${String(g.build)} integration=${String(g.integration)} verify=${String(g.verify)}\n`,
            );
          }
          stdout.write(`status:    ${result.terminalStatus}\n`);

          db.close();
          exit(result.terminalStatus === 'complete' ? 0 : 2);
        } catch (err) {
          const msg = (err as Error).message;
          log.error({ err }, 'resume failed');
          stdout.write(`\nfactory resume: error: ${msg}\n`);
          exit(1);
        }
      },
    );
}
