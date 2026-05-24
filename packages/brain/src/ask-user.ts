/**
 * `askUser` / `escalateBlocked` — brain-side primitives that park execution
 * on a pending question until a human (or bot, or channel) writes an answer.
 *
 * ## Contract
 *
 *   - A call to {@link askUser} either finds an already-open question row that
 *     matches `(directiveId, question, taskId?)` or creates a new row. Finding
 *     an existing row is the brain-restart rehydration path — resuming the
 *     same phase calls `askUser` with the same arguments and continues
 *     waiting rather than double-asking.
 *   - On create, an outbound row is enqueued on the directive's originating
 *     channel (`targetChannel = directive.source`, `targetRef =
 *     directive.channelRef`) so the user sees the question in whatever client
 *     they kicked the work off from.
 *   - The helper then polls {@link pendingQuestions.getById} every
 *     `pollIntervalMs` (default 1 s) until `answered_at` is set, the abort
 *     signal fires, or `deadlineAt` passes.
 *   - {@link escalateBlocked} is a semantic variant: same plumbing, but the
 *     question is formatted as the "I'm stuck — here's what I tried" prompt
 *     from ADR 0005, and a no-answer result surfaces as `{ aborted: false,
 *     timedOut: true }` so callers can mark the directive blocked rather
 *     than retrying.
 *
 * ## Why brain-level and not worker-level (for now)
 *
 * See ADR 0015. A worker subprocess can't cheaply suspend — once `claude -p`
 * is streaming, we either ride it to completion or kill it. So Phase 4 puts
 * `askUser` at phase boundaries in the brain pipeline (architect → planner,
 * pool → assess, etc.) where we already checkpoint. In-worker `ask_user`
 * tool routing is Phase 5+.
 */

import type { Directive } from '@factory5/core';
import { newId } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import {
  AUTO_ANSWER_IN_FLIGHT,
  DEFAULT_ASK_USER_DEADLINE_MS,
  directives as directivesQ,
  loadConfig,
  outbound,
  pendingQuestions,
  type Database,
} from '@factory5/state';

import { resolveAxisCap, type ProjectBudgetsLike } from './pool-usage.js';

const log = createLogger('brain.ask-user');

/** Default cadence for polling `pending_questions.answered_at`. */
const DEFAULT_POLL_INTERVAL_MS = 1000;

/**
 * U038 — when the askUser deadline elapses but the Tier 8 auto-answer
 * dispatcher has already claimed the question (sentinel:
 * `answered_by = 'agent'` + `answer = AUTO_ANSWER_IN_FLIGHT`),
 * extend polling by this grace window for the dispatcher's LLM call
 * to finalize. Observed worst-case auto-answer latency in 2026-05-23
 * pythonetl was ~14 s; the 30 s default doubles that headroom while
 * still bounding the wait so a wedged dispatcher can't park the
 * directive indefinitely. Callers (and tests) can override via
 * {@link AskUserOptions.gracePeriodMs}.
 */
const DEFAULT_AUTO_ANSWER_GRACE_MS = 30_000;

/**
 * Cached `<dataDir>/config.json.askUserDeadlineMs`. Set on first call to
 * {@link askUser} so we don't read+parse the config file on every emission.
 * The brain process is long-lived; the config file is hand-edited via a
 * daemon restart, so a process-lifetime cache is acceptable. Tests reset
 * via {@link resetDeadlineCache}.
 */
let cachedDeadlineMs: number | undefined = undefined;

/** Test-only: clear the deadline cache so a fresh config read fires. */
export function resetDeadlineCache(): void {
  cachedDeadlineMs = undefined;
}

/**
 * Resolve the askUser deadline in ms.
 *
 * Feature F2 — when `projectBudgets` + `db` + `directiveId` are available,
 * uses the unified three-way max rule:
 *   `max(project.json, payload.budgets, BUDGET_DEFAULTS.askUserDeadlineMs)`
 * so per-project + per-build deadline overrides take effect (Relay issue #3).
 *
 * Falls back to the config.json path when the unified inputs are not
 * available (backward compat for callers outside the inline pipeline).
 */
