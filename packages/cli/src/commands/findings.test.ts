import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Finding } from '@factory5/core';
import {
  findingsRegistry,
  openDatabase,
  runMigrations,
  type Database,
} from '@factory5/state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  runFindingsBackfill,
  runFindingsList,
  runFindingsShow,
} from './findings.js';

function mkFinding(overrides: Partial<Finding> & { id: string }): Finding {
  return {
    source: 'reviewer',
    target: 'src/x.py',
    severity: 'MEDIUM',
    status: 'OPEN',
    description: 'generated test finding',
    createdAt: '2026-04-21T09:00:00.000Z',
    ...overrides,
  };
}

function seed(
  db: Database,
  projectId: string,
  finding: Finding,
  projectPath = `/tmp/${projectId}`,
  updatedAt = '2026-04-21T10:00:00.000Z',
  originDirectiveId?: string,
): void {
  findingsRegistry.upsert(db, {
    projectId,
    projectPath,
    finding,
    updatedAt,
    ...(originDirectiveId !== undefined ? { originDirectiveId } : {}),
  });
}

describe('runFindingsList', () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
    seed(db, 'alpha', mkFinding({ id: 'F001', severity: 'HIGH' }));
    seed(db, 'alpha', mkFinding({ id: 'F002', severity: 'LOW' }));
    seed(
      db,
      'alpha',
      mkFinding({ id: 'F003', severity: 'MEDIUM', source: 'verifier', advisory: true }),
    );
    seed(db, 'beta', mkFinding({ id: 'F001', severity: 'CRITICAL', status: 'FIXED' }));
  });
  afterEach(() => {
    db.close();
  });

  it('defaults to OPEN + blocking and renders a table', () => {
    const { stdout, exitCode } = runFindingsList(db, {});
    expect(exitCode).toBe(0);
    expect(stdout).toContain('F001');
    expect(stdout).toContain('F002');
    expect(stdout).not.toContain('F003'); // advisory excluded
    expect(stdout).not.toContain('beta'); // FIXED excluded by default
    expect(stdout).toMatch(/\(2 findings\)/);
  });

  it('--severity narrows to a single level', () => {
    const { stdout } = runFindingsList(db, { severity: 'HIGH' });
    expect(stdout).toContain('F001');
    expect(stdout).not.toContain('F002');
  });

  it('--advisory surfaces advisory findings and annotates with [adv]', () => {
    const { stdout } = runFindingsList(db, { advisory: true });
    expect(stdout).toContain('F003');
    expect(stdout).toContain('[adv]MEDIUM');
    expect(stdout).not.toContain('F001');
  });

  it('--advisory + --blocking together show both tiers', () => {
    const { stdout } = runFindingsList(db, { advisory: true, blocking: true });
    expect(stdout).toContain('F001');
    expect(stdout).toContain('F003');
  });

  it('--status FIXED includes resolved findings', () => {
    const { stdout } = runFindingsList(db, { status: 'FIXED' });
    expect(stdout).toContain('beta');
    expect(stdout).toContain('F001');
    expect(stdout).not.toContain('alpha');
  });

  it('--project exact match filters to one project', () => {
    const { stdout } = runFindingsList(db, { project: 'alpha' });
    expect(stdout).toContain('alpha');
    expect(stdout).not.toContain('beta');
  });

  it('--project glob (*) matches prefixes', () => {
    seed(db, 'alpha-two', mkFinding({ id: 'F001', severity: 'MEDIUM' }));
    const { stdout } = runFindingsList(db, { project: 'alpha*' });
    expect(stdout).toContain('alpha ');
    expect(stdout).toContain('alpha-two');
    expect(stdout).not.toContain('beta');
  });

  it('--json emits NDJSON', () => {
    const { stdout } = runFindingsList(db, { json: true });
    const lines = stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { projectId: string; finding: { id: string } };
      expect(parsed.finding.id).toBeDefined();
      expect(parsed.projectId).toBeDefined();
    }
  });

  it('returns exitCode 2 on invalid --severity', () => {
    const r = runFindingsList(db, { severity: 'SCARY' });
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain('invalid --severity');
  });

  it('returns exitCode 2 on invalid --status', () => {
    const r = runFindingsList(db, { status: 'DONE' });
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toContain('invalid --status');
  });

  it('empty registry produces the "(no findings match)" footer', () => {
    const emptyDb = openDatabase(':memory:');
    runMigrations(emptyDb);
    try {
      const { stdout, exitCode } = runFindingsList(emptyDb, {});
      expect(exitCode).toBe(0);
      expect(stdout).toContain('(no findings match)');
    } finally {
      emptyDb.close();
    }
  });
});

