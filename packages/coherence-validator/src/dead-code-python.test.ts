import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initLogger } from '@factory5/logger';

import { checkDeadCodePython } from './dead-code-python.js';

beforeAll(() => {
  initLogger({ processName: 'dead-code-python-test', noFile: true, noConsole: true });
});

describe('checkDeadCodePython', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-dead-code-'));
    await mkdir(join(projectPath, 'mypkg'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('flags an unused public function', async () => {
    await writeFile(join(projectPath, 'mypkg', '__init__.py'), '');
    await writeFile(
      join(projectPath, 'mypkg', 'lib.py'),
      'def used_helper(): pass\ndef orphan_func(): pass\n',
    );
    await writeFile(
      join(projectPath, 'mypkg', 'main.py'),
      'from mypkg.lib import used_helper\nused_helper()\n',
    );
    const findings = await checkDeadCodePython({
      projectPath,
      packageGlobs: ['mypkg/**/*.py'],
      exposedVia: [],
      excludeGlobs: ['tests/**'],
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.title.includes('orphan_func'))).toBe(true);
    expect(findings.every((f) => !f.title.includes('used_helper'))).toBe(true);
  });

  it('does not flag a symbol referenced via __all__', async () => {
    await writeFile(join(projectPath, 'mypkg', '__init__.py'), '');
    await writeFile(
      join(projectPath, 'mypkg', 'api.py'),
      '__all__ = ["public_api"]\ndef public_api(): pass\n',
    );
    const findings = await checkDeadCodePython({
      projectPath,
      packageGlobs: ['mypkg/**/*.py'],
      exposedVia: [{ kind: 'explicit_export', source: '__all__' }],
      excludeGlobs: [],
    });
    expect(findings.every((f) => !f.title.includes('public_api'))).toBe(true);
  });

  it('does not flag underscore-prefixed (private) symbols', async () => {
    await writeFile(join(projectPath, 'mypkg', '__init__.py'), '');
    await writeFile(join(projectPath, 'mypkg', 'lib.py'), 'def _internal(): pass\n');
    const findings = await checkDeadCodePython({
      projectPath,
      packageGlobs: ['mypkg/**/*.py'],
      exposedVia: [],
      excludeGlobs: [],
    });
    expect(findings.every((f) => !f.title.includes('_internal'))).toBe(true);
  });

  it('respects entry_points from pyproject.toml', async () => {
    await writeFile(
      join(projectPath, 'pyproject.toml'),
      '[project.scripts]\nmytool = "mypkg.cli:main"\n',
    );
    await writeFile(join(projectPath, 'mypkg', '__init__.py'), '');
    await writeFile(join(projectPath, 'mypkg', 'cli.py'), 'def main(): pass\n');
    const findings = await checkDeadCodePython({
      projectPath,
      packageGlobs: ['mypkg/**/*.py'],
      exposedVia: [{ kind: 'entry_points', source: 'pyproject.toml::project.scripts' }],
      excludeGlobs: [],
    });
    expect(findings.every((f) => !f.title.includes(' main '))).toBe(true);
  });
});