function resolveDeadlineMs(
  configDataDir?: string,
  unifiedInputs?: { db: Database; directiveId: string; projectBudgets: ProjectBudgetsLike },
): number {
  // Feature F2 — unified resolution path (Relay issue #3).
  if (unifiedInputs !== undefined) {
    return resolveAxisCap(
      unifiedInputs.db,
      unifiedInputs.directiveId,
      'askUserDeadlineMs',
      unifiedInputs.projectBudgets,
    );
  }
  // Legacy config.json path — process-lifetime cache.
  if (cachedDeadlineMs !== undefined) return cachedDeadlineMs;
  try {
    cachedDeadlineMs = loadConfig(configDataDir).askUserDeadlineMs;
  } catch (err) {
    // Corrupt config file is operator-visible; log and fall back to default
    // rather than crash the brain on every ask_user emission.
    log.warn({ err }, 'askUser: config.json read failed — using DEFAULT_ASK_USER_DEADLINE_MS');
    cachedDeadlineMs = DEFAULT_ASK_USER_DEADLINE_MS;
  }
  return cachedDeadlineMs;
}

export interface AskUserOptions {
  db: Database;
  /** Directive whose channel the question is posted back to. */
  directiveId: string;
  /** Optional task id — threads the question to a specific task's context. */
  taskId?: string;
  /** The question prompt, already rendered in user-facing language. */
  question: string;
  /** Optional enumerated choices the user can pick from. */
  options?: string[];
  /** ISO8601 timestamp after which the helper gives up and returns `timedOut: true`. */
  deadlineAt?: string;
  /** Abort signal (e.g. daemon shutdown). */
  signal?: AbortSignal;
  /** Poll cadence in ms. Default 1000. */
  pollIntervalMs?: number;
  /**
   * U038 — when {@link deadlineAt} elapses but the Tier 8 auto-answer
   * dispatcher has already claimed this question (sentinel:
   * `answered_by = 'agent'` + `answer = AUTO_ANSWER_IN_FLIGHT`),
   * keep polling for this many ms past the nominal deadline so the
   * dispatcher's LLM call gets a chance to land. Defaults to
   * {@link DEFAULT_AUTO_ANSWER_GRACE_MS} (30 s). Tests pass small
   * values; production omits.
   */
  gracePeriodMs?: number;
  /**
   * Outbound text override. By default the helper formats
   *   "(question qX) Q: <question>\n  1) opt-a\n  2) opt-b\n  Reply with `factory answer qX <text>`."
   * If you pass a function it's called with the question id and whatever
   * it returns becomes the outbound message text.
   */
  renderOutbound?: (ctx: AskUserRenderContext) => string;
  /**
   * Optional synchronous callback fired once the helper has resolved the
   * `pending_questions.id` it will poll on — whether a new row was created
   * or an existing open row was rehydrated. Lets callers wire side effects
   * keyed off the question id (e.g. ADR 0024 §4 marking the linked
   * `tasks_inflight` row `'waiting_for_human'` so brain-startup orphan
   * recovery can find it).
   *
   * Fires before polling begins. Throwing from this callback aborts the
   * helper.
   */
  onQuestionResolved?: (questionId: string) => void;
  /**
   * Test injection for the deadline-stamping clock. Production callers omit
   * and {@link Date.now} is used. Affects only the auto-stamped deadline
   * (when `deadlineAt` isn't passed); the abort+poll loop uses real time.
   */
  now?: () => number;
  /**
   * Test injection for the config-file lookup. Production callers omit and
   * `<dataDir>/config.json` is read. Affects only the auto-stamped deadline.
   */
  configDataDir?: string;
  /**
   * Feature F2 — project-level budget defaults from `project.json`. When
   * provided, the deadline resolves via the unified three-way max rule
   * (`max(project, payload, BUDGET_DEFAULTS)`) instead of the legacy
   * config.json-only path (Relay issue #3).
   */
  projectBudgets?: ProjectBudgetsLike;
}

export interface AskUserRenderContext {
  questionId: string;
  directiveId: string;
  taskId?: string;
  question: string;
  options?: string[];
}

export interface AskUserResult {
  questionId: string;
  answer?: string;
  /** True if deadline passed without an answer. */
  timedOut: boolean;
  /** True if signal aborted before answer/timeout. */
  aborted: boolean;
  /** True if we found an existing pending row and didn't re-enqueue. */
  rehydrated: boolean;
}

/**
 * Find the first open (not-yet-answered) question on this directive that
 * matches `question` text and optional `taskId`. Returns the row id so the
 * caller can resume polling on it.
 */
function findOpenMatch(
  db: Database,
  directiveId: string,
  question: string,
  taskId: string | undefined,
): string | undefined {
  const existing = pendingQuestions.openForDirective(db, directiveId);
  for (const q of existing) {
    if (q.question !== question) continue;
    if ((q.taskId ?? undefined) !== taskId) continue;
    return q.id;
  }
  return undefined;
}

