/**
 * Architect agent — read the project's `CLAUDE.md` spec, design the wiki,
 * and write markdown pages under `<project>/docs/knowledge/`. Runs on the
 * `reasoning` tier.
 *
 * Output contract: the architect produces a single JSON object with a list
 * of `pages`, each `{ slug, content }`. We validate this, write each page
 * via `@factory5/wiki`, then run the readiness gate.
 */

import { readFile } from 'node:fs/promises';

import type { ModelCategory } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import type { ProviderRegistry } from '@factory5/providers';
import type { Database } from '@factory5/state';
import {
  projectPaths,
  wikiReadiness,
  writeWikiPage,
  type ReadinessReport,
  type WikiPage,
} from '@factory5/wiki';
import { z } from 'zod';

import { buildAgentSystemPrompt } from './prompts.js';
import { extractJsonObject } from './triage.js';
import { recordUsage } from './usage.js';

const log = createLogger('brain.architect');

const architectJsonSchema = z.object({
  pages: z
    .array(
      z.object({
        slug: z.string().min(1),
        content: z.string().min(1),
      }),
    )
    .min(1),
  notes: z.string().default(''),
});

export interface ArchitectResult {
  projectPath: string;
  pages: WikiPage[];
  readiness: ReadinessReport;
  rawResponse: string;
}

export interface ArchitectOptions {
  registry: ProviderRegistry;
  projectPath: string;
  db?: Database;
  directiveId?: string;
  category?: ModelCategory;
}

async function readClaudeMd(projectPath: string): Promise<string> {
  const { claudeMd } = projectPaths(projectPath);
  try {
    return await readFile(claudeMd, 'utf8');
  } catch (err) {
    throw new Error(
      `architect: ${claudeMd} not found or unreadable (${(err as Error).message}) — every project needs a CLAUDE.md spec`,
    );
  }
}

/**
 * Run the architect: ask the reasoning model to produce a wiki plan,
 * write all pages, then evaluate readiness. Readiness is returned for the
 * caller to decide whether to iterate.
 */
export async function runArchitect(opts: ArchitectOptions): Promise<ArchitectResult> {
  const category = opts.category ?? 'reasoning';
  const resolution = await opts.registry.resolve(category);
  const systemPrompt = await buildAgentSystemPrompt('architect');
  const claudeMd = await readClaudeMd(opts.projectPath);

  const userPrompt = [
    'Design the knowledge wiki for this project.',
    '',
    'You will read the CLAUDE.md spec below and produce one or more markdown pages that',
    'together form the `docs/knowledge/` directory. Required coverage: an overview/architecture',
    'page, a page (or `## Modules` section) documenting each module, and a page (or `## Testing`',
    'section) describing how tests are organized. Aim for design-before-code: concrete',
    'interfaces, data shapes, decisions — not placeholder sentences.',
    '',
    'Respond with a SINGLE JSON object in this exact shape (no prose outside the object):',
    '',
    '{',
    '  "pages": [ { "slug": "overview.md", "content": "# Overview\\n..." }, ... ],',
    '  "notes": "short note about design choices (optional)"',
    '}',
    '',
    'Slugs may contain `/` to nest (e.g. `modules/api.md`). Use markdown; use `\\n` for newlines.',
    '',
    '--- CLAUDE.md ---',
    claudeMd,
    '--- end CLAUDE.md ---',
  ].join('\n');

  log.info(
    { projectPath: opts.projectPath, provider: resolution.provider.id, model: resolution.model },
    'architect: calling reasoning provider',
  );

  const started = Date.now();
  const response = await resolution.provider.call({
    model: resolution.model,
    systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.2,
    reasoning: 'medium',
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
    });
  }

  const jsonText = extractJsonObject(response.text);
  if (jsonText === undefined) {
    throw new Error(
      `architect: response contained no JSON object. First 500 chars: ${response.text.slice(0, 500)}`,
    );
  }
  const plan = architectJsonSchema.parse(JSON.parse(jsonText));

  const writtenPages: WikiPage[] = [];
  for (const p of plan.pages) {
    const path = await writeWikiPage(opts.projectPath, p.slug, p.content);
    writtenPages.push({ slug: p.slug, path, content: p.content });
  }
  log.info(
    { projectPath: opts.projectPath, pages: writtenPages.length },
    'architect: wiki written',
  );

  const readiness = await wikiReadiness(opts.projectPath);
  log.info(
    {
      projectPath: opts.projectPath,
      readinessOk: readiness.ok,
      failedChecks: readiness.checks.filter((c) => !c.ok).map((c) => c.id),
    },
    'architect: readiness evaluated',
  );

  return {
    projectPath: opts.projectPath,
    pages: writtenPages,
    readiness,
    rawResponse: response.text,
  };
}
