import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CreateProjectAlreadyExistsError,
  createProject,
  scaffoldClaudeMd,
} from './create-project.js';
import type { ProjectLanguage } from './project-metadata.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('createProject', () => {
  let workRoot: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'factory5-cp-'));
  });

  afterEach(() => {
    try {
      rmSync(workRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('creates a fresh project (python default scaffold)', async () => {
    const projectPath = join(workRoot, 'demo');
    const result = await createProject({ projectPath, name: 'demo', language: 'python' });

    expect(result.path).toBe(projectPath);
    expect(result.id).toMatch(ULID_RE);
    expect(result.claudeMdPath).toBe(join(projectPath, 'CLAUDE.md'));

    const claudeMd = readFileSync(result.claudeMdPath, 'utf8');
    expect(claudeMd).toMatch(/^# demo/);
    expect(claudeMd).toMatch(/Python 3\.11\+/);

    const meta = JSON.parse(
      readFileSync(join(projectPath, '.factory', 'project.json'), 'utf8'),
    ) as {
      id: string;
      name: string;
      metadata: { language?: string };
    };
    expect(meta.id).toBe(result.id);
    expect(meta.name).toBe('demo');
    expect(meta.metadata.language).toBe('python');
  });

  it('writes the language-appropriate scaffold for each runtime', async () => {
    const cases: Array<[ProjectLanguage, RegExp]> = [
      ['python', /pytest/],
      ['node', /vitest/],
      ['go', /go test/],
      ['rust', /cargo test/],
    ];
    for (const [language, marker] of cases) {
      const projectPath = join(workRoot, language);
      await createProject({ projectPath, name: language, language });
      const body = readFileSync(join(projectPath, 'CLAUDE.md'), 'utf8');
      expect(body).toMatch(marker);
    }
  });

  it('uses claudeMd override when provided (skips scaffold)', async () => {
    const projectPath = join(workRoot, 'override');
    const customBody = '# Custom Spec\n\nThis is hand-written, not scaffolded.\n';
    await createProject({
      projectPath,
      name: 'override',
      language: 'node',
      claudeMd: customBody,
    });
    expect(readFileSync(join(projectPath, 'CLAUDE.md'), 'utf8')).toBe(customBody);

    const meta = JSON.parse(
      readFileSync(join(projectPath, '.factory', 'project.json'), 'utf8'),
    ) as { metadata: { language?: string } };
    expect(meta.metadata.language).toBe('node');
  });

  it('refuses to overwrite an existing project identity', async () => {
    const projectPath = join(workRoot, 'taken');
    const first = await createProject({ projectPath, name: 'taken', language: 'python' });

    const err = await createProject({
      projectPath,
      name: 'taken',
      language: 'python',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CreateProjectAlreadyExistsError);
    const exErr = err as CreateProjectAlreadyExistsError;
    expect(exErr.reason).toBe('existing-metadata');
    expect(exErr.existingProjectId).toBe(first.id);
    expect(exErr.projectPath).toBe(projectPath);
  });

  it('refuses to overwrite when CLAUDE.md exists but no metadata yet', async () => {
    const projectPath = join(workRoot, 'half-claimed');
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, 'CLAUDE.md'), '# pre-existing\n', 'utf8');

    const err = await createProject({
      projectPath,
      name: 'half-claimed',
      language: 'python',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CreateProjectAlreadyExistsError);
    expect((err as CreateProjectAlreadyExistsError).reason).toBe('existing-claude-md');
    expect((err as CreateProjectAlreadyExistsError).existingProjectId).toBeUndefined();

    expect(readFileSync(join(projectPath, 'CLAUDE.md'), 'utf8')).toBe('# pre-existing\n');
    expect(existsSync(join(projectPath, '.factory', 'project.json'))).toBe(false);
  });

  it('keeps the project id stable when re-read after create', async () => {
    const projectPath = join(workRoot, 'stable');
    const first = await createProject({ projectPath, name: 'stable', language: 'go' });

    const meta = JSON.parse(
      readFileSync(join(projectPath, '.factory', 'project.json'), 'utf8'),
    ) as { id: string };
    expect(meta.id).toBe(first.id);
  });
});

describe('scaffoldClaudeMd', () => {
  it('python scaffold names pytest and src/<module>.py', () => {
    const out = scaffoldClaudeMd('my-cli', 'python');
    expect(out).toMatch(/# my-cli/);
    expect(out).toMatch(/Python 3\.11\+/);
    expect(out).toMatch(/pytest/);
    expect(out).toMatch(/src\/<module>\.py/);
  });

  it('node scaffold names pnpm + vitest + the assessor pipeline', () => {
    const out = scaffoldClaudeMd('logs', 'node');
    expect(out).toMatch(/# logs/);
    expect(out).toMatch(/TypeScript 5\.x/);
    expect(out).toMatch(/pnpm/);
    expect(out).toMatch(/vitest/);
    // The Node runtime gate runs `pnpm install → pnpm typecheck → pnpm test`,
    // so the scaffold must remind the operator to expose those scripts.
    expect(out).toMatch(/typecheck/);
  });

  it('go scaffold names go test ./... and main.go', () => {
    const out = scaffoldClaudeMd('svc', 'go');
    expect(out).toMatch(/Go 1\.21\+/);
    expect(out).toMatch(/main\.go/);
    expect(out).toMatch(/go test \.\/\.\.\./);
  });

  it('rust scaffold names cargo test and main.rs/lib.rs', () => {
    const out = scaffoldClaudeMd('cli', 'rust');
    expect(out).toMatch(/Rust stable/);
    expect(out).toMatch(/cargo test/);
    expect(out).toMatch(/main\.rs|lib\.rs/);
  });
});
