/**
 * Regression coverage for I014 (Phase 13.4) — `runArchitect` must auto-
 * commit its wiki writes on `factory resume` so the assessor's
 * `gitClean` check doesn't flip `gate.verify` to false.
 *
 * Tests focus on `commitArchitectWritesIfRepo` (exported for this
 * purpose) since it owns the entire git interaction. The full
 * `runArchitect` path needs a live LLM call which we don't want in
 * unit tests; the helper is the I014-fix surface area.
 *
 * Also covers Tier 14 modifications (ADR 0033): `priorCritique` param
 * and `agents.architect` category resolution with default flip to
 * `planning` (Sonnet).
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WikiCritique } from '@factory5/core';
import { initLogger } from '@factory5/logger';
import { simpleGit } from 'simple-git';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commitArchitectWritesIfRepo, runArchitect } from './architect.js';
import { makeFakeRegistry, tmpProjectWithClaudeMd } from './test-helpers.js';

beforeAll(() => {
  initLogger({ processName: 'architect-test', noFile: true, noConsole: true });
});

interface RepoFixture {
  projectPath: string;
  /** Initialise the repo with one already-tracked, already-committed wiki page. */
  seedTrackedWikiPage: (slug: string, content: string) => Promise<string>;
  /** Configure git identity for this test repo so commits succeed in CI. */
  setIdentity: () => Promise<void>;
}

let workRoot: string;

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'factory5-architect-test-'));
});

afterEach(() => {
  try {
    rmSync(workRoot, { recursive: true, force: true });
  } catch {
    // Windows occasionally holds files briefly post-test; the OS-level
    // tmp cleanup will handle stragglers.
  }
});

async function makeRepoFixture(): Promise<RepoFixture> {
  const projectPath = join(workRoot, 'project');
  mkdirSync(projectPath, { recursive: true });
  const git = simpleGit(projectPath);
  await git.init();
  // Configure local identity — picks up GH Actions / Windows-CI runners
  // that don't have a global identity set.
  await git.addConfig('user.email', 'architect-test@factory5.local');
  await git.addConfig('user.name', 'Architect Test');
  return {
    projectPath,
    setIdentity: async () => {
      await git.addConfig('user.email', 'architect-test@factory5.local');
      await git.addConfig('user.name', 'Architect Test');
    },
    seedTrackedWikiPage: async (slug, content) => {
      const knowledgeDir = join(projectPath, 'docs', 'knowledge');
      mkdirSync(knowledgeDir, { recursive: true });
      const filePath = join(knowledgeDir, slug);
      writeFileSync(filePath, content);
      await git.add([`docs/knowledge/${slug}`]);
      await git.commit(`seed: ${slug}`);
      return filePath;
    },
  };
}

