/**
 * `factory findings …` — cross-project findings registry surface
 * (Phase 6a). Subcommands:
 *
 *   factory findings list
 *     [--severity LOW|MEDIUM|HIGH|CRITICAL]
 *     [--status OPEN|FIXED|VERIFIED|WONTFIX]       (default: OPEN)
 *     [--project <name-or-glob>]
 *     [--advisory | --blocking]                    (default: --blocking)
 *     [--limit <n>]                                (default: 50, cap 1000)
 *     [--json]
 *
 *   factory findings show <project>/<id>
 *   factory findings show <id>                     (if unambiguous)
 *     [--json]
 *
 *   factory findings backfill
 *     [--workspace <path>]                         (default: ~/factory5-workspace)
 *     [--dry-run]
 *
 *   factory findings mark <project>/<id> <status>
 *   factory findings mark <id> <status>            (if unambiguous; Tier 7)
 *     [--note <prose>]
 *
 * Tabular by default; `--json` emits NDJSON (list) or a single JSON
 * object (show). `--project` accepts a bare name (exact match) or a
 * glob with `*` / `?` wildcards (translated to SQL LIKE).
 *
 * The backfill subcommand walks `<workspace>/<project>/.factory/findings.json`
 * one level deep and upserts each finding into the registry — idempotent
 * by the composite PK `(project_id, finding_id)`.
 *
 * The mark subcommand is the operator-side parallel to Tier 6 step 6.3's
 * agent-side `RESOLUTION` parser — it wraps the same `updateFindingStatus`
 * API the parser dispatches.
 *
 * Testability: each subcommand's logic is a pure async `run*` function
 * that takes a `Database` + opts and returns `{ stdout, exitCode }`.
 * The Commander `.action()` callbacks are thin wrappers that open the
 * DB, call the handler, write stdout, and exit on non-zero. Tests
 * import the handlers directly and drive them against an in-memory
 * DB — see `findings.test.ts`.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { exit, stdout } from 'node:process';

import { findingSchema, type Finding } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import {
  findingsRegistry,
  openDatabase,
  runMigrations,
  type Database,
  type FindingsRegistryEntry,
  type FindingsRegistryListFilter,
} from '@factory5/state';
import {
  ProjectMetadataCorruptError,
  readProjectMetadata,
  updateFindingStatus,
  type FindingRegistryBinding,
} from '@factory5/wiki';
import type { Command } from 'commander';

const log = createLogger('cli.findings');

export interface HandlerResult {
  stdout: string;
  exitCode: number;
}

// -----------------------------------------------------------------------------
// Option types + validation
// -----------------------------------------------------------------------------

export interface ListCommandOptions {
  severity?: string;
  status?: string;
  project?: string;
  advisory?: boolean;
  blocking?: boolean;
  limit?: string;
  json?: boolean;
}

export interface ShowCommandOptions {
  json?: boolean;
}

export interface BackfillCommandOptions {
  workspace?: string;
  dryRun?: boolean;
}

export interface MarkCommandOptions {
  note?: string;
}

const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const STATUSES = ['OPEN', 'FIXED', 'VERIFIED', 'WONTFIX'] as const;

type Severity = (typeof SEVERITIES)[number];
type Status = (typeof STATUSES)[number];

function isSeverity(s: string): s is Severity {
  return (SEVERITIES as readonly string[]).includes(s);
}

function isStatus(s: string): s is Status {
  return (STATUSES as readonly string[]).includes(s);
}

// -----------------------------------------------------------------------------
// Rendering helpers
// -----------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function firstLine(s: string): string {
  const nl = s.indexOf('\n');
  return nl === -1 ? s : s.slice(0, nl);
}

function severityBadge(e: FindingsRegistryEntry): string {
  return e.finding.advisory === true ? `[adv]${e.finding.severity}` : e.finding.severity;
}

function renderTable(rows: FindingsRegistryEntry[]): string {
  if (rows.length === 0) return '  (no findings match)\n';
  const header = {
    project: 'project',
    id: 'id',
    severity: 'severity',
    status: 'status',
    source: 'source',
    target: 'target',
    description: 'description',
  };
  const records = rows.map((e) => ({
    project: e.projectId,
    id: e.finding.id,
    severity: severityBadge(e),
    status: e.finding.status,
    source: e.finding.source,
    target: truncate(e.finding.target, 24),
    description: truncate(firstLine(e.finding.description), 80),
  }));
  const widths = {
    project: Math.max(header.project.length, ...records.map((r) => r.project.length)),
    id: Math.max(header.id.length, ...records.map((r) => r.id.length)),
    severity: Math.max(header.severity.length, ...records.map((r) => r.severity.length)),
    status: Math.max(header.status.length, ...records.map((r) => r.status.length)),
    source: Math.max(header.source.length, ...records.map((r) => r.source.length)),
    target: Math.max(header.target.length, ...records.map((r) => r.target.length)),
  };
  const line = (r: typeof header): string =>
    [
      r.project.padEnd(widths.project),
      r.id.padEnd(widths.id),
      r.severity.padEnd(widths.severity),
      r.status.padEnd(widths.status),
      r.source.padEnd(widths.source),
      r.target.padEnd(widths.target),
      r.description,
    ].join('  ');
  const out: string[] = [];
  out.push(line(header));
  for (const r of records) out.push(line(r));
  out.push(`\n(${String(records.length)} finding${records.length === 1 ? '' : 's'})`);
  return `${out.join('\n')}\n`;
}

function renderNdjson(rows: FindingsRegistryEntry[]): string {
  return rows
    .map((e) =>
      JSON.stringify({
        projectId: e.projectId,
        projectPath: e.projectPath,
        updatedAt: e.updatedAt,
        ...(e.originDirectiveId !== undefined ? { originDirectiveId: e.originDirectiveId } : {}),
        finding: e.finding,
      }),
    )
    .join('\n')
    .concat('\n');
}

function renderFindingDetail(e: FindingsRegistryEntry): string {
  const f = e.finding;
  const advisory = f.advisory === true ? 'yes (ADR 0018 — does not contribute to gate)' : 'no';
  const rows: Array<[string, string]> = [
    ['Project', e.projectId],
    ['Path', e.projectPath],
    ['Finding', f.id],
    ['Severity', f.severity],
    ['Status', f.status],
    ['Source', f.source],
    ['Target', f.target],
    ['Advisory', advisory],
    ['Directive', e.originDirectiveId ?? '(unrecorded)'],
    ['Created', f.createdAt],
    ['Updated', e.updatedAt],
    ['Resolved', f.resolvedAt ?? '-'],
  ];
  const labelWidth = Math.max(...rows.map(([k]) => k.length));
  const header = rows.map(([k, v]) => `${`${k}:`.padEnd(labelWidth + 2)}${v}`).join('\n');
  const description = f.description.trim().length > 0 ? f.description.trim() : '(none)';
  const resolution = f.resolution !== undefined ? f.resolution.trim() : '(unresolved)';
  const indent = (block: string): string =>
    block
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');
  return `${header}\n\nDescription:\n${indent(description)}\n\nResolution:\n${indent(resolution)}\n`;
}

function renderShowJson(e: FindingsRegistryEntry): string {
  return `${JSON.stringify(
    {
      projectId: e.projectId,
      projectPath: e.projectPath,
      updatedAt: e.updatedAt,
      ...(e.originDirectiveId !== undefined ? { originDirectiveId: e.originDirectiveId } : {}),
      finding: e.finding,
    },
    null,
    2,
  )}\n`;
}

function renderAmbiguity(findingId: string, matches: FindingsRegistryEntry[]): string {
  const lines: string[] = [
    `factory findings show: ${findingId} exists in ${String(matches.length)} projects:`,
  ];
  const projectWidth = Math.max(7, ...matches.map((m) => m.projectId.length));
  for (const m of matches) {
    lines.push(
      `  ${m.projectId.padEnd(projectWidth)}  ` +
        `${m.finding.status.padEnd(8)}  ` +
        `${(m.finding.advisory === true ? `[adv]${m.finding.severity}` : m.finding.severity).padEnd(14)}  ` +
        `${m.finding.source}`,
    );
  }
  lines.push('', `Disambiguate with \`factory findings show <project>/${findingId}\`.`, '');
  return `${lines.join('\n')}\n`;
}

// -----------------------------------------------------------------------------
// Handlers — pure, testable, do not touch process.exit or stdout directly.
// -----------------------------------------------------------------------------

/**
 * `factory findings list` handler. Returns rendered stdout + exit code.
 * `exitCode === 2` on invalid input (bad --severity / --status). Does
 * not open or close the DB — the caller owns the lifecycle.
 */
