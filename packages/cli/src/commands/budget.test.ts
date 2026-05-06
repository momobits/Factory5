/**
 * `factory budget set <project>` — unit tests (Phase 4.2).
 *
 * Drives `runBudgetSet` directly against an in-memory DB + tmpdir-rooted
 * workspaces, same shape as `spend.test.ts`. Exercises per-field merge,
 * idempotence, validation, and the error paths surfaced by
 * `updateProjectMetadata` (`ProjectMetadataNotFoundError`,
 * `ProjectMetadataCorruptError`).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newId } from '@factory5/core';
import { initLogger } from '@factory5/logger';
import { openDatabase, projects, runMigrations, type Database } from '@factory5/state';
import { loadOrCreateProjectMetadata, readProjectMetadata } from '@factory5/wiki';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runBudgetSet } from './budget.js';

beforeAll(() => {
  initLogger({ processName: 'cli-budget-test', noFile: true, noConsole: true });
});

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

describe('runBudgetSet', () => {
  let db: Database;
  let tmpRoot: string;

  beforeEach(async () => {
    db = freshDb();
    tmpRoot = await mkdtemp(join(tmpdir(), 'factory-budget-test-'));
  });

  afterEach(async () => {
    db.close();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  /**
   * Seed a project at `<tmpRoot>/<name>` with a real `.factory/project.json`
   * and a matching row in the `projects` registry (the same shape the
   * directive-creation path produces, minus the directive itself).
   */
  async function seedProject(name: string): Promise<{ id: string; workspacePath: string }> {
    const workspacePath = join(tmpRoot, name);
    const meta = await loadOrCreateProjectMetadata(workspacePath, name);
    projects.upsert(db, {
      id: meta.id,
      name,
      workspacePath,
      status: 'active',
      createdAt: meta.createdAt,
      lastTouchedAt: meta.createdAt,
    });
    return { id: meta.id, workspacePath };
  }

  it('writes maxUsd to project.json and prints the updated block', async () => {
    const { workspacePath } = await seedProject('alpha');
    const result = await runBudgetSet(db, { project: 'alpha', maxUsd: 5 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('budgetDefaults');
    expect(result.stdout).toContain('5');
    const persisted = await readProjectMetadata(workspacePath);
    expect(persisted?.metadata['budgetDefaults']).toEqual({ maxUsd: 5 });
  });

  it('writes maxSteps independently', async () => {
    const { workspacePath } = await seedProject('alpha');
    const result = await runBudgetSet(db, { project: 'alpha', maxSteps: 100 });
    expect(result.exitCode).toBe(0);
    const persisted = await readProjectMetadata(workspacePath);
    expect(persisted?.metadata['budgetDefaults']).toEqual({ maxSteps: 100 });
  });

  it('writes both flags together', async () => {
    const { workspacePath } = await seedProject('alpha');
    const result = await runBudgetSet(db, {
      project: 'alpha',
      maxUsd: 5,
      maxSteps: 100,
    });
    expect(result.exitCode).toBe(0);
    const persisted = await readProjectMetadata(workspacePath);
    expect(persisted?.metadata['budgetDefaults']).toEqual({ maxUsd: 5, maxSteps: 100 });
  });

  it('per-field merge: --max-steps does not flush an existing maxUsd', async () => {
    const { workspacePath } = await seedProject('alpha');
    await runBudgetSet(db, { project: 'alpha', maxUsd: 5 });
    await runBudgetSet(db, { project: 'alpha', maxSteps: 100 });
    const persisted = await readProjectMetadata(workspacePath);
    expect(persisted?.metadata['budgetDefaults']).toEqual({ maxUsd: 5, maxSteps: 100 });
  });

  it('per-field merge: --max-usd overwrites an existing maxUsd but keeps maxSteps', async () => {
    const { workspacePath } = await seedProject('alpha');
    await runBudgetSet(db, { project: 'alpha', maxUsd: 5, maxSteps: 100 });
    await runBudgetSet(db, { project: 'alpha', maxUsd: 12 });
    const persisted = await readProjectMetadata(workspacePath);
    expect(persisted?.metadata['budgetDefaults']).toEqual({ maxUsd: 12, maxSteps: 100 });
  });

  it('idempotent: same call twice yields the same persisted state', async () => {
    const { workspacePath } = await seedProject('alpha');
    await runBudgetSet(db, { project: 'alpha', maxUsd: 5, maxSteps: 100 });
    const after1 = await readProjectMetadata(workspacePath);
    await runBudgetSet(db, { project: 'alpha', maxUsd: 5, maxSteps: 100 });
    const after2 = await readProjectMetadata(workspacePath);
    expect(after2?.metadata['budgetDefaults']).toEqual(after1?.metadata['budgetDefaults']);
  });

  it('rejects missing flags (neither --max-usd nor --max-steps) with exit 2', async () => {
    await seedProject('alpha');
    const result = await runBudgetSet(db, { project: 'alpha' });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatch(/--max-usd|--max-steps/);
  });

  it('rejects negative maxUsd with exit 2', async () => {
    await seedProject('alpha');
    const result = await runBudgetSet(db, { project: 'alpha', maxUsd: -1 });
    expect(result.exitCode).toBe(2);
  });

  it('rejects zero maxUsd with exit 2 (schema requires positive)', async () => {
    await seedProject('alpha');
    const result = await runBudgetSet(db, { project: 'alpha', maxUsd: 0 });
    expect(result.exitCode).toBe(2);
  });

  it('rejects fractional maxSteps with exit 2 (schema requires integer)', async () => {
    await seedProject('alpha');
    const result = await runBudgetSet(db, { project: 'alpha', maxSteps: 1.5 });
    expect(result.exitCode).toBe(2);
  });

  it('errors when no project matches the ref with exit 2', async () => {
    const result = await runBudgetSet(db, { project: 'nonsense', maxUsd: 5 });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('no project matches');
  });

  it('errors when project resolves to a workspace lacking project.json (exit 2)', async () => {
    const id = newId();
    const orphanedPath = join(tmpRoot, 'no-such-dir');
    projects.upsert(db, {
      id,
      name: 'orphaned',
      workspacePath: orphanedPath,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastTouchedAt: new Date().toISOString(),
    });
    const result = await runBudgetSet(db, { project: 'orphaned', maxUsd: 5 });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('project.json');
  });

  it('errors when the project.json on disk is corrupt (exit 2)', async () => {
    const { workspacePath } = await seedProject('alpha');
    await writeFile(join(workspacePath, '.factory', 'project.json'), '{not valid json', 'utf8');
    const result = await runBudgetSet(db, { project: 'alpha', maxUsd: 5 });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('project.json');
  });

  it('reports ambiguous project ref with exit 2 and lists the matches', async () => {
    await seedProject('alpha');
    const wp2 = join(tmpRoot, 'alpha-other');
    const meta2 = await loadOrCreateProjectMetadata(wp2, 'alpha');
    projects.upsert(db, {
      id: meta2.id,
      name: 'alpha',
      workspacePath: wp2,
      status: 'active',
      createdAt: meta2.createdAt,
      lastTouchedAt: meta2.createdAt,
    });
    const result = await runBudgetSet(db, { project: 'alpha', maxUsd: 5 });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('ambiguous');
    expect(result.stdout).toContain('2 matches');
  });

  it('resolves --project by full ULID', async () => {
    const seeded = await seedProject('alpha');
    const result = await runBudgetSet(db, { project: seeded.id, maxUsd: 5 });
    expect(result.exitCode).toBe(0);
    const persisted = await readProjectMetadata(seeded.workspacePath);
    expect(persisted?.metadata['budgetDefaults']).toEqual({ maxUsd: 5 });
  });
});
