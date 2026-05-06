/**
 * `factory budget set <project> [--max-usd <n>] [--max-steps <n>]` —
 * Phase 4.2 sibling of the web UI's `PUT /api/v1/projects/:id/budget`
 * (ADR 0027 §1).
 *
 * Writes per-project `metadata.budgetDefaults` into
 * `<workspace>/<project>/.factory/project.json` via the same
 * {@link updateProjectMetadata} helper the daemon's PUT route uses, so a
 * future change to the on-disk shape lands in one place.
 *
 * **Per-field merge** (CLI semantics — differs from the web UI):
 * the web UI's PUT is full-document replacement (body wins wholesale); the
 * CLI takes one or both flags and merges into the existing block. Operators
 * passing only `--max-steps 100` keep an existing `maxUsd`; they never have
 * to re-state the whole budget block. Idempotent: same call twice yields
 * the same on-disk state.
 *
 * Exit codes:
 *   0 — success
 *   1 — hard error (filesystem / DB exception not otherwise classified)
 *   2 — invalid input (missing flags, bad value, project not found,
 *       project.json missing or corrupt on disk, ambiguous project ref)
 *
 * Project resolution: `<project>` is matched against the `projects` table
 * by name first (the common case), then by full ULID. Two projects sharing
 * a name surface as ambiguous — disambiguate with the full ULID. Suffix
 * matching is intentionally not supported here; use `factory spend
 * --project <suffix>` to look up the full ULID first if needed.
 */

import { exit, stdout } from 'node:process';

import { projectBudgetDefaultsSchema, type ProjectBudgetDefaults } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import { openDatabase, projects as projectsQ, runMigrations, type Database } from '@factory5/state';
import {
  budgetDefaultsFromProjectMeta,
  ProjectMetadataCorruptError,
  ProjectMetadataNotFoundError,
  updateProjectMetadata,
} from '@factory5/wiki';
import { InvalidArgumentError, type Command } from 'commander';

const log = createLogger('cli.budget');

export const BUDGET_EXIT = {
  OK: 0,
  GENERIC_FAILURE: 1,
  INVALID_INPUT: 2,
} as const;

export type BudgetExitCode = (typeof BUDGET_EXIT)[keyof typeof BUDGET_EXIT];

export interface HandlerResult {
  stdout: string;
  exitCode: BudgetExitCode;
}

export interface BudgetSetOptions {
  /** Project ref — name (most common) or full ULID. */
  project: string;
  /** Per-directive USD ceiling. Must be > 0; merged with any existing maxSteps. */
  maxUsd?: number | undefined;
  /** Per-directive step ceiling. Must be a positive integer; merged with any existing maxUsd. */
  maxSteps?: number | undefined;
}

interface ResolvedProject {
  id: string;
  name: string;
  workspacePath: string;
}

/**
 * Pure handler — open-and-close DB lifecycle owned by caller. Tests drive
 * it directly against an in-memory DB plus tmpdir-rooted workspaces.
 */
export async function runBudgetSet(db: Database, opts: BudgetSetOptions): Promise<HandlerResult> {
  // 1. Require at least one field — `factory budget set <project>` with no
  //    flags is a no-op the operator probably didn't mean.
  if (opts.maxUsd === undefined && opts.maxSteps === undefined) {
    return {
      stdout: 'factory budget set: specify at least one of --max-usd <n> or --max-steps <n>\n',
      exitCode: BUDGET_EXIT.INVALID_INPUT,
    };
  }

  // 2. Validate values via the canonical schema (ADR 0027 — same shape the
  //    web UI's PUT body parses against).
  const candidate: Partial<ProjectBudgetDefaults> = {};
  if (opts.maxUsd !== undefined) candidate.maxUsd = opts.maxUsd;
  if (opts.maxSteps !== undefined) candidate.maxSteps = opts.maxSteps;
  const parsed = projectBudgetDefaultsSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') ?? '';
    const reason = issue?.message ?? 'invalid budget value';
    return {
      stdout: `factory budget set: ${field !== '' ? `${field}: ` : ''}${reason}\n`,
      exitCode: BUDGET_EXIT.INVALID_INPUT,
    };
  }

  // 3. Resolve the project ref.
  const resolution = resolveProjectByRef(db, opts.project);
  if ('error' in resolution) {
    return { stdout: resolution.error, exitCode: BUDGET_EXIT.INVALID_INPUT };
  }
  const project = resolution.project;

  // 4. Read-modify-write project.json with per-field merge.
  let updatedDefaults: ProjectBudgetDefaults;
  try {
    const updated = await updateProjectMetadata(project.workspacePath, (meta) => {
      const existing = budgetDefaultsFromProjectMeta(meta) ?? {};
      const next: ProjectBudgetDefaults = {
        ...existing,
        ...(opts.maxUsd !== undefined ? { maxUsd: opts.maxUsd } : {}),
        ...(opts.maxSteps !== undefined ? { maxSteps: opts.maxSteps } : {}),
      };
      return { ...meta, metadata: { ...meta.metadata, budgetDefaults: next } };
    });
    updatedDefaults = budgetDefaultsFromProjectMeta(updated) ?? {};
  } catch (err) {
    if (err instanceof ProjectMetadataNotFoundError || err instanceof ProjectMetadataCorruptError) {
      return {
        stdout: `factory budget set: ${err.message}\n`,
        exitCode: BUDGET_EXIT.INVALID_INPUT,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, projectId: project.id }, 'budget set: write failed');
    return {
      stdout: `factory budget set: error: ${msg}\n`,
      exitCode: BUDGET_EXIT.GENERIC_FAILURE,
    };
  }

  return {
    stdout: formatBudgetBlock(project.name, updatedDefaults),
    exitCode: BUDGET_EXIT.OK,
  };
}