export function runFindingsList(db: Database, opts: ListCommandOptions): HandlerResult {
  if (opts.severity !== undefined && !isSeverity(opts.severity)) {
    return {
      stdout: `factory findings list: invalid --severity "${opts.severity}"\n`,
      exitCode: 2,
    };
  }
  // Default status is 'OPEN' per steps.md §6a.3. The CLI Commander layer
  // also passes 'OPEN' as its default, so in practice opts.status is
  // always set when invoked from the shell; defaulting here keeps the
  // handler's contract honest for direct callers (tests, future
  // programmatic callers) without relying on Commander wiring.
  const statusArg = opts.status ?? 'OPEN';
  if (statusArg !== 'all' && !isStatus(statusArg)) {
    return {
      stdout: `factory findings list: invalid --status "${statusArg}"\n`,
      exitCode: 2,
    };
  }

  const limit = Math.max(1, Number.parseInt(opts.limit ?? '50', 10) || 50);

  // Advisory resolution: explicit --advisory wins, otherwise default to
  // blocking-only per steps.md §6a.3. Both flags set → don't filter on
  // advisory (show everything).
  let advisoryFilter: boolean | undefined;
  if (opts.advisory === true && opts.blocking === true) advisoryFilter = undefined;
  else if (opts.advisory === true) advisoryFilter = true;
  else advisoryFilter = false;

  const filter: FindingsRegistryListFilter = {
    ...(opts.severity !== undefined ? { severity: opts.severity as Severity } : {}),
    ...(statusArg !== 'all' ? { status: statusArg as Status } : {}),
    ...(opts.project !== undefined ? { project: opts.project } : {}),
    ...(advisoryFilter !== undefined ? { advisory: advisoryFilter } : {}),
    limit,
  };

  const rows = findingsRegistry.list(db, filter);
  return {
    stdout: opts.json === true ? renderNdjson(rows) : renderTable(rows),
    exitCode: 0,
  };
}

