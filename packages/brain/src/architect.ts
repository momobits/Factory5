/**
 * Architect agent — read the project's `CLAUDE.md` spec, design the wiki,
 * and write markdown pages under `<project>/docs/knowledge/`. Runs on the
 * `planning` tier by default (ADR 0033 §6; was `reasoning`).
 *
 * Output contract: the architect produces a single JSON object with a list
 * of `pages`, each `{ slug, content }`. We validate this and write each page
 * via `@factory5/wiki`. Wiki-readiness evaluation is external (see
 * `runArchitectWithCritique` in `architect-loop.ts`, ADR 0033).
 */

import { access } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import type { DirectiveLimits, ModelCategory, WikiCritique } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import type { ProviderRegistry } from '@factory5/providers';
import type { Database } from '@factory5/state';
import { resolveAgentCategory } from '@factory5/state';
import { projectPaths, writeWikiPage, type WikiPage } from '@factory5/wiki';
import { simpleGit } from 'simple-git';
import { z } from 'zod';

import type { DirectiveEventEmitter } from '@factory5/ipc';

import { assertBudget } from './budget.js';
import { emitLogLine } from './emit.js';
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
  rawResponse: string;
}

export interface ArchitectOptions {
  registry: ProviderRegistry;
  projectPath: string;
  db?: Database;
  directiveId?: string;
  /** Explicit category override — takes precedence over `config.agents.architect`. */
  category?: ModelCategory;
  /** Per-directive budget ceilings (ADR 0020). See {@link TriageOptions.limits}. */
  limits?: DirectiveLimits;
  /**
   * Optional SSE emitter (ADR 0029 / ADR 0031). When wired, the architect
   * surfaces `log.line` events at stage entry and wiki-written so
   * directive-detail's activity panel narrates the run.
   */
  emit?: DirectiveEventEmitter;
  /**
   * Optional critique from a prior failed attempt — appended to the user
   * prompt on retry so the architect can address specific gaps (ADR 0033 §4).
   */
  priorCritique?: WikiCritique;
  /**
   * Loaded daemon config — used to resolve `agents.architect` category
   * override (ADR 0004 amendment). Absent means use
   * `DEFAULT_AGENT_CATEGORIES.architect` (`'planning'`).
   */
  config?: {
    agents?: {
      architect?: ModelCategory | undefined;
      critic?: ModelCategory | undefined;
    };
  };
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
 * Run the architect: ask the configured model to produce a wiki plan,
 * write all pages, and return. Wiki-readiness evaluation is now external
 * (see `runArchitectWithCritique` in `architect-loop.ts`, ADR 0033).
 */
export async function runArchitect(opts: ArchitectOptions): Promise<ArchitectResult> {
  const config = opts.config ?? {};
  const category = opts.category ?? resolveAgentCategory(config, 'architect');
  const resolution = await opts.registry.resolve(category);
  const systemPrompt = await buildAgentSystemPrompt('architect');
  const claudeMd = await readClaudeMd(opts.projectPath);

  const userPrompt = [
    'Design the knowledge wiki for this project.',
    '',
    'You will read the CLAUDE.md spec below and produce one or more markdown pages that',
    'together form the `docs/knowledge/` directory. Required coverage:',
    '  - an overview/architecture page (purpose + how the modules fit together);',
    '  - a page (or `## Modules` section) documenting each module — especially which',
    '    modules DO and DO NOT import each other (the planner uses this to decide',
    '    what can run in parallel; vague statements become a serialised build);',
    '  - a page (or `## Testing` section) describing how tests are organised;',
    '  - repo-level hygiene guidance on the overview page: one paragraph on what the',
    '    README should cover (purpose, install, usage, testing, license), which',
    '    license applies (default MIT unless the spec overrides), and which runtime',
    '    the `.gitignore` should target (Python / Node / Go / …). The scaffolder',
    '    reads this to produce README.md, LICENSE, and .gitignore; omitting it',
    '    causes the assessor verify-gate to fail on missing/thin artefacts.',
    'Aim for design-before-code: concrete interfaces, data shapes, decisions — not',
    'placeholder sentences.',
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
    {
      projectPath: opts.projectPath,
      provider: resolution.provider.id,
      model: resolution.model,
      category,
    },
    'architect: calling provider',
  );
  if (opts.directiveId !== undefined) {
    emitLogLine(
      opts.emit,
      opts.directiveId,
      'info',
      'brain.architect',
      `architect: calling ${resolution.model}`,
      { provider: resolution.provider.id },
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
      agent: 'architect',
    });
  }

  let promptWithFeedback = userPrompt;
  if (opts.priorCritique !== undefined) {
    const findingsBlock = opts.priorCritique.findings
      .map((f) => `  - [${f.aspect}] ${f.gap} — fix: ${f.suggestion}`)
      .join('\n');
    promptWithFeedback = [
      userPrompt,
      '',
      '--- PREVIOUS ATTEMPT FAILED ---',
      `severity: ${opts.priorCritique.severity}`,
      `summary: ${opts.priorCritique.summary}`,
      'findings:',
      findingsBlock,
      'Please re-write the wiki addressing each finding above. Preserve content that was already correct.',
      '--- end PREVIOUS ATTEMPT FAILED ---',
    ].join('\n');
  }

