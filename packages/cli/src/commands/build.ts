/**
 * `factory build <project>` — inline build path for Phase 1.
 *
 * The project argument is resolved to an absolute path:
 *   1. If it's an absolute path, use as-is.
 *   2. If it starts with `./` or `../`, resolve relative to cwd.
 *   3. Otherwise, look it up under `templates/<name>/` in the factory5 repo,
 *      then fall back to `cwd/<name>/`.
 *
 * A fresh directive is written to SQLite and the brain is invoked in `inline`
 * mode. On completion, a summary is printed to stdout.
 */

import { exit, stdout } from 'node:process';

import { loadConfig, loadDaemonEndpoint, runBrain } from '@factory5/brain';
import { readPidFile } from '@factory5/daemon';
import { type AutonomyMode, directiveSchema, newId, type Intent } from '@factory5/core';
import { type BudgetAxis } from '@factory5/core/budgets';
import { createDaemonClient } from '@factory5/ipc';
import { createLogger } from '@factory5/logger';
import { addBudgetFlags, collectBudgetFlags, type BudgetOptions } from './budget-flags.js';
import {
  directives as directivesQ,
  modelUsage,
  openDatabase,
  projects as projectsQ,
  runMigrations,
  type Database,
} from '@factory5/state';
import {
  budgetDefaultsFromProjectMeta,
  defaultWorkspace,
  languageFromProjectMeta,
  loadOrCreateProjectMetadata,
  ProjectMetadataCorruptError,
  resolveDirectiveLimits,
  type ProjectLanguage,
  resolveProjectPath,
} from '@factory5/wiki';
import type { Command } from 'commander';

const log = createLogger('cli.build');

function parseAutonomy(raw: string): AutonomyMode {
  if (raw === 'chat' || raw === 'assisted' || raw === 'autonomous') return raw;
  throw new Error(`--autonomy must be chat | assisted | autonomous, got: ${raw}`);
}

function parseLanguage(raw: string): ProjectLanguage {
  if (raw === 'python' || raw === 'node' || raw === 'go' || raw === 'rust') return raw;
  throw new Error(`--language must be python | node | go | rust, got: ${raw}`);
}

