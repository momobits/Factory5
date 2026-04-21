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
 *   factory findings show <project>/<id>
 *   factory findings show <id>                     (if unambiguous)
 *     [--json]
 *
 * Tabular by default; `--json` emits NDJSON (list) or a single JSON
 * object (show). `--project` accepts a bare name (exact match) or a
 * glob with `*` / `?` wildcards (translated to SQL LIKE).
 *
 * The backfill subcommand lands in step 6a.5; it hangs off the same
 * `findings` group and reuses the `openDatabase()` + `runMigrations()`
 * pattern below.
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

interface ShowCommandOptions {
  json?: boolean;
}

function splitShowArg(raw: string): { projectId?: string; findingId: string } {
  const slash = raw.indexOf('/');
  if (slash === -1) return { findingId: raw };
  return { projectId: raw.slice(0, slash), findingId: raw.slice(slash + 1) };
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
  const header = rows.map(([k, v]) => `${(`${k}:`).padEnd(labelWidth + 2)}${v}`).join('\n');
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
  lines.push(
    '',
    `Disambiguate with \`factory findings show <project>/${findingId}\`.`,
    '',
  );
  return `${lines.join('\n')}\n`;
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

  group
    .command('show <id>')
    .description(
      'show a single finding in full. <id> is either "<project>/F001" or bare "F001" (must be unambiguous)',
    )
    .option('--json', 'emit one JSON object instead of formatted text')
    .action((rawId: string, opts: ShowCommandOptions) => {
      const { projectId, findingId } = splitShowArg(rawId);
      const db = openDatabase();
      try {
        runMigrations(db);
        if (projectId !== undefined) {
          const entry = findingsRegistry.getByProjectAndId(db, projectId, findingId);
          if (entry === undefined) {
            stdout.write(
              `factory findings show: no finding ${findingId} in project "${projectId}"\n`,
            );
            exit(2);
          }
          stdout.write(opts.json === true ? renderShowJson(entry) : renderFindingDetail(entry));
          return;
        }
        // Bare id path — resolve across all projects; require exactly one match.
        const matches = findingsRegistry.findByFindingId(db, findingId);
        if (matches.length === 0) {
          stdout.write(`factory findings show: no finding with id "${findingId}"\n`);
          exit(2);
        }
        if (matches.length > 1) {
          stdout.write(renderAmbiguity(findingId, matches));
          exit(2);
        }
        const only = matches[0]!;
        stdout.write(opts.json === true ? renderShowJson(only) : renderFindingDetail(only));
      } finally {
        db.close();
      }
    });
}
