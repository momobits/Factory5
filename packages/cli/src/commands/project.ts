/**
 * `factory project list / show <name> / delete <name>` — Phase 4.3.
 *
 * Three handlers, one Commander group. Each is a pure async function that
 * returns `{ stdout, exitCode }` so tests can drive them directly without
 * spawning a subprocess or stubbing out `process.exit`.
 *
 * `list` walks the projects registry, enriching each row with on-disk
 * `language` (from `<workspace>/.factory/project.json`) and a "most
 * recent build" status pulled from the directives table. Best-effort on
 * the disk read — a missing or corrupt project.json renders the field as
 * `(unavailable)` rather than failing the whole table.
 *
 * `show` resolves a project ref (name or full ULID), pretty-prints the
 * registry row, the on-disk metadata (language, budget defaults), and
 * the most recent build directive's status / timestamp.
 *
 * `delete` is the unregister surface. Defaults are non-destructive:
 *   - default       → prompts (`y` / anything-else), removes the projects
 *                     row, leaves workspace files untouched
 *   - `--force`     → skips the prompt, unregisters
 *   - `--purge`     → double-prompts (typed-name confirm on the second),
 *                     unregisters AND `rm -rf`s the workspace dir
 *   - `--purge --force` → no prompts, unregisters + rm -rf
 *
 * Order of operations on `--purge`: unregister first (DELETE FROM projects),
 * then rm -rf. If rm -rf fails (permission denied, etc.) the registry is
 * already clean — operator gets the rm error and removes the dir manually,
 * and `factory build` won't trip on a stale registry entry.
 *
 * Exit codes (consistent with the rest of the CLI):
 *   0 — success (including a declined prompt — operator chose to cancel)
 *   1 — hard error (rm-rf failed unexpectedly, etc.)
 *   2 — invalid input (project not found, ambiguous name)
 */

