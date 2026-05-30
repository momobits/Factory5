/**
 * `factory graph check [<projectPath>]` — validate the project's
 * knowledge graph at `docs/knowledge/`.
 *
 * Phase A scope: schema validity + reference integrity. Phase B will
 * add doc-fiction + dead-code checks via the same entry point.
 *
 * Exit codes:
 *   0 — validation passed (or no knowledge area to validate)
 *   1 — one or more findings raised
 */

import { resolve } from 'node:path';

import type { Command } from 'commander';

import { validateKnowledgeGraph } from '@factory5/coherence-validator';
import { createLogger } from '@factory5/logger';

const log = createLogger('cli.graph-check');

export function registerGraphCheckCommand(parent: Command): void {
  const graph = parent.command('graph').description('Operate on the project knowledge graph');

  graph
    .command('check')
    .description('Validate the project knowledge graph (schema + reference integrity)')
    .argument('[projectPath]', 'Project root path (defaults to cwd)', process.cwd())
    .addHelpText(
      'after',
      `
Examples:
  factory graph check               # validate docs/knowledge/ in the current dir
  factory graph check ../my-app     # validate a specific project

Exit codes:
  0  validation passed (or no knowledge area to validate)
  1  one or more findings raised
`,
    )
    .action(async (projectPath: string) => {
      const abs = resolve(projectPath);
      log.info({ projectPath: abs }, 'graph check: starting');

      const result = await validateKnowledgeGraph({ projectPath: abs, taskIds: [] });

      if (result.skippedReason === 'no-knowledge-area') {
        process.stdout.write('No knowledge area at docs/knowledge/ — nothing to check.\n');
        return;
      }

      if (result.ok) {
        process.stdout.write('Knowledge graph: OK\n');
        return;
      }

      process.stdout.write(`Knowledge graph: ${String(result.findings.length)} findings\n\n`);
      for (const f of result.findings) {
        const loc = f.location;
        const locStr =
          loc.file +
          (loc.line !== undefined ? `:${String(loc.line)}` : '') +
          (loc.frontmatter_field !== undefined && loc.frontmatter_field.length > 0
            ? ` [${loc.frontmatter_field}]`
            : '') +
          (loc.anchor !== undefined && loc.anchor.length > 0 ? ` (${loc.anchor})` : '');
        process.stdout.write(
          `[${f.severity.toUpperCase()}] ${f.category}: ${f.title}\n` +
            `  Location: ${locStr}\n` +
            `  Why: ${f.why}\n` +
            `  Fix: ${f.suggested_fix}\n\n`,
        );
      }
      process.exit(1);
    });
}
