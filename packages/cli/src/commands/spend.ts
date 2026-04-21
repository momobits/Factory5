/**
 * `factory spend …` — cross-session spend dashboard (Phase 7b.3).
 *
 *   factory spend
 *     [--group-by project|directive|day|model]  (default: project)
 *     [--since <relative-or-iso>]               (e.g., "7d", "2026-04-01")
 *     [--until <relative-or-iso>]
 *     [--project <name-or-suffix-or-ulid>]
 *     [--limit <n>]                             (default: 50, cap 1000)
 *     [--json]
 *
 * Pulls from the four rollup queries in `@factory5/state` (7b.2) and renders
 * a table or NDJSON. Every view includes a totals line summarising the
 * window's overall spend so operators don't have to sum the rows themselves.
 *
 * Project reference resolution (`--project`) accepts any of:
 *   - Full 26-char ULID (exact match on `projects.id`)
 *   - Project name (exact match on `projects.name`)
 *   - ULID suffix (`8F0M`, matches `projects.id LIKE '%8F0M'`, case-insensitive)
 * Union of the three; an ambiguous ref (e.g. two projects share a basename)
 * errors with a list rather than silently picking one.
 *
 * Relative-duration parser for `--since` / `--until` accepts `<N>[dhm]`
 * (days, hours, minutes). ISO8601 dates / datetimes pass through.
 */

import { exit, stdout } from 'node:process';

import {
  openDatabase,
  runMigrations,
  spend as spendQ,
  type Database,
  type PerDaySpend,
  type PerDirectiveSpend,
  type PerModelSpend,
  type PerProjectSpend,
  type SpendFilter,
} from '@factory5/state';
import type { Command } from 'commander';

export interface HandlerResult {
  stdout: string;
  exitCode: number;
}

export interface SpendCommandOptions {
  groupBy?: string;
  since?: string;
  until?: string;
  project?: string;
  limit?: string;
  json?: boolean;
}

const GROUP_BY_MODES = ['project', 'directive', 'day', 'model'] as const;
type GroupBy = (typeof GROUP_BY_MODES)[number];

function isGroupBy(s: string): s is GroupBy {
  return (GROUP_BY_MODES as readonly string[]).includes(s);
}

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 50;

// -----------------------------------------------------------------------------
// Input parsing
// -----------------------------------------------------------------------------

/**
 * Parse `--since` / `--until`. Accepts either:
 *   - A relative duration: `7d`, `24h`, `30m` → `now - duration` as an ISO string
 *   - An ISO date: `2026-04-21` → `2026-04-21T00:00:00.000Z`
 *   - An ISO datetime: `2026-04-21T14:00:00Z` → pass through (normalised to ms precision)
 *
 * Returns `undefined` for bad input. Callers render an error message keyed
 * on the flag name (`--since` vs `--until`).
 *
 * `now` is injectable for tests so they don't race against wall-clock time.
 */
export function parseWindowArg(raw: string, now: () => number = Date.now): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;

  const relMatch = /^(\d+)([dhm])$/.exec(trimmed);
  if (relMatch !== null) {
    const n = Number.parseInt(relMatch[1] as string, 10);
    if (!Number.isFinite(n) || n < 0) return undefined;
    const unit = relMatch[2] as 'd' | 'h' | 'm';
    const ms = unit === 'd' ? n * 86_400_000 : unit === 'h' ? n * 3_600_000 : n * 60_000;
    return new Date(now() - ms).toISOString();
  }

  // Bare date (`2026-04-21`) — treat as that day's 00:00 UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = Date.parse(`${trimmed}T00:00:00.000Z`);
    if (!Number.isFinite(parsed)) return undefined;
    return new Date(parsed).toISOString();
  }

  // ISO datetime — must contain a 'T' separator so we don't accidentally
  // accept bare numeric strings (`Date.parse('5')` yields year 5 on v8).
  if (trimmed.includes('T')) {
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    return new Date(parsed).toISOString();
  }

  return undefined;
}

/**
 * Resolve `--project` to a ULID. Returns `{ id }` on unique match,
 * `{ error, stdout }` on zero / ambiguous matches.
 */
export function resolveProjectRef(
  db: Database,
  ref: string,
): { id: string } | { error: string; matches?: { id: string; name: string }[] } {
  // Union match: exact id, exact name, or suffix-of-id (case-insensitive via LIKE).
  const rows = db
    .prepare(
      `SELECT id, name FROM projects
         WHERE id = @ref
            OR name = @ref
            OR id LIKE @like`,
    )
    .all({ ref, like: `%${ref}` }) as { id: string; name: string }[];
  if (rows.length === 0) {
    return { error: `factory spend: no project matches "${ref}"\n` };
  }
  if (rows.length > 1) {
    const lines = [
      `factory spend: --project "${ref}" is ambiguous (${String(rows.length)} matches):`,
    ];
    for (const r of rows) {
      lines.push(`  ${spendQ.formatProjectDisplay(r.name, r.id)}    ${r.id}`);
    }
    lines.push('', 'Disambiguate with a full ULID or a unique suffix.', '');
    return { error: `${lines.join('\n')}\n`, matches: rows };
  }
  return { id: rows[0]!.id };
}

function clampLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? String(DEFAULT_LIMIT), 10);
  const n = Number.isFinite(parsed) ? parsed : DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

// -----------------------------------------------------------------------------
// Rendering — tabular
// -----------------------------------------------------------------------------

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

/**
 * Condense an ISO string for tabular output: `2026-04-21T14:00:00.000Z`
 * becomes `2026-04-21 14:00Z`. Preserves full precision in --json mode.
 */
function fmtShortIso(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m === null ? iso : `${m[1] as string} ${m[2] as string}Z`;
}

interface Column<R> {
  header: string;
  value: (row: R) => string;
  /** If true, right-align (for numeric/USD columns). */
  right?: boolean;
}

function renderColumnarTable<R>(rows: R[], cols: Column<R>[], trailingLines: string[]): string {
  const headerCells = cols.map((c) => c.header);
  const valueCells = rows.map((r) => cols.map((c) => c.value(r)));
  const widths = cols.map((_, i) =>
    Math.max(headerCells[i]!.length, ...valueCells.map((v) => v[i]!.length)),
  );
  const fmtRow = (cells: string[]): string =>
    cells
      .map((cell, i) =>
        cols[i]!.right === true ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!),
      )
      .join('  ');

  const lines: string[] = [];
  lines.push(fmtRow(headerCells));
  for (const v of valueCells) lines.push(fmtRow(v));
  for (const t of trailingLines) lines.push(t);
  return `${lines.join('\n')}\n`;
}

function renderProjectTable(rows: PerProjectSpend[]): string {
  if (rows.length === 0) return '(no spend in this window)\n';
  const total = rows.reduce((a, r) => a + r.totalUsd, 0);
  const calls = rows.reduce((a, r) => a + r.callCount, 0);
  const cols: Column<PerProjectSpend>[] = [
    { header: 'PROJECT', value: (r) => r.display },
    { header: 'N_DIR', value: (r) => String(r.directiveCount), right: true },
    { header: 'N_CALL', value: (r) => String(r.callCount), right: true },
    { header: 'SPENT', value: (r) => fmtUsd(r.totalUsd), right: true },
  ];
  return renderColumnarTable(rows, cols, [
    '',
    `TOTAL  ${String(calls)} call${calls === 1 ? '' : 's'}  ${fmtUsd(total)}`,
  ]);
}

function renderDirectiveTable(rows: PerDirectiveSpend[]): string {
  if (rows.length === 0) return '(no spend in this window)\n';
  const total = rows.reduce((a, r) => a + r.totalUsd, 0);
  const calls = rows.reduce((a, r) => a + r.callCount, 0);
  const cols: Column<PerDirectiveSpend>[] = [
    { header: 'DIRECTIVE', value: (r) => r.directiveId },
    {
      header: 'PROJECT',
      value: (r) => spendQ.formatProjectDisplay(r.projectName, r.projectId),
    },
    { header: 'N_CALL', value: (r) => String(r.callCount), right: true },
    { header: 'FIRST', value: (r) => fmtShortIso(r.firstCalledAt) },
    { header: 'LAST', value: (r) => fmtShortIso(r.lastCalledAt) },
    { header: 'SPENT', value: (r) => fmtUsd(r.totalUsd), right: true },
  ];
  return renderColumnarTable(rows, cols, [
    '',
    `TOTAL  ${String(calls)} call${calls === 1 ? '' : 's'}  ${fmtUsd(total)}`,
  ]);
}

function renderDayTable(rows: PerDaySpend[]): string {
  if (rows.length === 0) return '(no spend in this window)\n';
  const total = rows.reduce((a, r) => a + r.totalUsd, 0);
  const calls = rows.reduce((a, r) => a + r.callCount, 0);
  const cols: Column<PerDaySpend>[] = [
    { header: 'DATE', value: (r) => r.date },
    { header: 'N_CALL', value: (r) => String(r.callCount), right: true },
    { header: 'SPENT', value: (r) => fmtUsd(r.totalUsd), right: true },
  ];
  return renderColumnarTable(rows, cols, [
    '',
    `TOTAL  ${String(calls)} call${calls === 1 ? '' : 's'}  ${fmtUsd(total)}`,
  ]);
}

