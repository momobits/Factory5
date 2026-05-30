/**
 * Brain orchestration. `mode: 'inline'` pipeline:
 *   1. Claim the named directive in SQLite.
 *   2. Triage the intent.
 *   3. Run the architect → critic loop (ADR 0033) to write the wiki.
 *   4. Run the planner → write plan.
 *   5. Hand the plan to the parallel pool (see `./pool.ts`) which topo-sorts,
 *      dispatches independent ready-tasks concurrently up to
 *      `min(4, cpuCount)`, and heartbeats `tasks_inflight` rows.
 *   6. Run the assessor.
 *   7. Mark directive complete/blocked and return.
 *
 * `mode: 'serve'` (long-running claim loop) lands in Phase 3.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AutonomyMode, Directive, DirectiveLimits, ModelCategory, Plan, Task } from '@factory5/core';
import { newId } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import { assess, type AssessResult, type Runtime } from '@factory5/assessor';
import { validateKnowledgeGraph } from '@factory5/coherence-validator';
import type { DirectiveEventEmitter } from '@factory5/ipc';
import type { ProviderRegistry } from '@factory5/providers';
import {
  directives as directivesQ,
  loadConfig,
  modelUsage,
  openDatabase,
  outbound,
  runMigrations,
  type Database,
} from '@factory5/state';
import {
  addFinding,
  appendBuildLog,
  isAdvisory,
  listFindings,
  loadOrCreateProjectMetadata,
  readPlan,
  readWiki,
} from '@factory5/wiki';
import { projectBudgetsFromMetadata, resolveAxisCap, type ProjectBudgetsLike } from './pool-usage.js';

import { runArchitect, type ArchitectResult } from './architect.js';
import { runArchitectWithCritique, WikiReadinessAbortError } from './architect-loop.js';
import { runWikiCritic } from './critic.js';
import { askUser, escalateBlocked, type AskUserResult } from './ask-user.js';
import { BudgetExceededError, formatBlockedReason } from './budget.js';
import { runPlanner } from './planner.js';
import { executeTask, runPlanPool, type TaskOutcome } from './pool.js';
import { buildRegistryFromDisk } from './provider-config.js';
import { runServe, type OnWake } from './serve.js';
import { triageDirective, type TriageResult } from './triage.js';

const log = createLogger('brain.loop');

export interface BrainOptions {
  mode: 'inline' | 'serve';
  /** Required when `mode = 'inline'`. */
  directiveId?: string;
  /** Provider registry. If omitted, a default (claude-cli only) is used. */
  registry?: ProviderRegistry;
  /** Database handle. If omitted, opens the default SQLite file. */
  db?: Database;
  /** Process id used as `claimedBy` for directive claiming. */
  claimedBy?: string;
  /**
   * Cancellation signal propagated to every provider call. When aborted,
   * any in-flight worker's subprocess is killed and the directive is left
   * in `running` state for later resume.
   */
  signal?: AbortSignal;
  /**
   * Max concurrent workers inside a single plan's pool (inline mode and
   * each serve-mode directive). Defaults to `min(4, cpuCount)`.
   */
  concurrency?: number;
  /**
   * `mode: 'serve'` only — max directives in flight at once. Default 1.
   */
  serveConcurrency?: number;
  /**
   * `mode: 'serve'` only — register an external wake signal (typically the
   * daemon's doorbell wired to the IPC `/directives/notify` endpoint).
   */
  onWake?: OnWake;
  /**
   * Per-directive SSE event emitter (Phase 3 / step 3.1). When provided,
   * the brain's pool + loop call this at every observable state
   * transition (task lifecycle, spend updates, directive completion).
   * Inline `factory build` runs leave it unset — emit calls are silent
   * no-op. The daemon's brain-supervisor wires this to the in-memory
   * {@link DirectiveStreamHub} so SSE subscribers see live progress.
   */
  emitDirectiveEvent?: DirectiveEventEmitter;
}

export interface BrainHandle {
  /** Resolves when the brain has finished (inline) or been stopped (serve). */
  done: Promise<InlineResult | void>;
  /** Stop the brain (graceful shutdown for serve mode). */
  stop(): Promise<void>;
}

export interface InlineResult {
  directive: Directive;
  /**
   * Optional because a pre-call budget check (ADR 0020) can halt the
   * pipeline before triage even fires. When absent, `terminalStatus`
   * is `'blocked'` and `directive.blockedReason` carries the
   * `budget_exceeded_*:` prefix.
   */
  triage?: TriageResult;
  architect?: ArchitectResult;
  plan?: Plan;
  taskResults: TaskOutcome[];
  assessment?: AssessResult;
  terminalStatus: Directive['status'];
}

/**
 * Resolve `db`: use caller's handle, or open the default factory.db and
 * migrate. Returns the handle + whether we own it (and should close it).
 */
