/**
 * Cross-session spend aggregation queries over `model_usage`.
 *
 * Phase 7b.2 — powers the `factory spend` CLI subcommand in 7b.3. Five
 * rollup shapes, each returning JSON-friendly rows that the CLI formats
 * for terminal display (and the spend web page renders as tables / charts):
 *
 *   - {@link perProject}        — `SUM(cost_usd)` grouped by `directives.project_id`
 *   - {@link perDirective}      — `SUM(cost_usd)` grouped by `directive_id`
 *   - {@link perDay}            — `SUM(cost_usd)` grouped by `date(called_at)` (UTC)
 *   - {@link perDayPerProject}  — `SUM(cost_usd)` grouped by `(date(called_at), project_id)` — powers Phase 3.8's spend-page sparkline + stacked bar
 *   - {@link perModel}          — `SUM(cost_usd)` grouped by `(provider, model)`
 *
 * Per-project and per-directive rollups join through `directives.project_id`
 * (populated for every directive since migration 006 per ADR 0021).
 * Per-day and per-model are pure-`model_usage` aggregations, with the
 * directives join present only to support the `projectId` filter.
 *
 * All four functions accept a shared {@link SpendFilter} for time-window
 * narrowing (`since` / `until`) and per-project narrowing (`projectId`).
 *
 * `model_usage` rows with `directive_id IS NULL` (none today, but schema
 * allows it via `ON DELETE SET NULL`) or whose owning directive has
 * `project_id IS NULL` (chat / system directives) collapse into a single
 * `(unassigned)` bucket in per-project rollup rather than silently vanishing.
 */

import type { Database } from '../db.js';

/**
 * Window-and-project filter shared by every rollup. Every field is optional;
 * omitting all fields returns the all-time aggregate.
 */
export interface SpendFilter {
  /** ISO8601 timestamp. Inclusive lower bound on `called_at`. */
  since?: string;
  /** ISO8601 timestamp. Exclusive upper bound on `called_at`. */
  until?: string;
  /** Restrict to `model_usage` rows whose owning directive has this `project_id` (ULID). */
  projectId?: string;
}

export interface PerProjectSpend {
  /** ULID from `directives.project_id`. `null` for rows attributed to no project. */
  projectId: string | null;
  /** Human label from `projects.name`. `null` when `projectId` is `null` or the projects row is missing. */
  projectName: string | null;
  /** Pre-formatted display label per ADR 0021 §5 — `name (…id-suffix)`. See {@link formatProjectDisplay}. */
  display: string;
  totalUsd: number;
  callCount: number;
  /** Distinct `directive_id` count inside this project. Excludes NULL directive_id rows. */
  directiveCount: number;
}

export interface PerDirectiveSpend {
  directiveId: string;
  projectId: string | null;
  projectName: string | null;
  totalUsd: number;
  callCount: number;
  /** Earliest `called_at` among this directive's rows (ISO8601). */
  firstCalledAt: string;
  /** Latest `called_at` among this directive's rows (ISO8601). */
  lastCalledAt: string;
}

export interface PerDaySpend {
  /** UTC calendar date as `YYYY-MM-DD` (via SQLite's `date()` function). */
  date: string;
  totalUsd: number;
  callCount: number;
}

export interface PerDayPerProjectSpend {
  /** UTC calendar date as `YYYY-MM-DD` (via SQLite's `date()` function). */
  date: string;
  /** ULID from `directives.project_id`. `null` for rows attributed to no project. */
  projectId: string | null;
  /** Human label from `projects.name`. `null` when `projectId` is `null` or the projects row is missing. */
  projectName: string | null;
  /** Pre-formatted display label per ADR 0021 §5 — `name (…id-suffix)`. See {@link formatProjectDisplay}. */
  display: string;
  totalUsd: number;
  callCount: number;
}

export interface PerModelSpend {
  provider: string;
  model: string;
  totalUsd: number;
  callCount: number;
}

/**
 * Format a project label for operator-facing output per ADR 0021 §5.
 *
 * Rules:
 *   - `id` null → `(unassigned)` (directive with no project — chat / system).
 *   - `id` non-null, `name` null → `(unknown) (…xxxx)` (projects row missing
 *     for an id that still appears on a directive; defensive, shouldn't
 *     happen under normal single-writer lifecycle).
 *   - otherwise → `name (…xxxx)` where `xxxx` is the last 4 chars of the ULID.
 *
 * Four chars of disambiguation is enough to separate the common two-workspace
 * `example` / `example` case without bloating the column.
 */