/**
 * Find any previously-answered question on this directive that matches
 * `question` text + optional `taskId`. Lets us rehydrate an answer without
 * re-asking when the brain is resumed after the answer already came in.
 *
 * U038 — rows whose `answer` is the {@link AUTO_ANSWER_IN_FLIGHT}
 * sentinel are NOT yet finalized; the auto-answer dispatcher writes
 * the placeholder atomically at claim time and overwrites with the
 * real reply on finalize. Skipping them here lets the caller fall
 * through to the open-match / poll path and respect the in-flight
 * grace window.
 */
function findAnsweredMatch(
  db: Database,
  directiveId: string,
  question: string,
  taskId: string | undefined,
): { id: string; answer: string } | undefined {
  const rows = db
    .prepare(
      `SELECT id, task_id AS taskId, answer
         FROM pending_questions
        WHERE directive_id = ?
          AND question = ?
          AND answered_at IS NOT NULL
          AND answer IS NOT NULL
          AND answer != ?
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .all(directiveId, question, AUTO_ANSWER_IN_FLIGHT) as Array<{
    id: string;
    taskId: string | null;
    answer: string;
  }>;
  for (const r of rows) {
    if ((r.taskId ?? undefined) !== taskId) continue;
    return { id: r.id, answer: r.answer };
  }
  return undefined;
}

/**
 * U038 — find any in-flight auto-answer row matching this question.
 * The auto-answer dispatcher's claim sentinel sets `answered_at` non-
 * null (so {@link findOpenMatch}'s `answered_at IS NULL` predicate
 * skips it) yet the row is still genuinely "waiting on a real answer"
 * — the LLM call hasn't finalized. Returns the row id so the caller
 * can poll on it within the in-flight grace window rather than
 * re-asking the operator.
 */
function findInFlightAutoAnswerMatch(
  db: Database,
  directiveId: string,
  question: string,
  taskId: string | undefined,
): string | undefined {
  const rows = db
    .prepare(
      `SELECT id, task_id AS taskId
         FROM pending_questions
        WHERE directive_id = ?
          AND question = ?
          AND answer = ?
          AND answered_by = 'agent'
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .all(directiveId, question, AUTO_ANSWER_IN_FLIGHT) as Array<{
    id: string;
    taskId: string | null;
  }>;
  for (const r of rows) {
    if ((r.taskId ?? undefined) !== taskId) continue;
    return r.id;
  }
  return undefined;
}

/**
 * Default outbound-message formatter — used when the caller doesn't supply
 * {@link AskUserOptions.renderOutbound}. Kept separately so tests can assert
 * on the exact text shape.
 */
export function defaultAskUserOutbound(ctx: AskUserRenderContext): string {
  const lines = [`(question ${ctx.questionId})`, `Q: ${ctx.question}`];
  if (ctx.options !== undefined && ctx.options.length > 0) {
    lines.push('Options:');
    for (let i = 0; i < ctx.options.length; i++) {
      lines.push(`  ${String(i + 1)}) ${ctx.options[i] ?? ''}`);
    }
  }
  lines.push('', `Reply with: factory answer ${ctx.questionId} <text>`);
  return lines.join('\n');
}

/**
 * Park execution on a pending question. Resolves when an answer is
 * written to `pending_questions.answer` for this question, the deadline
 * passes, or the signal aborts.
 */
export async function askUser(opts: AskUserOptions): Promise<AskUserResult> {
  const directive: Directive | undefined = directivesQ.getById(opts.db, opts.directiveId);
  if (directive === undefined) {
    throw new Error(`askUser: directive ${opts.directiveId} not found`);
  }

  // 1. Already-answered? Return the previous answer without re-asking.
  const answered = findAnsweredMatch(opts.db, directive.id, opts.question, opts.taskId);
  if (answered !== undefined) {
    log.info(
      { directiveId: directive.id, questionId: answered.id },
      'askUser: rehydrated previously-answered question',
    );
    // Skip onQuestionResolved on the answered-already path — there's no
    // poll-loop to protect, so callers don't need to stage wait state.
    return {
      questionId: answered.id,
      answer: answered.answer,
      timedOut: false,
      aborted: false,
      rehydrated: true,
    };
  }

  // 2. Open and waiting? Resume polling on the existing row.
  let questionId = findOpenMatch(opts.db, directive.id, opts.question, opts.taskId);
  let resumeKind: 'open' | 'in-flight' | 'new' = 'open';
  // U038 — fall back to an in-flight auto-answer match: a row whose
  // `answer = AUTO_ANSWER_IN_FLIGHT` is genuinely still pending even
  // though `answered_at` is set. Resume polling on it within the
  // grace window rather than re-asking the operator.
  if (questionId === undefined) {
    questionId = findInFlightAutoAnswerMatch(opts.db, directive.id, opts.question, opts.taskId);
    if (questionId !== undefined) {
      resumeKind = 'in-flight';
    }
  }
  let rehydrated = false;
  if (questionId !== undefined) {
    rehydrated = true;
    log.info(
      { directiveId: directive.id, questionId, resumeKind },
      resumeKind === 'in-flight'
        ? 'askUser: resuming polling on in-flight auto-answer claim'
        : 'askUser: resuming polling on open question',
    );
  } else {
    resumeKind = 'new';
    // 3. New question: create row + enqueue outbound.
    questionId = newId();
    const now = opts.now ?? ((): number => Date.now());
    const createdAt = new Date(now()).toISOString();
    // Stamp deadline (ADR 0030 §2 + Feature F2 unified resolution):
    // caller-provided `deadlineAt` wins; otherwise resolved via the unified
    // three-way max rule when projectBudgets is available (Relay issue #3),
    // falling back to config.json.askUserDeadlineMs when it is not.
    const unifiedInputs =
      opts.projectBudgets !== undefined
        ? { db: opts.db, directiveId: directive.id, projectBudgets: opts.projectBudgets }
        : undefined;
    const deadlineAt =
      opts.deadlineAt ??
      new Date(now() + resolveDeadlineMs(opts.configDataDir, unifiedInputs)).toISOString();
    pendingQuestions.create(opts.db, {
      id: questionId,
      directiveId: directive.id,
      ...(opts.taskId !== undefined ? { taskId: opts.taskId } : {}),
      question: opts.question,
      ...(opts.options !== undefined ? { options: opts.options } : {}),
      channel: directive.source,
      channelRef: directive.channelRef,
      createdAt,
      deadlineAt,
    });
    const outboundText = (opts.renderOutbound ?? defaultAskUserOutbound)({
      questionId,
      directiveId: directive.id,
      ...(opts.taskId !== undefined ? { taskId: opts.taskId } : {}),
      question: opts.question,
      ...(opts.options !== undefined ? { options: opts.options } : {}),
    });
    outbound.enqueue(opts.db, {
      id: newId(),
      directiveId: directive.id,
      targetChannel: directive.source,
      targetRef: directive.channelRef,
      text: outboundText,
      metadata: { kind: 'ask_user', questionId },
      createdAt,
      attempts: 0,
    });
    log.info(
      {
        directiveId: directive.id,
        questionId,
        channel: directive.source,
        channelRef: directive.channelRef,
      },
      'askUser: new question enqueued',
    );
  }

  // Fire the resolution callback before polling so callers can stage state
  // that depends on the questionId (ADR 0024 §4 — mark the task waiting).
  opts.onQuestionResolved?.(questionId);

  return pollForAnswer(opts, questionId, rehydrated);
}

async function pollForAnswer(
  opts: AskUserOptions,
  questionId: string,
  rehydrated: boolean,
): Promise<AskUserResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const gracePeriodMs = opts.gracePeriodMs ?? DEFAULT_AUTO_ANSWER_GRACE_MS;
  const nominalDeadline =
    opts.deadlineAt !== undefined ? Date.parse(opts.deadlineAt) : Number.POSITIVE_INFINITY;
  // U038 — extended once on first observed in-flight sentinel at timeout.
  // Stays at the nominal value if the dispatcher never claimed the row,
  // so the no-auto-answer path still times out exactly at deadline.
  let effectiveDeadline = nominalDeadline;
  let graceLogged = false;

  while (!(opts.signal?.aborted === true)) {
    const row = pendingQuestions.getById(opts.db, questionId);
    if (row === undefined) {
      // Race: row deleted out from under us (shouldn't happen; surface loud).
      throw new Error(`askUser: question ${questionId} disappeared mid-poll`);
    }
    // Real answer landed (auto-answer finalized OR a human reply) — but
    // ignore the {@link AUTO_ANSWER_IN_FLIGHT} sentinel: the auto-answer
    // dispatcher claims the row with that placeholder before calling the
    // LLM, then overwrites with the real reply on finalize. Treating the
    // placeholder as the answer would surface "[in flight]" to the brain.
    if (
      row.answer !== undefined &&
      row.answeredAt !== undefined &&
      row.answer !== AUTO_ANSWER_IN_FLIGHT
    ) {
      log.info({ questionId, answerLen: row.answer.length }, 'askUser: answer received');
      return {
        questionId,
        answer: row.answer,
        timedOut: false,
        aborted: false,
        rehydrated,
      };
    }

    // Deadline check runs AFTER the answer check so a finalized answer
    // landing on the exact deadline tick still wins over the timeout.
    if (Date.now() >= effectiveDeadline) {
      // U038 — if an auto-answer is in flight, extend by gracePeriodMs
      // once for the LLM call to finalize. The sentinel write is atomic;
      // observing it here means the dispatcher won the claim and is
      // committed to writing a real answer (or `[auto-answer failed: ...]`)
      // on its own finalize path.
      const inFlight =
        row.answer === AUTO_ANSWER_IN_FLIGHT && (row.answeredBy ?? undefined) === 'agent';
      if (inFlight && effectiveDeadline === nominalDeadline) {
        effectiveDeadline = Date.now() + gracePeriodMs;
        graceLogged = true;
        log.info(
          { questionId, gracePeriodMs },
          'askUser: deadline reached but auto-answer in flight — extending by grace window',
        );
      } else {
        log.info(
          { questionId, gracePeriodMs: graceLogged ? gracePeriodMs : undefined },
          graceLogged
            ? 'askUser: auto-answer grace window elapsed without finalize'
            : 'askUser: deadline passed without answer',
        );
        return { questionId, timedOut: true, aborted: false, rehydrated };
      }
    }
    await sleepOrAbort(pollIntervalMs, opts.signal);
  }

  log.info({ questionId }, 'askUser: aborted before answer');
  return { questionId, timedOut: false, aborted: true, rehydrated };
}

function sleepOrAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
    if (signal === undefined) return;
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    if (signal.aborted) {
      clearTimeout(timer);
      resolve();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// escalateBlocked
// ---------------------------------------------------------------------------

export interface EscalateBlockedOptions {
  db: Database;
  directiveId: string;
  taskId?: string;
  /** Short machine-friendly reason code; surfaces in the outbound. */
  reason: string;
  /** List of things the brain already tried. */
  attempted: string[];
  /** Follow-up actions the user might authorise. */
  suggestions: string[];
  deadlineAt?: string;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  /** See {@link AskUserOptions.gracePeriodMs} (U038). */
  gracePeriodMs?: number;
}

/** Default formatter for the "I'm stuck" message (ADR 0005). */
export function defaultEscalateOutbound(
  ctx: AskUserRenderContext & { reason: string; attempted: string[]; suggestions: string[] },
): string {
  const lines = [
    `(escalation ${ctx.questionId})`,
    `I'm stuck. Reason: ${ctx.reason}`,
    '',
    'Attempted:',
    ...ctx.attempted.map((a) => `  - ${a}`),
    '',
    'Suggestions:',
    ...ctx.suggestions.map((s) => `  - ${s}`),
    '',
    `Reply with: factory answer ${ctx.questionId} <direction>`,
  ];
  return lines.join('\n');
}

/**
 * Escalate a stuck task to the user. Same plumbing as {@link askUser}, but
 * the outbound message is formatted as the structured "I'm stuck — here's
 * what I tried" prompt and the stored question text is a stable JSON blob
 * so rehydration works on restart.
 */
export async function escalateBlocked(opts: EscalateBlockedOptions): Promise<AskUserResult> {
  // Use a stable, canonical question string so rehydration keys off it.
  const questionBody = JSON.stringify({
    reason: opts.reason,
    attempted: opts.attempted,
    suggestions: opts.suggestions,
  });
  const question = `[escalation] ${questionBody}`;

  const askOpts: AskUserOptions = {
    db: opts.db,
    directiveId: opts.directiveId,
    ...(opts.taskId !== undefined ? { taskId: opts.taskId } : {}),
    question,
    ...(opts.deadlineAt !== undefined ? { deadlineAt: opts.deadlineAt } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
    ...(opts.gracePeriodMs !== undefined ? { gracePeriodMs: opts.gracePeriodMs } : {}),
    renderOutbound: (ctx) =>
      defaultEscalateOutbound({
        ...ctx,
        reason: opts.reason,
        attempted: opts.attempted,
        suggestions: opts.suggestions,
      }),
  };
  return askUser(askOpts);
}

/**
 * Convenience: list any open questions for a directive. Useful for
 * operators and for `factory status` to surface "this directive is waiting
 * on N questions."
 */
export function openQuestionsForDirective(
  db: Database,
  directiveId: string,
): ReturnType<typeof pendingQuestions.openForDirective> {
  return pendingQuestions.openForDirective(db, directiveId);
}