function ensureDatabase(db: Database | undefined): { db: Database; owned: boolean } {
  if (db !== undefined) return { db, owned: false };
  const d = openDatabase();
  runMigrations(d);
  return { db: d, owned: true };
}

async function runPlanTasks(
  plan: Plan,
  registry: ProviderRegistry,
  db: Database,
  directiveId: string,
  signal: AbortSignal | undefined,
  concurrency: number | undefined,
  // Tier 15 / ADR 0034 — `limits` no longer threads into the pool. The pool's
  // `computePoolUsage` reads ceilings live from `project.json` + `payload.budgets`,
  // and pool exhaustion parks the directive (no pre-dispatch `BudgetExceededError`
  // from the pool side). Directive-level ADR 0020 ceilings still apply via
  // `assertBudget` in `triage`/`planner`/`architect`/`critic` entry points.
  _limits: DirectiveLimits | undefined,
  emitDirectiveEvent: DirectiveEventEmitter | undefined,
): Promise<TaskOutcome[]> {
  return runPlanPool({
    plan,
    registry,
    db,
    directiveId,
    ...(signal !== undefined ? { signal } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(emitDirectiveEvent !== undefined ? { emitDirectiveEvent } : {}),
  });
}

import { emitDirectiveCompleted, emitLogLine } from './emit.js';

export { emitDirectiveCompleted, emitLogLine } from './emit.js';

/** Title of the one-shot graph-migration task (also used to detect duplicates). */
export const GRAPH_MIGRATION_TASK_TITLE = 'Migrate to knowledge graph (one-shot)';

/**
 * Build the one-shot graph-migration task inserted at the head of a plan when a
 * project has `docs/knowledge/` but no `_schema.md` (Tier 15.13 backward-compat).
 *
 * The `agent` MUST be a tool-using role (`isToolUsingAgent` in `@factory5/worker`)
 * so the worker runs it through `runTooling` — with a worktree and a commit.
 * A read-only agent (e.g. `architect`) routes to `runReadOnly`, returns
 * `filesChanged: []`, never commits, and silently seeds nothing. `scaffolder`
 * carries the `knowledge-graph` skill and writes the seed files. A regression
 * test pins this invariant against `isToolUsingAgent`.
 */
export function buildGraphMigrationTask(planId: string): Task {
  return {
    id: newId(),
    planId,
    title: GRAPH_MIGRATION_TASK_TITLE,
    agent: 'scaffolder',
    category: 'reasoning',
    inputs: {
      files: ['docs/knowledge/modules.md'],
      context:
        'This project predates the knowledge graph. Read modules.md, infer features (status=implemented since code already exists), copy _schema.md and _templates/ from factory5 assets, write features/*.md and decisions/ skeleton. Single commit. After this task completes, downstream tasks will operate on the seeded graph.',
    },
    expectedOutputs: {
      files: [
        'docs/knowledge/_schema.md',
        'docs/knowledge/_templates/feature.md',
        'docs/knowledge/_templates/decision.md',
      ],
      signals: [],
    },
    dependsOn: [],
    status: 'pending',
    attempts: 0,
    featureIds: [],
  };
}

async function runInline(
  opts: Required<Pick<BrainOptions, 'directiveId'>> & BrainOptions,
): Promise<InlineResult> {
  const { db, owned } = ensureDatabase(opts.db);
  const registry = opts.registry ?? (await buildRegistryFromDisk());
  const claimedBy = opts.claimedBy ?? `inline-${String(process.pid)}`;
  const emit = opts.emitDirectiveEvent;

  try {
    const directive = directivesQ.getById(db, opts.directiveId);
    if (directive === undefined) {
      throw new Error(`runBrain: directive ${opts.directiveId} not found in state`);
    }

    if (directive.status === 'pending') {
      directivesQ.updateStatus(db, directive.id, 'claimed');
    }
    directivesQ.updateStatus(db, directive.id, 'running');

    // Feature F2 — live-resolve maxUsd/maxSteps via unified three-way max rule
    // instead of the ADR 0020 creation-time snapshot (`directive.limits`).
    // The `limits` object threaded to triage/architect/critic/planner now
    // carries live-resolved ceilings so operator edits mid-build take effect
    // on the next agent call (Relay issue #5).
    const triageProjectPath = extractProjectPathSafely(directive);
    const liveBudgets =
      triageProjectPath !== undefined
        ? await loadProjectBudgetsForDirective(triageProjectPath)
        : ({ budgetDefaults: {} } as ProjectBudgetsLike);
    const liveMaxUsd = resolveAxisCap(db, directive.id, 'maxUsd', liveBudgets);
    const liveMaxSteps = resolveAxisCap(db, directive.id, 'maxSteps', liveBudgets);
    const limits: DirectiveLimits | undefined =
      liveMaxUsd > 0 || liveMaxSteps > 0
        ? {
            ...(liveMaxUsd > 0 ? { maxUsd: liveMaxUsd } : {}),
            ...(liveMaxSteps > 0 ? { maxSteps: liveMaxSteps } : {}),
          }
        : undefined;
    log.info(
      {
        directiveId: directive.id,
        intent: directive.intent,
        claimedBy,
        ...(limits?.maxUsd !== undefined ? { maxUsd: limits.maxUsd } : {}),
        ...(limits?.maxSteps !== undefined ? { maxSteps: limits.maxSteps } : {}),
      },
      'brain: running inline',
    );

    try {
      // -------- TRIAGE --------
      const triageText = renderDirectiveForTriage(directive);
      // Resolve the project path eagerly for the cwd-isolation guard
      // (post-Tier-15 fix). Build directives carry payload.projectPath;
      // chat / system directives don't — `resolveLlmCwd` falls back to
      // os.tmpdir() inside triage in that case.
      const triage = await triageDirective(triageText, {
        registry,
        db,
        directiveId: directive.id,
        ...(limits !== undefined ? { limits } : {}),
        ...(triageProjectPath !== undefined ? { projectPath: triageProjectPath } : {}),
      });

      // For inline builds, respect the original intent; triage is the audit record.
      const effectiveIntent = directive.intent;
      emitLogLine(
        emit,
        directive.id,
        'info',
        'brain.triage',
        `triage: intent=${triage.intent} confidence=${triage.confidence.toFixed(2)}`,
        { effectiveIntent },
      );

      if (effectiveIntent === 'chat') {
        // Phase 3 minimum: emit a triage-summary reply on the CLI-RPC channel
        // so `factory chat` has a real round-trip to render. Fuller chat
        // behaviour lands with the per-channel agent work.
        const replyText = `(triage) intent=${triage.intent} confidence=${triage.confidence.toFixed(2)}`;
        outbound.enqueue(db, {
          id: newId(),
          directiveId: directive.id,
          targetChannel: directive.source,
          targetRef: directive.channelRef,
          text: replyText,
          createdAt: new Date().toISOString(),
          attempts: 0,
        });
        // Step 3.5 — surface the chat reply as a `log.line` SSE event so
        // /app/chat (and any other subscriber) renders one bubble per
        // agent turn. The outbound row continues to drive Discord /
        // Telegram / CLI-RPC delivery; the SSE event is purely additive.
        emitLogLine(emit, directive.id, 'info', 'brain.chat', replyText, {
          intent: triage.intent,
          confidence: triage.confidence,
        });
        directivesQ.updateStatus(db, directive.id, 'complete');
        emitDirectiveCompleted(emit, directive.id, 'complete', undefined);
        log.info({ directiveId: directive.id, replyText }, 'brain: chat reply queued');
        return {
          directive,
          triage,
          taskResults: [],
          terminalStatus: 'complete',
        };
      }

      if (effectiveIntent !== 'build') {
        // Phase 1 only implements the build path.
        log.warn(
          { intent: effectiveIntent },
          'brain: only build / chat are implemented — recording triage and exiting',
        );
        directivesQ.updateStatus(db, directive.id, 'complete');
        emitDirectiveCompleted(emit, directive.id, 'complete', undefined);
        return {
          directive,
          triage,
          taskResults: [],
          terminalStatus: 'complete',
        };
      }

      const projectPath = extractProjectPath(directive);
      await appendBuildLog(projectPath, `brain: inline run started (directive ${directive.id})`);

      // Assisted-mode shared options: every checkpoint inherits the same abort
      // + poll cadence so a daemon shutdown unblocks all of them in one shot.
      const checkpointSignal = opts.signal;
      const runCheckpoint = async (question: string): Promise<AskUserResult> => {
        const ckOpts: Parameters<typeof askUser>[0] = {
          db,
          directiveId: directive.id,
          question,
          options: ['continue', 'abort'],
          ...(checkpointSignal !== undefined ? { signal: checkpointSignal } : {}),
        };
        return askUser(ckOpts);
      };

      // -------- ARCHITECT --------
      // Skip when the wiki already has pages (resume path); otherwise run the
      // architect→critic loop (ADR 0033 / Tier 14).
      const existingPages = await readWiki(projectPath);
      let architect: ArchitectResult | undefined;
      if (existingPages.length > 0) {
        log.info(
          { projectPath, pageCount: existingPages.length },
          'architect: skipped — wiki pages already on disk',
        );
        await appendBuildLog(projectPath, 'architect skipped (wiki already on disk; resume path)');
        emitLogLine(
          emit,
          directive.id,
          'info',
          'brain.architect',
          'architect: skipped (wiki already on disk; resume path)',
        );
      } else {
        // Feature F2 — resolve maxWikiReadinessAttempts via unified three-way
        // max rule (Relay issue #6): max(project.json, payload.budgets, BUDGET_DEFAULTS).
        // Previously this used payload-only resolution (ADR 0032 / Tier 14.3),
        // meaning project-level defaults were ignored.
        const projectBudgets = await loadProjectBudgetsForDirective(projectPath);
        const maxAttempts = resolveAxisCap(
          db,
          directive.id,
          'maxWikiReadinessAttempts',
          projectBudgets,
        );

        // Build an adapter from the real askUser (AskUserOptions → AskUserResult)
        // to the wrapper's convenience shape (prompt/options → string).
        const askUserAdapter = async (opts: {
          prompt: string;
          options: readonly string[];
          directiveId?: string;
        }): Promise<string> => {
          const targetDirectiveId = opts.directiveId ?? directive.id;
          const res = await askUser({
            db,
            directiveId: targetDirectiveId,
            question: opts.prompt,
            options: [...opts.options],
            ...(checkpointSignal !== undefined ? { signal: checkpointSignal } : {}),
          });
          // Treat timeout/abort the same as 'continue' (ADR 0030 default).
          return res.answer ?? 'continue';
        };

        const rawConfig = loadConfig();
        // Strip explicit `undefined` values from agents so the object satisfies
        // exactOptionalPropertyTypes (FactoryConfig uses `prop?: T | undefined`
        // while RunArchitectWithCritiqueOptions.config uses `prop?: T`).
        const config: { agents?: { architect?: ModelCategory; critic?: ModelCategory } } = {
          ...(rawConfig.agents !== undefined
            ? {
                agents: {
                  ...(rawConfig.agents.architect !== undefined
                    ? { architect: rawConfig.agents.architect }
                    : {}),
                  ...(rawConfig.agents.critic !== undefined
                    ? { critic: rawConfig.agents.critic }
                    : {}),
                },
              }
            : {}),
        };

        try {
          const architectLoopResult = await runArchitectWithCritique({
            runArchitect,
            runWikiCritic,
            askUser: askUserAdapter,
            registry,
            projectPath,
            directiveBody: renderDirectiveForTriage(directive),
            maxAttempts,
            db,
            directiveId: directive.id,
            config,
            ...(limits !== undefined
              ? {
                  limits: {
                    ...(limits.maxUsd !== undefined ? { maxUsd: limits.maxUsd } : {}),
                    ...(limits.maxSteps !== undefined ? { maxSteps: limits.maxSteps } : {}),
                  },
                }
              : {}),
            ...(emit !== undefined ? { emit } : {}),
          });
          architect = architectLoopResult.architectResult;
        } catch (err) {
          if (err instanceof WikiReadinessAbortError) {
            await appendBuildLog(
              projectPath,
              `wiki-readiness aborted by operator: ${err.lastCritique.summary}`,
            );
            directivesQ.updateStatus(db, directive.id, 'blocked');
            emitDirectiveCompleted(emit, directive.id, 'blocked', undefined);
            return {
              directive,
              triage,
              taskResults: [],
              terminalStatus: 'blocked',
            };
          }
          throw err;
        }
      }

      // Assisted-mode checkpoint after architect (ADR 0005). Per ADR 0015 the
      // checkpoint is idempotent — re-entering the phase finds the prior
      // answer and skips re-asking.
      if (directive.autonomy === 'assisted') {
        const pageCount = architect?.pages.length ?? 0;
        const ck = await runCheckpoint(
          `Architect done (${String(pageCount)} wiki page${pageCount === 1 ? '' : 's'}). Continue to planning?`,
        );
        if (isAbortAnswer(ck)) {
          await appendBuildLog(
            projectPath,
            `user aborted at architect checkpoint: ${ck.answer ?? '(no answer)'}`,
          );
          directivesQ.updateStatus(db, directive.id, 'blocked');
          emitDirectiveCompleted(emit, directive.id, 'blocked', undefined);
          return {
            directive,
            triage,
            ...(architect !== undefined ? { architect } : {}),
            taskResults: [],
            terminalStatus: 'blocked',
          };
        }
      }

      // -------- PLANNER --------
      let plan: Plan;
      const existing = await readPlan(projectPath);
      if (
        existing !== undefined &&
        existing.status !== 'complete' &&
        existing.status !== 'abandoned'
      ) {
        log.info({ planId: existing.id, status: existing.status }, 'reusing existing plan');
        emitLogLine(
          emit,
          directive.id,
          'info',
          'brain.planner',
          `planner: reusing existing plan (${String(existing.tasks.length)} task${existing.tasks.length === 1 ? '' : 's'}, status=${existing.status})`,
          { planId: existing.id },
        );
        plan = existing;
      } else {
        const plannerOut = await runPlanner({
          registry,
          projectPath,
          directiveId: directive.id,
          db,
          ...(limits !== undefined ? { limits } : {}),
          ...(emit !== undefined ? { emit } : {}),
        });
        plan = plannerOut.plan;
      }

      // Tier 15.13 — backward-compat: if the project has docs/knowledge/ but
      // no _schema.md, insert a migration task at the head of the plan to seed
      // the graph. All existing tasks gain a dependency on it.
      const knowledgeDir = join(projectPath, 'docs', 'knowledge');
      const schemaPath = join(knowledgeDir, '_schema.md');
      if (
        existsSync(knowledgeDir) &&
        !existsSync(schemaPath) &&
        plan.tasks.length > 0 &&
        !plan.tasks.some((t) => t.title === GRAPH_MIGRATION_TASK_TITLE)
      ) {
        log.info(
          { projectPath, planId: plan.id },
          'loop: graph migration needed — inserting graph-migration task at plan head',
        );
        emitLogLine(
          emit,
          directive.id,
          'info',
          'brain.loop',
          'loop: inserting graph-migration task (project predates knowledge graph)',
          { projectPath },
        );
        const migrationTask = buildGraphMigrationTask(plan.id);
        // All existing tasks gain a dependency on the migration task
        for (const t of plan.tasks) {
          if (!t.dependsOn.includes(migrationTask.id)) {
            t.dependsOn = [migrationTask.id, ...t.dependsOn];
          }
        }
        plan.tasks.unshift(migrationTask);
      }

      // Assisted-mode checkpoint after planner. Gives the user a chance to
      // abort before any paid worker tasks start — the highest-leverage
      // checkpoint in the pipeline.
      if (directive.autonomy === 'assisted') {
        const ck = await runCheckpoint(
          `Plan ready (${String(plan.tasks.length)} task${plan.tasks.length === 1 ? '' : 's'}). Continue to execution?`,
        );
        if (isAbortAnswer(ck)) {
          await appendBuildLog(
            projectPath,
            `user aborted at planner checkpoint: ${ck.answer ?? '(no answer)'}`,
          );
          directivesQ.updateStatus(db, directive.id, 'blocked');
          emitDirectiveCompleted(emit, directive.id, 'blocked', undefined);
          const resBlocked: InlineResult = {
            directive,
            triage,
            plan,
            taskResults: [],
            terminalStatus: 'blocked',
          };
          if (architect !== undefined) resBlocked.architect = architect;
          return resBlocked;
        }
      }

      // -------- DELEGATE --------
      const taskResults = await runPlanTasks(
        plan,
        registry,
        db,
        directive.id,
        opts.signal,
        opts.concurrency,
        limits,
        emit,
      );

      // -------- ASSESS --------
      const expectedModules = collectExpectedModules(plan);
      const runtime = extractRuntime(directive);
      const assessment = await assess({
        projectPath,
        expectedModules,
        testFramework: 'auto',
        ...(runtime !== undefined ? { runtime } : {}),
      });
      await appendBuildLog(
        projectPath,
        `assessor: build=${String(assessment.gateResults.build)} integration=${String(assessment.gateResults.integration)} verify=${String(assessment.gateResults.verify)}`,
      );

      const openFindings = await listFindings(projectPath, { status: 'OPEN' });
      const advisoryFindings = openFindings.filter(isAdvisory);
      const blockingFindings = openFindings.filter((f) => !isAdvisory(f));
      // ADR 0018: advisory findings (today: verifier source by default) never
      // enter `hadFailures`. Assessor gate results remain the sole ground truth.
      // `let` because the final-verification validator below may flip it to true.
      let hadFailures =
        taskResults.some((r) => r.exitCode !== 0) || !assessment.gateResults.verify;

      // Autonomous mode never silently finishes with failures — escalate (ADR 0005).
      // The call blocks until the user answers or the brain is aborted. The
      // directive still ends up `blocked` here; a follow-up session (or a
      // future planner-driven retry loop) can route the answer back in.
      if (hadFailures && directive.autonomy === 'autonomous') {
        // Tier 15.13 — self-healing fix loop. Before escalating to the operator,
        // dispatch the fixer agent for any auto-fixable findings. Up to N
        // attempts; zero-progress detection breaks early.
        const MAX_FIXER_ATTEMPTS = 3;
        let autoFixableRemaining = (
          await listFindings(projectPath, { status: 'OPEN' })
        ).filter((f) => f.auto_fixable === true);

        let attemptIndex = 0;
        while (autoFixableRemaining.length > 0 && attemptIndex < MAX_FIXER_ATTEMPTS) {
          attemptIndex++;
          log.info(
            {
              directiveId: directive.id,
              attempt: attemptIndex,
              maxAttempts: MAX_FIXER_ATTEMPTS,
              findingCount: autoFixableRemaining.length,
            },
            'loop: dispatching fixer for auto-fixable findings',
          );

          const findingsContext = autoFixableRemaining
            .map(
              (f) =>
                `- ID: ${f.id}\n  Category: ${f.category ?? 'other'}\n  Severity: ${f.severity}\n  Location: ${f.location?.file ?? f.target}${f.location?.frontmatter_field !== undefined ? ` (front-matter: ${f.location.frontmatter_field})` : ''}\n  Title: ${f.title ?? f.description}\n  Why: ${f.why ?? '(no detail)'}\n  Suggested fix: ${f.suggested_fix ?? '(no suggestion)'}`,
            )
            .join('\n\n');

          const fixerTask: Task = {
            id: newId(),
            planId: plan.id,
            title: `Self-healing fixer attempt ${String(attemptIndex)}/${String(MAX_FIXER_ATTEMPTS)}`,
            agent: 'fixer',
            category: 'reasoning',
            inputs: {
              files: [
                ...new Set(
                  autoFixableRemaining
                    .map((f) => f.location?.file ?? f.target)
                    .filter((p): p is string => typeof p === 'string'),
                ),
              ],
              context: `## Findings to resolve\n\n${findingsContext}`,
            },
            expectedOutputs: { files: [], signals: [] },
            dependsOn: [],
            status: 'pending',
            attempts: 0,
            featureIds: [],
          };

          const before = autoFixableRemaining.length;
          const beforeIds = new Set(autoFixableRemaining.map((f) => f.id));

          try {
            await executeTask(fixerTask, plan, registry, db, directive.id, opts.signal, emit);
          } catch (err) {
            log.warn(
              { err, attempt: attemptIndex, directiveId: directive.id },
              'loop: fixer attempt threw — stopping self-healing loop',
            );
            break;
          }

          // Re-query findings to see what changed
          autoFixableRemaining = (
            await listFindings(projectPath, { status: 'OPEN' })
          ).filter((f) => f.auto_fixable === true);

          // Zero-progress detection: if no findings resolved AND no new ones appeared
          const after = autoFixableRemaining.length;
          const stillSame = autoFixableRemaining.every((f) => beforeIds.has(f.id));
          if (after === before && stillSame) {
            log.warn(
              {
                directiveId: directive.id,
                attempt: attemptIndex,
                remaining: after,
              },
              'loop: fixer made zero progress — breaking out to escalation',
            );
            break;
          }
        }

        if (autoFixableRemaining.length === 0) {
          log.info(
            { directiveId: directive.id, attempts: attemptIndex },
            'loop: self-healing resolved all auto-fixable findings',
          );
          // Nothing to clear here: per ADR 0018 findings never set `hadFailures`
          // (only task exit codes + the assessor verify gate do), and neither
          // changed during the self-heal loop — so recomputing that same
          // expression always reproduces the current value. Reflecting the
          // fixer's merges would require re-running the assessor, a separate
          // ADR-gated behavior change.
        }

        if (hadFailures) {
          const failedTasks = taskResults.filter((r) => r.exitCode !== 0);
          const escalationOpts: Parameters<typeof escalateBlocked>[0] = {
            db,
            directiveId: directive.id,
            reason: `${String(failedTasks.length)} task(s) failed and/or verify gate did not pass`,
            attempted:
              failedTasks.length === 0
                ? [`assessor.verify=${String(assessment.gateResults.verify)}`]
                : failedTasks.map(
                    (r) =>
                      `task ${r.taskId}: exit ${String(r.exitCode)}${r.error !== undefined ? ` — ${r.error}` : ''}`,
                  ),
            suggestions: [
              'reply "skip" to mark this build blocked and move on',
              'reply "retry" to try again from the top (brain will re-run `factory build`)',
              'reply with a specific fix instruction',
            ],
            ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
            // Tier 15.13 — structured self-healing context
            ...(attemptIndex > 0
              ? { fixerAttempts: { tried: attemptIndex, max: MAX_FIXER_ATTEMPTS } }
              : {}),
            ...(autoFixableRemaining.length > 0
              ? {
                  remainingFindings: autoFixableRemaining.map((f) => {
                    const loc = f.location;
                    return {
                      id: f.id,
                      ...(f.category !== undefined && { category: f.category }),
                      ...(f.title !== undefined && { title: f.title }),
                      ...(f.why !== undefined && { why: f.why }),
                      ...(f.suggested_fix !== undefined && { suggested_fix: f.suggested_fix }),
                      ...(loc !== undefined && {
                        location: {
                          file: loc.file,
                          ...(loc.line !== undefined && { line: loc.line }),
                          ...(loc.anchor !== undefined && { anchor: loc.anchor }),
                          ...(loc.frontmatter_field !== undefined && {
                            frontmatter_field: loc.frontmatter_field,
                          }),
                        },
                      }),
                    };
                  }),
                }
              : {}),
          };
          const res = await escalateBlocked(escalationOpts);
          if (res.answer !== undefined) {
            await appendBuildLog(projectPath, `escalation answered: ${res.answer}`);
          } else if (res.aborted) {
            await appendBuildLog(projectPath, 'escalation aborted (brain shutdown)');
          } else if (res.timedOut) {
            await appendBuildLog(projectPath, 'escalation timed out — no human reply');
          }
        }
      }

      // Tier 15.13 — final knowledge graph validation. Runs against the
      // fully-integrated project at directive end. This is the gate that
      // catches doc-fiction + dead-code + reference integrity issues that
      // only become detectable once all task merges are in main. Skipped
      // when the directive already failed (the existing findings + the
      // failed task surface are enough signal for the operator).
      if (!hadFailures) {
        try {
          const planTaskIds = taskResults.map((r) => r.taskId);
          const finalValidation = await validateKnowledgeGraph({
            projectPath,
            taskIds: planTaskIds,
          });
          if (!finalValidation.ok) {
            log.info(
              { directiveId: directive.id, findingCount: finalValidation.findings.length },
              'loop: final-verification surfaced findings',
            );
            for (const pf of finalValidation.findings) {
              try {
                await addFinding(projectPath, {
                  source: 'verifier',
                  target: pf.location.file,
                  severity: pf.severity === 'high' ? 'HIGH' : pf.severity === 'medium' ? 'MEDIUM' : 'LOW',
                  description: pf.title,
                  category: pf.category,
                  location: pf.location,
                  title: pf.title,
                  why: pf.why,
                  suggested_fix: pf.suggested_fix,
                  auto_fixable: pf.auto_fixable,
                });
              } catch (persistErr) {
                log.warn(
                  { err: persistErr, directiveId: directive.id, partialFinding: pf },
                  'loop: failed to persist final-verification finding',
                );
              }
            }
            hadFailures = true;
          }
        } catch (validatorErr) {
          log.warn(
            { err: validatorErr, directiveId: directive.id },
            'loop: final-verification validator threw — non-fatal, directive completes per task results',
          );
        }
      }

      const terminalStatus: Directive['status'] = hadFailures ? 'blocked' : 'complete';
      directivesQ.updateStatus(db, directive.id, terminalStatus);
      emitDirectiveCompleted(emit, directive.id, terminalStatus, undefined);

      const totalCost = modelUsage.totalCostForDirective(db, directive.id);
      const findingsCountPhrase =
        advisoryFindings.length > 0
          ? `${String(blockingFindings.length)} blocking + ${String(advisoryFindings.length)} advisory`
          : String(blockingFindings.length);
      await appendBuildLog(
        projectPath,
        `brain: inline run ended (status=${terminalStatus}, open findings=${findingsCountPhrase}, spend=$${totalCost.toFixed(4)})`,
      );
      log.info(
        {
          directiveId: directive.id,
          terminalStatus,
          openFindings: openFindings.length,
          blockingFindings: blockingFindings.length,
          advisoryFindings: advisoryFindings.length,
          totalCostUsd: totalCost,
        },
        'brain: inline run complete',
      );
      emitLogLine(
        emit,
        directive.id,
        terminalStatus === 'complete' ? 'info' : 'warn',
        'brain.loop',
        `brain: directive ${terminalStatus} (open findings=${findingsCountPhrase}, spend=$${totalCost.toFixed(4)})`,
        { terminalStatus, totalCostUsd: totalCost },
      );

      const result: InlineResult = {
        directive,
        triage,
        plan,
        taskResults,
        assessment,
        terminalStatus,
      };
      if (architect !== undefined) result.architect = architect;
      return result;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        const reason = formatBlockedReason(err.detail);
        log.warn(
          { directiveId: directive.id, detail: err.detail, reason },
          'brain: directive halted by pre-call budget check',
        );
        emitLogLine(emit, directive.id, 'warn', 'brain.loop', `brain: blocked — ${reason}`, {
          detail: err.detail,
        });
        directivesQ.markBlocked(db, directive.id, reason);
        emitDirectiveCompleted(emit, directive.id, 'blocked', reason);
        outbound.enqueue(db, {
          id: newId(),
          directiveId: directive.id,
          targetChannel: directive.source,
          targetRef: directive.channelRef,
          text: `[budget] ${reason} — run \`factory resume ${directive.id} --max-usd <higher>\` to continue.`,
          createdAt: new Date().toISOString(),
          attempts: 0,
        });
        const refreshed = directivesQ.getById(db, directive.id) ?? directive;
        return {
          directive: refreshed,
          taskResults: [],
          terminalStatus: 'blocked',
        };
      }
      throw err;
    }
  } finally {
    if (owned) db.close();
  }
}

