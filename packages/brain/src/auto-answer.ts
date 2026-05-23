/**
 * Tier 8 auto-answer dispatcher (ADR 0030).
 *
 * Periodically scans `pending_questions` for unanswered rows past their
 * deadline whose parent directive is still active, builds an LLM prompt
 * from the surrounding context (the question itself, the parent
 * directive, past Q&A in this directive), and dispatches an auto-answer
 * via the existing model/provider abstraction. Writes the result back
 * with `answered_by = 'agent'` (success) or `'agent-failed'`
 * (after one retry).
 *
 * The dispatcher uses a sentinel claim
 * ({@link pendingQuestions.claimForAutoAnswer}) before the LLM call so
 * a concurrent human reply via `factory answer` no-ops on the
 * already-claimed row. Race-loser human writes are logged at `warn` —
 * the answer is final, the human's input is discarded.
 *
 * The sweep runs from inside the brain's serve loop; see
 * `packages/brain/src/serve.ts`. Each tick does at most a single
 * `findOpenPastDeadline` query (cheap, indexed); LLM dispatches happen
 * asynchronously per matched row.
 */

import type { Directive, ModelCategory, PendingQuestion } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import type { ProviderRegistry } from '@factory5/providers';
import { directives as directivesQ, pendingQuestions, type Database } from '@factory5/state';

import { BUDGET_ESCALATION_MARKER } from './budget-escalation.js';
import { CRITIC_MARKER } from './architect-loop.js';
import { recordUsage } from './usage.js';

const log = createLogger('brain.auto-answer');

/** Category used for the auto-answer LLM call (ADR 0030 §6 spend taxonomy). */
const AUTO_ANSWER_CATEGORY: ModelCategory = 'quick';

/** Retry once on transient failures before falling through to the synthetic. */
const RETRY_BACKOFF_MS = 2000;

export interface AutoAnswerDeps {
  db: Database;
  registry: ProviderRegistry;
  /** Test injection: clock used for sweep `now` + answered_at timestamps. */
  now?: () => number;
  /**
   * Test injection: override the sweep batch size. Production omits and
   * falls back to {@link pendingQuestions.findOpenPastDeadline}'s default.
   */
  limit?: number;
}

export interface AutoAnswerOneDeps extends AutoAnswerDeps {
  /**
   * Test injection: override the backoff between the first and second
   * LLM call so the failure-path test isn't sleeping for seconds.
   */
  retryBackoffMs?: number;
}

/**
 * One sweep pass: scan for past-deadline open questions on active
 * directives, dispatch each via {@link autoAnswerOne}. Resolves once
 * every dispatched answer has settled (one tick = batch-bounded).
 */
export async function runAutoAnswerSweep(deps: AutoAnswerDeps): Promise<void> {
  const now = deps.now ?? ((): number => Date.now());
  const nowIso = new Date(now()).toISOString();
  const candidates = pendingQuestions.findOpenPastDeadline(deps.db, nowIso, deps.limit);
  if (candidates.length === 0) return;
  log.info({ count: candidates.length }, 'auto-answer: dispatching past-deadline questions');
  await Promise.allSettled(candidates.map((q) => autoAnswerOne(q, deps)));
}

/**
 * Handle a single past-deadline question:
 *   1. Claim the row (sentinel UPDATE) — bail if a concurrent reply won.
 *   2. Build the prompt from question + directive + past Q&A.
 *   3. Provider call; retry once on failure.
 *   4. Finalize: write the real answer with `answered_by = 'agent'`,
 *      record spend, log success.
 *   5. On double failure: write `[auto-answer failed: ...]` synthetic
 *      with `answered_by = 'agent-failed'`. No spend recorded (provider
 *      may or may not have charged for failed calls — reconciliation
 *      lives outside factory's accounting per ADR 0030 §6).
 */
