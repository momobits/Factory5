/**
 * `factory cleanup [<projectPath>]` — list and remove worktrees from prior
 * failed runs that are no longer referenced by the current plan.
 *
 * Lists by default. Use `--yes` to remove. `--prune-branches` also deletes
 * the matching `factory/task-<id>` branches.
 *
 * Exit codes:
 *   0 — listed cleanly, or removed successfully
 *   1 — unexpected error (e.g. cannot read project, git removal failed)
 */

import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Command } from 'commander';

import { createLogger } from '@factory5/logger';
import { branchNameFor, listAbandonedWorktrees } from '@factory5/worker';

const log = createLogger('cli.cleanup');

interface CleanupFlags {
  pruneBranches?: boolean;
  yes?: boolean;
}

async function readActiveTaskIds(projectPath: string): Promise<string[]> {
  try {
    const planText = await readFile(join(projectPath, '.factory', 'plan.json'), 'utf8');
    const parsed = JSON.parse(planText) as { tasks?: Array<{ id?: string }> };
    return (parsed.tasks ?? [])
      .map((t) => t.id)
      .filter((id): id is string => typeof id === 'string');
  } catch {
    // No plan.json — every worktree is, by definition, not in the active set.
    return [];
  }
}

export function registerCleanupCommand(parent: Command): void {
  parent
    .command('cleanup')
    .description('List and remove abandoned worktrees from prior failed runs')
    .argument('[projectPath]', 'Project root path (defaults to cwd)', process.cwd())
    .option('--prune-branches', 'Also delete the factory/task-<id> branches')
    .option('-y, --yes', 'Skip the listing-only dry run and actually remove')
    .addHelpText(
      'after',
      `
Examples:
  factory cleanup                          # list abandoned worktrees in cwd (dry run)
  factory cleanup ../my-app                # list for a specific project
  factory cleanup --yes                    # actually remove the worktrees
  factory cleanup --yes --prune-branches   # also delete the factory/task-<id> branches

Exit codes:
  0  listed cleanly, or removed successfully
  1  unexpected error (cannot read project, git removal failed)
`,
    )
    .action(async (projectPath: string, opts: CleanupFlags) => {
      const abs = resolve(projectPath);
      const activeTaskIds = await readActiveTaskIds(abs);

      const abandoned = await listAbandonedWorktrees({ projectPath: abs, activeTaskIds });

      if (abandoned.length === 0) {
        process.stdout.write('No abandoned worktrees found.\n');
        return;
      }

      process.stdout.write(`Found ${String(abandoned.length)} abandoned worktree(s):\n\n`);
      for (const w of abandoned) {
        process.stdout.write(
          `  ${w.path}\n` +
            `    Task: ${w.taskId}\n` +
            `    Last modified: ${w.abandonedSince.toISOString()}\n\n`,
        );
      }

      if (opts.yes !== true) {
        process.stdout.write('Remove these? Re-run with --yes to confirm.\n');
        return;
      }

      let removed = 0;
      for (const w of abandoned) {
        log.info({ path: w.path, taskId: w.taskId }, 'cleanup: removing worktree');
        try {
          execFileSync('git', ['worktree', 'remove', '--force', w.path], {
            cwd: abs,
            stdio: 'pipe',
          });
        } catch {
          // git worktree remove may fail if it doesn't recognise the directory
          // (e.g., not registered as a worktree). Fall back to plain rm.
          try {
            await rm(w.path, { recursive: true, force: true });
          } catch (rmErr) {
            log.warn({ err: rmErr, path: w.path }, 'cleanup: rm fallback failed');
            continue;
          }
        }

        if (opts.pruneBranches === true) {
          // Must match the worktree's actual branch name. branchNameFor uses the
          // last-8 chars of the task id (worktree.ts:465) — building the name from
          // the full ULID here never matched, so the delete always threw into the
          // warn-only catch and branch pruning was a silent no-op (ADR 0008 mandates
          // a single branch-naming source).
          const branchName = branchNameFor(w.taskId);
          try {
            execFileSync('git', ['branch', '-D', branchName], { cwd: abs, stdio: 'pipe' });
          } catch (err) {
            log.warn(
              { err, taskId: w.taskId, branch: branchName },
              'cleanup: branch delete failed (probably already gone or unmerged)',
            );
          }
        }
        removed++;
      }
      process.stdout.write(`Removed ${String(removed)} worktree(s).\n`);
    });
}