function renderDirectiveForTriage(d: Directive): string {
  const payload =
    typeof d.payload === 'object' && d.payload !== null
      ? JSON.stringify(d.payload)
      : String(d.payload);
  return `[source=${d.source}] [principal=${d.principal}] [intent=${d.intent}] ${payload}`;
}

function extractProjectPath(d: Directive): string {
  if (typeof d.payload === 'object' && d.payload !== null) {
    const p = d.payload as Record<string, unknown>;
    const candidate = p['projectPath'] ?? p['project'];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  throw new Error(
    `directive ${d.id}: payload.projectPath (or payload.project) is required for build intent`,
  );
}

/**
 * Non-throwing variant of {@link extractProjectPath}. Returns `undefined`
 * for directives whose payload legitimately lacks a project root (chat,
 * system, generic auto-answer questions). Used by the triage call site
 * to thread `projectPath` into the cwd-isolation guard without forcing
 * a hard failure for pre-triage directives whose intent hasn't been
 * classified as 'build' yet.
 */
function extractProjectPathSafely(d: Directive): string | undefined {
  if (typeof d.payload === 'object' && d.payload !== null) {
    const p = d.payload as Record<string, unknown>;
    const candidate = p['projectPath'] ?? p['project'];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return undefined;
}

/**
 * Pull the assessor runtime (ADR 0026) from the directive's payload. Returns
 * `undefined` for directives that predate the language field — `assess()`
 * then falls back to its `'python'` default, preserving tier-1/2 behaviour.
 */
function extractRuntime(d: Directive): Runtime | undefined {
  if (typeof d.payload === 'object' && d.payload !== null) {
    const p = d.payload as Record<string, unknown>;
    const raw = p['language'];
    if (raw === 'python' || raw === 'node' || raw === 'go' || raw === 'rust') return raw;
  }
  return undefined;
}

/**
 * Interpret an {@link AskUserResult} as an abort signal. Treats explicit
 * "abort", "cancel", "stop", or "no" answers as aborts; aborted signals
 * and timeouts also count (the brain shuts down before continuing). Any
 * other text is treated as "continue".
 */
function isAbortAnswer(res: AskUserResult): boolean {
  if (res.aborted) return true;
  if (res.timedOut) return true;
  const ans = (res.answer ?? '').trim().toLowerCase();
  return /^(abort|cancel|stop|no|quit|exit)\b/.test(ans);
}

/**
 * Feature F2 — load project-level budget defaults for unified resolution.
 * Uses the shared {@link projectBudgetsFromMetadata} transform (pool-usage.ts)
 * to avoid duplicating extraction logic. Falls back to empty defaults on read
 * failure so the brain never crashes on a corrupt `project.json`.
 */
async function loadProjectBudgetsForDirective(projectPath: string): Promise<ProjectBudgetsLike> {
  try {
    const metadata = await loadOrCreateProjectMetadata(projectPath, '');
    return projectBudgetsFromMetadata(metadata);
  } catch (err) {
    log.warn(
      { err, projectPath },
      'loop: failed to load project.json — falling back to BUDGET_DEFAULTS',
    );
    return { budgetDefaults: {} };
  }
}

function collectExpectedModules(plan: Plan): string[] {
  const out = new Set<string>();
  for (const t of plan.tasks) {
    for (const f of t.expectedOutputs.files) out.add(f);
  }
  return [...out];
}

export async function runBrain(opts: BrainOptions): Promise<BrainHandle> {
  if (opts.mode === 'serve') {
    return startServeMode(opts);
  }
  if (opts.directiveId === undefined) {
    throw new Error('runBrain: mode=inline requires directiveId');
  }
  const done = runInline({ ...opts, directiveId: opts.directiveId });
  return {
    done,
    stop: async () => undefined,
  };
}

/**
 * Wire the serve-mode loop: build an AbortController that merges an
 * externally supplied signal with our own `stop()`, then run `runServe`
 * and expose the handle. The returned `done` resolves when the loop
 * drains cleanly; it rejects only on catastrophic errors the supervisor
 * should observe (DB closed mid-loop, etc.).
 */
async function startServeMode(opts: BrainOptions): Promise<BrainHandle> {
  const { db, owned } = ensureDatabase(opts.db);
  const registry = opts.registry ?? (await buildRegistryFromDisk());

  const ac = new AbortController();
  const onExternalAbort = (): void => ac.abort();
  if (opts.signal !== undefined) {
    if (opts.signal.aborted) ac.abort();
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const done = runServe({
    db,
    registry,
    signal: ac.signal,
    ...(opts.claimedBy !== undefined ? { claimedBy: opts.claimedBy } : {}),
    ...(opts.serveConcurrency !== undefined ? { concurrency: opts.serveConcurrency } : {}),
    ...(opts.onWake !== undefined ? { onWake: opts.onWake } : {}),
    ...(opts.emitDirectiveEvent !== undefined
      ? { emitDirectiveEvent: opts.emitDirectiveEvent }
      : {}),
  }).finally(() => {
    if (opts.signal !== undefined) {
      opts.signal.removeEventListener('abort', onExternalAbort);
    }
    if (owned) db.close();
  });

  return {
    done,
    stop: async () => {
      ac.abort();
      await done.catch(() => undefined);
    },
  };
}

// re-exports so `import { ... } from '@factory5/brain'` is the only thing apps need
export * from './agents/registry.js';
export * from './triage.js';
export * from './architect.js';
export * from './planner.js';
export * from './pool.js';
export * from './prompts.js';
export * from './provider-config.js';
export * from './usage.js';

// Re-export types consumers commonly need
export type { AutonomyMode };
