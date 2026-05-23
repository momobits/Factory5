import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PROJECT_FILE_VERSION,
  ProjectMetadataCorruptError,
  ProjectMetadataNotFoundError,
  budgetDefaultsFromProjectMeta,
  loadOrCreateProjectMetadata,
  readProjectMetadata,
  resolveDirectiveLimits,
  resolveDirectivePayloadBudgets,
  updateProjectMetadata,
  type ProjectMetadata,
} from './project-metadata.js';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('loadOrCreateProjectMetadata', () => {
  let workRoot: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'factory5-pm-'));
  });

  afterEach(() => {
    try {
      rmSync(workRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('creates a fresh identity file when none exists', async () => {
    const projectPath = join(workRoot, 'fresh');
    mkdirSync(projectPath, { recursive: true });

    const meta = await loadOrCreateProjectMetadata(projectPath, 'fresh');

    expect(meta.id).toMatch(ULID_RE);
    expect(meta.name).toBe('fresh');
    expect(meta.factoryVersion).toBe(PROJECT_FILE_VERSION);
    expect(meta.metadata).toEqual({});

    const onDisk = JSON.parse(
      readFileSync(join(projectPath, '.factory', 'project.json'), 'utf8'),
    ) as { id: string; name: string };
    expect(onDisk.id).toBe(meta.id);
    expect(onDisk.name).toBe('fresh');
  });

  it('seeds metadata from initialMetadata on create (Phase 10.8 language picker)', async () => {
    const projectPath = join(workRoot, 'seeded');
    mkdirSync(projectPath, { recursive: true });

    const meta = await loadOrCreateProjectMetadata(projectPath, 'seeded', {
      initialMetadata: { language: 'node' },
    });

    expect(meta.metadata).toEqual({ language: 'node' });

    const onDisk = JSON.parse(
      readFileSync(join(projectPath, '.factory', 'project.json'), 'utf8'),
    ) as { metadata: Record<string, unknown> };
    expect(onDisk.metadata).toEqual({ language: 'node' });
  });

  it('ignores initialMetadata when the file already exists', async () => {
    const projectPath = join(workRoot, 'preexisting');
    mkdirSync(projectPath, { recursive: true });

    const first = await loadOrCreateProjectMetadata(projectPath, 'preexisting', {
      initialMetadata: { language: 'go' },
    });
    expect(first.metadata).toEqual({ language: 'go' });

    // A second load must NOT overwrite the existing file's metadata, even if
    // the caller passes a different initialMetadata. Existing identity is
    // sticky per ADR 0021.
    const second = await loadOrCreateProjectMetadata(projectPath, 'preexisting', {
      initialMetadata: { language: 'rust' },
    });
    expect(second.id).toBe(first.id);
    expect(second.metadata).toEqual({ language: 'go' });
  });

  it('adopts the existing identity when project.json already exists', async () => {
    const projectPath = join(workRoot, 'existing');
    const factoryDir = join(projectPath, '.factory');
    mkdirSync(factoryDir, { recursive: true });
    const existingId = '01KPRHNEX1T3VR3S4ZTTSJ8F0M';
    writeFileSync(
      join(factoryDir, 'project.json'),
      JSON.stringify(
        {
          id: existingId,
          name: 'existing',
          createdAt: '2026-01-01T00:00:00.000Z',
          factoryVersion: '0.x',
          metadata: { foo: 'bar' },
        },
        null,
        2,
      ),
      'utf8',
    );

    const meta = await loadOrCreateProjectMetadata(projectPath, 'existing');

    expect(meta.id).toBe(existingId);
    expect(meta.metadata).toEqual({ foo: 'bar' });
  });

  it('throws ProjectMetadataCorruptError when project.json is invalid JSON', async () => {
    const projectPath = join(workRoot, 'broken-json');
    const factoryDir = join(projectPath, '.factory');
    mkdirSync(factoryDir, { recursive: true });
    writeFileSync(join(factoryDir, 'project.json'), 'this is not json {', 'utf8');

    await expect(loadOrCreateProjectMetadata(projectPath, 'broken-json')).rejects.toBeInstanceOf(
      ProjectMetadataCorruptError,
    );
  });

  it('throws ProjectMetadataCorruptError when id is missing', async () => {
    const projectPath = join(workRoot, 'no-id');
    const factoryDir = join(projectPath, '.factory');
    mkdirSync(factoryDir, { recursive: true });
    writeFileSync(
      join(factoryDir, 'project.json'),
      JSON.stringify({ name: 'no-id', createdAt: '2026-01-01T00:00:00Z', factoryVersion: '0.x' }),
      'utf8',
    );

    await expect(loadOrCreateProjectMetadata(projectPath, 'no-id')).rejects.toBeInstanceOf(
      ProjectMetadataCorruptError,
    );
  });

  it('throws ProjectMetadataCorruptError when id is not a ULID', async () => {
    const projectPath = join(workRoot, 'bad-id');
    const factoryDir = join(projectPath, '.factory');
    mkdirSync(factoryDir, { recursive: true });
    writeFileSync(
      join(factoryDir, 'project.json'),
      JSON.stringify({
        id: 'not-a-ulid',
        name: 'bad-id',
        createdAt: '2026-01-01T00:00:00Z',
        factoryVersion: '0.x',
      }),
      'utf8',
    );

    await expect(loadOrCreateProjectMetadata(projectPath, 'bad-id')).rejects.toBeInstanceOf(
      ProjectMetadataCorruptError,
    );
  });

  it('uses injected generateId and now functions for determinism', async () => {
    const projectPath = join(workRoot, 'deterministic');
    mkdirSync(projectPath, { recursive: true });
    const fixedId = '01KP00000000000000000000XX';
    const fixedNow = new Date('2026-04-21T17:30:00.000Z');

    const meta = await loadOrCreateProjectMetadata(projectPath, 'deterministic', {
      generateId: () => fixedId,
      now: () => fixedNow,
    });

    expect(meta.id).toBe(fixedId);
    expect(meta.createdAt).toBe('2026-04-21T17:30:00.000Z');
  });

  it('two consecutive calls return the same metadata (idempotent claim)', async () => {
    const projectPath = join(workRoot, 'twice');
    mkdirSync(projectPath, { recursive: true });

    const first = await loadOrCreateProjectMetadata(projectPath, 'twice');
    const second = await loadOrCreateProjectMetadata(projectPath, 'twice');

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it('error message names the file path so operators know what to inspect', async () => {
    const projectPath = join(workRoot, 'err-path');
    const factoryDir = join(projectPath, '.factory');
    mkdirSync(factoryDir, { recursive: true });
    const filePath = join(factoryDir, 'project.json');
    writeFileSync(filePath, '{', 'utf8');

    let caught: Error | undefined;
    try {
      await loadOrCreateProjectMetadata(projectPath, 'err-path');
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(ProjectMetadataCorruptError);
    expect(caught?.message).toContain(filePath);
    expect((caught as ProjectMetadataCorruptError).filePath).toBe(filePath);
  });
});

describe('readProjectMetadata', () => {
  let workRoot: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'factory5-pm-read-'));
  });

  afterEach(() => {
    try {
      rmSync(workRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('returns undefined when project.json is absent (no claim, no creation)', async () => {
    const projectPath = join(workRoot, 'absent');
    mkdirSync(projectPath, { recursive: true });
    const meta = await readProjectMetadata(projectPath);
    expect(meta).toBeUndefined();
  });

  it('returns parsed metadata when project.json is present and valid', async () => {
    const projectPath = join(workRoot, 'present');
    const factoryDir = join(projectPath, '.factory');
    mkdirSync(factoryDir, { recursive: true });
    const id = '01KPRHNEX1T3VR3S4ZTTSJ8F0M';
    writeFileSync(
      join(factoryDir, 'project.json'),
      JSON.stringify({
        id,
        name: 'present',
        createdAt: '2026-04-21T00:00:00.000Z',
        factoryVersion: '0.x',
        metadata: {},
      }),
      'utf8',
    );
    const meta = await readProjectMetadata(projectPath);
    expect(meta?.id).toBe(id);
  });

  it('throws ProjectMetadataCorruptError on a present-but-invalid file (no silent miss)', async () => {
    const projectPath = join(workRoot, 'corrupt');
    const factoryDir = join(projectPath, '.factory');
    mkdirSync(factoryDir, { recursive: true });
    writeFileSync(join(factoryDir, 'project.json'), 'not json', 'utf8');
    await expect(readProjectMetadata(projectPath)).rejects.toBeInstanceOf(
      ProjectMetadataCorruptError,
    );
  });
});

describe('budgetDefaultsFromProjectMeta (ADR 0027 §4 read helper)', () => {
  const baseMeta = (metadata: Record<string, unknown>): ProjectMetadata => ({
    id: '01KQ0P14MZZPJRPA5RW929TTSJ',
    name: 'sample',
    createdAt: '2026-04-25T00:00:00.000Z',
    factoryVersion: '0.x',
    metadata,
  });

  it('returns the parsed defaults when both fields are set', () => {
    expect(
      budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { maxUsd: 5, maxSteps: 100 } })),
    ).toEqual({
      maxUsd: 5,
      maxSteps: 100,
    });
  });

  it('returns just the present field on partial defaults', () => {
    expect(budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { maxUsd: 2.5 } }))).toEqual({
      maxUsd: 2.5,
    });
    expect(budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { maxSteps: 50 } }))).toEqual({
      maxSteps: 50,
    });
  });

  it('returns an empty object when budgetDefaults is {} (cleared)', () => {
    expect(budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: {} }))).toEqual({});
  });

  it('returns undefined when the budgetDefaults key is absent', () => {
    expect(budgetDefaultsFromProjectMeta(baseMeta({}))).toBeUndefined();
  });

  it('returns undefined on malformed entries (negative, non-numeric, wrong shape)', () => {
    expect(
      budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { maxUsd: -1 } })),
    ).toBeUndefined();
    expect(
      budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { maxUsd: 'free' } })),
    ).toBeUndefined();
    expect(
      budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: 'unlimited' })),
    ).toBeUndefined();
    expect(budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: null }))).toBeUndefined();
  });

  // Phase 13.5 — widen the project metadata schema to cover all six Phase 12
  // budget axes (ADR 0032 §1). Old projects with `{maxUsd, maxSteps}` only
  // still parse; new projects can carry `{maxTurnsScaffolder, ...}` etc.

  it('parses all six Phase 12 budget axes when set', () => {
    expect(
      budgetDefaultsFromProjectMeta(
        baseMeta({
          budgetDefaults: {
            maxUsd: 5,
            maxSteps: 100,
            askUserDeadlineMs: 600_000,
            maxTurnsScaffolder: 160,
            maxTurnsBuilder: 80,
            maxTurnsFixer: 80,
          },
        }),
      ),
    ).toEqual({
      maxUsd: 5,
      maxSteps: 100,
      askUserDeadlineMs: 600_000,
      maxTurnsScaffolder: 160,
      maxTurnsBuilder: 80,
      maxTurnsFixer: 80,
    });
  });

  it('parses maxTurnsScaffolder alone (one new axis at a time)', () => {
    expect(
      budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { maxTurnsScaffolder: 160 } })),
    ).toEqual({ maxTurnsScaffolder: 160 });
  });

  it('parses askUserDeadlineMs alone', () => {
    expect(
      budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { askUserDeadlineMs: 600_000 } })),
    ).toEqual({ askUserDeadlineMs: 600_000 });
  });

  it('rejects malformed Phase 12 axis values (negative, non-integer, non-positive)', () => {
    expect(
      budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { maxTurnsScaffolder: -1 } })),
    ).toBeUndefined();
    expect(
      budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { maxTurnsBuilder: 'wide' } })),
    ).toBeUndefined();
    expect(
      budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { askUserDeadlineMs: 0 } })),
    ).toBeUndefined(); // askUserDeadlineMs is .positive() — 0 makes no sense
    expect(
      budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { maxTurnsFixer: 1.5 } })),
    ).toBeUndefined(); // .int() rejects fractions
  });

  it('accepts maxUsd: 0 as the unlimited sentinel (ADR 0032 + BUDGET_DEFAULTS alignment)', () => {
    // Pre-13.5 the legacy schema required `.positive()`, rejecting 0. The 13.5
    // widen-to-budgetsSchema aligns with ADR 0032's `0 = unlimited` semantic
    // for maxUsd / maxSteps.
    expect(budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { maxUsd: 0 } }))).toEqual({
      maxUsd: 0,
    });
    expect(budgetDefaultsFromProjectMeta(baseMeta({ budgetDefaults: { maxSteps: 0 } }))).toEqual({
      maxSteps: 0,
    });
  });
});