function parsePositiveInt(flag: string, raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${flag} must be a positive integer, got: ${raw}`);
  }
  return n;
}

export function registerBuildCommand(program: Command): void {
  const cmd = program
    .command('build <project>')
    .description('build a project from its CLAUDE.md spec (delegates to factoryd if running)')
    .option('--autonomy <mode>', 'chat | assisted | autonomous', 'assisted')
    .option(
      '--language <lang>',
      'python | node | go | rust — selects assessor runtime (ADR 0026). Default python.',
    )
    .option('--workspace <path>', 'root directory under which projects live', defaultWorkspace())
    .option('--concurrency <n>', 'max parallel worker tasks (default: min(4, cpuCount))', (v) =>
      parsePositiveInt('--concurrency', v),
    );

  // Tier 12 / ADR 0032 §3 — six budget flags with explainers read verbatim
  // from BUDGET_DEFAULTS. The same set lands on `factory resume` so resume
  // can override per-axis when the operator picks accept-with-bump.
  addBudgetFlags(cmd);

  cmd
    .option('--inline', 'force inline execution even when a daemon is running')
    .option('--verbose', 'log at debug level')
    .addHelpText(
      'after',
      `
Examples:
  factory build my-app
  factory build my-app --autonomy autonomous --max-usd 5
  factory build my-app --language node --max-steps 200
  factory build my-app --max-turns-scaffolder 160      # bigger projects
  factory build templates/python-cli --autonomy chat
  factory build my-app --inline                        # bypass the daemon

Budgets (ADR 0032 §1) are operator-facing; defaults + explainers live in
@factory5/core/budgets — the same source the Web UI's "Advanced budgets"
accordion reads. Omit any flag to use the default.
`,
    )
    .action(
      async (
        project: string,
        options: {
          autonomy: string;
          language?: string;
          workspace: string;
          concurrency?: number;
          inline?: boolean;
          verbose?: boolean;
        } & BudgetOptions,
      ) => {
        try {
          if (options.verbose === true) {
            process.env['FACTORY5_LOG_LEVEL'] = 'debug';
          }
          const autonomy = parseAutonomy(options.autonomy);
          const flagLanguage =
            options.language !== undefined ? parseLanguage(options.language) : undefined;
          const workspace = options.workspace;
          const projectPath = await resolveProjectPath(project, workspace);

          const db = openDatabase();
          runMigrations(db);

          // Resolve project identity (ADR 0021): read or create
          // <project>/.factory/project.json. The id is the canonical
          // handle, stable across path moves; downstream queries
          // (spend rollups, findings registry) join on it.
          const projectMeta = await loadOrCreateProjectMetadata(projectPath, project);

          // Language resolution (Phase 10.8): explicit --language flag wins;
          // otherwise read what `factory init` recorded in
          // `project.json.metadata.language`. Both absent → leave undefined
          // and the assessor defaults to python.
          const language = flagLanguage ?? languageFromProjectMeta(projectMeta);

          const nowIso = new Date().toISOString();
          projectsQ.upsert(db, {
            id: projectMeta.id,
            name: projectMeta.name,
            workspacePath: projectPath,
            status: 'active',
            createdAt: projectMeta.createdAt,
            lastTouchedAt: nowIso,
          });

          // Resolve budget ceilings via the shared three-tier helper
          // (ADR 0027 §4 / I009 fix): explicit CLI flag → per-project
          // `metadata.budgetDefaults` (Web UI–writable) → `config.toml`
          // `[budget.defaults]` (ADR 0020). Per-field independent.
          // Tier 12 / ADR 0032 §6: the four new axes (deadline + maxTurns*)
          // ride on directive.payload.budgets instead. The split is
          // transitional — step 12.7 unifies the shape.
          const { limits: explicitLimits, budgets: budgetOverrides } = collectBudgetFlags(options);
          const cfg = await loadConfig().catch(() => undefined);
          const limits = resolveDirectiveLimits({
            explicitFlags: explicitLimits,
            projectDefaults: budgetDefaultsFromProjectMeta(projectMeta),
            configDefaults: cfg?.budget.defaults,
          });
          const hasLimits = limits !== undefined;
          const hasBudgets = Object.keys(budgetOverrides).length > 0;

          const directive = directiveSchema.parse({
            id: newId(),
            source: 'cli',
            principal: 'cli-user',
            channelRef: `build-${String(process.pid)}`,
            intent: 'build' satisfies Intent,
            payload: {
              project,
              projectPath,
              workspace,
              ...(language !== undefined ? { language } : {}),
              ...(hasBudgets ? { budgets: budgetOverrides } : {}),
            },
            autonomy,
            createdAt: nowIso,
            status: 'pending' as const,
            projectId: projectMeta.id,
            ...(hasLimits ? { limits } : {}),
          });
          directivesQ.insert(db, directive);

          const limitsLine =
            limits !== undefined
              ? `  limits:   ${limits.maxUsd !== undefined ? `max_usd=$${limits.maxUsd.toFixed(2)} ` : ''}${limits.maxSteps !== undefined ? `max_steps=${String(limits.maxSteps)}` : ''}\n`
              : '';
          const budgetsLine = hasBudgets
            ? `  budgets:  ${(Object.keys(budgetOverrides) as BudgetAxis[])
                .map((k) => `${k}=${String(budgetOverrides[k])}`)
                .join(' ')}\n`
            : '';
          const languageLine = language !== undefined ? `  language: ${language}\n` : '';
          stdout.write(
            `factory build ${project}\n  directive: ${directive.id}\n  path: ${projectPath}\n  autonomy: ${autonomy}\n${languageLine}${limitsLine}${budgetsLine}\n`,
          );

          const daemonAvailable = options.inline !== true && isDaemonRunning();
          if (daemonAvailable) {
            const code = await runViaDaemon(db, directive.id);
            db.close();
            exit(code);
          } else {
            const code = await runInline(db, directive.id, options.concurrency);
            db.close();
            exit(code);
          }
        } catch (err) {
          const msg = (err as Error).message;
          if (err instanceof ProjectMetadataCorruptError) {
            log.error(
              { err, filePath: err.filePath },
              'build failed: project identity file is corrupt',
            );
            stdout.write(
              `\nfactory build: ${msg}\n` +
                `\nThis project's identity file (.factory/project.json) cannot be parsed; refusing\n` +
                `to silently re-tag it (would lose the project's spend / findings / build history).\n` +
                `Restore the file from backup, or delete it to claim a new identity.\n`,
            );
          } else {
            log.error({ err }, 'build failed');
            stdout.write(`\nfactory build: error: ${msg}\n`);
          }
          exit(1);
        }
      },
    );
}