describe('commitArchitectWritesIfRepo (I014 fix — Phase 13.4)', () => {
  it('commits modifications to tracked wiki pages, leaving the tree clean', async () => {
    const fix = await makeRepoFixture();
    const filePath = await fix.seedTrackedWikiPage(
      'overview.md',
      '# Overview (initial)\n\nFirst version.\n',
    );

    // Simulate the architect's re-write of a tracked page.
    writeFileSync(filePath, '# Overview (regenerated)\n\nSecond version.\n');

    // Sanity check: tree IS dirty before the helper runs.
    let status = await simpleGit(fix.projectPath).status();
    expect(status.modified).toContain('docs/knowledge/overview.md');

    await commitArchitectWritesIfRepo({
      projectPath: fix.projectPath,
      writtenPages: [{ path: filePath }],
      directiveId: '01KQARCHITECTI0140000000000',
    });

    status = await simpleGit(fix.projectPath).status();
    expect(status.modified).toEqual([]);
    expect(status.staged).toEqual([]);
    expect(status.not_added).toEqual([]);
    expect(status.isClean()).toBe(true);

    // Commit landed with the expected subject.
    const log = await simpleGit(fix.projectPath).log({ maxCount: 1 });
    expect(log.latest?.message).toBe(
      'factory: architect updated wiki for directive 01KQARCHITECTI0140000000000',
    );
  });

  it('commits new (untracked) wiki pages, leaving the tree clean', async () => {
    const fix = await makeRepoFixture();
    // Seed an unrelated tracked file so the repo has a HEAD.
    await fix.seedTrackedWikiPage('overview.md', '# Overview\n');

    // Architect writes a brand-new page that isn't in the repo yet.
    const knowledgeDir = join(fix.projectPath, 'docs', 'knowledge');
    const newPath = join(knowledgeDir, 'modules.md');
    writeFileSync(newPath, '# Modules\n');

    let status = await simpleGit(fix.projectPath).status();
    expect(status.not_added).toContain('docs/knowledge/modules.md');

    await commitArchitectWritesIfRepo({
      projectPath: fix.projectPath,
      writtenPages: [{ path: newPath }],
      directiveId: 'D-NEW-PAGE',
    });

    status = await simpleGit(fix.projectPath).status();
    expect(status.isClean()).toBe(true);
  });

  it('omits the directive id from the commit subject when not supplied', async () => {
    const fix = await makeRepoFixture();
    const filePath = await fix.seedTrackedWikiPage('a.md', 'one\n');
    writeFileSync(filePath, 'two\n');

    await commitArchitectWritesIfRepo({
      projectPath: fix.projectPath,
      writtenPages: [{ path: filePath }],
    });

    const log = await simpleGit(fix.projectPath).log({ maxCount: 1 });
    expect(log.latest?.message).toBe('factory: architect updated wiki');
  });

  it('skips commit when the architect rewrote a page to identical content', async () => {
    const fix = await makeRepoFixture();
    const filePath = await fix.seedTrackedWikiPage('overview.md', 'same content\n');

    // Architect writes the SAME content — `git add` finds nothing to stage.
    writeFileSync(filePath, 'same content\n');

    const beforeLog = await simpleGit(fix.projectPath).log();
    await commitArchitectWritesIfRepo({
      projectPath: fix.projectPath,
      writtenPages: [{ path: filePath }],
      directiveId: 'D-NOOP',
    });
    const afterLog = await simpleGit(fix.projectPath).log();

    // Tree is clean and no new commit landed.
    const status = await simpleGit(fix.projectPath).status();
    expect(status.isClean()).toBe(true);
    expect(afterLog.total).toBe(beforeLog.total);
  });

  it('is a no-op when projectPath is not a git repo', async () => {
    // Plain directory, no `.git` — typical of test harnesses.
    const projectPath = join(workRoot, 'no-repo');
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(join(projectPath, 'docs', 'knowledge'), { recursive: true });
    const filePath = join(projectPath, 'docs', 'knowledge', 'overview.md');
    writeFileSync(filePath, '# Overview\n');

    // Doesn't throw; doesn't try to init a repo.
    await expect(
      commitArchitectWritesIfRepo({
        projectPath,
        writtenPages: [{ path: filePath }],
        directiveId: 'D-NO-REPO',
      }),
    ).resolves.toBeUndefined();
  });

  it('is a no-op with no written pages', async () => {
    const fix = await makeRepoFixture();
    const beforeLog = await simpleGit(fix.projectPath)
      .log()
      .catch(() => ({ total: 0 }));
    await commitArchitectWritesIfRepo({
      projectPath: fix.projectPath,
      writtenPages: [],
    });
    const afterLog = await simpleGit(fix.projectPath)
      .log()
      .catch(() => ({ total: 0 }));
    expect(afterLog.total).toBe(beforeLog.total);
  });

  it('does not throw when git operations fail (degrades to a logged warning)', async () => {
    // Repo with no identity configured — `git commit` rejects with a
    // user.email error. The helper must swallow the failure so the
    // directive proceeds.
    const projectPath = join(workRoot, 'no-identity');
    mkdirSync(projectPath, { recursive: true });
    const git = simpleGit(projectPath);
    await git.init();
    // Force a clean unset of any inherited global identity for this repo.
    await git.addConfig('user.email', '');
    await git.addConfig('user.name', '');

    const knowledgeDir = join(projectPath, 'docs', 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });
    const filePath = join(knowledgeDir, 'overview.md');
    writeFileSync(filePath, '# Overview\n');

    await expect(
      commitArchitectWritesIfRepo({
        projectPath,
        writtenPages: [{ path: filePath }],
        directiveId: 'D-NO-IDENT',
      }),
    ).resolves.toBeUndefined();
  });

  it('only stages the architect-written paths, leaving unrelated dirty docs/ files alone', async () => {
    const fix = await makeRepoFixture();
    // Seed two tracked files: one wiki page (the architect will rewrite),
    // and one unrelated file under docs/ (the user's pending edit).
    const wikiPath = await fix.seedTrackedWikiPage('overview.md', '# Overview (v1)\n');
    const decisionPath = join(fix.projectPath, 'docs', 'decisions');
    mkdirSync(decisionPath, { recursive: true });
    const adrPath = join(decisionPath, '0001-foo.md');
    writeFileSync(adrPath, '# ADR 1 (committed)\n');
    await simpleGit(fix.projectPath).add(['docs/decisions/0001-foo.md']);
    await simpleGit(fix.projectPath).commit('seed: ADR');

    // Now dirty BOTH files: the architect rewrites the wiki, and the
    // user has an in-progress edit to the ADR.
    writeFileSync(wikiPath, '# Overview (v2)\n');
    writeFileSync(adrPath, '# ADR 1 (in-progress edit)\n');

    await commitArchitectWritesIfRepo({
      projectPath: fix.projectPath,
      writtenPages: [{ path: wikiPath }],
      directiveId: 'D-ISOLATED',
    });

    // Wiki page is committed; ADR is still dirty (the architect's
    // commit didn't sweep it up).
    const status = await simpleGit(fix.projectPath).status();
    expect(status.modified).toEqual(['docs/decisions/0001-foo.md']);
    expect(status.staged).toEqual([]);

    // Latest commit only mentions the wiki page.
    const lastCommit = await simpleGit(fix.projectPath).log({ maxCount: 1 });
    expect(lastCommit.latest?.message).toBe(
      'factory: architect updated wiki for directive D-ISOLATED',
    );
    const showOutput = await simpleGit(fix.projectPath).raw([
      'show',
      '--name-only',
      '--pretty=format:',
      'HEAD',
    ]);
    const filesInCommit = showOutput
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    expect(filesInCommit).toEqual(['docs/knowledge/overview.md']);
  });
});

