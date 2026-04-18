import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assess,
  checkArchitectureDoc,
  checkGitignore,
  checkLicense,
  checkReadme,
} from './index.js';
import { parsePytestSummary } from './runners/pytest.js';
import { pathToModule } from './runners/imports.js';

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'factory5-assessor-'));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('parsePytestSummary', () => {
  it('parses the common `X passed, Y failed` line', () => {
    const out = '....F.\n===== 5 passed, 2 failed, 1 error in 0.42s =====\n';
    const s = parsePytestSummary(out);
    expect(s.passed).toBe(5);
    expect(s.failed).toBe(2);
    expect(s.errors).toBe(1);
  });

  it('parses pass-only line', () => {
    const out = '.....\n===== 3 passed in 0.1s =====\n';
    const s = parsePytestSummary(out);
    expect(s.passed).toBe(3);
    expect(s.failed).toBe(0);
  });

  it('handles skipped entries', () => {
    const out = '=== 1 passed, 2 skipped in 0.1s ===\n';
    const s = parsePytestSummary(out);
    expect(s.skipped).toBe(2);
    expect(s.passed).toBe(1);
  });

  it('returns zeros when no summary line is present', () => {
    const s = parsePytestSummary('no summary here\n');
    expect(s.passed).toBe(0);
    expect(s.failed).toBe(0);
  });

  it('parses a bare `-q` summary line with no banner', () => {
    const out =
      '.................................                                        [100%]\n33 passed in 0.07s\n';
    const s = parsePytestSummary(out);
    expect(s.passed).toBe(33);
    expect(s.failed).toBe(0);
  });

  it('parses a bare bare-q line with multiple counts', () => {
    const out = 'F.F\n1 passed, 2 failed in 0.3s\n';
    const s = parsePytestSummary(out);
    expect(s.passed).toBe(1);
    expect(s.failed).toBe(2);
  });
});

describe('pathToModule', () => {
  it('converts standard relative paths', () => {
    expect(pathToModule('src/api.py')).toBe('src.api');
    expect(pathToModule('src/foo/bar.py')).toBe('src.foo.bar');
    expect(pathToModule('src\\foo\\bar.py')).toBe('src.foo.bar');
  });

  it('strips __init__', () => {
    expect(pathToModule('src/foo/__init__.py')).toBe('src.foo');
  });

  it('returns undefined for non-.py files', () => {
    expect(pathToModule('src/cli.ts')).toBeUndefined();
  });
});

describe('artifact checks', () => {
  it('checkReadme returns false when missing', async () => {
    expect(await checkReadme(projectDir)).toBe(false);
  });

  it('checkReadme requires at least 30 non-empty lines', async () => {
    await writeFile(join(projectDir, 'README.md'), 'one line only\n');
    expect(await checkReadme(projectDir)).toBe(false);

    const longContent = Array.from({ length: 40 }, (_, i) => `line ${String(i)}`).join('\n');
    await writeFile(join(projectDir, 'README.md'), longContent);
    expect(await checkReadme(projectDir)).toBe(true);
  });

  it('checkLicense picks up LICENSE, LICENSE.md, etc.', async () => {
    expect(await checkLicense(projectDir)).toBe(false);
    await writeFile(join(projectDir, 'LICENSE'), 'MIT');
    expect(await checkLicense(projectDir)).toBe(true);
  });

  it('checkGitignore returns true when .gitignore exists', async () => {
    expect(await checkGitignore(projectDir)).toBe(false);
    await writeFile(join(projectDir, '.gitignore'), 'node_modules\n');
    expect(await checkGitignore(projectDir)).toBe(true);
  });

  it('checkArchitectureDoc matches a variety of paths', async () => {
    expect(await checkArchitectureDoc(projectDir)).toBe(false);
    await mkdir(join(projectDir, 'docs', 'knowledge'), { recursive: true });
    await writeFile(join(projectDir, 'docs', 'knowledge', 'overview.md'), '# Overview');
    expect(await checkArchitectureDoc(projectDir)).toBe(true);
  });
});

describe('assess', () => {
  it('produces a full AssessResult for an empty project', async () => {
    const result = await assess({ projectPath: projectDir, testFramework: 'none' });
    expect(result.modulesExisting).toBe(0);
    expect(result.modulesMissing).toEqual([]);
    expect(result.gateResults.verify).toBe(false);
    expect(result.testFramework).toBe('none');
  });

  it('reports missing modules', async () => {
    const result = await assess({
      projectPath: projectDir,
      expectedModules: ['src/api.py', 'src/cli.py'],
      testFramework: 'none',
    });
    expect(result.modulesExisting).toBe(0);
    expect(result.modulesMissing).toEqual(['src/api.py', 'src/cli.py']);
    expect(result.gateResults.build).toBe(false);
  });

  it('flips gate:build when modules exist and imports ok', async () => {
    await mkdir(join(projectDir, 'src'), { recursive: true });
    await writeFile(join(projectDir, 'src', '__init__.py'), '');
    await writeFile(join(projectDir, 'src', 'api.py'), '# empty\n');
    const result = await assess({
      projectPath: projectDir,
      expectedModules: ['src/api.py'],
      testFramework: 'none',
    });
    expect(result.modulesExisting).toBe(1);
    expect(result.modulesMissing).toEqual([]);
    // imports.ok depends on whether python is installed in the test env; we
    // assert that at least the modules-missing side of gate:build is satisfied.
    expect(result.gateResults.build).toBe(result.importsOk);
  });
});