describe('resolveDirectivePayloadBudgets (Phase 13.5 — per-axis merge for directive.payload.budgets)', () => {
  // Phase 13.5: per-project metadata.budgetDefaults flows into directive.payload.budgets
  // for the new four Phase 12 axes (askUserDeadlineMs, maxTurnsScaffolder|Builder|Fixer).
  // Body wins per-axis; absent axes fall through to project metadata; result is the
  // overrides-only partial that the daemon persists on the new directive's payload
  // (ADR 0032 §6 — overrides-only, not fully-resolved; brain fills defaults at
  // consumption via resolveBudgets()).

  it('returns undefined when both body and project are absent', () => {
    expect(resolveDirectivePayloadBudgets({})).toBeUndefined();
    expect(
      resolveDirectivePayloadBudgets({ explicitBody: undefined, projectDefaults: undefined }),
    ).toBeUndefined();
  });

  it('returns undefined when both body and project are empty objects', () => {
    expect(
      resolveDirectivePayloadBudgets({ explicitBody: {}, projectDefaults: {} }),
    ).toBeUndefined();
  });

  it('returns the body value when only body is set', () => {
    expect(resolveDirectivePayloadBudgets({ explicitBody: { maxTurnsScaffolder: 80 } })).toEqual({
      maxTurnsScaffolder: 80,
    });
  });

  it('falls back to projectDefaults when body unset (per-axis)', () => {
    expect(
      resolveDirectivePayloadBudgets({ projectDefaults: { maxTurnsScaffolder: 160 } }),
    ).toEqual({ maxTurnsScaffolder: 160 });
  });

  it('body overrides projectDefaults per-axis', () => {
    expect(
      resolveDirectivePayloadBudgets({
        explicitBody: { maxTurnsScaffolder: 80 },
        projectDefaults: { maxTurnsScaffolder: 160 },
      }),
    ).toEqual({ maxTurnsScaffolder: 80 });
  });

  it('merges different axes per-axis (body sets one, project sets another)', () => {
    expect(
      resolveDirectivePayloadBudgets({
        explicitBody: { maxTurnsScaffolder: 80 },
        projectDefaults: { maxTurnsBuilder: 160, askUserDeadlineMs: 600_000 },
      }),
    ).toEqual({
      maxTurnsScaffolder: 80,
      maxTurnsBuilder: 160,
      askUserDeadlineMs: 600_000,
    });
  });

  it('per-axis independence — one body field does not flush the others from project', () => {
    expect(
      resolveDirectivePayloadBudgets({
        explicitBody: { maxTurnsScaffolder: 80 },
        projectDefaults: {
          maxTurnsScaffolder: 160,
          maxTurnsBuilder: 160,
          maxTurnsFixer: 80,
        },
      }),
    ).toEqual({
      maxTurnsScaffolder: 80, // body wins
      maxTurnsBuilder: 160, // project tier
      maxTurnsFixer: 80, // project tier
    });
  });

  it('Phase 13.6 regression: maxUsdPerTask flows through from body', () => {
    expect(
      resolveDirectivePayloadBudgets({ explicitBody: { maxUsdPerTask: 2.5 } }),
    ).toEqual({ maxUsdPerTask: 2.5 });
  });

  it('Phase 14 regression: maxWikiReadinessAttempts flows through from body', () => {
    expect(
      resolveDirectivePayloadBudgets({ explicitBody: { maxWikiReadinessAttempts: 5 } }),
    ).toEqual({ maxWikiReadinessAttempts: 5 });
  });

  it('Phase 13.6 regression: maxUsdPerTask flows through from project defaults', () => {
    expect(
      resolveDirectivePayloadBudgets({ projectDefaults: { maxUsdPerTask: 0.75 } }),
    ).toEqual({ maxUsdPerTask: 0.75 });
  });
});

