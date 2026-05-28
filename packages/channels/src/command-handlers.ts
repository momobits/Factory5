/**
 * Transport-agnostic command handlers (Phase 2 step 2.2).
 *
 * Both Discord (slash commands) and Telegram (`/factory <cmd>` text
 * commands) dispatch through this module. Handlers take typed input,
 * touch SQLite + the channel-context callbacks, and return structured
 * results. Each transport then formats the result for its medium —
 * Discord builds an `EmbedBuilder`; Telegram emits HTML-mode plain text
 * with `<pre>...</pre>` blocks for tabular sections.
 *
 * The shape mirrors the CLI's pure-handler pattern (see
 * `packages/cli/src/commands/spend.ts` `runSpend`) — handlers return a
 * value (or a discriminated `CommandResult<T>` for user-visible
 * failures); the calling transport owns I/O. Systemic errors throw and
 * the transport's outer try/catch surfaces them.
 *
 * Two failure conventions:
 *   - **`CommandResult<T>`** — used when the failure is user-visible
 *     and the transport renders it as a recognisable error response
 *     (e.g. "no project named X"). The `code` field is stable so each
 *     transport can branch on it without string-matching the message.
 *   - **Throw** — reserved for systemic failures (DB corruption, bug
 *     in the handler). The transport's outer catch logs + reports.
 *
 * Read handlers (`runStatus`, `runFindings`) never have a user-visible
 * failure mode — they always return data (possibly empty), so they
 * return the data type directly.
 */

import {
  type AutonomyMode,
  type ChannelId,
  type Directive,
  type DirectiveLimits,
  type DirectiveStatus,
  directiveSchema,
  newId,
  type Project,
  type ProjectBudgetDefaults,
  type Intent,
} from '@factory5/core';
import type { Logger } from '@factory5/logger';
import {
  directives as directivesQ,
  findingsRegistry,
  modelUsage,
  projects as projectsQ,
  spend as spendQ,
  type Database,
  type FindingsRegistryEntry,
  type FindingsRegistryListFilter,
  type PerDaySpend,
  type PerDirectiveSpend,
  type PerModelSpend,
  type PerProjectSpend,
  type SpendFilter,
  MarkBlockedError,
} from '@factory5/state';

import { listAbandonedWorktrees, type AbandonedWorktree } from '@factory5/worker';

import { SetProjectBudgetError, type ChannelContext } from './types.js';

// ---------------------------------------------------------------------------
// Context + result shape
// ---------------------------------------------------------------------------

/**
 * Per-invocation context handed to every handler. Transports build it once
 * per inbound command + thread it through. Mirrors a subset of
 * {@link ChannelContext} plus the live DB and the invoking principal.
 */
export interface CommandHandlerContext {
  db: Database;
  log: Logger;
  /** Source recorded on directives this handler creates. */
  source: ChannelId;
  /** Stable user/principal id for new directives (Discord user id, Telegram user id, ...). */
  principal: string;
  /**
   * Channel-shaped reference for any directive this handler creates. The
   * transport supplies a value that lets it route follow-up messages back
   * (e.g. Discord `<channelId>#<threadId>`, Telegram `<chatId>#<messageId>`).
   * For commands that do not create directives this is unused.
   */
  channelRef: string;
  onInbound: ChannelContext['onInbound'];
  resolveProjectPath: ChannelContext['resolveProjectPath'];
  resolveBuildLimits: ChannelContext['resolveBuildLimits'];
  setProjectBudget: ChannelContext['setProjectBudget'];
}

/**
 * Stable error codes returned by handlers for user-visible failures. The
 * transport branches on `code` (not `message`) when it needs to format
 * differently — e.g. ambiguity might want a list embed while not-found
 * gets a one-liner.
 */
export type CommandErrorCode =
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'INVALID_INPUT'
  | 'ALREADY_TERMINAL'
  | 'BUDGET_UNWIRED'
  | 'PATH_UNREADABLE'
  | 'METADATA_CORRUPT';

