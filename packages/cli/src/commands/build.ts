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

import { constants as fsConstants } from 'node:fs';
import { access, mkdir, cp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { cwd, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadConfig, runBrain } from '@factory5/brain';
import { readPidFile } from '@factory5/daemon';
import { type AutonomyMode, directiveSchema, newId, type Intent } from '@factory5/core';
import { createDaemonClient } from '@factory5/ipc';
import { createLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  modelUsage,
  openDatabase,
  projects as projectsQ,
  runMigrations,
  type Database,
} from '@factory5/state';
import type { Command } from 'commander';

const log = createLogger('cli.build');

function parseAutonomy(raw: string): AutonomyMode {
  if (raw === 'chat' || raw === 'assisted' || raw === 'autonomous') return raw;
  throw new Error(`--autonomy must be chat | assisted | autonomous, got: ${raw}`);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findRepoTemplatesDir(): Promise<string | undefined> {
  // Walk up from this file (works for both tsx/dev and compiled dist/ layouts)
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = join(dir, 'templates');
    if (await fileExists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function resolveProjectPath(name: string, workspace: string): Promise<string> {
  if (isAbsolute(name) && (await fileExists(name))) return name;
  if (
    (name.startsWith('./') || name.startsWith('../')) &&
    (await fileExists(resolve(cwd(), name)))
  ) {
    return resolve(cwd(), name);
  }

  // Check the workspace dir first
  const inWorkspace = join(workspace, name);
  if (await fileExists(inWorkspace)) return inWorkspace;

  // Then templates
  const templates = await findRepoTemplatesDir();
  if (templates !== undefined) {
    const inTemplates = join(templates, name);
    if (await fileExists(inTemplates)) {
      // Copy the template into the workspace so writes don't pollute the repo
      await mkdir(workspace, { recursive: true });
      await cp(inTemplates, inWorkspace, { recursive: true });
      log.info({ name, from: inTemplates, to: inWorkspace }, 'template copied into workspace');
      return inWorkspace;
    }
  }

  // Last resort: create an empty project directory
  await mkdir(inWorkspace, { recursive: true });
  log.warn({ name, created: inWorkspace }, 'project dir did not exist — created empty');
  return inWorkspace;
}

function defaultWorkspace(): string {
  return join(homedir(), 'factory5-workspace');
}

function parsePositiveFloat(flag: string, raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${flag} must be a positive number, got: ${raw}`);
  }
  return n;
}

function parsePositiveInt(flag: string, raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${flag} must be a positive integer, got: ${raw}`);
  }
  return n;
}

export function registerBuildCommand(program: Command): void {
  program
    .command('build <project>')
    .description('build a project from its CLAUDE.md spec (delegates to factoryd if running)')
    .option('--autonomy <mode>', 'chat | assisted | autonomous', 'assisted')
    .option('--workspace <path>', 'root directory under which projects live', defaultWorkspace())
    .option('--concurrency <n>', 'max parallel worker tasks (default: min(4, cpuCount))', (v) =>
      parsePositiveInt('--concurrency', v),
    )
    .option(
      '--max-usd <n>',
      'hard USD ceiling for this directive (ADR 0020). Absent = unlimited.',
      (v) => parsePositiveFloat('--max-usd', v),
    )
    .option(
      '--max-steps <n>',
      'hard call-count ceiling for this directive (ADR 0020). Absent = unlimited.',
      (v) => parsePositiveInt('--max-steps', v),
    )
    .option('--inline', 'force inline execution even when a daemon is running')
    .option('--verbose', 'log at debug level')
    .action(
      async (
        project: string,
        options: {
          autonomy: string;
          workspace: string;
          concurrency?: number;
          maxUsd?: number;
          maxSteps?: number;
          inline?: boolean;
          verbose?: boolean;
        },
      ) => {
        try {
          if (options.verbose === true) {
            process.env['FACTORY5_LOG_LEVEL'] = 'debug';
          }
          const autonomy = parseAutonomy(options.autonomy);
          const workspace = options.workspace;
          const projectPath = await resolveProjectPath(project, workspace);

          const db = openDatabase();
          runMigrations(db);

          projectsQ.upsert(db, {
            name: project,
            workspacePath: projectPath,
            status: 'active',
            createdAt: new Date().toISOString(),
            lastTouchedAt: new Date().toISOString(),
          });

          // Resolve budget ceilings: explicit CLI flag wins over
          // `~/.factory5/config.toml` [budget.defaults] (ADR 0020, step 7a.6).
          const cfg = await loadConfig().catch(() => undefined);
          const limits: { maxUsd?: number; maxSteps?: number } = {};
          const maxUsd = options.maxUsd ?? cfg?.budget.defaults.maxUsd;
          const maxSteps = options.maxSteps ?? cfg?.budget.defaults.maxSteps;
          if (maxUsd !== undefined) limits.maxUsd = maxUsd;
          if (maxSteps !== undefined) limits.maxSteps = maxSteps;
          const hasLimits = Object.keys(limits).length > 0;

          const directive = directiveSchema.parse({
            id: newId(),
            source: 'cli',
            principal: 'cli-user',
            channelRef: `build-${String(process.pid)}`,
            intent: 'build' satisfies Intent,
            payload: { project, projectPath, workspace },
            autonomy,
            createdAt: new Date().toISOString(),
            status: 'pending' as const,
            ...(hasLimits ? { limits } : {}),
          });
          directivesQ.insert(db, directive);

          const limitsLine = hasLimits
            ? `  limits:   ${maxUsd !== undefined ? `max_usd=$${maxUsd.toFixed(2)} ` : ''}${maxSteps !== undefined ? `max_steps=${String(maxSteps)}` : ''}\n`
            : '';
          stdout.write(
            `factory build ${project}\n  directive: ${directive.id}\n  path: ${projectPath}\n  autonomy: ${autonomy}\n${limitsLine}\n`,
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
          log.error({ err }, 'build failed');
          stdout.write(`\nfactory build: error: ${msg}\n`);
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
  const client = createDaemonClient({ timeoutMs: 5000 });
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
    stdout.write(
      `assessor:  build=${String(g.build)} integration=${String(g.integration)} verify=${String(g.verify)} (pytest: ${String(result.assessment.testsPassed)} passed / ${String(result.assessment.testsFailed)} failed)\n`,
    );
  }
  stdout.write(`status:    ${result.terminalStatus}\n`);
  return result.terminalStatus === 'complete' ? 0 : 2;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
