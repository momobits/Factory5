/**
 * 7b.4 — round-trip regression for I008 under ADR 0021.
 *
 * Seeds two workspaces in separate tmp dirs, both with the project basename
 * `example`. For each, `loadOrCreateProjectMetadata` writes a
 * `<workspace>/.factory/project.json` carrying a distinct ULID (the
 * whole point of ADR 0021). Directives + model_usage rows hang off each
 * identity, and the spend dashboard is queried through the CLI's
 * `runSpend` handler.
 *
 * Assertions:
 *   1. Two distinct `.factory/project.json` files on disk with different ids.
 *   2. Dashboard renders both projects as distinct rows — same name `example`,
 *      different ULID suffixes in the `display` label.
 *   3. Per-project SPENT totals match the raw SUM(cost_usd) over each
 *      directive's model_usage rows (no lossy aggregation).
 *   4. Narrowing with `--project <suffix>` or `--project <ulid>` isolates
 *      each workspace's spend independently.
 *
 * This is the regression test for I008 at the end-to-end-ish level —
 * identity is stored in the file, directives join on the id, the dashboard
 * disambiguates. If any layer reverts to basename-keying, this test fails.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newId } from '@factory5/core';
import {
  directives,
  modelUsage,
  openDatabase,
  projects,
  runMigrations,
  type Database,
} from '@factory5/state';
import { loadOrCreateProjectMetadata } from '@factory5/wiki';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runSpend } from './spend.js';

interface SeededWorkspace {
  workspacePath: string;
  projectPath: string;
  projectId: string;
  directiveId: string;
  totalUsd: number;
}

/**
 * Create a tmp workspace root with a `example/` subdir, write the identity
 * file via the real helper, upsert the `projects` row, insert one directive
 * tagged with that project, and record N model_usage rows against it.
 */
async function seedWorkspace(
  db: Database,
  label: string,
  perCallUsd: number[],
): Promise<SeededWorkspace> {
  const workspacePath = await mkdtemp(join(tmpdir(), `factory5-7b4-${label}-`));
  const projectPath = join(workspacePath, 'example');
  const meta = await loadOrCreateProjectMetadata(projectPath, 'example');

  projects.upsert(db, {
    id: meta.id,
    name: meta.name,
    workspacePath: projectPath,
    status: 'active',
    createdAt: meta.createdAt,
    lastTouchedAt: meta.createdAt,
  });

  const directiveId = newId();
  directives.insert(db, {
    id: directiveId,
    source: 'cli',
    principal: 'test',
    channelRef: 'test',
    intent: 'build',
    payload: { project: 'example', workspacePath },
    autonomy: 'autonomous',
    createdAt: meta.createdAt,
    status: 'complete',
    projectId: meta.id,
  });

  let total = 0;
  for (let i = 0; i < perCallUsd.length; i++) {
    modelUsage.record(db, {
      id: newId(),
      directiveId,
      provider: 'claude-cli',
      model: 'claude-opus-4-7',
      category: 'reasoning',
      inputTokens: 1_000,
      outputTokens: 5_000,
      costUsd: perCallUsd[i]!,
      durationMs: 10_000,
      calledAt: new Date(Date.parse(meta.createdAt) + i * 60_000).toISOString(),
    });
    total += perCallUsd[i]!;
  }

  return { workspacePath, projectPath, projectId: meta.id, directiveId, totalUsd: total };
}

