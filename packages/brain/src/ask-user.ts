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
  directives as directivesQ,
  outbound,
  pendingQuestions,
  type Database,
} from '@factory5/state';

const log = createLogger('brain.ask-user');

/** Default cadence for polling `pending_questions.answered_at`. */
const DEFAULT_POLL_INTERVAL_MS = 1000;

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
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .all(directiveId, question) as Array<{ id: string; taskId: string | null; answer: string }>;
  for (const r of rows) {
    if ((r.taskId ?? undefined) !== taskId) continue;
    return { id: r.id, answer: r.answer };
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
  let rehydrated = false;
  if (questionId !== undefined) {
    rehydrated = true;
    log.info(
      { directiveId: directive.id, questionId },
      'askUser: resuming polling on open question',
    );
  } else {
    // 3. New question: create row + enqueue outbound.
    questionId = newId();
    const createdAt = new Date().toISOString();
    pendingQuestions.create(opts.db, {
      id: questionId,
      directiveId: directive.id,
      ...(opts.taskId !== undefined ? { taskId: opts.taskId } : {}),
      question: opts.question,
      ...(opts.options !== undefined ? { options: opts.options } : {}),
      channel: directive.source,
      channelRef: directive.channelRef,
      createdAt,
      ...(opts.deadlineAt !== undefined ? { deadlineAt: opts.deadlineAt } : {}),
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
  const deadline =
    opts.deadlineAt !== undefined ? Date.parse(opts.deadlineAt) : Number.POSITIVE_INFINITY;

  while (!(opts.signal?.aborted === true)) {
    if (Date.now() >= deadline) {
      log.info({ questionId }, 'askUser: deadline passed without answer');
      return { questionId, timedOut: true, aborted: false, rehydrated };
    }
    const row = pendingQuestions.getById(opts.db, questionId);
    if (row === undefined) {
      // Race: row deleted out from under us (shouldn't happen; surface loud).
      throw new Error(`askUser: question ${questionId} disappeared mid-poll`);
    }
    if (row.answer !== undefined && row.answeredAt !== undefined) {
      log.info({ questionId, answerLen: row.answer.length }, 'askUser: answer received');
      return {
        questionId,
        answer: row.answer,
        timedOut: false,
        aborted: false,
        rehydrated,
      };
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