describe('resolveDirectiveLimits (Phase 13.3 — three-tier merge for I009)', () => {
  it('returns undefined when no tier supplies any field', () => {
    expect(resolveDirectiveLimits({})).toBeUndefined();
    expect(
      resolveDirectiveLimits({ explicitFlags: {}, projectDefaults: {}, configDefaults: {} }),
    ).toBeUndefined();
  });

  it('falls through to configDefaults when nothing else is set', () => {
    expect(resolveDirectiveLimits({ configDefaults: { maxUsd: 3 } })).toEqual({ maxUsd: 3 });
    expect(resolveDirectiveLimits({ configDefaults: { maxUsd: 3, maxSteps: 50 } })).toEqual({
      maxUsd: 3,
      maxSteps: 50,
    });
  });

  it('projectDefaults override configDefaults per field', () => {
    expect(
      resolveDirectiveLimits({
        projectDefaults: { maxUsd: 10 },
        configDefaults: { maxUsd: 3, maxSteps: 50 },
      }),
    ).toEqual({ maxUsd: 10, maxSteps: 50 });
  });

  it('explicitFlags override both lower tiers per field', () => {
    expect(
      resolveDirectiveLimits({
        explicitFlags: { maxUsd: 100 },
        projectDefaults: { maxUsd: 10, maxSteps: 200 },
        configDefaults: { maxUsd: 3, maxSteps: 50 },
      }),
    ).toEqual({ maxUsd: 100, maxSteps: 200 });
  });

  it('per-field independence — one explicit flag does not flush the others', () => {
    expect(
      resolveDirectiveLimits({
        explicitFlags: { maxSteps: 999 },
        projectDefaults: { maxUsd: 10 },
        configDefaults: { maxUsd: 3, maxSteps: 50 },
      }),
    ).toEqual({ maxUsd: 10, maxSteps: 999 });
  });

  it('omits absent fields rather than emitting undefined values (matches schema)', () => {
    const result = resolveDirectiveLimits({ projectDefaults: { maxSteps: 100 } });
    expect(result).toEqual({ maxSteps: 100 });
    expect(result).not.toHaveProperty('maxUsd');
  });
});