/**
 * Resolve `<project>` to a registry row. Name-match first (most common),
 * full-ULID match second. Two-or-more name matches surface as ambiguous —
 * the operator disambiguates with a full ULID. Zero matches is "not found".
 */
function resolveProjectByRef(
  db: Database,
  ref: string,
): { project: ResolvedProject } | { error: string } {
  const byName = projectsQ.findByName(db, ref);
  if (byName.length === 1) {
    const p = byName[0]!;
    return { project: { id: p.id, name: p.name, workspacePath: p.workspacePath } };
  }
  if (byName.length > 1) {
    const lines = [
      `factory budget set: --project "${ref}" is ambiguous (${String(byName.length)} matches):`,
    ];
    for (const p of byName) {
      lines.push(`  ${p.name}    ${p.id}    ${p.workspacePath}`);
    }
    lines.push('', 'Disambiguate with the full ULID.', '');
    return { error: `${lines.join('\n')}\n` };
  }

  const byId = projectsQ.getById(db, ref);
  if (byId !== undefined) {
    return {
      project: { id: byId.id, name: byId.name, workspacePath: byId.workspacePath },
    };
  }

  return { error: `factory budget set: no project matches "${ref}"\n` };
}

/**
 * Render the persisted `metadata.budgetDefaults` block for the operator.
 * Format mirrors the spend command's "informational footer" feel — header
 * line + indented field list — so the surface is consistent across the
 * CLI's read/write commands.
 */
function formatBudgetBlock(name: string, b: ProjectBudgetDefaults): string {
  const lines: string[] = [];
  lines.push(`factory budget set: ${name} -> metadata.budgetDefaults`);
  lines.push(`  maxUsd:   ${b.maxUsd !== undefined ? `$${b.maxUsd.toFixed(2)}` : '(unset)'}`);
  lines.push(`  maxSteps: ${b.maxSteps !== undefined ? String(b.maxSteps) : '(unset)'}`);
  return `${lines.join('\n')}\n`;
}

// -----------------------------------------------------------------------------
// Commander wiring
// -----------------------------------------------------------------------------

function parseUsdFlag(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) {
    throw new InvalidArgumentError(`expected a number, got "${raw}"`);
  }
  return n;
}

function parseStepsFlag(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw.trim()) {
    throw new InvalidArgumentError(`expected an integer, got "${raw}"`);
  }
  return n;
}

async function runWithDb<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const db = openDatabase();
  runMigrations(db);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

export function registerBudgetCommand(program: Command): void {
  const budget = program
    .command('budget')
    .description('per-project budget defaults (max-usd / max-steps)');

  budget
    .command('set <project>')
    .description(
      'set per-project budget defaults — writes <workspace>/<project>/.factory/project.json metadata.budgetDefaults (same code path as the web UI)',
    )
    .option('--max-usd <n>', 'maximum USD per directive (positive number)', parseUsdFlag)
    .option(
      '--max-steps <n>',
      'maximum step count per directive (positive integer)',
      parseStepsFlag,
    )
    .action(
      async (projectRef: string, opts: { maxUsd?: number; maxSteps?: number }): Promise<void> => {
        const result = await runWithDb((db) =>
          runBudgetSet(db, {
            project: projectRef,
            ...(opts.maxUsd !== undefined ? { maxUsd: opts.maxUsd } : {}),
            ...(opts.maxSteps !== undefined ? { maxSteps: opts.maxSteps } : {}),
          }),
        );
        stdout.write(result.stdout);
        if (result.exitCode !== BUDGET_EXIT.OK) exit(result.exitCode);
      },
    );
}
