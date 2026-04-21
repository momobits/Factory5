import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { newId } from '@factory5/core';
import {
  directives as directivesQ,
  openDatabase,
  runMigrations,
  type Database,
} from '@factory5/state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addFinding,
  appendBuildLog,
  getFinding,
  isAdvisory,
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

  // ADR 0018 — verifier findings default to advisory
  it('addFinding defaults advisory=true for verifier source', async () => {
    const f = await addFinding(projectDir, {
      source: 'verifier',
      target: 'src/',
      severity: 'CRITICAL',
      description: 'claimed absence of scaffolded files',
    });
    expect(f.advisory).toBe(true);
    expect(isAdvisory(f)).toBe(true);
  });

  it('addFinding does not set advisory for non-verifier sources', async () => {
    const reviewer = await addFinding(projectDir, {
      source: 'reviewer',
      target: 'src/api.py',
      severity: 'HIGH',
      description: 'no timeout on HTTP call',
    });
    const builder = await addFinding(projectDir, {
      source: 'builder',
      target: 'src/cli.py',
      severity: 'MEDIUM',
      description: 'leaky error handler',
    });
    expect(reviewer.advisory).toBeUndefined();
    expect(builder.advisory).toBeUndefined();
    expect(isAdvisory(reviewer)).toBe(false);
    expect(isAdvisory(builder)).toBe(false);
  });

  it('addFinding respects an explicit advisory override', async () => {
    const verifierBlocking = await addFinding(projectDir, {
      source: 'verifier',
      target: 'docs/',
      severity: 'LOW',
      description: 'caller forced blocking',
      advisory: false,
    });
    const reviewerAdvisory = await addFinding(projectDir, {
      source: 'reviewer',
      target: 'README.md',
      severity: 'LOW',
      description: 'caller forced advisory',
      advisory: true,
    });
    expect(verifierBlocking.advisory).toBeUndefined();
    expect(reviewerAdvisory.advisory).toBe(true);
  });
});