export async function autoAnswerOne(q: PendingQuestion, deps: AutoAnswerOneDeps): Promise<void> {
  const now = deps.now ?? ((): number => Date.now());
  const claimedAt = new Date(now()).toISOString();
  const won = pendingQuestions.claimForAutoAnswer(deps.db, q.id, claimedAt);
  if (!won) {
    log.warn(
      { questionId: q.id, directiveId: q.directiveId },
      'auto-answer: claim lost — concurrent reply got there first',
    );
    return;
  }
  log.info(
    { questionId: q.id, directiveId: q.directiveId },
    'auto-answer: claim won — dispatching LLM call',
  );

  const directive = directivesQ.getById(deps.db, q.directiveId);
  if (directive === undefined) {
    // Directive vanished between sweep and dispatch (deleted? table corruption?).
    // Finalize with a 'agent-failed' synthetic so the row doesn't sit in the
    // [in flight] state forever.
    log.warn(
      { questionId: q.id, directiveId: q.directiveId },
      'auto-answer: directive disappeared during dispatch',
    );
    pendingQuestions.finalizeAutoAnswer(
      deps.db,
      q.id,
      `[auto-answer failed: directive ${q.directiveId} not found]`,
      new Date(now()).toISOString(),
      'agent-failed',
    );
    return;
  }

  // Tier 12 / ADR 0032 §5 — budget-escalation questions follow a
  // deterministic policy (bump-by-one-bucket on first failure, abort on
  // second), NOT an LLM dispatch. The policy is keyed off the count of
  // already-agent-answered budget-escalation questions on this directive,
  // so consecutive trips on the same axis follow bump-then-abort. Skip
  // the generic prompt-builder + LLM call entirely.
  if (q.question.startsWith(BUDGET_ESCALATION_MARKER)) {
    const answer = pickBudgetEscalationAnswer(deps.db, q);
    pendingQuestions.finalizeAutoAnswer(
      deps.db,
      q.id,
      answer,
      new Date(now()).toISOString(),
      'agent',
    );
    log.info(
      {
        questionId: q.id,
        directiveId: q.directiveId,
        answer,
      },
      'auto-answer: budget-escalation deterministic policy applied',
    );
    return;
  }

  // Tier 14 / ADR 0030 amendment — wiki-readiness exhaustion questions follow a
  // deterministic policy: always answer `continue` (preserves the advisory contract
  // for autonomous operation). No LLM call required — matches the [BUDGET] precedent.
  if (q.question.startsWith(CRITIC_MARKER)) {
    const answer = 'continue';
    pendingQuestions.finalizeAutoAnswer(
      deps.db,
      q.id,
      answer,
      new Date(now()).toISOString(),
      'agent',
    );
    log.info(
      {
        questionId: q.id,
        directiveId: q.directiveId,
        answer,
      },
      'auto-answer: wiki-readiness [CRITIC] deterministic policy applied (continue)',
    );
    return;
  }

  const pastQA = collectPastQA(deps.db, q.directiveId, q.id);
  const prompt = buildAutoAnswerPrompt(q, directive, pastQA);

  const retryBackoffMs = deps.retryBackoffMs ?? RETRY_BACKOFF_MS;
  const result = await callProviderWithOneRetry(prompt, deps, directive.id, retryBackoffMs);
  const finalizedAt = new Date(now()).toISOString();

  if (result.kind === 'ok') {
    pendingQuestions.finalizeAutoAnswer(deps.db, q.id, result.answer, finalizedAt, 'agent');
    log.info(
      {
        questionId: q.id,
        directiveId: q.directiveId,
        chars: result.answer.length,
        durationMs: result.durationMs,
      },
      'auto-answer: success',
    );
    return;
  }

  pendingQuestions.finalizeAutoAnswer(
    deps.db,
    q.id,
    `[auto-answer failed: ${result.reason}]`,
    finalizedAt,
    'agent-failed',
  );
  log.warn(
    { questionId: q.id, directiveId: q.directiveId, reason: result.reason },
    'auto-answer: failed both attempts — wrote agent-failed synthetic',
  );
}

interface ProviderOk {
  kind: 'ok';
  answer: string;
  durationMs: number;
}

interface ProviderFail {
  kind: 'fail';
  reason: string;
}

async function callProviderWithOneRetry(
  prompt: { systemPrompt: string; userPrompt: string },
  deps: AutoAnswerDeps,
  directiveId: string,
  retryBackoffMs: number,
): Promise<ProviderOk | ProviderFail> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      const resolution = await deps.registry.resolve(AUTO_ANSWER_CATEGORY);
      const response = await resolution.provider.call({
        model: resolution.model,
        systemPrompt: prompt.systemPrompt,
        messages: [{ role: 'user', content: prompt.userPrompt }],
        temperature: 0.2,
        maxTokens: 1024,
      });
      const durationMs = Date.now() - started;
      // Spend recorded only on success (ADR 0030 §6).
      recordUsage({
        db: deps.db,
        directiveId,
        category: AUTO_ANSWER_CATEGORY,
        resolution,
        response,
        durationMs,
        mode: 'call',
      });
      const answer = response.text.trim();
      if (answer.length === 0) {
        // Empty completion is treated as a failure — no useful answer to write.
        if (attempt === 1) {
          log.warn({ attempt }, 'auto-answer: empty response, retrying');
          await sleep(retryBackoffMs);
          continue;
        }
        return { kind: 'fail', reason: 'empty response after retry' };
      }
      return { kind: 'ok', answer, durationMs };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (attempt === 1) {
        log.warn({ err, attempt }, 'auto-answer: first call failed, retrying');
        await sleep(retryBackoffMs);
        continue;
      }
      return { kind: 'fail', reason };
    }
  }
  // Unreachable — the loop always returns.
  return { kind: 'fail', reason: 'unreachable' };
}

