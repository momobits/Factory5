/**
 * Architect+critic retry orchestration (ADR 0033).
 *
 * Wraps `runArchitect` and `runWikiCritic` in a bounded retry loop. On the
 * Nth failed critique the loop escalates to the operator via askUser; the
 * operator may continue (proceed to planner with the last-attempt wiki),
 * abort (block the directive), or extend (N more attempts).
 *
 * Dependencies are injected to keep the wrapper testable in isolation —
 * the real `loop.ts` call site wires in the live `runArchitect` /
 * `runWikiCritic` / `askUser` / `readFile` implementations.
 *
 * @packageDocumentation
 */

import { readFile } from 'node:fs/promises';

import type { ModelCategory, WikiCritique } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import type { ProviderRegistry } from '@factory5/providers';
import type { Database } from '@factory5/state';
import { projectPaths } from '@factory5/wiki';

import type { DirectiveEventEmitter } from '@factory5/ipc';

import { emitLogLine } from './emit.js';
import type { ArchitectResult } from './architect.js';
import type { RunWikiCriticOptions } from './critic.js';

const log = createLogger('brain.architect-loop');

/** Marker prefix on askUser prompts; auto-answer dispatcher recognises it (ADR 0030 amendment). */
export const CRITIC_MARKER = '[CRITIC]';

/**
 * Convenience `askUser` signature used by the wrapper for DI.
 *
 * The real `ask-user.ts` function has a richer shape (requires `db`,
 * `directiveId`, `question`, returns `AskUserResult`). The wrapper operates
 * on an injected variant that already abstracts the DB/polling machinery and
 * returns a plain string answer. Task 8 (loop integration) wires the real
 * `askUser` behind this adapter.
 */
export type AskUserFn = (opts: {
  prompt: string;
  options: readonly string[];
  directiveId?: string;
}) => Promise<string>;

export interface RunArchitectWithCritiqueOptions {
  registry: ProviderRegistry;
  projectPath: string;
  directiveBody: string;
  /** Resolved attempt cap. 0 = unlimited (loop runs until the critic passes). */
  maxAttempts: number;
  db?: Database;
  directiveId?: string;
  limits?: { maxUsd?: number; maxSteps?: number };
  config?: { agents?: { architect?: ModelCategory; critic?: ModelCategory } };
  emit?: DirectiveEventEmitter;
  // --- injected dependencies (real call sites inject live implementations) ---
  runArchitect: (opts: ArchitectCallOpts) => Promise<ArchitectResult>;
  runWikiCritic: (opts: CriticCallOpts) => Promise<WikiCritique>;
  askUser: AskUserFn;
  /** Read CLAUDE.md from disk; injected for test isolation. */
  readClaudeMd?: (projectPath: string) => Promise<string>;
}

/** Subset of ArchitectOptions that the wrapper passes through. */
export interface ArchitectCallOpts {
  registry: ProviderRegistry;
  projectPath: string;
  db?: Database;
  directiveId?: string;
  limits?: { maxUsd?: number; maxSteps?: number };
  config?: { agents?: { architect?: ModelCategory; critic?: ModelCategory } };
  emit?: DirectiveEventEmitter;
  priorCritique?: WikiCritique;
}

/** Subset of RunWikiCriticOptions that the wrapper passes through. */
export type CriticCallOpts = Pick<
  RunWikiCriticOptions,
  | 'registry'
  | 'projectPath'
  | 'directiveBody'
  | 'claudeMd'
  | 'pages'
  | 'db'
  | 'directiveId'
  | 'limits'
  | 'config'
  | 'emit'
>;

export interface ArchitectLoopResult {
  architectResult: ArchitectResult;
  critique: WikiCritique;
  attempts: number;
  exhausted: boolean;
}

/** Thrown when the operator selects `abort` at exhaustion. */
export class WikiReadinessAbortError extends Error {
  constructor(public readonly lastCritique: WikiCritique) {
    super(`wiki-readiness aborted by operator: ${lastCritique.summary}`);
    this.name = 'WikiReadinessAbortError';
  }
}

/**
 * Run the architect→critic loop, retrying up to `maxAttempts` times. On
 * exhaustion, escalates to the operator via `askUser`; the operator can
 * continue (proceed with imperfect wiki), abort (block the directive), or
 * extend-3 (grant 3 more attempts).
 */
export async function runArchitectWithCritique(
  opts: RunArchitectWithCritiqueOptions,
): Promise<ArchitectLoopResult> {
  const readClaude = opts.readClaudeMd ?? defaultReadClaudeMd;
  const claudeMd = await readClaude(opts.projectPath);

  // Run the bounded retry loop, potentially recursing on extend-3.
  return runLoop(opts, claudeMd);
}