// Phase 6a.2 — dual-write into the cross-project findings_registry.
// Full coverage lands in 6a.6; these cases verify the contract:
//   - registry receives the row with the expected column values,
//   - advisory is persisted as 0/1 mirroring Finding.advisory,
//   - updateFindingStatus upserts status + resolved_at,
//   - no-registry callsites keep writing file-only (backwards compat).
describe('findings registry dual-write', () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
  });
  afterEach(() => {
    try {
      db.close();
    } catch {
      /* db may already be closed by a test that exercised the failure path */
    }
  });

  // Seeds a directive row so that findings referencing its id via
  // `origin_directive_id` pass the FK constraint.
  function seedDirective(id: string = newId()): string {
    directivesQ.insert(db, {
      id,
      source: 'cli',
      principal: 'tester',
      channelRef: 'wiki-test',
      intent: 'build',
      payload: {},
      autonomy: 'autonomous',
      createdAt: new Date().toISOString(),
      status: 'running',
    });
    return id;
  }

  interface RegistryRow {
    project_id: string;
    project_path: string;
    finding_id: string;
    source: string;
    target: string;
    severity: string;
    status: string;
    description: string;
    resolution: string | null;
    advisory: number;
    origin_directive_id: string | null;
    created_at: string;
    resolved_at: string | null;
    updated_at: string;
  }

  // ADR 0021: callers must pass an explicit `projectId` (the ULID from
  // `<project>/.factory/project.json`) on the registry binding. Without
  // it, `mirrorToRegistry` skips the write rather than fall back to
  // `basename(projectPath)` (the I008 collision trap). Tests construct a
  // synthetic ULID here; production callers use
  // `wiki.loadOrCreateProjectMetadata`.
  const TEST_PROJECT_ID = '01KP00000000000000000000PR';

  it('addFinding with registry writes both file and registry row', async () => {
    const directiveId = seedDirective();
    const f = await addFinding(
      projectDir,
      {
        source: 'reviewer',
        target: 'src/api.py',
        severity: 'HIGH',
        description: 'missing timeout',
      },
      { db, projectId: TEST_PROJECT_ID, originDirectiveId: directiveId },
    );
    const rows = db
      .prepare('SELECT * FROM findings_registry WHERE finding_id = ?')
      .all(f.id) as RegistryRow[];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.project_id).toBe(TEST_PROJECT_ID);
    expect(row.project_path).toBe(projectDir);
    expect(row.source).toBe('reviewer');
    expect(row.severity).toBe('HIGH');
    expect(row.status).toBe('OPEN');
    expect(row.advisory).toBe(0);
    expect(row.origin_directive_id).toBe(directiveId);
    expect(row.resolved_at).toBeNull();
  });

  it('addFinding persists advisory=1 for verifier source', async () => {
    const f = await addFinding(
      projectDir,
      {
        source: 'verifier',
        target: 'architecture',
        severity: 'MEDIUM',
        description: 'potential contract drift',
      },
      { db, projectId: TEST_PROJECT_ID },
    );
    const row = db
      .prepare('SELECT advisory, source FROM findings_registry WHERE finding_id = ?')
      .get(f.id) as { advisory: number; source: string } | undefined;
    expect(row?.advisory).toBe(1);
    expect(row?.source).toBe('verifier');
  });

  it('addFinding without a registry binding writes file-only (back-compat)', async () => {
    const f = await addFinding(projectDir, {
      source: 'reviewer',
      target: 'x',
      severity: 'LOW',
      description: 'nit',
    });
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM findings_registry WHERE finding_id = ?')
      .get(f.id) as { c: number };
    expect(count.c).toBe(0);
    // File write still happens.
    const fileCopy = await getFinding(projectDir, f.id);
    expect(fileCopy?.id).toBe(f.id);
  });

  it('addFinding with binding but no projectId skips the registry mirror (ADR 0021)', async () => {
    const f = await addFinding(
      projectDir,
      {
        source: 'reviewer',
        target: 'src/x',
        severity: 'LOW',
        description: 'nit',
      },
      { db }, // intentionally no projectId
    );
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM findings_registry WHERE finding_id = ?')
      .get(f.id) as { c: number };
    expect(count.c).toBe(0);
    // File write still happens — the per-project file is authoritative.
    const fileCopy = await getFinding(projectDir, f.id);
    expect(fileCopy?.id).toBe(f.id);
  });

  it('updateFindingStatus upserts into the registry and bumps resolved_at', async () => {
    const directiveId = seedDirective();
    const f = await addFinding(
      projectDir,
      {
        source: 'fixer',
        target: 'src/x.py',
        severity: 'LOW',
        description: 'nit',
      },
      { db, projectId: TEST_PROJECT_ID, originDirectiveId: directiveId },
    );
    const before = db
      .prepare('SELECT updated_at FROM findings_registry WHERE finding_id = ?')
      .get(f.id) as { updated_at: string };
    await new Promise((r) => setTimeout(r, 2));
    await updateFindingStatus(projectDir, f.id, 'FIXED', 'patched in abc', {
      db,
      projectId: TEST_PROJECT_ID,
      originDirectiveId: directiveId,
    });
    const after = db
      .prepare(
        'SELECT status, resolution, resolved_at, updated_at FROM findings_registry WHERE finding_id = ?',
      )
      .get(f.id) as {
      status: string;
      resolution: string | null;
      resolved_at: string | null;
      updated_at: string;
    };
    expect(after.status).toBe('FIXED');
    expect(after.resolution).toBe('patched in abc');
    expect(after.resolved_at).not.toBeNull();
    expect(after.updated_at >= before.updated_at).toBe(true);
  });

  it('registry upsert preserves created_at across re-raise', async () => {
    const fixedCreated = '2026-01-01T00:00:00.000+00:00';
    const f = await addFinding(
      projectDir,
      {
        source: 'reviewer',
        target: 'src/a',
        severity: 'LOW',
        description: 'first',
        createdAt: fixedCreated,
      },
      { db, projectId: TEST_PROJECT_ID },
    );
    // Manually re-upsert with a different updated_at — created_at should stick.
    await updateFindingStatus(projectDir, f.id, 'WONTFIX', 'stale rule', {
      db,
      projectId: TEST_PROJECT_ID,
    });
    const row = db
      .prepare('SELECT created_at, status FROM findings_registry WHERE finding_id = ?')
      .get(f.id) as { created_at: string; status: string };
    expect(row.created_at).toBe(fixedCreated);
    expect(row.status).toBe('WONTFIX');
  });

  it('registry failure does not fail addFinding (best-effort)', async () => {
    // Close the DB so the registry upsert throws. The per-project file
    // must still be written — afterEach tolerates the already-closed db.
    db.close();
    const f = await addFinding(
      projectDir,
      {
        source: 'reviewer',
        target: 'x',
        severity: 'LOW',
        description: 'y',
      },
      { db, projectId: TEST_PROJECT_ID },
    );
    expect(f.id).toBe('F001');
    const fileCopy = await getFinding(projectDir, f.id);
    expect(fileCopy?.id).toBe(f.id);
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
    await mkdir(dirname(bp), { recursive: true });
    await writeFile(bp, '# BUILD.md\n\n## Log\n\n- pre-existing line\n', 'utf8');
    await appendBuildLog(projectDir, 'new entry', new Date('2026-04-18T11:00:00Z'));
    const content = await readFile(bp, 'utf8');
    expect(content).toContain('pre-existing line');
    expect(content).toContain('new entry');
  });
});