function renderModelTable(rows: PerModelSpend[]): string {
  if (rows.length === 0) return '(no spend in this window)\n';
  const total = rows.reduce((a, r) => a + r.totalUsd, 0);
  const calls = rows.reduce((a, r) => a + r.callCount, 0);
  const cols: Column<PerModelSpend>[] = [
    { header: 'PROVIDER/MODEL', value: (r) => `${r.provider}/${r.model}` },
    { header: 'N_CALL', value: (r) => String(r.callCount), right: true },
    { header: 'SPENT', value: (r) => fmtUsd(r.totalUsd), right: true },
  ];
  return renderColumnarTable(rows, cols, [
    '',
    `TOTAL  ${String(calls)} call${calls === 1 ? '' : 's'}  ${fmtUsd(total)}`,
  ]);
}

// -----------------------------------------------------------------------------
// Rendering — NDJSON
// -----------------------------------------------------------------------------

/**
 * NDJSON emits one object per row, nothing else. Totals are derivable by
 * scripts via `jq 'map(.totalUsd) | add'`; an extra totals line would
 * force consumers to pattern-match a discriminator.
 */
function renderNdjson<T>(rows: T[]): string {
  if (rows.length === 0) return '';
  return `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

/**
 * Pure handler — open-and-close DB lifecycle owned by caller. Tests drive
 * it directly against an in-memory DB, same pattern as findings.ts.
 *
 * Exit codes:
 *   0 — success (including empty result sets — not an error)
 *   2 — invalid input (bad --group-by, bad --since/--until, unknown/ambiguous --project)
 */
export function runSpend(
  db: Database,
  opts: SpendCommandOptions,
  now: () => number = Date.now,
): HandlerResult {
  const groupBy = opts.groupBy ?? 'project';
  if (!isGroupBy(groupBy)) {
    return {
      stdout: `factory spend: invalid --group-by "${groupBy}" (expected: ${GROUP_BY_MODES.join(' | ')})\n`,
      exitCode: 2,
    };
  }

  const filter: SpendFilter = {};

  if (opts.since !== undefined) {
    const iso = parseWindowArg(opts.since, now);
    if (iso === undefined) {
      return {
        stdout: `factory spend: invalid --since "${opts.since}" (expected relative "<N>[dhm]" or ISO8601)\n`,
        exitCode: 2,
      };
    }
    filter.since = iso;
  }
  if (opts.until !== undefined) {
    const iso = parseWindowArg(opts.until, now);
    if (iso === undefined) {
      return {
        stdout: `factory spend: invalid --until "${opts.until}" (expected relative "<N>[dhm]" or ISO8601)\n`,
        exitCode: 2,
      };
    }
    filter.until = iso;
  }
  if (opts.project !== undefined) {
    const resolved = resolveProjectRef(db, opts.project);
    if ('error' in resolved) {
      return { stdout: resolved.error, exitCode: 2 };
    }
    filter.projectId = resolved.id;
  }

  const limit = clampLimit(opts.limit);

  switch (groupBy) {
    case 'project': {
      const rows = spendQ.perProject(db, filter).slice(0, limit);
      return {
        stdout: opts.json === true ? renderNdjson(rows) : renderProjectTable(rows),
        exitCode: 0,
      };
    }
    case 'directive': {
      const rows = spendQ.perDirective(db, filter).slice(0, limit);
      return {
        stdout: opts.json === true ? renderNdjson(rows) : renderDirectiveTable(rows),
        exitCode: 0,
      };
    }
    case 'day': {
      const rows = spendQ.perDay(db, filter).slice(0, limit);
      return {
        stdout: opts.json === true ? renderNdjson(rows) : renderDayTable(rows),
        exitCode: 0,
      };
    }
    case 'model': {
      const rows = spendQ.perModel(db, filter).slice(0, limit);
      return {
        stdout: opts.json === true ? renderNdjson(rows) : renderModelTable(rows),
        exitCode: 0,
      };
    }
  }
}

// -----------------------------------------------------------------------------
// Commander wiring
// -----------------------------------------------------------------------------

function runWithDb<T>(fn: (db: Database) => T): T {
  const db = openDatabase();
  runMigrations(db);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function registerSpendCommand(program: Command): void {
  program
    .command('spend')
    .description(
      'cross-session spend dashboard — per-project / per-directive / per-day / per-model',
    )
    .option('--group-by <mode>', `how to roll up rows: ${GROUP_BY_MODES.join(' | ')}`, 'project')
    .option('--since <time>', 'earliest called_at (relative "<N>[dhm]" or ISO8601)')
    .option('--until <time>', 'latest called_at (exclusive; relative or ISO8601)')
    .option('--project <ref>', 'name, ULID, or id-suffix of a single project')
    .option(
      '--limit <n>',
      `max rows to show (capped at ${String(MAX_LIMIT)})`,
      String(DEFAULT_LIMIT),
    )
    .option('--json', 'emit NDJSON instead of a table')
    .action((opts: SpendCommandOptions) => {
      const result = runWithDb((db) => runSpend(db, opts));
      stdout.write(result.stdout);
      if (result.exitCode !== 0) exit(result.exitCode);
    });
}
