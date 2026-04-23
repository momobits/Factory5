/**
 * Typed CRUD for the `directives` table.
 *
 * The brain claims pending directives via {@link claimNext}; channels insert
 * via {@link insert}; transitions via {@link updateStatus}. Terminal
 * `blocked` transitions driven by operator tooling or daemon reconcile
 * record a reason via {@link markBlocked}.
 */

import { directiveSchema, type Directive } from '@factory5/core';
import type { Logger } from '@factory5/logger';

import type { Database } from '../db.js';

interface Row {
  id: string;
  source: string;
  principal: string;
  channel_ref: string;
  intent: string;
  payload_json: string;
  autonomy: string;
  created_at: string;
  status: string;
  claimed_by: string | null;
  parent_directive_id: string | null;
  blocked_reason: string | null;
  max_usd: number | null;
  max_steps: number | null;
  project_id: string | null;
}

function rowToDirective(row: Row): Directive {
  const limits: { maxUsd?: number; maxSteps?: number } = {};
  if (row.max_usd !== null) limits.maxUsd = row.max_usd;
  if (row.max_steps !== null) limits.maxSteps = row.max_steps;
  const hasLimits = Object.keys(limits).length > 0;
  return directiveSchema.parse({
    id: row.id,
    source: row.source,
    principal: row.principal,
    channelRef: row.channel_ref,
    intent: row.intent,
    payload: JSON.parse(row.payload_json),
    autonomy: row.autonomy,
    createdAt: row.created_at,
    status: row.status,
    ...(row.claimed_by !== null ? { claimedBy: row.claimed_by } : {}),
    ...(row.parent_directive_id !== null ? { parentDirectiveId: row.parent_directive_id } : {}),
    ...(row.blocked_reason !== null ? { blockedReason: row.blocked_reason } : {}),
    ...(hasLimits ? { limits } : {}),
    ...(row.project_id !== null ? { projectId: row.project_id } : {}),
  });
}

/** Insert a fresh directive. Validates against the schema. */
export function insert(db: Database, d: Directive): void {
  const validated = directiveSchema.parse(d);
  db.prepare(
    `INSERT INTO directives
       (id, source, principal, channel_ref, intent, payload_json, autonomy,
        created_at, status, claimed_by, parent_directive_id, blocked_reason,
        max_usd, max_steps, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    validated.id,
    validated.source,
    validated.principal,
    validated.channelRef,
    validated.intent,
    JSON.stringify(validated.payload ?? null),
    validated.autonomy,
    validated.createdAt,
    validated.status,
    validated.claimedBy ?? null,
    validated.parentDirectiveId ?? null,
    validated.blockedReason ?? null,
    validated.limits?.maxUsd ?? null,
    validated.limits?.maxSteps ?? null,
    validated.projectId ?? null,
  );
}

/** Fetch a directive by id. */
export function getById(db: Database, id: string): Directive | undefined {
  const row = db.prepare('SELECT * FROM directives WHERE id = ?').get(id) as Row | undefined;
  return row !== undefined ? rowToDirective(row) : undefined;
}

/** List directives by status (most-recent first), limited. */
export function listByStatus(db: Database, status: Directive['status'], limit = 50): Directive[] {
  const rows = db
    .prepare('SELECT * FROM directives WHERE status = ? ORDER BY created_at DESC LIMIT ?')
    .all(status, limit) as Row[];
  return rows.map(rowToDirective);
}

/**
 * Atomically claim the next pending directive (FIFO). Returns the claimed
 * directive or `undefined` if the queue is empty.
 */
export function claimNext(db: Database, opts: { claimedBy: string }): Directive | undefined {
  const claimTx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM directives
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get() as Row | undefined;
    if (row === undefined) return undefined;
    db.prepare(`UPDATE directives SET status = 'claimed', claimed_by = ? WHERE id = ?`).run(
      opts.claimedBy,
      row.id,
    );
    return rowToDirective({ ...row, status: 'claimed', claimed_by: opts.claimedBy });
  });
  return claimTx();
}

/** Update a directive's status. */
export function updateStatus(db: Database, id: string, status: Directive['status']): void {
  db.prepare('UPDATE directives SET status = ? WHERE id = ?').run(status, id);
}

/** List the most recent N directives across all statuses. */
export function listRecent(db: Database, limit = 50): Directive[] {
  const rows = db
    .prepare('SELECT * FROM directives ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Row[];
  return rows.map(rowToDirective);
}

export interface ListPagedFilter {
  /** Page size. Clamped to [1, 100]. Default 20. */
  limit?: number;
  /** Rows to skip. Clamped to >= 0. Default 0. */
  offset?: number;
  /** Optional status filter; omit to return all statuses. */
  status?: Directive['status'];
}

export interface ListPagedResult {
  items: Directive[];
  /** Total matching rows ignoring pagination; feeds page-count UX. */
  total: number;
}

/**
 * Paged list with optional status filter, newest first. Used by the web UI's
 * `/api/v1/directives` endpoint (Phase 9); CLI and brain paths continue to
 * use {@link listRecent} / {@link listByStatus} as before.
 */
export function listPaged(db: Database, filter: ListPagedFilter = {}): ListPagedResult {
  const limit = Math.max(1, Math.min(100, filter.limit ?? 20));
  const offset = Math.max(0, filter.offset ?? 0);

  if (filter.status !== undefined) {
    const countRow = db
      .prepare('SELECT COUNT(*) AS count FROM directives WHERE status = ?')
      .get(filter.status) as { count: number };
    const rows = db
      .prepare(
        `SELECT * FROM directives
           WHERE status = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
      )
      .all(filter.status, limit, offset) as Row[];
    return { items: rows.map(rowToDirective), total: countRow.count };
  }

  const countRow = db.prepare('SELECT COUNT(*) AS count FROM directives').get() as {
    count: number;
  };
  const rows = db
    .prepare('SELECT * FROM directives ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as Row[];
  return { items: rows.map(rowToDirective), total: countRow.count };
}