/**
 * Collect prior question/answer pairs for this directive (excluding the
 * one currently being auto-answered) so the LLM has consistency
 * context.
 */
function collectPastQA(
  db: Database,
  directiveId: string,
  excludeId: string,
): Array<{ question: string; answer: string }> {
  const rows = db
    .prepare(
      `SELECT question, answer
         FROM pending_questions
        WHERE directive_id = ?
          AND id != ?
          AND answered_at IS NOT NULL
          AND answer IS NOT NULL
        ORDER BY created_at ASC
        LIMIT 10`,
    )
    .all(directiveId, excludeId) as Array<{ question: string; answer: string }>;
  return rows;
}

/**
 * Build the system + user prompt the auto-answer LLM call uses.
 * Generic across emitting agents (verifier-emitted vs fixer-emitted vs
 * planner-emitted, etc.) — first ship doesn't tailor per agent class.
 * If quality data shows specific agent classes need specialization, a
 * follow-up tier can branch on `taskId`'s agent.
 */
export function buildAutoAnswerPrompt(
  q: PendingQuestion,
  directive: Directive,
  pastQA: Array<{ question: string; answer: string }>,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'You are answering a question on behalf of an absent human operator.',
    'A factory5 agent is mid-build and asked the operator to make a decision; the operator did not reply within the deadline.',
    'Pick the most defensible answer from the available context. Be concise: one short paragraph or a single option from the offered list.',
    'Do not refuse, do not ask follow-up questions, do not stall. The agent is waiting; provide a usable answer based on the surrounding context.',
    'If the question lists explicit options, pick one. If not, write one or two sentences of direction.',
    "Your reply will be recorded as 'answered_by = agent' so the operator can audit the auto-answer later.",
  ].join('\n');

  const optionLines =
    q.options !== undefined && q.options.length > 0
      ? ['Options:', ...q.options.map((opt, i) => `  ${String(i + 1)}) ${opt}`)].join('\n')
      : '';

  const directiveLines = [
    `Directive intent: ${directive.intent}`,
    `Directive autonomy: ${directive.autonomy}`,
    `Directive source: ${directive.source}`,
    `Directive payload: ${safeStringify(directive.payload)}`,
  ].join('\n');

  const pastQALines =
    pastQA.length > 0
      ? [
          '',
          'Past Q&A in this directive (for consistency):',
          ...pastQA.map(
            (pq, i) => `  Q${String(i + 1)}: ${pq.question}\n  A${String(i + 1)}: ${pq.answer}`,
          ),
        ].join('\n')
      : '';

  const userPrompt = [
    'Question requiring an answer:',
    q.question,
    optionLines,
    '',
    'Surrounding context:',
    directiveLines,
    pastQALines,
    '',
    'Write your answer below. Plain text, no JSON, no preamble.',
  ]
    .filter((s) => s.length > 0)
    .join('\n');

  return { systemPrompt, userPrompt };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') t.unref();
  });
}

/**
 * Tier 12 / ADR 0032 §5 — deterministic auto-answer for budget-escalation
 * questions.
 *
 * Policy:
 *   - First budget-escalation question on this directive scoped to the
 *     SAME task → `'accept'` (bump-by-one-bucket).
 *   - Second + → `'abort'` (let the directive's normal failed-task
 *     handling take over; prevents runaway bump loops).
 *
 * The count is scoped per task so a directive with multiple independent
 * tasks that each trip once gets one accept each; only repeated trips on
 * the SAME task abort. The query counts answered (final, not in-flight)
 * budget-escalation rows tagged `agent` whose task_id matches.
 */
function pickBudgetEscalationAnswer(db: Database, q: PendingQuestion): string {
  if (q.taskId === undefined) return 'abort';
  const priorAgentBumps = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM pending_questions
        WHERE directive_id = ?
          AND task_id = ?
          AND id != ?
          AND answered_by = 'agent'
          AND answer = 'accept'
          AND question LIKE ? || '%'`,
    )
    .get(q.directiveId, q.taskId, q.id, BUDGET_ESCALATION_MARKER) as { n: number };
  if (priorAgentBumps.n === 0) return 'accept';
  return 'abort';
}
