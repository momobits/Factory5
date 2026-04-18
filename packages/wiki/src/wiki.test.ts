import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newId } from '@factory5/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addFinding,
  appendBuildLog,
  getFinding,
  listFindings,
  projectPaths,
  readPlan,
  readWiki,
  rebuildFindingsTable,
  updateFindingStatus,
  wikiReadiness,
  writePlan,
  writeWikiPage,
} from './index.js';

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'factory5-wiki-'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('paths', () => {
  it('computes all sub-paths under the project root', () => {
    const p = projectPaths('/tmp/proj');
    expect(p.root).toBe('/tmp/proj');
    expect(p.findings).toMatch(/[\\/].factory[\\/]findings\.json$/);
    expect(p.knowledge).toMatch(/[\\/]docs[\\/]knowledge$/);
    expect(p.planJson).toMatch(/[\\/].factory[\\/]plan\.json$/);
  });
});

describe('wiki pages', () => {
  it('writeWikiPage creates nested directories and trailing newline', async () => {
    const path = await writeWikiPage(projectDir, 'modules/api.md', '# API');
    const content = await readFile(path, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(content).toContain('# API');
  });

  it('readWiki returns empty list when knowledge dir is missing', async () => {
    const pages = await readWiki(projectDir);
    expect(pages).toEqual([]);
  });

  it('readWiki round-trips multiple pages including nested slugs', async () => {
    await writeWikiPage(projectDir, 'overview.md', '# Overview');
    await writeWikiPage(projectDir, 'modules/api.md', '# API');
    const pages = await readWiki(projectDir);
    const slugs = pages.map((p) => p.slug).sort();
    expect(slugs).toEqual(['modules/api.md', 'overview.md']);
  });

  it('rejects path-traversal slugs', async () => {
    await expect(writeWikiPage(projectDir, '../evil.md', 'no')).rejects.toThrow(/unsafe slug/);
    await expect(writeWikiPage(projectDir, '/abs.md', 'no')).rejects.toThrow(/unsafe slug/);
  });
});

describe('findings', () => {
  it('addFinding assigns F001, F002 sequentially', async () => {
    const a = await addFinding(projectDir, {
      source: 'reviewer',
      target: 'src/api.py',
      severity: 'MEDIUM',
      description: 'Missing input validation.',
    });
    const b = await addFinding(projectDir, {
      source: 'reviewer',
      target: 'src/cli.py',
      severity: 'HIGH',
      description: 'Unhandled KeyboardInterrupt.',
    });
    expect(a.id).toBe('F001');
    expect(b.id).toBe('F002');
    const all = await listFindings(projectDir);
    expect(all).toHaveLength(2);
  });

  it('updateFindingStatus sets resolvedAt on terminal transitions', async () => {
    const f = await addFinding(projectDir, {
      source: 'fixer',
      target: 'src/x.py',
      severity: 'LOW',
      description: 'nit',
    });
    expect(f.resolvedAt).toBeUndefined();
    const fixed = await updateFindingStatus(projectDir, f.id, 'FIXED', 'patched in commit abc');
    expect(fixed.status).toBe('FIXED');
    expect(fixed.resolution).toBe('patched in commit abc');
    expect(fixed.resolvedAt).toBeDefined();
  });

  it('listFindings filters by status', async () => {
    await addFinding(projectDir, {
      source: 'reviewer',
      target: 'a',
      severity: 'LOW',
      description: 'x',
    });
    const b = await addFinding(projectDir, {
      source: 'reviewer',
      target: 'b',
      severity: 'LOW',
      description: 'y',
    });
    await updateFindingStatus(projectDir, b.id, 'FIXED');
    const open = await listFindings(projectDir, { status: 'OPEN' });
    const closed = await listFindings(projectDir, { status: ['FIXED', 'VERIFIED'] });
    expect(open.map((f) => f.id)).toEqual(['F001']);
    expect(closed.map((f) => f.id)).toEqual(['F002']);
  });

  it('getFinding returns undefined for unknown id', async () => {
    const got = await getFinding(projectDir, 'F999');
    expect(got).toBeUndefined();
  });
});

describe('BUILD.md', () => {
  it('rebuildFindingsTable creates BUILD.md with a table', async () => {
    await addFinding(projectDir, {
      source: 'reviewer',
      target: 'src/x',
      severity: 'HIGH',
      description: 'needs fixing',
    });
    await rebuildFindingsTable(projectDir);
    const content = await readFile(projectPaths(projectDir).buildMd, 'utf8');
    expect(content).toContain('## Findings');
    expect(content).toContain('F001');
    expect(content).toContain('needs fixing');
  });

  it('appendBuildLog writes a timestamped entry', async () => {
    await appendBuildLog(projectDir, 'scaffolder created src/', new Date('2026-04-18T10:00:00Z'));
    const content = await readFile(projectPaths(projectDir).buildMd, 'utf8');
    expect(content).toContain('## Log');
    expect(content).toContain('2026-04-18T10:00:00.000Z');
    expect(content).toContain('scaffolder created src/');
  });

  it('rebuildFindingsTable preserves existing log entries', async () => {
    await appendBuildLog(projectDir, 'first entry', new Date('2026-04-18T10:00:00Z'));
    await addFinding(projectDir, {
      source: 'reviewer',
      target: 'src/x',
      severity: 'LOW',
      description: 'tiny',
    });
    await rebuildFindingsTable(projectDir);
    const content = await readFile(projectPaths(projectDir).buildMd, 'utf8');
    expect(content).toContain('first entry');
    expect(content).toContain('F001');
  });
});

describe('plan', () => {
  it('writePlan + readPlan round-trips', async () => {
    const now = new Date().toISOString();
    const plan = {
      id: newId(),
      directiveId: newId(),
      projectPath: projectDir,
      tasks: [],
      createdAt: now,
      status: 'draft' as const,
    };
    await writePlan(plan);
    const got = await readPlan(projectDir);
    expect(got?.id).toBe(plan.id);
    expect(got?.status).toBe('draft');
  });

  it('readPlan returns undefined when no plan written', async () => {
    expect(await readPlan(projectDir)).toBeUndefined();
  });
});

describe('readiness', () => {
  it('fails everything for an empty wiki', async () => {
    const report = await wikiReadiness(projectDir);
    expect(report.ok).toBe(false);
    expect(report.checks.map((c) => c.id)).toContain('overview-exists');
  });

  it('passes when all required sections exist and content is substantial', async () => {
    const body = 'x'.repeat(400);
    await writeWikiPage(projectDir, 'overview.md', `# Overview\n\n${body}`);
    await writeWikiPage(projectDir, 'modules/api.md', `# API\n\n${body}`);
    await writeWikiPage(projectDir, 'testing.md', `# Testing\n\n${body}`);
    const report = await wikiReadiness(projectDir);
    expect(report.ok).toBe(true);
  });

  it('recognizes an inline `## Modules` section as module documentation', async () => {
    const body = 'x'.repeat(400);
    await writeWikiPage(
      projectDir,
      'overview.md',
      `# Overview\n\n${body}\n\n## Modules\n\n- a\n- b`,
    );
    await writeWikiPage(projectDir, 'testing.md', `# Testing\n\n${body}`);
    const report = await wikiReadiness(projectDir);
    const modules = report.checks.find((c) => c.id === 'modules-documented');
    expect(modules?.ok).toBe(true);
  });
});

describe('custom pre-existing files', () => {
  it('does not overwrite an existing BUILD.md on appendBuildLog', async () => {
    const bp = projectPaths(projectDir).buildMd;
    await mkdir(join(projectDir), { recursive: true });
    await writeFile(bp, '# BUILD.md\n\n## Log\n\n- pre-existing line\n', 'utf8');
    await appendBuildLog(projectDir, 'new entry', new Date('2026-04-18T11:00:00Z'));
    const content = await readFile(bp, 'utf8');
    expect(content).toContain('pre-existing line');
    expect(content).toContain('new entry');
  });
});
