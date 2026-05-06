/**
 * `factory project list / show <name> / delete <name>` — unit tests
 * (Phase 4.3).
 *
 * All three handlers are async and pure (no `process.exit`, no readline);
 * the CLI wiring in `project.ts` adapts. Drives them directly against an
 * in-memory DB and tmpdir-rooted workspaces, paralleling spend.test.ts /
 * budget.test.ts.
 */

import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newId, type Directive } from '@factory5/core';
import { initLogger } from '@factory5/logger';
import {
  directives as directivesQ,
  openDatabase,
  projects as projectsQ,
  runMigrations,
  type Database,
} from '@factory5/state';
import { loadOrCreateProjectMetadata, updateProjectMetadata } from '@factory5/wiki';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runProjectDelete, runProjectList, runProjectShow } from './project.js';

beforeAll(() => {
  initLogger({ processName: 'cli-project-test', noFile: true, noConsole: true });
});

function freshDb(): Database {
  const db = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('factory project (Phase 4.3)', () => {
  let db: Database;
  let tmpRoot: string;

  beforeEach(async () => {
    db = freshDb();
    tmpRoot = await mkdtemp(join(tmpdir(), 'factory-project-test-'));
  });

  afterEach(async () => {
    db.close();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  /**
   * Create a project at `<tmpRoot>/<name>` with a real `project.json`,
   * register it in the projects table, and optionally seed a build directive
   * tagged with the project's id so `last build` rendering has something to
   * show.
   */
  async function seedProject(
    name: string,
    extras: {
      language?: 'node' | 'python';
      budgetDefaults?: { maxUsd?: number; maxSteps?: number };
      lastBuild?: { status: Directive['status']; createdAt?: string };
    } = {},
  ): Promise<{ id: string; workspacePath: string }> {
    const workspacePath = join(tmpRoot, name);
    const meta = await loadOrCreateProjectMetadata(workspacePath, name);
    if (extras.language !== undefined || extras.budgetDefaults !== undefined) {
      await updateProjectMetadata(workspacePath, (m) => ({
        ...m,
        metadata: {
          ...m.metadata,
          ...(extras.language !== undefined ? { language: extras.language } : {}),
          ...(extras.budgetDefaults !== undefined ? { budgetDefaults: extras.budgetDefaults } : {}),
        },
      }));
    }
    projectsQ.upsert(db, {
      id: meta.id,
      name,
      workspacePath,
      status: 'active',
      createdAt: meta.createdAt,
      lastTouchedAt: meta.createdAt,
    });
    if (extras.lastBuild !== undefined) {
      const directiveId = newId();
      directivesQ.insert(db, {
        id: directiveId,
        source: 'cli',
        principal: 'me',
        channelRef: 'r-1',
        intent: 'build',
        payload: { project: name },
        autonomy: 'autonomous',
        createdAt: extras.lastBuild.createdAt ?? '2026-04-21T12:00:00.000Z',
        status: 'pending',
        projectId: meta.id,
      });
      directivesQ.updateStatus(db, directiveId, extras.lastBuild.status);
    }
    return { id: meta.id, workspacePath };
  }

  // -------- list --------

  describe('runProjectList', () => {
    it('reports an empty registry without erroring', async () => {
      const result = await runProjectList(db);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('no projects');
    });

    it('renders one row per project with name + status + workspace', async () => {
      await seedProject('alpha');
      const result = await runProjectList(db);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('alpha');
      expect(result.stdout).toContain('active');
      expect(result.stdout).toContain('NAME');
      expect(result.stdout).toContain('STATUS');
    });

    it('shows "(no builds yet)" when the project has no build directives', async () => {
      await seedProject('alpha');
      const result = await runProjectList(db);
      expect(result.stdout).toContain('no builds yet');
    });

    it('shows the most recent build status when a build directive exists', async () => {
      await seedProject('alpha', { lastBuild: { status: 'complete' } });
      const result = await runProjectList(db);
      expect(result.stdout).toContain('complete');
    });

    it('shows the language read from project.json metadata', async () => {
      await seedProject('alpha', { language: 'node' });
      const result = await runProjectList(db);
      expect(result.stdout).toContain('node');
    });

    it('renders multiple projects', async () => {
      await seedProject('alpha');
      await seedProject('beta');
      const result = await runProjectList(db);
      expect(result.stdout).toContain('alpha');
      expect(result.stdout).toContain('beta');
    });
  });

  // -------- show --------

  describe('runProjectShow', () => {
    it('pretty-prints registry fields when resolved by name', async () => {
      const seeded = await seedProject('alpha', { language: 'node' });
      const result = await runProjectShow(db, { project: 'alpha' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('alpha');
      expect(result.stdout).toContain(seeded.id);
      expect(result.stdout).toContain(seeded.workspacePath);
      expect(result.stdout).toContain('node');
    });

    it('resolves by full ULID', async () => {
      const seeded = await seedProject('alpha');
      const result = await runProjectShow(db, { project: seeded.id });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('alpha');
    });

    it('prints budget defaults when present', async () => {
      await seedProject('alpha', { budgetDefaults: { maxUsd: 5, maxSteps: 100 } });
      const result = await runProjectShow(db, { project: 'alpha' });
      expect(result.stdout).toContain('5');
      expect(result.stdout).toContain('100');
    });

    it('marks budget as unset when project.json has no budgetDefaults', async () => {
      await seedProject('alpha');
      const result = await runProjectShow(db, { project: 'alpha' });
      expect(result.stdout).toMatch(/maxUsd:\s*\(unset\)/);
    });

    it('errors with exit 2 when no project matches', async () => {
      const result = await runProjectShow(db, { project: 'nonsense' });
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain('no project matches');
    });

    it('still prints registry fields when project.json is missing on disk', async () => {
      // Register a project whose workspacePath has no .factory/project.json.
      const id = newId();
      const orphanPath = join(tmpRoot, 'orphaned');
      projectsQ.upsert(db, {
        id,
        name: 'orphaned',
        workspacePath: orphanPath,
        status: 'active',
        createdAt: '2026-04-01T00:00:00.000Z',
        lastTouchedAt: '2026-04-01T00:00:00.000Z',
      });
      const result = await runProjectShow(db, { project: 'orphaned' });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('orphaned');
      expect(result.stdout).toContain('(unavailable)');
    });

    it('errors with exit 2 on ambiguous name', async () => {
      await seedProject('alpha');
      const wp2 = join(tmpRoot, 'alpha-other');
      const meta2 = await loadOrCreateProjectMetadata(wp2, 'alpha');
      projectsQ.upsert(db, {
        id: meta2.id,
        name: 'alpha',
        workspacePath: wp2,
        status: 'active',
        createdAt: meta2.createdAt,
        lastTouchedAt: meta2.createdAt,
      });
      const result = await runProjectShow(db, { project: 'alpha' });
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain('ambiguous');
    });
  });

  // -------- delete --------

  describe('runProjectDelete', () => {
    it('default path: prompts and unregisters when operator confirms with "y"', async () => {
      const seeded = await seedProject('alpha');
      const result = await runProjectDelete(db, {
        project: 'alpha',
        prompt: async () => 'y',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('unregistered');
      expect(projectsQ.getById(db, seeded.id)).toBeUndefined();
      // Workspace files untouched on the default path.
      expect(await pathExists(seeded.workspacePath)).toBe(true);
    });

    it('default path: declining the prompt cancels and exits 0 without changes', async () => {
      const seeded = await seedProject('alpha');
      const result = await runProjectDelete(db, {
        project: 'alpha',
        prompt: async () => 'n',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('cancelled');
      expect(projectsQ.getById(db, seeded.id)).toBeDefined();
    });

    it('--force: skips the prompt and unregisters immediately', async () => {
      const seeded = await seedProject('alpha');
      let promptCalled = false;
      const result = await runProjectDelete(db, {
        project: 'alpha',
        force: true,
        prompt: async () => {
          promptCalled = true;
          return 'y';
        },
      });
      expect(result.exitCode).toBe(0);
      expect(promptCalled).toBe(false);
      expect(projectsQ.getById(db, seeded.id)).toBeUndefined();
    });

    it('errors with exit 2 when no project matches', async () => {
      const result = await runProjectDelete(db, {
        project: 'nonsense',
        prompt: async () => 'y',
      });
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain('no project matches');
    });

    it('--purge: double-confirm + unregister + recursively delete the workspace', async () => {
      const seeded = await seedProject('alpha');
      // Seed a nested file so rm -rf has something to remove.
      await mkdir(join(seeded.workspacePath, 'src'), { recursive: true });
      const responses = ['y', 'alpha'];
      const result = await runProjectDelete(db, {
        project: 'alpha',
        purge: true,
        prompt: async () => responses.shift() ?? '',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('unregistered');
      expect(result.stdout).toContain('purged');
      expect(projectsQ.getById(db, seeded.id)).toBeUndefined();
      expect(await pathExists(seeded.workspacePath)).toBe(false);
    });

    it('--purge: declining the first prompt cancels (workspace untouched)', async () => {
      const seeded = await seedProject('alpha');
      const result = await runProjectDelete(db, {
        project: 'alpha',
        purge: true,
        prompt: async () => 'n',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('cancelled');
      expect(projectsQ.getById(db, seeded.id)).toBeDefined();
      expect(await pathExists(seeded.workspacePath)).toBe(true);
    });

    it('--purge: typing the wrong name on the second prompt cancels', async () => {
      const seeded = await seedProject('alpha');
      const responses = ['y', 'beta']; // first y, then wrong name
      const result = await runProjectDelete(db, {
        project: 'alpha',
        purge: true,
        prompt: async () => responses.shift() ?? '',
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('cancelled');
      expect(projectsQ.getById(db, seeded.id)).toBeDefined();
      expect(await pathExists(seeded.workspacePath)).toBe(true);
    });

    it('--purge --force: skips prompts and unregisters + rm-rfs', async () => {
      const seeded = await seedProject('alpha');
      let promptCalled = false;
      const result = await runProjectDelete(db, {
        project: 'alpha',
        purge: true,
        force: true,
        prompt: async () => {
          promptCalled = true;
          return 'y';
        },
      });
      expect(result.exitCode).toBe(0);
      expect(promptCalled).toBe(false);
      expect(projectsQ.getById(db, seeded.id)).toBeUndefined();
      expect(await pathExists(seeded.workspacePath)).toBe(false);
    });

    it('errors with exit 2 on ambiguous name', async () => {
      await seedProject('alpha');
      const wp2 = join(tmpRoot, 'alpha-other');
      const meta2 = await loadOrCreateProjectMetadata(wp2, 'alpha');
      projectsQ.upsert(db, {
        id: meta2.id,
        name: 'alpha',
        workspacePath: wp2,
        status: 'active',
        createdAt: meta2.createdAt,
        lastTouchedAt: meta2.createdAt,
      });
      const result = await runProjectDelete(db, {
        project: 'alpha',
        force: true,
        prompt: async () => 'y',
      });
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain('ambiguous');
    });
  });
});