describe('updateProjectMetadata (ADR 0027 §1 write helper)', () => {
  let workRoot: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'factory5-pm-update-'));
  });

  afterEach(() => {
    try {
      rmSync(workRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  it('reads, mutates, writes — returns the mutated metadata', async () => {
    const projectPath = join(workRoot, 'with-id');
    mkdirSync(projectPath, { recursive: true });
    const original = await loadOrCreateProjectMetadata(projectPath, 'with-id');

    const updated = await updateProjectMetadata(projectPath, (meta) => ({
      ...meta,
      metadata: { ...meta.metadata, budgetDefaults: { maxUsd: 7.5, maxSteps: 200 } },
    }));

    expect(updated.id).toBe(original.id);
    expect(budgetDefaultsFromProjectMeta(updated)).toEqual({ maxUsd: 7.5, maxSteps: 200 });

    // Round-trip through readProjectMetadata.
    const reread = await readProjectMetadata(projectPath);
    expect(budgetDefaultsFromProjectMeta(reread!)).toEqual({ maxUsd: 7.5, maxSteps: 200 });
  });

  it('preserves unrelated metadata fields across the write', async () => {
    const projectPath = join(workRoot, 'mixed');
    mkdirSync(projectPath, { recursive: true });
    await loadOrCreateProjectMetadata(projectPath, 'mixed', {
      initialMetadata: { language: 'rust' },
    });

    const updated = await updateProjectMetadata(projectPath, (meta) => ({
      ...meta,
      metadata: { ...meta.metadata, budgetDefaults: { maxUsd: 1 } },
    }));

    expect(updated.metadata['language']).toBe('rust');
    expect(updated.metadata['budgetDefaults']).toEqual({ maxUsd: 1 });
  });

  it('throws ProjectMetadataNotFoundError when project.json is absent', async () => {
    const projectPath = join(workRoot, 'no-meta');
    mkdirSync(projectPath, { recursive: true });
    await expect(updateProjectMetadata(projectPath, (m) => m)).rejects.toBeInstanceOf(
      ProjectMetadataNotFoundError,
    );
  });

  it('throws ProjectMetadataCorruptError when project.json is unparseable', async () => {
    const projectPath = join(workRoot, 'corrupt-too');
    const factoryDir = join(projectPath, '.factory');
    mkdirSync(factoryDir, { recursive: true });
    writeFileSync(join(factoryDir, 'project.json'), '{ corrupt', 'utf8');
    await expect(updateProjectMetadata(projectPath, (m) => m)).rejects.toBeInstanceOf(
      ProjectMetadataCorruptError,
    );
  });
});