// ---------------------------------------------------------------------------
// Tier 14 modifications — runArchitect (ADR 0033)
// ---------------------------------------------------------------------------

describe('runArchitect — Tier 14 modifications (ADR 0033)', () => {
  afterEach(() => {
    delete process.env['FACTORY5_PROMPTS_ROOT'];
  });

  it('appends PREVIOUS ATTEMPT FAILED block when priorCritique is provided', async () => {
    const captured: { userPrompt: string }[] = [];
    const registry = makeFakeRegistry({
      response: JSON.stringify({ pages: [{ slug: 'overview.md', content: '# x' }], notes: '' }),
      capturePromptTo: captured,
    });
    const critique: WikiCritique = {
      passes: false,
      severity: 'major',
      findings: [{ aspect: 'modules', gap: 'missing relationships', suggestion: 'add a section' }],
      summary: 'modules missing',
    };
    const projectPath = await tmpProjectWithClaudeMd();
    try {
      await runArchitect({
        registry: registry as Parameters<typeof runArchitect>[0]['registry'],
        projectPath,
        priorCritique: critique,
      });
      expect(captured[0]!.userPrompt).toContain('PREVIOUS ATTEMPT FAILED');
      expect(captured[0]!.userPrompt).toContain('modules missing');
      expect(captured[0]!.userPrompt).toContain('missing relationships');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('does NOT include the PREVIOUS ATTEMPT block when priorCritique is absent', async () => {
    const captured: { userPrompt: string }[] = [];
    const registry = makeFakeRegistry({
      response: JSON.stringify({ pages: [{ slug: 'overview.md', content: '# x' }], notes: '' }),
      capturePromptTo: captured,
    });
    const projectPath = await tmpProjectWithClaudeMd();
    try {
      await runArchitect({
        registry: registry as Parameters<typeof runArchitect>[0]['registry'],
        projectPath,
      });
      expect(captured[0]!.userPrompt).not.toContain('PREVIOUS ATTEMPT FAILED');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('resolves model category from agents.architect when provided', async () => {
    const resolved: string[] = [];
    const registry = makeFakeRegistry({
      response: JSON.stringify({ pages: [{ slug: 'overview.md', content: '# x' }], notes: '' }),
      captureCategoryTo: resolved,
    });
    const projectPath = await tmpProjectWithClaudeMd();
    try {
      await runArchitect({
        registry: registry as Parameters<typeof runArchitect>[0]['registry'],
        projectPath,
        config: { agents: { architect: 'deep' } },
      });
      expect(resolved[0]).toBe('deep');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it("defaults to 'planning' (Sonnet) when config absent — Tier 14 flip", async () => {
    const resolved: string[] = [];
    const registry = makeFakeRegistry({
      response: JSON.stringify({ pages: [{ slug: 'overview.md', content: '# x' }], notes: '' }),
      captureCategoryTo: resolved,
    });
    const projectPath = await tmpProjectWithClaudeMd();
    try {
      await runArchitect({
        registry: registry as Parameters<typeof runArchitect>[0]['registry'],
        projectPath,
      });
      expect(resolved[0]).toBe('planning');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // cwd isolation (post-Tier-15 fix — pythonetl resume incident)
  // -------------------------------------------------------------------------

  it('passes opts.projectPath as req.cwd to the provider (prevents factory5 repo leak)', async () => {
    const captured: Array<{ cwd?: string }> = [];
    const registry = makeFakeRegistry({
      response: JSON.stringify({ pages: [{ slug: 'overview.md', content: '# x' }], notes: '' }),
      captureTo: captured,
    });
    const projectPath = await tmpProjectWithClaudeMd();
    try {
      await runArchitect({
        registry: registry as Parameters<typeof runArchitect>[0]['registry'],
        projectPath,
      });
      expect(captured).toHaveLength(1);
      expect(captured[0]?.cwd).toBe(projectPath);
      expect(captured[0]?.cwd).toBeDefined();
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('writes README to project root when architect output includes the readme field', async () => {
    const captured: Array<{ cwd?: string }> = [];
    const registry = makeFakeRegistry({
      response: JSON.stringify({
        pages: [{ slug: 'overview.md', content: '# x' }],
        readme: '# Project\n\n## Quick Start\n\n<!-- to be filled by scaffolder/builder -->\n',
        notes: '',
      }),
      captureTo: captured,
    });
    const projectPath = await tmpProjectWithClaudeMd();
    try {
      await runArchitect({
        registry: registry as Parameters<typeof runArchitect>[0]['registry'],
        projectPath,
      });
      const readmeContent = await readFile(join(projectPath, 'README.md'), 'utf8');
      expect(readmeContent).toContain('## Quick Start');
      expect(readmeContent).toContain('<!-- to be filled by scaffolder/builder -->');
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  it('does NOT write README when architect output omits the readme field', async () => {
    const registry = makeFakeRegistry({
      response: JSON.stringify({
        pages: [{ slug: 'overview.md', content: '# x' }],
        notes: '',
      }),
    });
    const projectPath = await tmpProjectWithClaudeMd();
    try {
      await runArchitect({
        registry: registry as Parameters<typeof runArchitect>[0]['registry'],
        projectPath,
      });
      // README.md should not exist
      await expect(readFile(join(projectPath, 'README.md'), 'utf8')).rejects.toThrow();
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });
});
