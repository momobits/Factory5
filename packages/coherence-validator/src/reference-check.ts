/**
 * Reference integrity check for knowledge-graph files.
 *
 * For each feature, verifies:
 *   - documented_in: <file>#<anchor> resolves to a real file with a
 *     real heading-derived anchor
 *   - implements: <task-id> matches a task in the current plan
 *
 * Anchors are slugified from heading text (lowercased, hyphenated)
 * matching GitHub's standard markdown anchor convention.
 */

import type { PartialFinding } from './schema-check.js';

export interface FeatureEntry {
  filePath: string;
  frontmatter: Record<string, unknown>;
}

export interface ReferenceCheckContext {
  taskIds: readonly string[];
}

const SLUG_NON_ALPHANUMERIC = /[^a-z0-9]+/g;

function slugify(headingText: string): string {
  return headingText.toLowerCase().replace(SLUG_NON_ALPHANUMERIC, '-').replace(/^-|-$/g, '');
}

function extractAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const headingRe = /^#{1,6}\s+(.+?)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(markdown)) !== null) {
    anchors.add(slugify(m[1] ?? ''));
  }
  return anchors;
}

/**
 * Checks reference integrity for a set of feature entries.
 *
 * @param features - Parsed feature entries with frontmatter.
 * @param docs - Map of doc file path to file content.
 * @param ctx - Context containing known task IDs.
 * @returns Array of partial findings; empty array means all references are valid.
 */
export function checkReferences(
  features: readonly FeatureEntry[],
  docs: ReadonlyMap<string, string>,
  ctx: ReferenceCheckContext,
): PartialFinding[] {
  const findings: PartialFinding[] = [];

  // Pre-compute anchors per doc file.
  const anchorsByFile = new Map<string, Set<string>>();
  for (const [file, content] of docs) {
    anchorsByFile.set(file, extractAnchors(content));
  }
  const taskIdSet = new Set(ctx.taskIds);

  for (const feature of features) {
    const fm = feature.frontmatter;

    // Check documented_in references.
    const documentedIn = fm['documented_in'];
    if (Array.isArray(documentedIn)) {
      for (const entry of documentedIn) {
        if (typeof entry !== 'string') continue;
        const [file, anchor] = entry.split('#', 2);
        if (file === undefined || file.length === 0) continue;

        if (!docs.has(file)) {
          findings.push({
            category: 'graph-schema-error',
            severity: 'high',
            title: `Referenced doc file does not exist: ${file}`,
            why: `Feature documented_in points to ${file}, which doesn't exist in the project.`,
            suggested_fix: `Either create ${file} or remove the entry from documented_in.`,
            auto_fixable: false,
            location: { file: feature.filePath, frontmatter_field: 'documented_in' },
          });
          continue;
        }

        if (anchor !== undefined && anchor.length > 0) {
          const anchors = anchorsByFile.get(file) ?? new Set();
          if (!anchors.has(anchor)) {
            findings.push({
              category: 'graph-schema-error',
              severity: 'high',
              title: `Anchor #${anchor} not found in ${file}`,
              why: `Feature documented_in references #${anchor} but ${file} has no heading that slugifies to that anchor.`,
              suggested_fix: `Add a matching heading to ${file}, or correct the anchor in this feature's documented_in.`,
              auto_fixable: false,
              location: { file: feature.filePath, frontmatter_field: 'documented_in' },
            });
          }
        }
      }
    }

    // Check implements task IDs.
    const implementsField = fm['implements'];
    if (Array.isArray(implementsField)) {
      for (const taskId of implementsField) {
        if (typeof taskId !== 'string') continue;
        if (!taskIdSet.has(taskId)) {
          findings.push({
            category: 'graph-orphan',
            severity: 'medium',
            title: `implements references unknown task ID: ${taskId}`,
            why: `This feature's implements: list references a task ID that does not exist in the current plan.`,
            suggested_fix: 'Remove the stale task ID or update to the correct one.',
            auto_fixable: false,
            location: { file: feature.filePath, frontmatter_field: 'implements' },
          });
        }
      }
    }
  }

  return findings;
}
