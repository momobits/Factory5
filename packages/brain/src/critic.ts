/**
 * Wiki critic — evaluates the architect's wiki against the directive's intent,
 * the project's CLAUDE.md, and the wiki pages on disk. Produces a structured
 * critique that the architect-loop wrapper feeds back into the architect on
 * retry. Replaces the regex-based readiness gate per ADR 0033.
 *
 * @packageDocumentation
 */

import type { ModelCategory, WikiCritique } from '@factory5/core';
import { wikiCritiqueSchema } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import type { ProviderRegistry } from '@factory5/providers';
import type { Database } from '@factory5/state';
import { resolveAgentCategory } from '@factory5/state';
import type { WikiPage } from '@factory5/wiki';
import { z } from 'zod';

import type { DirectiveEventEmitter } from '@factory5/ipc';

import { assertBudget } from './budget.js';
import { emitLogLine } from './emit.js';
import { resolveLlmCwd } from './llm-cwd.js';
import { buildAgentSystemPrompt } from './prompts.js';
import { extractJsonObject } from './triage.js';
import { recordUsage } from './usage.js';

const log = createLogger('brain.critic');

export interface RunWikiCriticOptions {
  registry: ProviderRegistry;
  projectPath: string;
  /** The directive's free-text body — what the operator originally asked for. */
  directiveBody: string;
  /** Content of `<projectPath>/CLAUDE.md`. */
  claudeMd: string;
  /** Wiki pages currently on disk. */
  pages: WikiPage[];
  db?: Database;
  directiveId?: string;
  /** Per-directive budget ceilings (ADR 0020). */
  limits?: { maxUsd?: number; maxSteps?: number };
  /**
   * Loaded config — used to resolve `agents.critic` category override.
   * Absent means "use `DEFAULT_AGENT_CATEGORIES.critic`" (`reasoning`).
   */
  config?: {
    agents?: { architect?: ModelCategory | undefined; critic?: ModelCategory | undefined };
  };
  /** SSE emitter (ADR 0029 / ADR 0031). */
  emit?: DirectiveEventEmitter;
}

/**
 * Call the critic-category LLM to evaluate the architect's wiki output.
 * Returns a {@link WikiCritique} on success; throws on budget trip, malformed
 * JSON, or Zod schema rejection.
 */
export async function runWikiCritic(opts: RunWikiCriticOptions): Promise<WikiCritique> {
  if (opts.pages.length === 0) {
    throw new Error(
      `critic: no pages to evaluate at ${opts.projectPath}/docs/knowledge/ — architect produced nothing`,
    );
  }

  const config = opts.config ?? {};
  const category = resolveAgentCategory(config, 'critic');
  const resolution = await opts.registry.resolve(category);
  const systemPrompt = await buildAgentSystemPrompt('critic');

  const renderedPages = opts.pages.map((p) => `--- ${p.slug} ---\n${p.content}`).join('\n\n');

  const userPrompt = [
    'You are evaluating whether a project wiki adequately designs what the operator requested.',
    '',
    'Read the directive (what was asked), the project CLAUDE.md spec, and the wiki pages the',
    'architect just wrote. Decide: does this wiki give a downstream planner enough concrete',
    'design to decompose into tasks AND does it address what the operator asked for?',
    '',
    'Respond with a SINGLE JSON object in this exact shape (no prose outside the object):',
    '',
    '{',
    '  "passes": <true|false>,',
    '  "severity": <"pass" | "minor" | "major" | "blocking">,',
    '  "findings": [',
    '    {',
    '      "aspect": <"overview" | "modules" | "testing" | "hygiene" | "directive-fit" | "other">,',
    '      "gap": "<one-sentence description of what is missing or wrong>",',
    '      "suggestion": "<one-sentence concrete fix the architect should make>"',
    '    }',
    '  ],',
    '  "summary": "<one-paragraph operator-readable summary of your verdict>"',
    '}',
    '',
    'If passes=true, severity must be "pass" and findings should be []. If passes=false,',
    'severity reflects how badly the wiki misses (minor=cosmetic gap; major=missing required',
    'coverage; blocking=planner cannot decompose with this wiki).',
    '',
    '--- DIRECTIVE ---',
    opts.directiveBody,
    '--- end DIRECTIVE ---',
    '',
    '--- CLAUDE.md ---',
    opts.claudeMd,
    '--- end CLAUDE.md ---',
    '',
    '--- WIKI PAGES ---',
    renderedPages,
    '--- end WIKI PAGES ---',
  ].join('\n');

  log.info(
    {
      projectPath: opts.projectPath,
      provider: resolution.provider.id,
      model: resolution.model,
      category,
      ...(opts.directiveId !== undefined ? { directiveId: opts.directiveId } : {}),
    },
    'critic: calling',
  );
  if (opts.directiveId !== undefined) {
    emitLogLine(
      opts.emit,
      opts.directiveId,
      'info',
      'brain.critic',
      `critic: calling ${resolution.model} (category ${category})`,
      { provider: resolution.provider.id, category },
    );
  }

  if (opts.db !== undefined && opts.directiveId !== undefined) {
    assertBudget({
      db: opts.db,
      directiveId: opts.directiveId,
      ...(opts.limits?.maxUsd !== undefined ? { maxUsd: opts.limits.maxUsd } : {}),
      ...(opts.limits?.maxSteps !== undefined ? { maxSteps: opts.limits.maxSteps } : {}),
      category,
      mode: 'call',
      agent: 'critic',
    });
  }

  const started = Date.now();
  const response = await resolution.provider.call({
    model: resolution.model,
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0,
    reasoning: 'low',
    cwd: resolveLlmCwd(opts.projectPath),
  });
  const durationMs = Date.now() - started;

  if (opts.db !== undefined) {
    recordUsage({
      db: opts.db,
      ...(opts.directiveId !== undefined ? { directiveId: opts.directiveId } : {}),
      category,
      resolution,
      response,
      durationMs,
      mode: 'call',
    });
  }

  const jsonText = extractJsonObject(response.text);
  if (jsonText === undefined) {
    const detail = response.text.slice(0, 500);
    if (opts.directiveId !== undefined) {
      emitLogLine(
        opts.emit,
        opts.directiveId,
        'error',
        'brain.critic',
        'critic: no JSON in response',
        {
          detail,
        },
      );
    }
    throw new Error(`critic: response contained no JSON object. First 500 chars: ${detail}`);
  }

  let critique: WikiCritique;
  try {
    critique = wikiCritiqueSchema.parse(JSON.parse(jsonText));
  } catch (err) {
    if (opts.directiveId !== undefined) {
      const detail = response.text.slice(0, 500);
      const zodIssues =
        err instanceof z.ZodError ? err.issues.slice(0, 3) : [{ message: String(err) }];
      emitLogLine(
        opts.emit,
        opts.directiveId,
        'error',
        'brain.critic',
        'critic: schema parse failed',
        {
          detail,
          zodIssues,
        },
      );
    }
    throw err;
  }

  if (opts.directiveId !== undefined) {
    const level = critique.passes ? 'info' : 'warn';
    emitLogLine(
      opts.emit,
      opts.directiveId,
      level,
      'brain.critic',
      `critic: ${critique.passes ? 'passed' : `failed (${critique.severity})`} — ${critique.summary}`,
      { passes: critique.passes, severity: critique.severity, findings: critique.findings },
    );
  }

  return critique;
}