/**
 * Thrown when `markBlocked` is called on a directive that doesn't exist or
 * is already in a terminal state. The CLI surfaces `code` to set an
 * operator-friendly exit code without string-matching the message.
 */
export class MarkBlockedError extends Error {
  readonly code: 'NOT_FOUND' | 'ALREADY_TERMINAL';
  constructor(code: 'NOT_FOUND' | 'ALREADY_TERMINAL', message: string) {
    super(message);
    this.name = 'MarkBlockedError';
    this.code = code;
  }
}

const TERMINAL_STATUSES: ReadonlySet<Directive['status']> = new Set([
  'blocked',
  'complete',
  'failed',
]);

/**
 * Flip a non-terminal directive to `blocked`, recording an optional reason.
 *
 * Refuses to touch a directive that's already terminal — flipping a
 * `complete` directive to `blocked` would be a data-integrity bug, not a
 * recovery. Returns the updated directive on success.
 */
export function markBlocked(db: Database, id: string, reason?: string): Directive {
  const trimmed = reason !== undefined ? reason.trim() : undefined;
  const markTx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM directives WHERE id = ?').get(id) as Row | undefined;
    if (row === undefined) {
      throw new MarkBlockedError('NOT_FOUND', `directive ${id} not found`);
    }
    if (TERMINAL_STATUSES.has(row.status as Directive['status'])) {
      throw new MarkBlockedError(
        'ALREADY_TERMINAL',
        `directive ${id} is already ${row.status}; refusing to mark blocked`,
      );
    }
    db.prepare(
      `UPDATE directives
         SET status = 'blocked',
             blocked_reason = COALESCE(?, blocked_reason)
       WHERE id = ?`,
    ).run(trimmed !== undefined && trimmed.length > 0 ? trimmed : null, id);
    return rowToDirective({
      ...row,
      status: 'blocked',
      blocked_reason:
        trimmed !== undefined && trimmed.length > 0 ? trimmed : (row.blocked_reason ?? null),
    });
  });
  return markTx();
}

// ---------------------------------------------------------------------------
// Orphaned-directive reconcile (daemon startup)
// ---------------------------------------------------------------------------

/**
 * Activity floor below which a `running` directive with no live owning
 * process is assumed dead. Picked generously — a Sonnet architect pass
 * today spends ~2 min, an Opus assess sub-minute; 10 min swallows normal
 * concurrency without false-flagging a legit long run.
 */
export const ORPHAN_STALE_AFTER_MS = 10 * 60 * 1000;

export interface ReconcileOrphanedOptions {
  /** Override wall clock (tests). */
  now?: () => number;
  /** Override PID liveness (tests). Returns true iff the pid is alive. */
  isPidAlive?: (pid: number) => boolean;
  /** Override the stale-after threshold. */
  staleAfterMs?: number;
  /** Override the `blocked_reason` text written on orphans. */
  reasonPrefix?: string;
}

