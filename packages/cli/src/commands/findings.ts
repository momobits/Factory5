/**
 * `factory findings …` — cross-project findings registry surface
 * (Phase 6a). Today's subcommands:
 *
 *   factory findings list
 *     [--severity LOW|MEDIUM|HIGH|CRITICAL]
 *     [--status OPEN|FIXED|VERIFIED|WONTFIX]       (default: OPEN)
 *     [--project <name-or-glob>]
 *     [--advisory | --blocking]                    (default: --blocking)
 *     [--limit <n>]                                (default: 50, cap 1000)
 *     [--json]
 *
 * Tabular by default; `--json` emits NDJSON so scripts can pipe.
 * `--project` accepts a bare name (exact match) or a glob with `*` /
 * `?` wildcards (translated to SQL LIKE).
 *
 * The `show <id>` subcommand lands in step 6a.4; the backfill
 * subcommand in 6a.5. Both hang off the same `findings` group and
 * will share the `openDatabase()` + `runMigrations()` pattern below.
 */

import { exit, stdout } from 'node:process';

import {
  findingsRegistry,
  openDatabase,
  runMigrations,
  type FindingsRegistryEntry,
  type FindingsRegistryListFilter,
} from '@factory5/state';
import type { Command } from 'commander';

interface ListCommandOptions {
  severity?: string;
  status?: string;
  project?: string;
  advisory?: boolean;
  blocking?: boolean;
  limit?: string;
  json?: boolean;
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
    .action((opts: ListCommandOptions) => {
      // Validate enums up-front so we don't silently send invalid values to SQL.
      if (opts.severity !== undefined && !isSeverity(opts.severity)) {
        stdout.write(`factory findings list: invalid --severity "${opts.severity}"\n`);
        exit(2);
      }
      if (opts.status !== undefined && opts.status !== 'all' && !isStatus(opts.status)) {
        stdout.write(`factory findings list: invalid --status "${opts.status}"\n`);
        exit(2);
      }

      const limit = Math.max(1, Number.parseInt(opts.limit ?? '50', 10) || 50);

      // Advisory resolution: explicit --advisory wins, otherwise default
      // to blocking-only per steps.md §6a.3. If the user sets both flags
      // we treat that as "don't filter on advisory" — both shown.
      let advisoryFilter: boolean | undefined;
      if (opts.advisory === true && opts.blocking === true) advisoryFilter = undefined;
      else if (opts.advisory === true) advisoryFilter = true;
      else advisoryFilter = false;

      const filter: FindingsRegistryListFilter = {
        ...(opts.severity !== undefined ? { severity: opts.severity as Severity } : {}),
        ...(opts.status !== undefined && opts.status !== 'all'
          ? { status: opts.status as Status }
          : {}),
        ...(opts.project !== undefined ? { project: opts.project } : {}),
        ...(advisoryFilter !== undefined ? { advisory: advisoryFilter } : {}),
        limit,
      };

      const db = openDatabase();
      try {
        runMigrations(db);
        const rows = findingsRegistry.list(db, filter);
        stdout.write(opts.json === true ? renderNdjson(rows) : renderTable(rows));
      } finally {
        db.close();
      }
    });
}
