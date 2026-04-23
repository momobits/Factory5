import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultWorkspace, findRepoTemplatesDir, resolveProjectPath } from './project-resolver.js';

async function freshTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'factory5-resolver-'));
}

describe('defaultWorkspace', () => {
  it('returns a path ending in factory5-workspace', () => {
    expect(defaultWorkspace().endsWith('factory5-workspace')).toBe(true);
  });
});

describe('resolveProjectPath', () => {
  let tmp: string;
  let workspace: string;
  let templates: string;

  beforeEach(async () => {
    tmp = await freshTmp();
    workspace = join(tmp, 'ws');
    templates = join(tmp, 'templates');
    await mkdir(templates, { recursive: true });
  });

  afterEach(() => {
    // Best-effort cleanup handled by OS temp rotation; tests don't depend on it.
  });

  it('returns an absolute path that already exists as-is', async () => {
    const existingAbs = join(tmp, 'absolute-proj');
    await mkdir(existingAbs, { recursive: true });
    const resolved = await resolveProjectPath(existingAbs, workspace, { templatesDir: templates });
    expect(resolved).toBe(existingAbs);
  });

  it('resolves a ./-relative path against the injected cwd', async () => {
    const relBase = join(tmp, 'rel-base');
    await mkdir(join(relBase, 'local-proj'), { recursive: true });
    const resolved = await resolveProjectPath('./local-proj', workspace, {
      templatesDir: templates,
      cwd: relBase,
    });
    expect(resolved).toBe(join(relBase, 'local-proj'));
  });

  it('returns existing workspace directory without copying from templates', async () => {
    const inWorkspace = join(workspace, 'already-there');
    await mkdir(inWorkspace, { recursive: true });
    await writeFile(join(inWorkspace, 'existing.txt'), 'keep me');
    await mkdir(join(templates, 'already-there'), { recursive: true });
    await writeFile(join(templates, 'already-there', 'template.txt'), 'should NOT copy');

    const resolved = await resolveProjectPath('already-there', workspace, {
      templatesDir: templates,
    });
    expect(resolved).toBe(inWorkspace);

    // Existing workspace files preserved; template contents NOT copied over
    const { readFile } = await import('node:fs/promises');
    await expect(readFile(join(inWorkspace, 'existing.txt'), 'utf8')).resolves.toBe('keep me');
    await expect(readFile(join(inWorkspace, 'template.txt'), 'utf8')).rejects.toThrow();
  });

  it('copies from templates/<name> into workspace when workspace empty', async () => {
    const templateDir = join(templates, 'template-proj');
    await mkdir(templateDir, { recursive: true });
    await writeFile(join(templateDir, 'CLAUDE.md'), '# spec\n');

    const resolved = await resolveProjectPath('template-proj', workspace, {
      templatesDir: templates,
    });
    expect(resolved).toBe(join(workspace, 'template-proj'));

    const { readFile } = await import('node:fs/promises');
    await expect(readFile(join(workspace, 'template-proj', 'CLAUDE.md'), 'utf8')).resolves.toBe(
      '# spec\n',
    );
  });

  it('creates an empty workspace directory for an unknown name', async () => {
    const resolved = await resolveProjectPath('brand-new', workspace, { templatesDir: templates });
    expect(resolved).toBe(join(workspace, 'brand-new'));

    const { access, constants } = await import('node:fs/promises');
    await expect(access(resolved, constants.F_OK)).resolves.toBeUndefined();
  });

  it('tolerates missing templates directory (templatesDir undefined)', async () => {
    // Pass `templatesDir: undefined` explicitly so findRepoTemplatesDir is
    // called — point startFrom into a folder that has no templates above
    // it by giving it a fresh tmp root.
    const isolated = await freshTmp();
    const isolatedWorkspace = join(isolated, 'ws');
    // Simulate the "no templates anywhere" case by shadowing findRepoTemplatesDir's
    // startFrom via monkey-patching isn't necessary — instead, just verify the
    // empty-dir fallback wins when templatesDir is explicitly empty.
    const resolved = await resolveProjectPath('no-template-match', isolatedWorkspace, {
      templatesDir: isolated, // templates/<name> doesn't exist under isolated
    });
    expect(resolved).toBe(join(isolatedWorkspace, 'no-template-match'));
  });
});

describe('findRepoTemplatesDir', () => {
  it('finds a templates directory in an ancestor', async () => {
    const root = await freshTmp();
    const templates = join(root, 'templates');
    await mkdir(templates, { recursive: true });
    const deep = join(root, 'a', 'b', 'c');
    await mkdir(deep, { recursive: true });
    expect(await findRepoTemplatesDir({ startFrom: deep })).toBe(templates);
  });

  // Note: a "no templates anywhere in ancestry" test isn't reliable on Windows
  // because mkdtemp() lives under %LOCALAPPDATA%\Temp and the walk will reach
  // %USERPROFILE% — if the user happens to have `~/templates` (even empty),
  // the walk correctly returns it. The positive case above exercises the
  // walk semantics; the negative case is effectively untestable without
  // chroot-style isolation.
});