/**
 * `factory findings show <id>` handler. `exitCode === 2` for
 * not-found / ambiguous-bare-id cases; `stdout` explains.
 */
export function runFindingsShow(
  db: Database,
  rawId: string,
  opts: ShowCommandOptions,
): HandlerResult {
  const { projectId, findingId } = splitShowArg(rawId);
  if (projectId !== undefined) {
    const entry = findingsRegistry.getByProjectAndId(db, projectId, findingId);
    if (entry === undefined) {
      return {
        stdout: `factory findings show: no finding ${findingId} in project "${projectId}"\n`,
        exitCode: 2,
      };
    }
    return {
      stdout: opts.json === true ? renderShowJson(entry) : renderFindingDetail(entry),
      exitCode: 0,
    };
  }
  const matches = findingsRegistry.findByFindingId(db, findingId);
  if (matches.length === 0) {
    return {
      stdout: `factory findings show: no finding with id "${findingId}"\n`,
      exitCode: 2,
    };
  }
  if (matches.length > 1) {
    return { stdout: renderAmbiguity(findingId, matches), exitCode: 2 };
  }
  const only = matches[0]!;
  return {
    stdout: opts.json === true ? renderShowJson(only) : renderFindingDetail(only),
    exitCode: 0,
  };
}

/**
 * `factory findings mark <id> <status>` handler. Wraps
 * {@link updateFindingStatus} from `@factory5/wiki` — the same API the
 * agent-side `RESOLUTION` parser dispatches (Tier 6 step 6.3). Resolves
 * `<id>` the same way `runFindingsShow` does: `<project>/<id>` form takes
 * the explicit project; bare `<id>` must be unambiguous across the
 * registry. Status normalization is case-insensitive on input; rendered
 * output uses upper-case to match the rest of the surface.
 *
 * `--note <prose>` flows through to `resolution`, mirroring how the
 * parser populates it from `RESOLUTION` marker prose.
 *
 * Exit codes: `0` success, `1` runtime error (registry/on-disk drift —
 * `updateFindingStatus` throws on a missing finding-id row in
 * `findings.json` even when the registry says otherwise), `2` invalid
 * status / not-found / ambiguous-bare-id.
 */