export function formatProjectDisplay(name: string | null, id: string | null): string {
  if (id === null) return '(unassigned)';
  const suffix = id.slice(-4);
  const label = name ?? '(unknown)';
  return `${label} (…${suffix})`;
}

/**
 * Build the dynamic WHERE fragment + bindable params for a given filter.
 * Returns an empty clause when the filter is absent or all-undefined —
 * callers compose with their own fixed predicates via `AND` if needed.
 *
 * The `u` alias (for `model_usage`) and `d` alias (for `directives`) are
 * hard-coded; every query in this module uses those aliases.
 */
function buildFilterClause(filter: SpendFilter | undefined): {
  sql: string;
  params: Record<string, string>;
} {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filter?.since !== undefined) {
    clauses.push('u.called_at >= @since');
    params.since = filter.since;
  }
  if (filter?.until !== undefined) {
    clauses.push('u.called_at < @until');
    params.until = filter.until;
  }
  if (filter?.projectId !== undefined) {
    clauses.push('d.project_id = @project_id');
    params.project_id = filter.projectId;
  }
  return { sql: clauses.join(' AND '), params };
}

/**
 * Compose a final WHERE clause by AND-combining a dynamic filter with zero
 * or more fixed predicates that the query always needs (e.g. per-directive
 * always filters out `directive_id IS NULL`).
 */
function composeWhere(filterSql: string, ...fixedPredicates: string[]): string {
  const all = [filterSql, ...fixedPredicates].filter((s) => s.length > 0);
  return all.length > 0 ? `WHERE ${all.join(' AND ')}` : '';
}

/**
 * Per-project spend rollup. Joins `model_usage → directives → projects`
 * (both LEFT) so orphan-directive and NULL-project rows roll up into a
 * single `(unassigned)` bucket rather than being silently dropped.
 *
 * Ordering: `totalUsd DESC` — operators scanning the dashboard for "where
 * did my money go" see biggest-spend projects first.
 */
export function perProject(db: Database, filter?: SpendFilter): PerProjectSpend[] {
  const { sql: filterSql, params } = buildFilterClause(filter);
  const where = composeWhere(filterSql);
  const rows = db
    .prepare(
      `SELECT
         d.project_id                  AS projectId,
         p.name                        AS projectName,
         COALESCE(SUM(u.cost_usd), 0)  AS totalUsd,
         COUNT(*)                      AS callCount,
         COUNT(DISTINCT u.directive_id) AS directiveCount
       FROM model_usage u
       LEFT JOIN directives d ON u.directive_id = d.id
       LEFT JOIN projects   p ON d.project_id = p.id
       ${where}
       GROUP BY d.project_id
       ORDER BY totalUsd DESC`,
    )
    .all(params) as {
    projectId: string | null;
    projectName: string | null;
    totalUsd: number;
    callCount: number;
    directiveCount: number;
  }[];
  return rows.map((r) => ({
    projectId: r.projectId,
    projectName: r.projectName,
    display: formatProjectDisplay(r.projectName, r.projectId),
    totalUsd: r.totalUsd,
    callCount: r.callCount,
    directiveCount: r.directiveCount,
  }));
}

/**
 * Per-directive spend rollup. Excludes rows with `directive_id IS NULL`
 * (they cannot be attributed to a build). Each row carries both the raw
 * project handle and display name so a CLI dashboard can render the
 * directive's project context without a second query.
 *
 * Ordering: `lastCalledAt DESC` — recent builds at the top.
 */
export function perDirective(db: Database, filter?: SpendFilter): PerDirectiveSpend[] {
  const { sql: filterSql, params } = buildFilterClause(filter);
  const where = composeWhere(filterSql, 'u.directive_id IS NOT NULL');
  const rows = db
    .prepare(
      `SELECT
         u.directive_id                AS directiveId,
         d.project_id                  AS projectId,
         p.name                        AS projectName,
         COALESCE(SUM(u.cost_usd), 0)  AS totalUsd,
         COUNT(*)                      AS callCount,
         MIN(u.called_at)              AS firstCalledAt,
         MAX(u.called_at)              AS lastCalledAt
       FROM model_usage u
       LEFT JOIN directives d ON u.directive_id = d.id
       LEFT JOIN projects   p ON d.project_id = p.id
       ${where}
       GROUP BY u.directive_id
       ORDER BY lastCalledAt DESC`,
    )
    .all(params) as {
    directiveId: string;
    projectId: string | null;
    projectName: string | null;
    totalUsd: number;
    callCount: number;
    firstCalledAt: string;
    lastCalledAt: string;
  }[];
  return rows.map((r) => ({
    directiveId: r.directiveId,
    projectId: r.projectId,
    projectName: r.projectName,
    totalUsd: r.totalUsd,
    callCount: r.callCount,
    firstCalledAt: r.firstCalledAt,
    lastCalledAt: r.lastCalledAt,
  }));
}

