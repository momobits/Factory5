/**
 * Schema validity check for knowledge-graph files.
 *
 * Validates front-matter shape (YAML parseability, required fields,
 * enum values) and required body sections (for decisions). Produces
 * structured findings keyed to specific front-matter fields.
 */

import matter from 'gray-matter';

import type { FindingCategory, FindingLocation } from '@factory5/core';

const VALID_FEATURE_STATUSES = ['documented', 'implemented', 'superseded', 'abandoned'];
const REQUIRED_DECISION_SECTIONS = ['Context', 'Decision', 'Consequences'];

/** Partial finding — missing fields populated by the validator entry point. */
export interface PartialFinding {
  category: FindingCategory;
  severity: 'high' | 'medium' | 'low';
  title: string;
  why: string;
  suggested_fix: string;
  auto_fixable: boolean;
  location: FindingLocation;
}

/**
 * Validates the front-matter and structure of a feature file.
 *
 * @param filePath - Relative or absolute path to the file (used in location fields).
 * @param content - Full file content including YAML front-matter.
 * @returns Array of partial findings; empty array means the file is valid.
 */
export function checkFeatureFile(filePath: string, content: string): PartialFinding[] {
  const findings: PartialFinding[] = [];

  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(content);
  } catch (err) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Malformed YAML front-matter',
      why: `Cannot parse front-matter: ${(err as Error).message}`,
      suggested_fix: 'Fix the YAML syntax. Use _templates/feature.md as a reference.',
      auto_fixable: false,
      location: { file: filePath, frontmatter_field: 'front-matter' },
    });
    return findings;
  }

  const data = parsed.data as Record<string, unknown>;

  // kind field
  if (data['kind'] !== 'feature') {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: data['kind'] === undefined ? 'Missing required field: kind' : 'Invalid kind value',
      why: 'Feature files must have `kind: feature` in front-matter.',
      suggested_fix: 'Set `kind: feature` in front-matter.',
      auto_fixable: true,
      location: { file: filePath, frontmatter_field: 'kind' },
    });
  }

  // id field
  if (typeof data['id'] !== 'string' || data['id'].length === 0) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Missing required field: id',
      why: 'Feature files must have a kebab-case `id:` in front-matter.',
      suggested_fix: 'Set `id: <kebab-case>` matching the filename (without .md).',
      auto_fixable: false,
      location: { file: filePath, frontmatter_field: 'id' },
    });
  }

  // status field
  const status = data['status'];
  if (typeof status !== 'string' || !VALID_FEATURE_STATUSES.includes(status)) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title:
        status === undefined
          ? 'Missing required field: status'
          : `Invalid status: ${String(status)}`,
      why: `Feature status must be one of: ${VALID_FEATURE_STATUSES.join(', ')}.`,
      suggested_fix: 'Set `status: documented` (or another valid value).',
      auto_fixable: true,
      location: { file: filePath, frontmatter_field: 'status' },
    });
  }

  // documented_in field
  const documentedIn = data['documented_in'];
  if (!Array.isArray(documentedIn) || documentedIn.length === 0) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Missing or empty documented_in',
      why: 'Feature files must have at least one documented_in entry.',
      suggested_fix: 'Set `documented_in: [README.md#section, ...]`.',
      auto_fixable: false,
      location: { file: filePath, frontmatter_field: 'documented_in' },
    });
  }

  return findings;
}

/**
 * Validates the front-matter and required body sections of a decision file.
 *
 * @param filePath - Relative or absolute path to the file (used in location fields).
 * @param content - Full file content including YAML front-matter.
 * @returns Array of partial findings; empty array means the file is valid.
 */
export function checkDecisionFile(filePath: string, content: string): PartialFinding[] {
  const findings: PartialFinding[] = [];

  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(content);
  } catch (err) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Malformed YAML front-matter',
      why: `Cannot parse front-matter: ${(err as Error).message}`,
      suggested_fix: 'Fix the YAML syntax. Use _templates/decision.md as a reference.',
      auto_fixable: false,
      location: { file: filePath, frontmatter_field: 'front-matter' },
    });
    return findings;
  }

  const data = parsed.data as Record<string, unknown>;

  // kind field
  if (data['kind'] !== 'decision') {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Decision file missing or wrong kind',
      why: 'Decision files must have `kind: decision`.',
      suggested_fix: 'Set `kind: decision`.',
      auto_fixable: true,
      location: { file: filePath, frontmatter_field: 'kind' },
    });
  }

  // Required fields: id, made_by_task (strings), date (string or Date — YAML parsers
  // silently coerce unquoted ISO dates like `2026-05-28` to Date objects).
  for (const field of ['id', 'made_by_task']) {
    if (typeof data[field] !== 'string' || (data[field] as string).length === 0) {
      findings.push({
        category: 'graph-schema-error',
        severity: 'high',
        title: `Missing required field: ${field}`,
        why: `Decision files must have a non-empty \`${field}:\`.`,
        suggested_fix: `Set \`${field}: <value>\` per the template.`,
        auto_fixable: false,
        location: { file: filePath, frontmatter_field: field },
      });
    }
  }

  // date field: accept string or native Date (gray-matter's YAML engine coerces
  // unquoted ISO dates like `2026-05-28` to Date objects).
  const dateVal = data['date'];
  const datePresent =
    (typeof dateVal === 'string' && dateVal.length > 0) || dateVal instanceof Date;
  if (!datePresent) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Missing required field: date',
      why: 'Decision files must have a non-empty `date:`.',
      suggested_fix: 'Set `date: <value>` per the template.',
      auto_fixable: false,
      location: { file: filePath, frontmatter_field: 'date' },
    });
  }

  // modifies field
  const modifies = data['modifies'];
  if (!Array.isArray(modifies) || modifies.length === 0) {
    findings.push({
      category: 'graph-schema-error',
      severity: 'high',
      title: 'Missing or empty modifies',
      why: 'Decisions must list at least one feature they modify.',
      suggested_fix: 'Set `modifies: [<feature-id>, ...]`.',
      auto_fixable: false,
      location: { file: filePath, frontmatter_field: 'modifies' },
    });
  }

  // Required body sections
  const body = parsed.content;
  for (const section of REQUIRED_DECISION_SECTIONS) {
    const headingRegex = new RegExp(`^##\\s+${section}\\s*$`, 'm');
    if (!headingRegex.test(body)) {
      findings.push({
        category: 'graph-schema-error',
        severity: 'medium',
        title: `Missing required section: ## ${section}`,
        why: 'Decision files must have Context, Decision, and Consequences sections.',
        suggested_fix: `Add a \`## ${section}\` heading with content.`,
        auto_fixable: false,
        location: { file: filePath, anchor: `#${section.toLowerCase()}` },
      });
    }
  }

  return findings;
}