export interface ReconcileOrphanedResult {
  reconciled: string[];
  inspected: number;
}

/**
 * Parse the `claimedBy` string into a PID if possible. Accepts the
 * `inline-<pid>` / `serve-<pid>` formats written by the brain; returns
 * undefined for anything else (including NULL claimers, operator-supplied
 * strings, or serve-mode formats that future work might introduce).
 */
function parseClaimedByPid(claimedBy: string | null): number | undefined {
  if (claimedBy === null) return undefined;
  const m = /^(?:inline|serve)-(\d+)$/.exec(claimedBy);
  if (m === null) return undefined;
  const pid = Number.parseInt(m[1] as string, 10);
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

/**
 * Default PID liveness check. `process.kill(pid, 0)` does not actually
 * send a signal — it tests whether the caller could signal the process.
 *
 * Error codes:
 *   - `ESRCH` — no such process → dead.
 *   - `EPERM` — process exists, we just don't own it → alive.
 *   - anything else (e.g. transient Windows ACL quirks) → treat as alive
 *     to avoid false-orphan on ambiguity.
 */
function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    return true;
  }
}

/**
 * Scan for `running` directives whose owning process is gone and flip them
 * to `blocked`. Called once at daemon startup (after migrations, before
 * channels) so an operator doesn't have to hand-crank `mark-blocked` on
 * every directive that died with its brain.
 *
 * Staleness has two redundant signals — a directive is only orphaned when
 * **both** say so:
 *   1. `claimed_by`'s PID (if parseable) is no longer alive on this host.
 *   2. The directive's most recent `model_usage` row (fallback: its own
 *      `created_at`) is older than {@link ORPHAN_STALE_AFTER_MS}.
 *
 * This conservatism exists because `factory build --inline` runs without
 * a pidfile, so the daemon can't tell a concurrently-running inline brain
 * apart from a dead one from PID state alone. The activity floor rules
 * out directives that are almost certainly still making LLM calls.
 */
export function reconcileOrphanedDirectives(
  db: Database,
  log: Logger,
  opts: ReconcileOrphanedOptions = {},
): ReconcileOrphanedResult {
  const now = opts.now ?? ((): number => Date.now());
  const isAlive = opts.isPidAlive ?? defaultIsPidAlive;
  const staleAfterMs = opts.staleAfterMs ?? ORPHAN_STALE_AFTER_MS;
  const reasonPrefix = opts.reasonPrefix ?? 'reconciled at daemon start';

  const rows = db.prepare(`SELECT * FROM directives WHERE status = 'running'`).all() as Row[];

  const reconciled: string[] = [];
  const nowMs = now();

  for (const row of rows) {
    const pid = parseClaimedByPid(row.claimed_by);
    if (pid !== undefined && isAlive(pid)) {
      // Owning process is alive — leave alone.
      continue;
    }

    // Find last activity: max(latest model_usage, directive.created_at).
    const usageRow = db
      .prepare(
        `SELECT called_at AS calledAt
           FROM model_usage
          WHERE directive_id = ?
          ORDER BY called_at DESC
          LIMIT 1`,
      )
      .get(row.id) as { calledAt: string } | undefined;
    const lastActivityIso = usageRow?.calledAt ?? row.created_at;
    const lastActivityMs = Date.parse(lastActivityIso);
    if (!Number.isFinite(lastActivityMs)) {
      log.warn(
        { directiveId: row.id, lastActivityIso },
        'reconcile: unparseable last-activity timestamp; skipping',
      );
      continue;
    }
    const ageMs = nowMs - lastActivityMs;
    if (ageMs < staleAfterMs) continue;

    const reason = `${reasonPrefix} — prior process gone (claimedBy=${row.claimed_by ?? 'null'}, idle ${Math.round(ageMs / 60000)}m)`;
    try {
      markBlocked(db, row.id, reason);
      reconciled.push(row.id);
      log.warn(
        {
          directiveId: row.id,
          claimedBy: row.claimed_by,
          lastActivityIso,
          ageMs,
        },
        'reconcile: directive flipped to blocked',
      );
    } catch (err) {
      // Shouldn't happen — we just read the row as running — but surface
      // loudly rather than silently drop.
      log.error({ err, directiveId: row.id }, 'reconcile: markBlocked failed');
    }
  }

  return { reconciled, inspected: rows.length };
}
