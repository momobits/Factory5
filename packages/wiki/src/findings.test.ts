import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initLogger } from '@factory5/logger';

import { addFinding, listFindings } from './findings.js';

beforeAll(() => {
  initLogger({ processName: 'wiki-findings-test', noFile: true, noConsole: true });
});

describe('addFinding — structured fields', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-findings-test-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('persists category, location, title, why, suggested_fix, auto_fixable', async () => {
    const f = await addFinding(projectPath, {
      source: 'builder',
      target: 'etl/cli.py',
      severity: 'HIGH',
      description: 'Legacy description still required.',
      category: 'doc-fiction',
      location: { file: 'README.md', line: 42, anchor: '#cli' },
      title: 'CLI doc mismatch',
      why: 'Users hit unexpected-argument error.',
      suggested_fix: 'Remove the arg from README or implement it.',
      auto_fixable: false,
    });
    expect(f.category).toBe('doc-fiction');
    expect(f.location?.file).toBe('README.md');
    expect(f.title).toBe('CLI doc mismatch');

    const listed = await listFindings(projectPath, { status: 'OPEN' });
    expect(listed[0]?.title).toBe('CLI doc mismatch');
    expect(listed[0]?.suggested_fix).toBe('Remove the arg from README or implement it.');
  });

  it('persists a legacy finding without the new fields', async () => {
    const f = await addFinding(projectPath, {
      source: 'scaffolder',
      target: 'README.md',
      severity: 'LOW',
      description: 'Old-style finding.',
    });
    expect(f.category).toBeUndefined();
    expect(f.location).toBeUndefined();
    expect(f.title).toBeUndefined();
  });
});
