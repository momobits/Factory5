/**
 * Coherence validator entry point.
 *
 * Walks docs/knowledge/, runs schema and reference checks, returns
 * structured findings. Caller (worker or brain) decides what to do
 * with them.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import matter from 'gray-matter';

import { createLogger } from '@factory5/logger';

import { checkDecisionFile, checkFeatureFile, type PartialFinding } from './schema-check.js';
import { checkReferences, type FeatureEntry } from './reference-check.js';

const log = createLogger('coherence-validator');

export interface ValidateOptions {
  projectPath: string;
  taskIds: readonly string[];
  /** Runtime hint; when set, the engine loads the matching config and runs deeper checks (doc-fiction + dead-code). */
  runtime?: string;
}

export interface ValidationResult {
  ok: boolean;
  findings: PartialFinding[];
  skippedReason?: 'no-knowledge-area';
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => e.endsWith('.md') && !e.startsWith('_')).map((e) => join(dir, e));
  } catch {
    return [];
  }
}

async function collectDocsForReferenceCheck(projectPath: string): Promise<Map<string, string>> {
  const docs = new Map<string, string>();
  const candidates = ['README.md', 'docs/knowledge/modules.md', 'docs/knowledge/overview.md'];
  for (const rel of candidates) {
    const abs = join(projectPath, rel);
    if (await fileExists(abs)) {
      docs.set(rel, await readFile(abs, 'utf8'));
    }
  }
  return docs;
}

/**
 * Validates the project's knowledge graph by walking docs/knowledge/,
 * running schema checks on feature and decision files, and verifying
 * reference integrity.
 *
 * @param opts - Validation options including projectPath and known taskIds.
 * @returns A ValidationResult with ok flag, findings array, and optional skippedReason.
 */
export async function validateKnowledgeGraph(opts: ValidateOptions): Promise<ValidationResult> {
  const knowledgeDir = join(opts.projectPath, 'docs', 'knowledge');
  if (!(await fileExists(knowledgeDir))) {
    return { ok: true, findings: [], skippedReason: 'no-knowledge-area' };
  }

  const allFindings: PartialFinding[] = [];
  const featureEntries: FeatureEntry[] = [];

  // Schema check: features
  const featureFiles = await listMarkdownFiles(join(knowledgeDir, 'features'));
  for (const filePath of featureFiles) {
    const rel = relative(opts.projectPath, filePath).split('\\').join('/');
    const content = await readFile(filePath, 'utf8');
    const schemaFindings = checkFeatureFile(rel, content);
    allFindings.push(...schemaFindings);

    // Collect for reference check (only if schema passed)
    if (schemaFindings.length === 0) {
      try {
        const parsed = matter(content);
        featureEntries.push({ filePath: rel, frontmatter: parsed.data as Record<string, unknown> });
      } catch {
        // Already reported by schema check
      }
    }
  }

  // Schema check: decisions
  const decisionFiles = await listMarkdownFiles(join(knowledgeDir, 'decisions'));
  for (const filePath of decisionFiles) {
    const rel = relative(opts.projectPath, filePath).split('\\').join('/');
    const content = await readFile(filePath, 'utf8');
    allFindings.push(...checkDecisionFile(rel, content));
  }

  // Reference integrity check
  const docs = await collectDocsForReferenceCheck(opts.projectPath);
  allFindings.push(...checkReferences(featureEntries, docs, { taskIds: opts.taskIds }));

  // Tier 15.13 — deeper checks (doc-fiction, dead-code) when a runtime
  // hint is supplied AND a config can be resolved.
  if (opts.runtime !== undefined) {
    try {
      const { loadValidatorConfig } = await import('./config-loader.js');
      const cfg = await loadValidatorConfig({
        projectPath: opts.projectPath,
        runtime: opts.runtime,
      });
      if (cfg.config !== undefined) {
        const { checkDocFiction } = await import('./doc-fiction.js');
        const docFictionFindings = await checkDocFiction({
          projectPath: opts.projectPath,
          config: cfg.config,
        });
        allFindings.push(...docFictionFindings);

        // Dead-code scan (Python only for v1). Runs only when the resolved config
        // includes a dead_code section.
        if (opts.runtime === 'python' && cfg.config.dead_code !== undefined) {
          try {
            const { checkDeadCodePython } = await import('./dead-code-python.js');
            const deadFindings = await checkDeadCodePython({
              projectPath: opts.projectPath,
              packageGlobs: cfg.config.dead_code.package_globs,
              exposedVia: cfg.config.dead_code.exposed_via,
              excludeGlobs: cfg.config.dead_code.caller_scan.exclude_globs,
            });
            allFindings.push(...deadFindings);
          } catch (err) {
            log.warn(
              { err, projectPath: opts.projectPath },
              'validator: dead-code scan threw — non-fatal',
            );
          }
        }
      }
    } catch (err) {
      log.warn(
        { err, projectPath: opts.projectPath, runtime: opts.runtime },
        'validator: doc-fiction check threw — non-fatal, other findings still surface',
      );
    }
  }

  log.debug(
    {
      projectPath: opts.projectPath,
      featureCount: featureFiles.length,
      decisionCount: decisionFiles.length,
      findingCount: allFindings.length,
    },
    'coherence-validator: complete',
  );

  return { ok: allFindings.length === 0, findings: allFindings };
}