  const started = Date.now();
  const response = await resolution.provider.call({
    model: resolution.model,
    systemPrompt,
    messages: [{ role: 'user', content: promptWithFeedback }],
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
        'brain.architect',
        'architect: no JSON in response',
        { detail },
      );
    }
    throw new Error(`architect: response contained no JSON object. First 500 chars: ${detail}`);
  }
  let plan;
  try {
    plan = architectJsonSchema.parse(JSON.parse(jsonText));
  } catch (err) {
    if (opts.directiveId !== undefined) {
      const detail = response.text.slice(0, 500);
      const zodIssues =
        err instanceof z.ZodError ? err.issues.slice(0, 3) : [{ message: String(err) }];
      emitLogLine(
        opts.emit,
        opts.directiveId,
        'error',
        'brain.architect',
        'architect: schema parse failed',
        { detail, zodIssues },
      );
    }
    throw err;
  }

  const writtenPages: WikiPage[] = [];
  for (const p of plan.pages) {
    const path = await writeWikiPage(opts.projectPath, p.slug, p.content);
    writtenPages.push({ slug: p.slug, path, content: p.content });
  }
  log.info(
    { projectPath: opts.projectPath, pages: writtenPages.length },
    'architect: wiki written',
  );
  if (opts.directiveId !== undefined) {
    emitLogLine(
      opts.emit,
      opts.directiveId,
      'info',
      'brain.architect',
      `architect: wrote ${String(writtenPages.length)} wiki page${writtenPages.length === 1 ? '' : 's'}`,
      { slugs: writtenPages.map((p) => p.slug) },
    );
  }

  // I014 fix (Phase 13.4) — when re-running on an existing project that
  // already has a git repo and a tracked `docs/knowledge/*.md` wiki, the
  // architect's writes land as modifications to tracked files. Without
  // an auto-commit they sit dirty in main and trip the assessor's
  // `gitClean` check, flipping `gate.verify` to false even when the
  // build + tests pass cleanly. On a fresh project the initial commit
  // (created later by the first scaffolder worker via
  // `ensureProjectRepo`) sweeps these up — but on `factory resume` the
  // repo already exists and there's no scaffolder commit, so the
  // architect's edits stay uncommitted forever. Stage just the pages we
  // wrote, commit only if anything is actually staged.
  await commitArchitectWritesIfRepo({
    projectPath: opts.projectPath,
    writtenPages,
    ...(opts.directiveId !== undefined ? { directiveId: opts.directiveId } : {}),
  });

  return {
    projectPath: opts.projectPath,
    pages: writtenPages,
    rawResponse: response.text,
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stage + commit any architect-written wiki pages when `projectPath` is
 * a git repo. No-op on non-repos and on already-clean trees. Errors are
 * logged at warn level rather than re-thrown — a failed auto-commit
 * shouldn't break the directive (the operator can recover by hand,
 * and the directive's other gates still run).
 *
 * Stages only the files we wrote (not `docs/` wholesale) so unrelated
 * dirty files in `docs/` don't get swept into the architect's commit.
 *
 * Exported for tests.
 */
export async function commitArchitectWritesIfRepo(opts: {
  projectPath: string;
  writtenPages: ReadonlyArray<{ path: string }>;
  directiveId?: string;
}): Promise<void> {
  if (opts.writtenPages.length === 0) return;
  if (!(await pathExists(join(opts.projectPath, '.git')))) {
    log.debug({ projectPath: opts.projectPath }, 'architect: no git repo, skipping auto-commit');
    return;
  }

  const git = simpleGit(opts.projectPath);
  // Project-relative paths in POSIX form (simple-git's add is happier with
  // forward slashes on Windows, and they round-trip cleanly via git itself).
  const relPaths = opts.writtenPages.map((p) =>
    relative(opts.projectPath, p.path).split('\\').join('/'),
  );

  try {
    await git.add(relPaths);
    const status = await git.status();
    if (status.staged.length === 0) {
      log.debug(
        { projectPath: opts.projectPath, paths: relPaths },
        'architect: no staged changes after add, skipping commit',
      );
      return;
    }
    const subject =
      opts.directiveId !== undefined
        ? `factory: architect updated wiki for directive ${opts.directiveId}`
        : 'factory: architect updated wiki';
    await git.commit(subject);
    log.info(
      {
        projectPath: opts.projectPath,
        directiveId: opts.directiveId,
        staged: status.staged.length,
      },
      'architect: wiki edits auto-committed',
    );
  } catch (err) {
    log.warn(
      { err, projectPath: opts.projectPath, directiveId: opts.directiveId },
      'architect: auto-commit failed — directive proceeds, operator may need to commit by hand',
    );
  }
}
