/**
 * `factory status` — show recent directives, totals, and per-directive spend.
 */

import { stdout } from 'node:process';

import {
  directives as directivesQ,
  modelUsage,
  openDatabase,
  projects as projectsQ,
  runMigrations,
} from '@factory5/state';
import type { Command } from 'commander';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('show projects, recent directives, and spend')
    .option('--limit <n>', 'how many recent directives to show', '20')
    .action((opts: { limit: string }) => {
      const db = openDatabase();
      runMigrations(db);
      try {
        const limit = Math.max(1, Number.parseInt(opts.limit, 10) || 20);

        stdout.write('== Projects ==\n');
        const projects = projectsQ.listAll(db);
        if (projects.length === 0) {
          stdout.write('  (no projects registered)\n');
        } else {
          for (const p of projects) {
            stdout.write(`  ${p.name.padEnd(28)} ${p.status.padEnd(10)} ${p.workspacePath}\n`);
          }
        }

        stdout.write('\n== Recent directives ==\n');
        const all = [
          ...directivesQ.listByStatus(db, 'complete', limit),
          ...directivesQ.listByStatus(db, 'failed', limit),
          ...directivesQ.listByStatus(db, 'blocked', limit),
          ...directivesQ.listByStatus(db, 'running', limit),
          ...directivesQ.listByStatus(db, 'pending', limit),
          ...directivesQ.listByStatus(db, 'claimed', limit),
        ]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit);

        if (all.length === 0) {
          stdout.write('  (no directives yet)\n');
        } else {
          const projectNameById = new Map<string, string>();
          for (const p of projects) projectNameById.set(p.id, p.name);
          for (const d of all) {
            const cost = modelUsage.totalCostForDirective(db, d.id);
            const projName =
              d.projectId !== undefined && projectNameById.has(d.projectId)
                ? projectNameById.get(d.projectId)!
                : '-';
            const projCol = (projName.length > 14 ? `${projName.slice(0, 13)}…` : projName).padEnd(
              14,
            );
            stdout.write(
              `  ${d.id}  ${projCol}  ${d.status.padEnd(8)} ${d.intent.padEnd(12)} ${d.createdAt}  $${cost.toFixed(4)}\n`,
            );
          }
        }
      } finally {
        db.close();
      }
    });
}
