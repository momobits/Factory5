import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initLogger } from '@factory5/logger';

import { loadValidatorConfig } from './config-loader.js';

beforeAll(() => {
  initLogger({ processName: 'coherence-validator-config-loader-test', noFile: true, noConsole: true });
});

describe('loadValidatorConfig', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-config-loader-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns project override when .factory/coherence-validator.json exists', async () => {
    await mkdir(join(projectPath, '.factory'), { recursive: true });
    await writeFile(
      join(projectPath, '.factory', 'coherence-validator.json'),
      JSON.stringify({
        runtime: 'custom',
        interpreter: '/custom/python',
        doc_globs: ['CUSTOM.md'],
      }),
    );
    const result = await loadValidatorConfig({ projectPath, runtime: 'python' });
    expect(result.config?.runtime).toBe('custom');
    expect(result.source).toBe('project-override');
  });

  it('returns shipped default for known runtime when no override exists', async () => {
    const result = await loadValidatorConfig({ projectPath, runtime: 'python' });
    expect(result.config?.runtime).toBe('python');
    expect(result.source).toBe('shipped-default');
  });

  it('returns no-config for unknown runtime with no override', async () => {
    const result = await loadValidatorConfig({ projectPath, runtime: 'haskell' });
    expect(result.config).toBeUndefined();
    expect(result.source).toBe('none');
  });

  it('falls back to shipped default when project override is invalid', async () => {
    await mkdir(join(projectPath, '.factory'), { recursive: true });
    await writeFile(
      join(projectPath, '.factory', 'coherence-validator.json'),
      '{"this": "is", "invalid": true}', // missing required fields
    );
    const result = await loadValidatorConfig({ projectPath, runtime: 'python' });
    // Per the spec: invalid project override logs a warning and falls back to shipped default.
    expect(result.source).toBe('shipped-default');
    expect(result.config?.runtime).toBe('python');
  });
});