/** Liveness check — there is a pidfile and its owner is alive. */
function isDaemonRunning(): boolean {
  const info = readPidFile();
  return info?.alive === true;
}

/**
 * Enqueue the directive with the running daemon, ring the doorbell, and poll
 * the directive's status until terminal. Exit code follows the directive.
 */
async function runViaDaemon(db: Database, directiveId: string): Promise<number> {
  const endpoint = await loadDaemonEndpoint();
  const client = createDaemonClient({ ...endpoint, timeoutMs: 5000 });
  stdout.write('daemon mode: directive enqueued — polling for completion…\n');
  try {
    await client.notifyDirective({ directiveId, reason: 'new' });
  } catch (err) {
    log.warn({ err, directiveId }, 'notifyDirective failed — falling back to poll-only');
  }

  // Poll every second until terminal; cap at ~2h just so stale wiring fails loud.
  const deadline = Date.now() + 2 * 60 * 60 * 1000;
  let lastStatus: string | undefined;
  while (Date.now() < deadline) {
    const d = directivesQ.getById(db, directiveId);
    if (d === undefined) {
      stdout.write('factory build: directive disappeared from the bus\n');
      return 1;
    }
    if (d.status !== lastStatus) {
      stdout.write(`  directive: ${d.status}\n`);
      lastStatus = d.status;
    }
    if (d.status === 'complete' || d.status === 'failed' || d.status === 'blocked') {
      const totalCost = modelUsage.totalCostForDirective(db, directiveId);
      stdout.write(`\n=== Build summary (daemon) ===\n`);
      stdout.write(`directive: ${d.id}\n`);
      stdout.write(`status:    ${d.status}\n`);
      stdout.write(`spend:     $${totalCost.toFixed(4)}\n`);
      return d.status === 'complete' ? 0 : 2;
    }
    await sleep(1000);
  }
  stdout.write('factory build: daemon did not reach a terminal status within 2h\n');
  return 2;
}

/** Fallback: inline execution, identical to the pre-daemon behaviour. */
async function runInline(
  db: Database,
  directiveId: string,
  concurrency: number | undefined,
): Promise<number> {
  const handle = await runBrain({
    mode: 'inline',
    directiveId,
    db,
    ...(concurrency !== undefined ? { concurrency } : {}),
  });
  const result = await handle.done;
  if (result === undefined) {
    stdout.write('brain exited without a result (unexpected for inline mode)\n');
    return 1;
  }
  stdout.write('\n=== Build summary ===\n');
  stdout.write(`directive: ${result.directive.id}\n`);
  if (result.triage !== undefined) {
    stdout.write(
      `triage:    intent=${result.triage.intent} confidence=${String(result.triage.confidence)}\n`,
    );
  }
  if (result.architect !== undefined) {
    const failedChecks = result.architect.readiness.checks.filter((c) => !c.ok).map((c) => c.id);
    stdout.write(
      `architect: pages=${String(result.architect.pages.length)} readiness=${result.architect.readiness.ok ? 'ok' : `failed: ${failedChecks.join(',')}`}\n`,
    );
  }
  if (result.plan !== undefined) {
    stdout.write(`plan:      ${String(result.plan.tasks.length)} tasks\n`);
  }
  const totalFilesChanged = result.taskResults.reduce((n, r) => n + r.filesChanged.length, 0);
  stdout.write(
    `tasks:     ${String(result.taskResults.filter((r) => r.exitCode === 0).length)} passed, ${String(result.taskResults.filter((r) => r.exitCode !== 0).length)} failed, ${String(totalFilesChanged)} file(s) changed\n`,
  );
  if (result.assessment !== undefined) {
    const g = result.assessment.gateResults;
    const a = result.assessment;
    const failureLine = a.failureMode !== undefined ? ` failureMode=${a.failureMode}` : '';
    stdout.write(
      `assessor:  runtime=${a.runtime} build=${String(g.build)} integration=${String(g.integration)} verify=${String(g.verify)} (${a.testFramework}: ${String(a.testsPassed)} passed / ${String(a.testsFailed)} failed)${failureLine}\n`,
    );
  }
  stdout.write(`status:    ${result.terminalStatus}\n`);
  return result.terminalStatus === 'complete' ? 0 : 2;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