export async function runFindingsMark(
  db: Database,
  rawId: string,
  rawStatus: string,
  opts: MarkCommandOptions,
): Promise<HandlerResult> {
  const status = rawStatus.toUpperCase();
  if (!isStatus(status)) {
    return {
      stdout: `factory findings mark: invalid status "${rawStatus}" — expected one of: ${STATUSES.join(' | ')}\n`,
      exitCode: 2,
    };
  }
  const { projectId, findingId } = splitShowArg(rawId);

  let entry: FindingsRegistryEntry;
  if (projectId !== undefined) {
    const found = findingsRegistry.getByProjectAndId(db, projectId, findingId);
    if (found === undefined) {
      return {
        stdout: `factory findings mark: no finding ${findingId} in project "${projectId}"\n`,
        exitCode: 2,
      };
    }
    entry = found;
  } else {
    const matches = findingsRegistry.findByFindingId(db, findingId);
    if (matches.length === 0) {
      return {
        stdout: `factory findings mark: no finding with id "${findingId}"\n`,
        exitCode: 2,
      };
    }
    if (matches.length > 1) {
      return { stdout: renderAmbiguity(findingId, matches), exitCode: 2 };
    }
    entry = matches[0]!;
  }

  const prevStatus = entry.finding.status;
  const registry: FindingRegistryBinding = { db, projectId: entry.projectId };
  try {
    const updated = await updateFindingStatus(
      entry.projectPath,
      entry.finding.id,
      status,
      opts.note,
      registry,
    );
    return {
      stdout: `${updated.id} in ${entry.projectId}: ${prevStatus} → ${updated.status}\n`,
      exitCode: 0,
    };
  } catch (err) {
    return {
      stdout: `factory findings mark: ${(err as Error).message}\n`,
      exitCode: 1,
    };
  }
}

/**
 * `factory findings backfill` handler. Walks
 * `<workspace>/<project>/.factory/findings.json` one level deep and
 * upserts every finding. Best-effort per project — one bad file does
 * not abort the whole run; `exitCode === 1` if any errors surfaced.
 * Workspace-not-readable is a fatal input error (`exitCode === 2`).
 */
export async function runFindingsBackfill(
  db: Database,
  opts: BackfillCommandOptions,
): Promise<HandlerResult> {
  const workspace = resolveWorkspace(opts.workspace);
  const dryRun = opts.dryRun === true;
  let entries: string[];
  try {
    entries = await readdir(workspace);
  } catch (err) {
    return {
      stdout: `factory findings backfill: workspace "${workspace}" not readable: ${(err as Error).message}\n`,
      exitCode: 2,
    };
  }

  const summary: BackfillSummary = {
    projectsScanned: 0,
    projectsWithFindings: 0,
    imported: 0,
    updated: 0,
    errors: 0,
    skipped: [],
    byProject: new Map(),
  };

  for (const name of entries.sort()) {
    const projectPath = join(workspace, name);
    const projectStat = await stat(projectPath).catch(() => undefined);
    if (projectStat === undefined || !projectStat.isDirectory()) continue;
    summary.projectsScanned++;

    const findingsPath = join(projectPath, '.factory', 'findings.json');
    const loaded = await loadFindingsFile(findingsPath);
    if (loaded === 'missing') continue;
    if (loaded === 'invalid') {
      summary.errors++;
      log.warn({ projectPath, findingsPath }, 'backfill: findings.json unreadable or invalid');
      continue;
    }
    summary.projectsWithFindings++;

    // Resolve project identity from `.factory/project.json` (ADR 0021).
    // The backfill never silently re-tags: if the identity file is missing
    // we skip the project (the operator should run `factory build` once to
    // claim identity); if it is corrupt we surface that loudly.
    let projectId: string;
    let projectName: string;
    try {
      const meta = await readProjectMetadata(projectPath);
      if (meta === undefined) {
        summary.skipped.push({
          projectPath,
          reason: 'no .factory/project.json — run `factory build` here once to claim identity',
        });
        log.info({ projectPath }, 'backfill: skipping — no project identity file (ADR 0021)');
        continue;
      }
      projectId = meta.id;
      projectName = meta.name;
    } catch (err) {
      if (err instanceof ProjectMetadataCorruptError) {
        summary.errors++;
        log.warn(
          { err, projectPath, filePath: err.filePath },
          'backfill: project.json corrupt — refusing to silently re-tag',
        );
        continue;
      }
      throw err;
    }

    const counters = { imported: 0, updated: 0 };
    for (const finding of loaded) {
      const existing = findingsRegistry.getByProjectAndId(db, projectId, finding.id);
      if (!dryRun) {
        findingsRegistry.upsert(db, {
          projectId,
          projectPath,
          finding,
          updatedAt: new Date().toISOString(),
        });
      }
      if (existing === undefined) {
        summary.imported++;
        counters.imported++;
      } else {
        summary.updated++;
        counters.updated++;
      }
    }
    summary.byProject.set(projectName, counters);
  }

  return {
    stdout: renderBackfillSummary(workspace, summary, dryRun),
    exitCode: summary.errors > 0 ? 1 : 0,
  };
}