export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: CommandErrorCode; message: string };

const ok = <T>(data: T): CommandResult<T> => ({ ok: true, data });
const fail = <T>(code: CommandErrorCode, message: string): CommandResult<T> => ({
  ok: false,
  code,
  message,
});

// ---------------------------------------------------------------------------
// Allowed enum values (mirrored from the slash-command JSON shape so a
// caller that forgets to validate input doesn't trip the handler later).
// ---------------------------------------------------------------------------

export const SPEND_GROUPS = ['project', 'directive', 'day', 'model'] as const;
export type SpendGroup = (typeof SPEND_GROUPS)[number];

export const FINDING_STATUSES = ['OPEN', 'FIXED', 'VERIFIED', 'WONTFIX'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const FINDING_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const PROJECT_LANGUAGES = ['python', 'node', 'go', 'rust'] as const;
export type ProjectLanguage = (typeof PROJECT_LANGUAGES)[number];

/**
 * Build a fast id→name lookup for the rendering side. Returns `'-'` when the
 * directive has no `projectId` (legacy rows pre-migration-006, or directives
 * that never resolved to a project) or when the id doesn't match anything in
 * the supplied list.
 */
export function makeProjectNameLookup(
  projects: ReadonlyArray<Project>,
): (id: string | undefined) => string {
  const byId = new Map<string, string>();
  for (const p of projects) byId.set(p.id, p.name);
  return (id) => (id !== undefined && byId.has(id) ? byId.get(id)! : '-');
}

// ---------------------------------------------------------------------------
// /factory status
// ---------------------------------------------------------------------------

export interface StatusInput {
  /** How many recent directives to include. Clamped to [1, 50]. */
  limit?: number;
}

export interface StatusEntry {
  directive: Directive;
  /** Aggregate spend across `model_usage` rows for this directive. */
  spendUsd: number;
}

export interface StatusData {
  projects: ReadonlyArray<Project>;
  recent: ReadonlyArray<StatusEntry>;
}

export async function runStatus(
  ctx: CommandHandlerContext,
  input: StatusInput,
): Promise<StatusData> {
  const limit = Math.max(1, Math.min(50, input.limit ?? 10));
  const recent = directivesQ.listRecent(ctx.db, limit).map((d) => ({
    directive: d,
    spendUsd: modelUsage.totalCostForDirective(ctx.db, d.id),
  }));
  const projects = projectsQ.listAll(ctx.db);
  return { projects, recent };
}

// ---------------------------------------------------------------------------
// /factory spend
// ---------------------------------------------------------------------------

export interface SpendInput {
  groupBy?: string;
  /** Project name filter — resolved via `projects.findByName`. */
  project?: string;
  /** Cap on rendered rows. Clamped to [1, 100]. Default 15. */
  limit?: number;
}

export type SpendData =
  | { groupBy: 'project'; rows: ReadonlyArray<PerProjectSpend> }
  | { groupBy: 'directive'; rows: ReadonlyArray<PerDirectiveSpend> }
  | { groupBy: 'day'; rows: ReadonlyArray<PerDaySpend> }
  | { groupBy: 'model'; rows: ReadonlyArray<PerModelSpend> };

export async function runSpend(
  ctx: CommandHandlerContext,
  input: SpendInput,
): Promise<CommandResult<SpendData>> {
  const groupRaw = input.groupBy ?? 'project';
  if (!isSpendGroup(groupRaw)) {
    return fail(
      'INVALID_INPUT',
      `invalid group-by "${groupRaw}" (expected: ${SPEND_GROUPS.join(' | ')})`,
    );
  }
  const filter: SpendFilter = {};
  if (input.project !== undefined && input.project.length > 0) {
    const matches = projectsQ.findByName(ctx.db, input.project);
    if (matches.length === 0) {
      return fail('NOT_FOUND', `no project matches "${input.project}"`);
    }
    if (matches.length > 1) {
      const lines = matches.map((p) => `${p.name} — ${p.id} — ${p.workspacePath}`);
      return fail(
        'AMBIGUOUS',
        `"${input.project}" is ambiguous (${matches.length.toString()} projects):\n${lines.join('\n')}`,
      );
    }
    const only = matches[0]!;
    filter.projectId = only.id;
  }
  const rowLimit = Math.max(1, Math.min(100, input.limit ?? 15));
  switch (groupRaw) {
    case 'project':
      return ok({ groupBy: 'project', rows: spendQ.perProject(ctx.db, filter).slice(0, rowLimit) });
    case 'directive':
      return ok({
        groupBy: 'directive',
        rows: spendQ.perDirective(ctx.db, filter).slice(0, rowLimit),
      });
    case 'day':
      return ok({ groupBy: 'day', rows: spendQ.perDay(ctx.db, filter).slice(0, rowLimit) });
    case 'model':
      return ok({ groupBy: 'model', rows: spendQ.perModel(ctx.db, filter).slice(0, rowLimit) });
  }
}

function isSpendGroup(s: string): s is SpendGroup {
  return (SPEND_GROUPS as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// /factory findings
// ---------------------------------------------------------------------------

export interface FindingsInput {
  project?: string;
  severity?: string;
  status?: string;
  /** Cap on rendered rows. Clamped to [1, 100]. Default 25. */
  limit?: number;
  /** When true, include advisory rows (default: blocking-only, mirrors the CLI). */
  advisory?: boolean;
}

export interface FindingsData {
  rows: ReadonlyArray<FindingsRegistryEntry>;
  filters: {
    project?: string;
    severity?: string;
    status: string;
  };
}

export async function runFindings(
  ctx: CommandHandlerContext,
  input: FindingsInput,
): Promise<CommandResult<FindingsData>> {
  if (input.severity !== undefined && !isFindingSeverity(input.severity)) {
    return fail(
      'INVALID_INPUT',
      `invalid severity "${input.severity}" (expected: ${FINDING_SEVERITIES.join(' | ')})`,
    );
  }
  const status = input.status ?? 'OPEN';
  if (!isFindingStatus(status)) {
    return fail(
      'INVALID_INPUT',
      `invalid status "${status}" (expected: ${FINDING_STATUSES.join(' | ')})`,
    );
  }
  const limit = Math.max(1, Math.min(100, input.limit ?? 25));
  const filter: FindingsRegistryListFilter = {
    advisory: input.advisory ?? false,
    limit,
    status,
    ...(input.severity !== undefined ? { severity: input.severity as FindingSeverity } : {}),
    ...(input.project !== undefined && input.project.length > 0 ? { project: input.project } : {}),
  };
  const rows = findingsRegistry.list(ctx.db, filter);
  return ok({
    rows,
    filters: {
      ...(input.project !== undefined && input.project.length > 0
        ? { project: input.project }
        : {}),
      ...(input.severity !== undefined ? { severity: input.severity } : {}),
      status,
    },
  });
}

function isFindingStatus(s: string): s is FindingStatus {
  return (FINDING_STATUSES as readonly string[]).includes(s);
}

function isFindingSeverity(s: string): s is FindingSeverity {
  return (FINDING_SEVERITIES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// /factory resume
// ---------------------------------------------------------------------------

export interface ResumeInput {
  project: string;
  /** Override autonomy on the resumed run. Default `assisted` (CLI parity). */
  autonomy?: AutonomyMode;
}

/** A worktree directory from a prior run that is no longer tracked in any active plan. */
export interface ResumeAbandonedWorktree {
  path: string;
  taskId: string;
  /** ISO 8601 datetime of when the directory was last modified. */
  abandonedSince: string;
}

export interface ResumeData {
  project: string;
  projectPath: string;
  priorId: string;
  priorStatus: DirectiveStatus;
  newDirectiveId: string;
  /** Carried language, if the prior directive recorded one. */
  language?: ProjectLanguage;
  /** Worktrees from prior runs on disk; non-empty when leftover state exists. */
  abandonedWorktrees?: ResumeAbandonedWorktree[];
}

export async function runResume(
  ctx: CommandHandlerContext,
  input: ResumeInput,
): Promise<CommandResult<ResumeData>> {
  const recent = directivesQ.listRecent(ctx.db, 200);
  const namedProjects = projectsQ.findByName(ctx.db, input.project);
  const projectRow = namedProjects[0];

  const prior = findPriorMatch(recent, input.project, projectRow?.workspacePath);
  if (prior === undefined) {
    return fail(
      'NOT_FOUND',
      `no prior directive found for "${input.project}". Try /factory build ${input.project} to start fresh.`,
    );
  }

  const priorPayload =
    typeof prior.payload === 'object' && prior.payload !== null
      ? (prior.payload as Record<string, unknown>)
      : undefined;
  const projectPath =
    (priorPayload?.['projectPath'] as string | undefined) ?? projectRow?.workspacePath;
  if (typeof projectPath !== 'string' || projectPath.length === 0) {
    return fail(
      'INVALID_INPUT',
      `prior directive ${prior.id} has no projectPath; resume needs an absolute path.`,
    );
  }

  // Tier 15.13 — list abandoned worktrees from prior runs so the operator
  // sees what leftover state exists. activeTaskIds=[] because the new plan
  // hasn't been computed yet.
  let abandoned: AbandonedWorktree[] = [];
  try {
    abandoned = await listAbandonedWorktrees({ projectPath, activeTaskIds: [] });
  } catch (err) {
    ctx.log.warn(
      { err, projectPath, priorId: prior.id },
      'command-handlers: runResume — listAbandonedWorktrees failed (non-fatal)',
    );
  }

  const inheritedProjectId = prior.projectId ?? projectRow?.id;
  const priorLanguage = priorPayload?.['language'];
  const carriedLanguage = isLanguage(priorLanguage) ? priorLanguage : undefined;
  const autonomy: AutonomyMode = input.autonomy ?? 'assisted';

  const directive = directiveSchema.parse({
    id: newId(),
    source: ctx.source,
    principal: ctx.principal,
    channelRef: ctx.channelRef,
    intent: 'build' satisfies Intent,
    payload: {
      project: input.project,
      projectPath,
      resumeFrom: prior.id,
      ...(carriedLanguage !== undefined ? { language: carriedLanguage } : {}),
    },
    autonomy,
    createdAt: new Date().toISOString(),
    status: 'pending' as const,
    parentDirectiveId: prior.id,
    ...(inheritedProjectId !== undefined ? { projectId: inheritedProjectId } : {}),
  });

  await ctx.onInbound(directive);
  ctx.log.info(
    {
      directiveId: directive.id,
      parentId: prior.id,
      project: input.project,
      source: ctx.source,
    },
    'command-handlers: resume directive enqueued',
  );

  return ok({
    project: input.project,
    projectPath,
    priorId: prior.id,
    priorStatus: prior.status,
    newDirectiveId: directive.id,
    ...(carriedLanguage !== undefined ? { language: carriedLanguage } : {}),
    ...(abandoned.length > 0
      ? {
          abandonedWorktrees: abandoned.map((w) => ({
            path: w.path,
            taskId: w.taskId,
            abandonedSince: w.abandonedSince.toISOString(),
          })),
        }
      : {}),
  });
}

function findPriorMatch(
  recent: readonly Directive[],
  name: string,
  projectPath: string | undefined,
): Directive | undefined {
  const nameLower = name.toLowerCase();
  const pathLower = projectPath?.toLowerCase();
  // Same priority as cli/resume.ts: running > blocked > claimed/pending > terminal.
  const sorted = [...recent].sort((a, b) => priority(a) - priority(b));
  for (const d of sorted) {
    if (typeof d.payload !== 'object' || d.payload === null) continue;
    const p = d.payload as Record<string, unknown>;
    const projectName = typeof p['project'] === 'string' ? p['project'].toLowerCase() : undefined;
    const dirPath =
      typeof p['projectPath'] === 'string' ? p['projectPath'].toLowerCase() : undefined;
    if (projectName === nameLower) return d;
    if (pathLower !== undefined && dirPath === pathLower) return d;
  }
  return undefined;
}

function priority(d: Directive): number {
  if (d.status === 'running') return 0;
  if (d.status === 'blocked') return 1;
  if (d.status === 'claimed' || d.status === 'pending') return 2;
  return 3;
}

function isLanguage(value: unknown): value is ProjectLanguage {
  return typeof value === 'string' && (PROJECT_LANGUAGES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// /factory cancel — Phase 2.1 marks blocked; 2.4 will swap in actual abort.
// ---------------------------------------------------------------------------

export interface CancelInput {
  /** Full ULID or 8-char trailing suffix (matches /factory status output). */
  directiveId: string;
  reason?: string;
}

export interface CancelData {
  directiveId: string;
  prevStatus: DirectiveStatus;
  reason: string;
}

export async function runCancel(
  ctx: CommandHandlerContext,
  input: CancelInput,
): Promise<CommandResult<CancelData>> {
  const reason =
    input.reason !== undefined && input.reason.trim().length > 0
      ? input.reason.trim()
      : `cancelled via ${ctx.source}`;
  const resolved = resolveDirectiveId(ctx.db, input.directiveId);
  if (resolved === undefined) {
    return fail('NOT_FOUND', `no directive matches "${input.directiveId}"`);
  }
  if (resolved === 'AMBIGUOUS') {
    return fail(
      'AMBIGUOUS',
      `"${input.directiveId}" is ambiguous (suffix matches multiple). Pass the full 26-char ULID.`,
    );
  }
  const before = directivesQ.getById(ctx.db, resolved);
  if (before === undefined) {
    // Race: someone deleted the row between resolve + read. Treat as not-found.
    return fail('NOT_FOUND', `no directive matches "${input.directiveId}"`);
  }
  try {
    directivesQ.markBlocked(ctx.db, resolved, reason);
    ctx.log.info(
      { directiveId: resolved, reason, source: ctx.source, principal: ctx.principal },
      'command-handlers: directive cancelled (markBlocked)',
    );
    return ok({ directiveId: resolved, prevStatus: before.status, reason });
  } catch (err) {
    if (err instanceof MarkBlockedError) {
      if (err.code === 'NOT_FOUND') {
        return fail('NOT_FOUND', `directive "${resolved}" not found`);
      }
      return fail('ALREADY_TERMINAL', err.message);
    }
    throw err;
  }
}

function resolveDirectiveId(db: Database, raw: string): string | 'AMBIGUOUS' | undefined {
  // Full 26-char ULID — try direct fetch first.
  if (raw.length === 26) {
    const direct = directivesQ.getById(db, raw);
    if (direct !== undefined) return direct.id;
  }
  // Suffix — walk the recent directives. Bounded to 200 to keep the query
  // cheap; if the operator cancels something older than that, they should
  // pass the full id (which we tried above).
  const recent = directivesQ.listRecent(db, 200);
  const matches = recent.filter((d) => d.id.endsWith(raw));
  if (matches.length === 0) return undefined;
  if (matches.length > 1) return 'AMBIGUOUS';
  return matches[0]!.id;
}

// ---------------------------------------------------------------------------
// /factory budget
// ---------------------------------------------------------------------------

export interface BudgetInput {
  project: string;
  /** Hard ceiling in USD across the whole build. 0 = unlimited. */
  maxUsd?: number;
  /** Hard ceiling on LLM call count across the build. 0 = unlimited. */
  maxSteps?: number;
  /** Per-task tool-conversation cap for the scaffolder (ADR 0032). */
  maxTurnsScaffolder?: number;
  /** Per-task tool-conversation cap for builders (ADR 0032). */
  maxTurnsBuilder?: number;
  /** Per-task tool-conversation cap for fixers (ADR 0032). */
  maxTurnsFixer?: number;
  /** Total tool-use turns across ALL agent classes combined. 0 = unlimited. */
  maxTotalTurns?: number;
  /** Per-task USD ceiling. 0 = unlimited. */
  maxUsdPerTask?: number;
  /** Maximum times a single task is retried (including auto-bumps). 0 = unlimited. */
  maxRetriesPerTask?: number;
  /** How long the brain waits on an askUser before falling back (ms). */
  askUserDeadlineMs?: number;
  /** Architect+critic cycles per build before escalating (ADR 0033). 0 = unlimited. */
  maxWikiReadinessAttempts?: number;
  /** Total wall-clock time for the build before directive parks. 0 = unlimited. */
  maxWallClockMinutes?: number;
  /** Concurrent task slots in the pool dispatcher. Minimum 1. */
  maxConcurrentTasks?: number;
  /** When true, the pool dispatcher auto-bumps exhausted axes (ADR 0034 §5). */
  autoIncreaseBudgets?: boolean;
  /**
   * Safety ceiling for the auto-bump loop. Must be ≥ 1.
   * The bump aborts when the effective cap would exceed
   * `projectDefault × multiplier` (ADR 0034 §5).
   */
  autoIncreaseCeilingMultiplier?: number;
}

export interface BudgetData {
  project: string;
  projectId: string;
  defaults: ProjectBudgetDefaults;
  autoIncreaseBudgets?: boolean;
  autoIncreaseCeilingMultiplier?: number;
}

export async function runBudget(
  ctx: CommandHandlerContext,
  input: BudgetInput,
): Promise<CommandResult<BudgetData>> {
  if (ctx.setProjectBudget === undefined) {
    return fail(
      'BUDGET_UNWIRED',
      'budget mutation is not wired (no daemon binding). This is expected in test/standalone mode.',
    );
  }
  const defaults: ProjectBudgetDefaults = {
    ...(input.maxUsd !== undefined ? { maxUsd: input.maxUsd } : {}),
    ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
    ...(input.maxTurnsScaffolder !== undefined
      ? { maxTurnsScaffolder: input.maxTurnsScaffolder }
      : {}),
    ...(input.maxTurnsBuilder !== undefined ? { maxTurnsBuilder: input.maxTurnsBuilder } : {}),
    ...(input.maxTurnsFixer !== undefined ? { maxTurnsFixer: input.maxTurnsFixer } : {}),
    ...(input.maxTotalTurns !== undefined ? { maxTotalTurns: input.maxTotalTurns } : {}),
    ...(input.maxUsdPerTask !== undefined ? { maxUsdPerTask: input.maxUsdPerTask } : {}),
    ...(input.maxRetriesPerTask !== undefined
      ? { maxRetriesPerTask: input.maxRetriesPerTask }
      : {}),
    ...(input.askUserDeadlineMs !== undefined
      ? { askUserDeadlineMs: input.askUserDeadlineMs }
      : {}),
    ...(input.maxWikiReadinessAttempts !== undefined
      ? { maxWikiReadinessAttempts: input.maxWikiReadinessAttempts }
      : {}),
    ...(input.maxWallClockMinutes !== undefined
      ? { maxWallClockMinutes: input.maxWallClockMinutes }
      : {}),
    ...(input.maxConcurrentTasks !== undefined
      ? { maxConcurrentTasks: input.maxConcurrentTasks }
      : {}),
  };
  const scalars: { autoIncreaseBudgets?: boolean; autoIncreaseCeilingMultiplier?: number } = {
    ...(input.autoIncreaseBudgets !== undefined
      ? { autoIncreaseBudgets: input.autoIncreaseBudgets }
      : {}),
    ...(input.autoIncreaseCeilingMultiplier !== undefined
      ? { autoIncreaseCeilingMultiplier: input.autoIncreaseCeilingMultiplier }
      : {}),
  };
  try {
    const result = await ctx.setProjectBudget(
      input.project,
      defaults,
      Object.keys(scalars).length > 0 ? scalars : undefined,
    );
    ctx.log.info(
      {
        projectId: result.projectId,
        defaults,
        ...(result.autoIncreaseBudgets !== undefined
          ? { autoIncreaseBudgets: result.autoIncreaseBudgets }
          : {}),
        ...(result.autoIncreaseCeilingMultiplier !== undefined
          ? { autoIncreaseCeilingMultiplier: result.autoIncreaseCeilingMultiplier }
          : {}),
        source: ctx.source,
        principal: ctx.principal,
      },
      'command-handlers: project budget updated',
    );
    return ok({
      project: input.project,
      projectId: result.projectId,
      defaults: result.defaults,
      ...(result.autoIncreaseBudgets !== undefined
        ? { autoIncreaseBudgets: result.autoIncreaseBudgets }
        : {}),
      ...(result.autoIncreaseCeilingMultiplier !== undefined
        ? { autoIncreaseCeilingMultiplier: result.autoIncreaseCeilingMultiplier }
        : {}),
    });
  } catch (err) {
    if (err instanceof SetProjectBudgetError) {
      return fail(err.code, err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// /factory build
// ---------------------------------------------------------------------------

export interface BuildInput {
  project: string;
  spec?: string;
  /** Default `autonomous` to mirror inbound `/build` behaviour. */
  autonomy?: AutonomyMode;
  language?: ProjectLanguage;
  maxUsd?: number;
  maxSteps?: number;
}

export interface BuildData {
  project: string;
  projectPath: string | undefined;
  directiveId: string;
  autonomy: AutonomyMode;
  language: ProjectLanguage | undefined;
  limits: DirectiveLimits | undefined;
  spec: string | undefined;
}

export async function runBuild(ctx: CommandHandlerContext, input: BuildInput): Promise<BuildData> {
  // Resolve project → absolute path (may fail; we proceed with raw name).
  let projectPath: string | undefined;
  if (ctx.resolveProjectPath !== undefined) {
    try {
      projectPath = await ctx.resolveProjectPath(input.project);
    } catch (err) {
      ctx.log.warn(
        { err, project: input.project },
        'command-handlers: resolveProjectPath failed — directive will carry raw name',
      );
    }
  }

  // Three-tier limits — explicit input wins; otherwise daemon's resolver
  // merges project tier + config tier.
  let limits: DirectiveLimits | undefined;
  if (input.maxUsd !== undefined || input.maxSteps !== undefined) {
    limits = {
      ...(input.maxUsd !== undefined ? { maxUsd: input.maxUsd } : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
    };
  } else if (ctx.resolveBuildLimits !== undefined) {
    try {
      limits = await ctx.resolveBuildLimits(input.project);
    } catch (err) {
      ctx.log.warn(
        { err, project: input.project },
        'command-handlers: resolveBuildLimits failed — directive will run uncapped',
      );
    }
  }

  const autonomy: AutonomyMode = input.autonomy ?? 'autonomous';
  const payload: Record<string, unknown> = {
    project: input.project,
    ...(projectPath !== undefined ? { projectPath } : {}),
    ...(input.spec !== undefined && input.spec.length > 0 ? { spec: input.spec } : {}),
    ...(input.language !== undefined ? { language: input.language } : {}),
  };

  const directive = directiveSchema.parse({
    id: newId(),
    source: ctx.source,
    principal: ctx.principal,
    channelRef: ctx.channelRef,
    intent: 'build' satisfies Intent,
    payload,
    autonomy,
    createdAt: new Date().toISOString(),
    status: 'pending' as const,
    ...(limits !== undefined ? { limits } : {}),
  });

  await ctx.onInbound(directive);
  ctx.log.info(
    { directiveId: directive.id, project: input.project, autonomy, source: ctx.source },
    'command-handlers: build directive enqueued',
  );

  return {
    project: input.project,
    projectPath,
    directiveId: directive.id,
    autonomy,
    language: input.language,
    limits,
    spec: input.spec,
  };
}