async function runLoop(
  opts: RunArchitectWithCritiqueOptions,
  claudeMd: string,
  initialPriorCritique?: WikiCritique,
): Promise<ArchitectLoopResult> {
  let architectResult!: ArchitectResult;
  let critique!: WikiCritique;
  let priorCritique: WikiCritique | undefined = initialPriorCritique;
  let attempts = 0;
  const cap = opts.maxAttempts === 0 ? Number.POSITIVE_INFINITY : opts.maxAttempts;
  const capLabel = opts.maxAttempts === 0 ? '∞' : String(opts.maxAttempts);

  while (attempts < cap) {
    attempts += 1;

    if (opts.directiveId !== undefined) {
      emitLogLine(
        opts.emit,
        opts.directiveId,
        'info',
        'brain.architect-loop',
        `critic: evaluating wiki (attempt ${String(attempts)}/${capLabel})`,
        { attempt: attempts },
      );
    }

    log.info(
      { projectPath: opts.projectPath, attempt: attempts, cap: capLabel },
      'architect-loop: running architect',
    );

    architectResult = await opts.runArchitect({
      registry: opts.registry,
      projectPath: opts.projectPath,
      ...(opts.db !== undefined ? { db: opts.db } : {}),
      ...(opts.directiveId !== undefined ? { directiveId: opts.directiveId } : {}),
      ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
      ...(opts.config !== undefined ? { config: opts.config } : {}),
      ...(opts.emit !== undefined ? { emit: opts.emit } : {}),
      ...(priorCritique !== undefined ? { priorCritique } : {}),
    });

    critique = await opts.runWikiCritic({
      registry: opts.registry,
      projectPath: opts.projectPath,
      directiveBody: opts.directiveBody,
      claudeMd,
      pages: architectResult.pages,
      ...(opts.db !== undefined ? { db: opts.db } : {}),
      ...(opts.directiveId !== undefined ? { directiveId: opts.directiveId } : {}),
      ...(opts.limits !== undefined ? { limits: opts.limits } : {}),
      ...(opts.config !== undefined ? { config: opts.config } : {}),
      ...(opts.emit !== undefined ? { emit: opts.emit } : {}),
    });

    if (critique.passes) {
      log.info(
        { projectPath: opts.projectPath, attempt: attempts, severity: critique.severity },
        `architect-loop: critic passed on attempt ${String(attempts)}`,
      );
      if (opts.directiveId !== undefined) {
        emitLogLine(
          opts.emit,
          opts.directiveId,
          'info',
          'brain.architect-loop',
          `critic: passed on attempt ${String(attempts)} — '${critique.summary}'`,
          { attempt: attempts, severity: critique.severity },
        );
      }
      return { architectResult, critique, attempts, exhausted: false };
    }

    log.warn(
      {
        projectPath: opts.projectPath,
        attempt: attempts,
        severity: critique.severity,
        summary: critique.summary,
      },
      `architect-loop: critic failed (${critique.severity}) on attempt ${String(attempts)}`,
    );
    if (opts.directiveId !== undefined) {
      emitLogLine(
        opts.emit,
        opts.directiveId,
        'warn',
        'brain.architect-loop',
        `critic: failed (${critique.severity}) on attempt ${String(attempts)} — ${critique.summary}`,
        { attempt: attempts, severity: critique.severity, findings: critique.findings },
      );
    }
    priorCritique = critique;
  }

  // --- Exhausted all attempts ---
  log.warn(
    {
      projectPath: opts.projectPath,
      attempts,
      lastSeverity: critique.severity,
      lastSummary: critique.summary,
    },
    'architect-loop: exhausted — escalating to operator',
  );
  if (opts.directiveId !== undefined) {
    emitLogLine(
      opts.emit,
      opts.directiveId,
      'warn',
      'brain.architect-loop',
      `critic: exhausted (${String(attempts)}/${capLabel} attempts) — escalating to operator`,
      { attempts, lastSeverity: critique.severity, lastSummary: critique.summary },
    );
  }

  const renderedFindings = critique.findings
    .map((f) => `  - [${f.aspect}] ${f.gap} — suggestion: ${f.suggestion}`)
    .join('\n');

  const prompt = [
    `${CRITIC_MARKER} Wiki-readiness exhausted after ${String(attempts)} architect attempt${attempts === 1 ? '' : 's'}.`,
    '',
    `Last severity: ${critique.severity}`,
    `Summary: ${critique.summary}`,
    'Findings:',
    renderedFindings,
    '',
    'Options:',
    '  - continue: proceed to planner with the last-attempt wiki (advisory default)',
    '  - abort: block this directive; you can refine CLAUDE.md and resume',
    '  - extend-3: run 3 more architect+critic attempts',
  ].join('\n');

  const answer = await opts.askUser({
    prompt,
    options: ['continue', 'abort', 'extend-3'],
    ...(opts.directiveId !== undefined ? { directiveId: opts.directiveId } : {}),
  });

  if (answer === 'abort') {
    throw new WikiReadinessAbortError(critique);
  }

  if (answer === 'extend-3') {
    // Recurse with 3 more attempts. The recursed call will re-use the same
    // claudeMd (already read) — pass it directly to avoid re-reading disk.
    const extended = await runLoop({ ...opts, maxAttempts: 3 }, claudeMd, critique);
    return {
      ...extended,
      attempts: attempts + extended.attempts,
    };
  }

  // 'continue' or any unrecognised answer falls through per ADR 0030 default.
  return { architectResult, critique, attempts, exhausted: true };
}

async function defaultReadClaudeMd(projectPath: string): Promise<string> {
  const { claudeMd } = projectPaths(projectPath);
  return readFile(claudeMd, 'utf8');
}