/**
 * Per-day spend rollup. Dates are produced by SQLite's `date()` function
 * applied to the ISO8601 `called_at` column — this yields the UTC calendar
 * date (`YYYY-MM-DD`). Operators in non-UTC timezones see UTC buckets; a
 * future timezone-aware flag can render locally without changing storage.
 *
 * Joins `directives` with LEFT so the shared `projectId` filter is applicable;
 * otherwise the join is a no-op.
 *
 * Ordering: `date DESC` — today first, scrolling back in time.
 */
export function perDay(db: Database, filter?: SpendFilter): PerDaySpend[] {
  const { sql: filterSql, params } = buildFilterClause(filter);
  const where = composeWhere(filterSql);
  const rows = db
    .prepare(
      `SELECT
         date(u.called_at)             AS date,
         COALESCE(SUM(u.cost_usd), 0)  AS totalUsd,
         COUNT(*)                      AS callCount
       FROM model_usage u
       LEFT JOIN directives d ON u.directive_id = d.id
       ${where}
       GROUP BY date(u.called_at)
       ORDER BY date DESC`,
    )
    .all(params) as {
    date: string;
    totalUsd: number;
    callCount: number;
  }[];
  return rows;
}

/**
 * Per-(day, project) spend rollup. Joins `model_usage → directives → projects`
 * (both LEFT) so orphan-directive and NULL-project rows roll up into a
 * single `(unassigned)` bucket per date rather than being silently dropped.
 *
 * Powers Phase 3.8's spend-page charts: the per-project 14-day sparklines
 * (one row per project, picking that project's date series) and the 30-day
 * stacked bar (date as outer axis, project as stack segment).
 *
 * Ordering: `date DESC, totalUsd DESC` — today first, biggest-spend project
 * inside each day first. Callers slice the leading window client-side.
 */
export function perDayPerProject(db: Database, filter?: SpendFilter): PerDayPerProjectSpend[] {
  const { sql: filterSql, params } = buildFilterClause(filter);
  const where = composeWhere(filterSql);
  const rows = db
    .prepare(
      `SELECT
         date(u.called_at)             AS date,
         d.project_id                  AS projectId,
         p.name                        AS projectName,
         COALESCE(SUM(u.cost_usd), 0)  AS totalUsd,
         COUNT(*)                      AS callCount
       FROM model_usage u
       LEFT JOIN directives d ON u.directive_id = d.id
       LEFT JOIN projects   p ON d.project_id = p.id
       ${where}
       GROUP BY date(u.called_at), d.project_id
       ORDER BY date DESC, totalUsd DESC`,
    )
    .all(params) as {
    date: string;
    projectId: string | null;
    projectName: string | null;
    totalUsd: number;
    callCount: number;
  }[];
  return rows.map((r) => ({
    date: r.date,
    projectId: r.projectId,
    projectName: r.projectName,
    display: formatProjectDisplay(r.projectName, r.projectId),
    totalUsd: r.totalUsd,
    callCount: r.callCount,
  }));
}

/**
 * Per-model spend rollup, grouped by `(provider, model)`. A model name is
 * not globally unique across providers — group by both to keep the rollup
 * honest if a future provider ever reuses a name.
 *
 * Ordering: `totalUsd DESC` — most-expensive model first.
 */
export function perModel(db: Database, filter?: SpendFilter): PerModelSpend[] {
  const { sql: filterSql, params } = buildFilterClause(filter);
  const where = composeWhere(filterSql);
  const rows = db
    .prepare(
      `SELECT
         u.provider                    AS provider,
         u.model                       AS model,
         COALESCE(SUM(u.cost_usd), 0)  AS totalUsd,
         COUNT(*)                      AS callCount
       FROM model_usage u
       LEFT JOIN directives d ON u.directive_id = d.id
       ${where}
       GROUP BY u.provider, u.model
       ORDER BY totalUsd DESC`,
    )
    .all(params) as {
    provider: string;
    model: string;
    totalUsd: number;
    callCount: number;
  }[];
  return rows;
}