describe('7b.4 round-trip — two `example` workspaces appear distinctly', () => {
  let db: Database;
  let workspaceA: SeededWorkspace | undefined;
  let workspaceB: SeededWorkspace | undefined;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    runMigrations(db);
    workspaceA = await seedWorkspace(db, 'A', [1.0, 0.5, 0.25]); // $1.75
    workspaceB = await seedWorkspace(db, 'B', [2.0, 1.0]); // $3.00
  });

  afterEach(async () => {
    db.close();
    for (const ws of [workspaceA, workspaceB]) {
      if (ws !== undefined) await rm(ws.workspacePath, { recursive: true, force: true });
    }
  });

  it('writes two distinct .factory/project.json files with different ULIDs', async () => {
    const aRaw = await readFile(join(workspaceA!.projectPath, '.factory', 'project.json'), 'utf8');
    const bRaw = await readFile(join(workspaceB!.projectPath, '.factory', 'project.json'), 'utf8');
    const a = JSON.parse(aRaw) as { id: string; name: string };
    const b = JSON.parse(bRaw) as { id: string; name: string };
    expect(a.name).toBe('example');
    expect(b.name).toBe('example');
    expect(a.id).not.toBe(b.id);
    expect(a.id).toBe(workspaceA!.projectId);
    expect(b.id).toBe(workspaceB!.projectId);
  });

  it('dashboard renders both projects as distinct rows (display suffixes differ)', () => {
    const result = runSpend(db, {});
    expect(result.exitCode).toBe(0);

    // Two `example` rows, each carrying a different ULID suffix per ADR 0021 §5.
    const suffixA = `(…${workspaceA!.projectId.slice(-4)})`;
    const suffixB = `(…${workspaceB!.projectId.slice(-4)})`;
    expect(result.stdout).toContain(`example ${suffixA}`);
    expect(result.stdout).toContain(`example ${suffixB}`);

    // Both rows visible, neither the (unassigned) bucket.
    const exampleRows = result.stdout.match(/^example \(…/gm) ?? [];
    expect(exampleRows.length).toBe(2);

    // TOTAL line sums both projects.
    expect(result.stdout).toContain('TOTAL');
    expect(result.stdout).toContain('5 calls');
    expect(result.stdout).toContain('$4.7500'); // 1.75 + 3.00
  });

  it('per-project rollup matches raw SUM(cost_usd) for each directive', () => {
    // Pure-query ground-truth: totalCostForDirective over raw model_usage.
    const rawA = modelUsage.totalCostForDirective(db, workspaceA!.directiveId);
    const rawB = modelUsage.totalCostForDirective(db, workspaceB!.directiveId);
    expect(rawA).toBeCloseTo(workspaceA!.totalUsd);
    expect(rawB).toBeCloseTo(workspaceB!.totalUsd);

    // JSON flow so the numbers come back as typed rows rather than parsed text.
    const result = runSpend(db, { json: true });
    expect(result.exitCode).toBe(0);
    const rows = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { projectId: string; totalUsd: number });
    const byId = new Map(rows.map((r) => [r.projectId, r.totalUsd]));

    expect(byId.get(workspaceA!.projectId)).toBeCloseTo(rawA);
    expect(byId.get(workspaceB!.projectId)).toBeCloseTo(rawB);
  });

  it('--project <ulid> isolates one workspace', () => {
    const result = runSpend(db, { project: workspaceA!.projectId });
    expect(result.exitCode).toBe(0);
    const suffixA = `(…${workspaceA!.projectId.slice(-4)})`;
    const suffixB = `(…${workspaceB!.projectId.slice(-4)})`;
    expect(result.stdout).toContain(suffixA);
    expect(result.stdout).not.toContain(suffixB);
    expect(result.stdout).toContain('$1.7500');
    expect(result.stdout).not.toContain('$3.0000');
  });

  it('--project <suffix> disambiguates across two `example` projects', () => {
    const suffixA = workspaceA!.projectId.slice(-4);
    const result = runSpend(db, { project: suffixA });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('$1.7500');
    expect(result.stdout).not.toContain('$3.0000');
  });

  it('--project example (ambiguous) exits 2 with a disambiguation list', () => {
    const result = runSpend(db, { project: 'example' });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('ambiguous');
    expect(result.stdout).toContain(workspaceA!.projectId);
    expect(result.stdout).toContain(workspaceB!.projectId);
  });
});