describe('runFindingsShow', () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase(':memory:');
    runMigrations(db);
    seed(db, 'alpha', mkFinding({ id: 'F001', severity: 'HIGH', description: 'missing timeout' }));
    seed(db, 'beta', mkFinding({ id: 'F002', severity: 'LOW' }));
  });
  afterEach(() => {
    db.close();
  });

  it('project/id form renders the full detail block', () => {
    const { stdout, exitCode } = runFindingsShow(db, 'alpha/F001', {});
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Project:');
    expect(stdout).toContain('alpha');
    expect(stdout).toContain('Severity:');
    expect(stdout).toContain('HIGH');
    expect(stdout).toContain('missing timeout');
    expect(stdout).toContain('Resolution:');
  });

  it('bare id resolves when unambiguous', () => {
    const { stdout, exitCode } = runFindingsShow(db, 'F002', {});
    expect(exitCode).toBe(0);
    expect(stdout).toContain('beta');
    expect(stdout).toContain('F002');
  });

  it('bare id reports ambiguity when multiple projects match', () => {
    seed(db, 'gamma', mkFinding({ id: 'F001', severity: 'LOW' }));
    const { stdout, exitCode } = runFindingsShow(db, 'F001', {});
    expect(exitCode).toBe(2);
    expect(stdout).toContain('exists in 2 projects');
    expect(stdout).toContain('alpha');
    expect(stdout).toContain('gamma');
    expect(stdout).toContain('Disambiguate');
  });

  it('missing project/id returns exitCode 2', () => {
    const { stdout, exitCode } = runFindingsShow(db, 'alpha/F999', {});
    expect(exitCode).toBe(2);
    expect(stdout).toContain('no finding F999');
  });

  it('missing bare id returns exitCode 2', () => {
    const { stdout, exitCode } = runFindingsShow(db, 'F999', {});
    expect(exitCode).toBe(2);
    expect(stdout).toContain('no finding with id');
  });

  it('--json emits a single parseable JSON object', () => {
    const { stdout, exitCode } = runFindingsShow(db, 'alpha/F001', { json: true });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as { finding: { id: string }; projectId: string };
    expect(parsed.finding.id).toBe('F001');
    expect(parsed.projectId).toBe('alpha');
  });

  it('displays advisory semantic text, not just a flag', () => {
    seed(db, 'delta', mkFinding({ id: 'F001', source: 'verifier', advisory: true }));
    const { stdout } = runFindingsShow(db, 'delta/F001', {});
    expect(stdout).toContain('yes (ADR 0018');
  });
});

describe('runFindingsBackfill', () => {
  let db: Database;
  let workspace: string;
  beforeEach(async () => {
    db = openDatabase(':memory:');
    runMigrations(db);
    workspace = await mkdtemp(join(tmpdir(), 'factory5-backfill-'));
  });
  afterEach(async () => {
    db.close();
    await rm(workspace, { recursive: true, force: true });
  });

  async function writeProjectFindings(name: string, findings: Finding[]): Promise<void> {
    const factoryDir = join(workspace, name, '.factory');
    await mkdir(factoryDir, { recursive: true });
    await writeFile(
      join(factoryDir, 'findings.json'),
      JSON.stringify({ nextSequence: findings.length + 1, findings }, null, 2),
      'utf8',
    );
  }

  it('workspace not readable returns exitCode 2', async () => {
    const { stdout, exitCode } = await runFindingsBackfill(db, {
      workspace: join(workspace, 'does-not-exist'),
    });
    expect(exitCode).toBe(2);
    expect(stdout).toContain('not readable');
  });

  it('imports every finding from every project one level deep', async () => {
    await writeProjectFindings('alpha', [
      mkFinding({ id: 'F001', severity: 'HIGH' }),
      mkFinding({ id: 'F002', severity: 'LOW' }),
    ]);
    await writeProjectFindings('beta', [mkFinding({ id: 'F001', severity: 'CRITICAL' })]);

    const { stdout, exitCode } = await runFindingsBackfill(db, { workspace });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('2 dir(s) scanned');
    expect(stdout).toContain('2 with findings.json');
    expect(stdout).toContain('imported 3');
    expect(stdout).toContain('alpha');
    expect(stdout).toContain('+2 imported');

    expect(findingsRegistry.getByProjectAndId(db, 'alpha', 'F001')).toBeDefined();
    expect(findingsRegistry.getByProjectAndId(db, 'alpha', 'F002')).toBeDefined();
    expect(findingsRegistry.getByProjectAndId(db, 'beta', 'F001')).toBeDefined();
  });

  it('is idempotent — second run reports updated-only, no duplicate inserts', async () => {
    await writeProjectFindings('alpha', [mkFinding({ id: 'F001', severity: 'HIGH' })]);
    await runFindingsBackfill(db, { workspace });
    const second = await runFindingsBackfill(db, { workspace });
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('imported 0');
    expect(second.stdout).toContain('updated 1');
    const total = db
      .prepare('SELECT COUNT(*) AS c FROM findings_registry WHERE project_id = ?')
      .get('alpha') as { c: number };
    expect(total.c).toBe(1);
  });

  it('--dry-run reports counts without touching the DB', async () => {
    await writeProjectFindings('alpha', [mkFinding({ id: 'F001', severity: 'HIGH' })]);
    const { stdout, exitCode } = await runFindingsBackfill(db, { workspace, dryRun: true });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('(dry-run)');
    expect(stdout).toContain('would import 1');
    const count = db
      .prepare('SELECT COUNT(*) AS c FROM findings_registry')
      .get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('malformed findings.json increments errors but does not abort the run', async () => {
    // Valid project + invalid project side-by-side.
    await writeProjectFindings('alpha', [mkFinding({ id: 'F001', severity: 'HIGH' })]);
    const badDir = join(workspace, 'beta', '.factory');
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, 'findings.json'), '{ not json', 'utf8');

    const { stdout, exitCode } = await runFindingsBackfill(db, { workspace });
    expect(exitCode).toBe(1); // errors > 0
    expect(stdout).toContain('1 error(s)');
    expect(stdout).toContain('imported 1'); // alpha still made it in
    expect(findingsRegistry.getByProjectAndId(db, 'alpha', 'F001')).toBeDefined();
    expect(findingsRegistry.getByProjectAndId(db, 'beta', 'F001')).toBeUndefined();
  });

  it('skips directories without a .factory/findings.json file', async () => {
    await writeProjectFindings('alpha', [mkFinding({ id: 'F001', severity: 'HIGH' })]);
    await mkdir(join(workspace, 'not-a-project'), { recursive: true });
    const { stdout, exitCode } = await runFindingsBackfill(db, { workspace });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('2 dir(s) scanned');
    expect(stdout).toContain('1 with findings.json');
  });
});