import { rm } from 'node:fs/promises';
import { exit, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { createLogger } from '@factory5/logger';
import { openDatabase, projects as projectsQ, runMigrations, type Database } from '@factory5/state';
import {
  budgetDefaultsFromProjectMeta,
  languageFromProjectMeta,
  ProjectMetadataCorruptError,
  readProjectMetadata,
  type ProjectMetadata,
} from '@factory5/wiki';
import type { Command } from 'commander';

const log = createLogger('cli.project');

export const PROJECT_EXIT = {
  OK: 0,
  GENERIC_FAILURE: 1,
  INVALID_INPUT: 2,
} as const;

export type ProjectExitCode = (typeof PROJECT_EXIT)[keyof typeof PROJECT_EXIT];

export interface HandlerResult {
  stdout: string;
  exitCode: ProjectExitCode;
}

interface ResolvedProject {
  id: string;
  name: string;
  workspacePath: string;
  status: string;
  createdAt: string;
  lastTouchedAt: string;
}

/**
 * Resolve `<project>` to a registry row. Name-match first (most common),
 * full-ULID match second. Two-or-more name matches surface as ambiguous —
 * the operator disambiguates with a full ULID. Zero matches is "not found".
 *
 * Shared shape with `budget set` so error messages, ambiguity rules, and
 * suffix-matching policy stay aligned across the CLI.
 */
function resolveProjectByRef(
  db: Database,
  ref: string,
  cmdLabel: string,
): { project: ResolvedProject } | { error: string } {
  const byName = projectsQ.findByName(db, ref);
  if (byName.length === 1) {
    const p = byName[0]!;
    return {
      project: {
        id: p.id,
        name: p.name,
        workspacePath: p.workspacePath,
        status: p.status,
        createdAt: p.createdAt,
        lastTouchedAt: p.lastTouchedAt,
      },
    };
  }
  if (byName.length > 1) {
    const lines = [
      `factory project ${cmdLabel}: --project "${ref}" is ambiguous (${String(byName.length)} matches):`,
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
      project: {
        id: byId.id,
        name: byId.name,
        workspacePath: byId.workspacePath,
        status: byId.status,
        createdAt: byId.createdAt,
        lastTouchedAt: byId.lastTouchedAt,
      },
    };
  }
  return { error: `factory project ${cmdLabel}: no project matches "${ref}"\n` };
}

/**
 * Best-effort read of `<workspacePath>/.factory/project.json`. Returns
 * `undefined` on any error (missing file, JSON parse failure, schema
 * mismatch) — `list` and `show` render the metadata-derived fields as
 * `(unavailable)` rather than failing the whole command.
 */
async function readMetaSafe(workspacePath: string): Promise<ProjectMetadata | undefined> {
  try {
    return await readProjectMetadata(workspacePath);
  } catch (err) {
    if (err instanceof ProjectMetadataCorruptError) {
      log.warn(
        { workspacePath, err: err.message },
        'project: project.json present but corrupt — falling back to registry-only view',
      );
      return undefined;
    }
    log.warn({ workspacePath, err }, 'project: failed to read project.json');
    return undefined;
  }
}

interface BuildSummary {
  directiveId: string;
  status: string;
  createdAt: string;
}

/**
 * Most recent `intent='build'` directive for a project. Returned undefined
 * when the project has never had a build run against it. Inlined query —
 * the directives module doesn't export a project-scoped helper because no
 * other caller needed one yet.
 */
function mostRecentBuild(db: Database, projectId: string): BuildSummary | undefined {
  const row = db
    .prepare(
      `SELECT id, status, created_at
         FROM directives
        WHERE project_id = ? AND intent = 'build'
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(projectId) as { id: string; status: string; created_at: string } | undefined;
  if (row === undefined) return undefined;
  return { directiveId: row.id, status: row.status, createdAt: row.created_at };
}

// -----------------------------------------------------------------------------
// list
// -----------------------------------------------------------------------------

export async function runProjectList(db: Database): Promise<HandlerResult> {
  const all = projectsQ.listAll(db);
  if (all.length === 0) {
    return { stdout: '(no projects registered)\n', exitCode: PROJECT_EXIT.OK };
  }

  // Pre-resolve language + last-build per row so we can size columns.
  interface Row {
    name: string;
    status: string;
    language: string;
    lastBuild: string;
    workspacePath: string;
  }
  const rows: Row[] = [];
  for (const p of all) {
    const meta = await readMetaSafe(p.workspacePath);
    const language = meta !== undefined ? (languageFromProjectMeta(meta) ?? '-') : '(unavailable)';
    const build = mostRecentBuild(db, p.id);
    const lastBuild =
      build !== undefined ? `${build.status} ${build.createdAt}` : '(no builds yet)';
    rows.push({
      name: p.name,
      status: p.status,
      language,
      lastBuild,
      workspacePath: p.workspacePath,
    });
  }

  const headers = ['NAME', 'STATUS', 'LANGUAGE', 'LAST BUILD', 'WORKSPACE'];
  const widths = [
    Math.max(headers[0]!.length, ...rows.map((r) => r.name.length)),
    Math.max(headers[1]!.length, ...rows.map((r) => r.status.length)),
    Math.max(headers[2]!.length, ...rows.map((r) => r.language.length)),
    Math.max(headers[3]!.length, ...rows.map((r) => r.lastBuild.length)),
    Math.max(headers[4]!.length, ...rows.map((r) => r.workspacePath.length)),
  ];
  const fmt = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');

  const lines: string[] = [];
  lines.push(fmt(headers));
  for (const r of rows) {
    lines.push(fmt([r.name, r.status, r.language, r.lastBuild, r.workspacePath]));
  }
  return { stdout: `${lines.join('\n')}\n`, exitCode: PROJECT_EXIT.OK };
}

// -----------------------------------------------------------------------------
// show
// -----------------------------------------------------------------------------

export interface ProjectShowOptions {
  project: string;
}

export async function runProjectShow(
  db: Database,
  opts: ProjectShowOptions,
): Promise<HandlerResult> {
  const resolved = resolveProjectByRef(db, opts.project, 'show');
  if ('error' in resolved) {
    return { stdout: resolved.error, exitCode: PROJECT_EXIT.INVALID_INPUT };
  }
  const project = resolved.project;
  const meta = await readMetaSafe(project.workspacePath);
  const language =
    meta !== undefined ? (languageFromProjectMeta(meta) ?? '(none)') : '(unavailable)';
  const budget = meta !== undefined ? budgetDefaultsFromProjectMeta(meta) : undefined;
  const build = mostRecentBuild(db, project.id);

  const lines: string[] = [];
  lines.push(`project: ${project.name}`);
  lines.push(`  id:           ${project.id}`);
  lines.push(`  status:       ${project.status}`);
  lines.push(`  workspace:    ${project.workspacePath}`);
  lines.push(`  language:     ${language}`);
  lines.push(`  budget:`);
  lines.push(
    `    maxUsd:    ${
      budget?.maxUsd !== undefined
        ? `$${budget.maxUsd.toFixed(2)}`
        : meta === undefined
          ? '(unavailable)'
          : '(unset)'
    }`,
  );
  lines.push(
    `    maxSteps:  ${
      budget?.maxSteps !== undefined
        ? String(budget.maxSteps)
        : meta === undefined
          ? '(unavailable)'
          : '(unset)'
    }`,
  );
  lines.push(`  registry:`);
  lines.push(`    createdAt:    ${project.createdAt}`);
  lines.push(`    lastTouched:  ${project.lastTouchedAt}`);
  lines.push(
    `  last build:   ${
      build !== undefined
        ? `${build.directiveId} (${build.status}) at ${build.createdAt}`
        : '(no builds yet)'
    }`,
  );
  return { stdout: `${lines.join('\n')}\n`, exitCode: PROJECT_EXIT.OK };
}

// -----------------------------------------------------------------------------
// delete
// -----------------------------------------------------------------------------

export interface ProjectDeleteOptions {
  project: string;
  /** Skip all prompts. Combine with `purge` to also rm-rf without prompts. */
  force?: boolean | undefined;
  /** Also recursively delete the workspace directory. Double-prompted unless `force`. */
  purge?: boolean | undefined;
  /** Override readline. Tests pass a stub returning canned responses. */
  prompt?: (question: string) => Promise<string>;
}

const DEFAULT_PROMPT = async (question: string): Promise<string> => {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
};

export async function runProjectDelete(
  db: Database,
  opts: ProjectDeleteOptions,
): Promise<HandlerResult> {
  const resolved = resolveProjectByRef(db, opts.project, 'delete');
  if ('error' in resolved) {
    return { stdout: resolved.error, exitCode: PROJECT_EXIT.INVALID_INPUT };
  }
  const project = resolved.project;
  const ask = opts.prompt ?? DEFAULT_PROMPT;
  const lines: string[] = [];

  // First confirm — same shape regardless of --purge.
  if (opts.force !== true) {
    const summary =
      opts.purge === true
        ? `factory project delete --purge: WILL UNREGISTER AND RM -RF\n  name:       ${project.name}\n  id:         ${project.id}\n  workspace:  ${project.workspacePath}\n`
        : `factory project delete: about to unregister "${project.name}"\n  id:         ${project.id}\n  workspace:  ${project.workspacePath}\n  workspace files will NOT be deleted (use --purge to also rm -rf)\n`;
    const reply = (await ask(`${summary}Proceed? (y/N) `)).trim().toLowerCase();
    if (reply !== 'y') {
      lines.push('factory project delete: cancelled');
      return { stdout: `${lines.join('\n')}\n`, exitCode: PROJECT_EXIT.OK };
    }
  }

  // Second confirm for --purge — typed-name match. Skipped when --force.
  if (opts.purge === true && opts.force !== true) {
    const reply = (await ask(`Type the project name "${project.name}" to confirm rm -rf: `)).trim();
    if (reply !== project.name) {
      lines.push(
        `factory project delete: name mismatch ("${reply}" != "${project.name}") — cancelled`,
      );
      return { stdout: `${lines.join('\n')}\n`, exitCode: PROJECT_EXIT.OK };
    }
  }

  // Unregister first — keeps the registry consistent if the rm -rf below trips.
  const removed = projectsQ.remove(db, project.id);
  if (removed) {
    lines.push(`factory project delete: ${project.name} unregistered (id ${project.id})`);
  } else {
    // Concurrent delete race — surface but keep going to the purge step.
    lines.push(
      `factory project delete: ${project.name} was already unregistered before the prompt`,
    );
  }

  if (opts.purge === true) {
    try {
      await rm(project.workspacePath, { recursive: true, force: true });
      lines.push(`factory project delete: workspace ${project.workspacePath} purged`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(
        { err, projectId: project.id, workspacePath: project.workspacePath },
        'project delete: rm -rf failed (registry already cleared)',
      );
      lines.push(
        `factory project delete: rm -rf failed: ${msg}\n  registry was already cleared — remove the directory manually if needed`,
      );
      return { stdout: `${lines.join('\n')}\n`, exitCode: PROJECT_EXIT.GENERIC_FAILURE };
    }
  }

  return { stdout: `${lines.join('\n')}\n`, exitCode: PROJECT_EXIT.OK };
}

// -----------------------------------------------------------------------------
// Commander wiring
// -----------------------------------------------------------------------------

async function runWithDb<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const db = openDatabase();
  runMigrations(db);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

export function registerProjectCommand(program: Command): void {
  const project = program
    .command('project')
    .description('per-project introspection + lifecycle (list / show / delete)');

  project
    .command('list')
    .description('walk the registry and print one row per project')
    .addHelpText(
      'after',
      `
Examples:
  factory project list                  # name + status + language + last build + workspace
`,
    )
    .action(async (): Promise<void> => {
      const result = await runWithDb((db) => runProjectList(db));
      stdout.write(result.stdout);
      if (result.exitCode !== PROJECT_EXIT.OK) exit(result.exitCode);
    });

  project
    .command('show <project>')
    .description('pretty-print the registry row + on-disk project.json metadata')
    .addHelpText(
      'after',
      `
Examples:
  factory project show my-app
  factory project show 01KQ…ULID            # resolve by full ULID
`,
    )
    .action(async (projectRef: string): Promise<void> => {
      const result = await runWithDb((db) => runProjectShow(db, { project: projectRef }));
      stdout.write(result.stdout);
      if (result.exitCode !== PROJECT_EXIT.OK) exit(result.exitCode);
    });

  project
    .command('delete <project>')
    .description(
      'unregister a project — prompts by default; --force skips the prompt; --purge also rm-rfs the workspace dir',
    )
    .option('--force', 'skip the interactive confirm', false)
    .option('--purge', 'also recursively delete the workspace directory', false)
    .addHelpText(
      'after',
      `
Examples:
  factory project delete my-app                # interactive y/N, registry only
  factory project delete my-app --force        # skip prompt, registry only
  factory project delete my-app --purge        # double-confirm + rm -rf workspace
  factory project delete my-app --force --purge   # destructive; no prompts
`,
    )
    .action(async (projectRef: string, opts: { force: boolean; purge: boolean }): Promise<void> => {
      const result = await runWithDb((db) =>
        runProjectDelete(db, {
          project: projectRef,
          force: opts.force,
          purge: opts.purge,
        }),
      );
      stdout.write(result.stdout);
      if (result.exitCode !== PROJECT_EXIT.OK) exit(result.exitCode);
    });
}