interface BackfillSummary {
  projectsScanned: number;
  projectsWithFindings: number;
  imported: number;
  updated: number;
  errors: number;
  /** Projects skipped because identity could not be resolved (ADR 0021). */
  skipped: { projectPath: string; reason: string }[];
  byProject: Map<string, { imported: number; updated: number }>;
}

function resolveWorkspace(raw: string | undefined): string {
  const base = raw ?? join(homedir(), 'factory5-workspace');
  if (base.startsWith('~/') || base === '~') {
    return join(homedir(), base.slice(2));
  }
  return base;
}

async function loadFindingsFile(path: string): Promise<Finding[] | 'missing' | 'invalid'> {
  try {
    await stat(path);
  } catch {
    return 'missing';
  }
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return 'invalid';
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('findings' in parsed)) {
      return 'invalid';
    }
    const arr = (parsed as { findings: unknown }).findings;
    if (!Array.isArray(arr)) return 'invalid';
    return arr.map((f) => findingSchema.parse(f));
  } catch {
    return 'invalid';
  }
}

function renderBackfillSummary(workspace: string, s: BackfillSummary, dryRun: boolean): string {
  const verb = dryRun ? 'would import' : 'imported';
  const verbUpd = dryRun ? 'would update' : 'updated';
  const lines: string[] = [];
  lines.push(`factory findings backfill — workspace: ${workspace}${dryRun ? ' (dry-run)' : ''}`);
  const skippedSuffix = s.skipped.length > 0 ? `; ${String(s.skipped.length)} skipped` : '';
  lines.push(
    `  ${String(s.projectsScanned)} dir(s) scanned; ` +
      `${String(s.projectsWithFindings)} with findings.json; ` +
      `${String(s.errors)} error(s)` +
      skippedSuffix,
  );
  if (s.projectsWithFindings === 0 && s.skipped.length === 0) return `${lines.join('\n')}\n`;
  if (s.byProject.size > 0) {
    lines.push(`  ${verb} ${String(s.imported)}; ${verbUpd} ${String(s.updated)}`, '');
    const projectWidth = Math.max(7, ...[...s.byProject.keys()].map((k) => k.length));
    for (const [projectName, counters] of s.byProject) {
      lines.push(
        `    ${projectName.padEnd(projectWidth)}  +${String(counters.imported)} imported  ~${String(counters.updated)} updated`,
      );
    }
  }
  if (s.skipped.length > 0) {
    lines.push('', '  skipped (no identity file — see ADR 0021):');
    for (const { projectPath, reason } of s.skipped) {
      lines.push(`    ${projectPath}  — ${reason}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function splitShowArg(raw: string): { projectId?: string; findingId: string } {
  const slash = raw.indexOf('/');
  if (slash === -1) return { findingId: raw };
  return { projectId: raw.slice(0, slash), findingId: raw.slice(slash + 1) };
}

// -----------------------------------------------------------------------------
// Commander wiring — thin wrappers that open the DB and route to handlers.
// -----------------------------------------------------------------------------

function runWithDb<T>(fn: (db: Database) => T | Promise<T>): Promise<T> | T {
  const db = openDatabase();
  runMigrations(db);
  try {
    const result = fn(db);
    if (result instanceof Promise) {
      return result.finally(() => {
        db.close();
      });
    }
    db.close();
    return result;
  } catch (err) {
    db.close();
    throw err;
  }
}

export function registerFindingsCommand(program: Command): void {
  const group = program
    .command('findings')
    .description('cross-project findings registry (Phase 6a)');

  group
    .command('list')
    .description('list findings across every project factory has touched')
    .option('--severity <level>', 'filter by severity (LOW|MEDIUM|HIGH|CRITICAL)')
    .option('--status <status>', 'filter by status (OPEN|FIXED|VERIFIED|WONTFIX)', 'OPEN')
    .option('--project <name-or-glob>', 'exact project id, or glob with * and ?')
    .option('--advisory', 'show advisory findings only (ADR 0018)')
    .option('--blocking', 'show blocking findings only (default)')
    .option('--limit <n>', 'max rows to show (capped at 1000)', '50')
    .option('--json', 'emit NDJSON instead of a table')
    .addHelpText(
      'after',
      `
Examples:
  factory findings list                                  # OPEN blocking findings
  factory findings list --severity HIGH
  factory findings list --status all --project my-app
  factory findings list --advisory --json | jq '.finding.id'
`,
    )
    .action((opts: ListCommandOptions) => {
      const result = runWithDb((db) => runFindingsList(db, opts)) as HandlerResult;
      stdout.write(result.stdout);
      if (result.exitCode !== 0) exit(result.exitCode);
    });

  group
    .command('backfill')
    .description(
      'walk <workspace>/<project>/.factory/findings.json and upsert every finding into the registry',
    )
    .option(
      '--workspace <path>',
      'workspace root holding <project> subdirs (default: ~/factory5-workspace)',
    )
    .option('--dry-run', 'report what would change without writing to the registry')
    .addHelpText(
      'after',
      `
Examples:
  factory findings backfill                              # default ~/factory5-workspace
  factory findings backfill --workspace /work --dry-run
  factory findings backfill --workspace ~/projects
`,
    )
    .action(async (opts: BackfillCommandOptions) => {
      const result = (await runWithDb((db) => runFindingsBackfill(db, opts))) as HandlerResult;
      stdout.write(result.stdout);
      if (result.exitCode !== 0) exit(result.exitCode);
    });

  group
    .command('show <id>')
    .description(
      'show a single finding in full. <id> is either "<project>/F001" or bare "F001" (must be unambiguous)',
    )
    .option('--json', 'emit one JSON object instead of formatted text')
    .addHelpText(
      'after',
      `
Examples:
  factory findings show my-app/F003
  factory findings show F003                             # if unambiguous
  factory findings show my-app/F003 --json
`,
    )
    .action((rawId: string, opts: ShowCommandOptions) => {
      const result = runWithDb((db) => runFindingsShow(db, rawId, opts)) as HandlerResult;
      stdout.write(result.stdout);
      if (result.exitCode !== 0) exit(result.exitCode);
    });

  group
    .command('mark <id> <status>')
    .description(
      'flip a finding status (OPEN|FIXED|VERIFIED|WONTFIX). <id> is "<project>/F001" or bare "F001" (must be unambiguous)',
    )
    .option('--note <prose>', "resolution note (recorded as the finding's `resolution` string)")
    .addHelpText(
      'after',
      `
Examples:
  factory findings mark my-app/F001 FIXED
  factory findings mark F001 WONTFIX --note "duplicate of F042"
  factory findings mark F003 verified                    # status is case-insensitive

Exit codes: 0 success, 1 runtime error (registry/on-disk drift), 2 invalid status / not found / ambiguous bare id.
`,
    )
    .action(async (rawId: string, rawStatus: string, opts: MarkCommandOptions) => {
      const result = (await runWithDb((db) =>
        runFindingsMark(db, rawId, rawStatus, opts),
      )) as HandlerResult;
      stdout.write(result.stdout);
      if (result.exitCode !== 0) exit(result.exitCode);
    });
}
