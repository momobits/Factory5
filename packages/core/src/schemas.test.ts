import { describe, expect, it } from 'vitest';

import {
  directiveSchema,
  eventSchema,
  findingSchema,
  planSchema,
  projectBudgetDefaultsSchema,
  projectMetadataSchema,
  taskResultSchema,
  taskSchema,
  wikiCritiqueSchema,
} from './schemas.js';
import { findingId, newId } from './ulid.js';

describe('newId', () => {
  it('produces 26-char ULIDs', () => {
    const id = newId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('produces lexicographically sorted IDs', async () => {
    const a = newId();
    await new Promise((r) => setTimeout(r, 2));
    const b = newId();
    expect(a < b).toBe(true);
  });
});

describe('findingId', () => {
  it('zero-pads to three digits', () => {
    expect(findingId(1)).toBe('F001');
    expect(findingId(42)).toBe('F042');
    expect(findingId(999)).toBe('F999');
  });

  it('expands beyond F999 without truncation', () => {
    expect(findingId(1234)).toBe('F1234');
  });

  it('throws on invalid input', () => {
    expect(() => findingId(0)).toThrow();
    expect(() => findingId(-1)).toThrow();
    expect(() => findingId(1.5)).toThrow();
  });
});

describe('directiveSchema', () => {
  it('round-trips a minimal directive', () => {
    const d = {
      id: newId(),
      source: 'cli' as const,
      principal: 'local-user',
      channelRef: 'session-123',
      intent: 'build' as const,
      payload: { project: 'demo' },
      autonomy: 'assisted' as const,
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
    };
    const parsed = directiveSchema.parse(d);
    expect(parsed.id).toBe(d.id);
    expect(parsed.intent).toBe('build');
  });

  it('rejects unknown source', () => {
    const bad = {
      id: newId(),
      source: 'made-up',
      principal: 'x',
      channelRef: 'x',
      intent: 'build',
      payload: null,
      autonomy: 'assisted',
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    expect(() => directiveSchema.parse(bad)).toThrow();
  });
});

describe('eventSchema', () => {
  it('parses a fs.changed event', () => {
    const e = {
      id: newId(),
      source: 'fs',
      body: {
        kind: 'fs.changed' as const,
        path: '/workspace/demo/src/api.py',
        type: 'modify' as const,
      },
      metadata: {},
      receivedAt: new Date().toISOString(),
    };
    const parsed = eventSchema.parse(e);
    expect(parsed.body.kind).toBe('fs.changed');
  });

  it('parses a channel message event', () => {
    const e = {
      id: newId(),
      source: 'channel',
      body: {
        kind: 'channel.message' as const,
        channel: 'discord' as const,
        principal: 'user-1',
        ref: 'channel-1',
        text: 'hello',
      },
      metadata: {},
      receivedAt: new Date().toISOString(),
    };
    const parsed = eventSchema.parse(e);
    if (parsed.body.kind !== 'channel.message') throw new Error('discriminator failed');
    expect(parsed.body.text).toBe('hello');
  });
});

describe('findingSchema', () => {
  it('accepts F001 format', () => {
    const f = {
      id: 'F001',
      source: 'reviewer' as const,
      target: 'src/api.py',
      severity: 'HIGH' as const,
      status: 'OPEN' as const,
      description: 'No timeout on HTTP calls',
      createdAt: new Date().toISOString(),
    };
    expect(findingSchema.parse(f).id).toBe('F001');
  });

  it('rejects invalid finding ID format', () => {
    const bad = {
      id: '1',
      source: 'reviewer',
      target: 'x',
      severity: 'HIGH',
      status: 'OPEN',
      description: 'x',
      createdAt: new Date().toISOString(),
    };
    expect(() => findingSchema.parse(bad)).toThrow();
  });

  it('accepts advisory:true (ADR 0018)', () => {
    const f = {
      id: 'F001',
      source: 'verifier' as const,
      target: 'src/',
      severity: 'CRITICAL' as const,
      status: 'OPEN' as const,
      description: 'second-opinion observation',
      createdAt: new Date().toISOString(),
      advisory: true,
    };
    const parsed = findingSchema.parse(f);
    expect(parsed.advisory).toBe(true);
  });

  it('accepts a finding with no advisory field (backwards-compat)', () => {
    const f = {
      id: 'F002',
      source: 'reviewer' as const,
      target: 'src/api.py',
      severity: 'HIGH' as const,
      status: 'OPEN' as const,
      description: 'no timeout',
      createdAt: new Date().toISOString(),
    };
    const parsed = findingSchema.parse(f);
    expect(parsed.advisory).toBeUndefined();
  });
});

describe('wikiCritiqueSchema', () => {
  it('parses a valid passing critique with empty findings', () => {
    const result = wikiCritiqueSchema.parse({
      passes: true,
      severity: 'pass',
      findings: [],
      summary: 'Wiki satisfies the directive',
    });
    expect(result.passes).toBe(true);
    expect(result.severity).toBe('pass');
  });

  it('parses a valid failing critique with findings', () => {
    const result = wikiCritiqueSchema.parse({
      passes: false,
      severity: 'major',
      findings: [
        {
          aspect: 'modules',
          gap: 'no module relationships',
          suggestion: 'add a section listing module imports',
        },
      ],
      summary: 'Wiki missing module-relationship documentation',
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].aspect).toBe('modules');
  });

  it('rejects an unknown severity', () => {
    expect(() =>
      wikiCritiqueSchema.parse({
        passes: false,
        severity: 'catastrophic',
        findings: [],
        summary: 'x',
      }),
    ).toThrow();
  });

  it('rejects an unknown aspect', () => {
    expect(() =>
      wikiCritiqueSchema.parse({
        passes: false,
        severity: 'minor',
        findings: [{ aspect: 'database', gap: 'x', suggestion: 'y' }],
        summary: 'x',
      }),
    ).toThrow();
  });

  it('rejects missing summary', () => {
    expect(() =>
      wikiCritiqueSchema.parse({
        passes: true,
        severity: 'pass',
        findings: [],
      }),
    ).toThrow();
  });

  it('rejects empty gap string', () => {
    expect(() =>
      wikiCritiqueSchema.parse({
        passes: false,
        severity: 'minor',
        findings: [{ aspect: 'modules', gap: '', suggestion: 'add a section' }],
        summary: 'x',
      }),
    ).toThrow();
  });

  it('rejects empty suggestion string', () => {
    expect(() =>
      wikiCritiqueSchema.parse({
        passes: false,
        severity: 'minor',
        findings: [{ aspect: 'modules', gap: 'something missing', suggestion: '' }],
        summary: 'x',
      }),
    ).toThrow();
  });
});

describe('plan and task schemas', () => {
  it('parses a plan with one task', () => {
    const planId = newId();
    const taskA: unknown = {
      id: newId(),
      planId,
      title: 'Build module A',
      agent: 'builder',
      category: 'deep',
      inputs: { files: [], context: 'spec' },
      expectedOutputs: { files: ['src/a.ts'], signals: [] },
      dependsOn: [],
      status: 'pending',
      attempts: 0,
    };
    const parsedTask = taskSchema.parse(taskA);
    const plan: unknown = {
      id: planId,
      directiveId: newId(),
      projectPath: '/tmp/demo',
      tasks: [parsedTask],
      createdAt: new Date().toISOString(),
      status: 'draft',
    };
    const parsed = planSchema.parse(plan);
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0]?.title).toBe('Build module A');
  });
});

describe('taskResultSchema — Tier 15 turnsUsed', () => {
  it('accepts a result with turnsUsed', () => {
    const parsed = taskResultSchema.parse({
      exitCode: 0,
      filesChanged: ['src/a.ts'],
      findingsRaised: [],
      signalsEmitted: [],
      durationMs: 1234,
      turnsUsed: 17,
    });
    expect(parsed.turnsUsed).toBe(17);
  });

  it('accepts a result without turnsUsed (optional, pre-Tier-15 / read-only path)', () => {
    const parsed = taskResultSchema.parse({
      exitCode: 0,
      filesChanged: [],
      findingsRaised: [],
      signalsEmitted: [],
      durationMs: 0,
    });
    expect(parsed.turnsUsed).toBeUndefined();
  });

  it('accepts turnsUsed: 0', () => {
    const parsed = taskResultSchema.parse({
      exitCode: 0,
      filesChanged: [],
      findingsRaised: [],
      signalsEmitted: [],
      durationMs: 0,
      turnsUsed: 0,
    });
    expect(parsed.turnsUsed).toBe(0);
  });

  it('rejects negative turnsUsed', () => {
    const result = taskResultSchema.safeParse({
      exitCode: 0,
      filesChanged: [],
      findingsRaised: [],
      signalsEmitted: [],
      durationMs: 0,
      turnsUsed: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer turnsUsed', () => {
    const result = taskResultSchema.safeParse({
      exitCode: 0,
      filesChanged: [],
      findingsRaised: [],
      signalsEmitted: [],
      durationMs: 0,
      turnsUsed: 3.14,
    });
    expect(result.success).toBe(false);
  });
});

describe('projectMetadataSchema — Tier 15 scalars', () => {
  it('accepts autoIncreaseBudgets: true', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3AAAAAAAAAAAAAAAAAA',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: {
        autoIncreaseBudgets: true,
        autoIncreaseCeilingMultiplier: 5,
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts autoIncreaseCeilingMultiplier: 1 (minimum)', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3AAAAAAAAAAAAAAAAAA',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: { autoIncreaseCeilingMultiplier: 1 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects autoIncreaseCeilingMultiplier: 0', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3AAAAAAAAAAAAAAAAAA',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: { autoIncreaseCeilingMultiplier: 0 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['metadata', 'autoIncreaseCeilingMultiplier']);
    }
  });

  it('rejects negative autoIncreaseCeilingMultiplier', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3AAAAAAAAAAAAAAAAAA',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: { autoIncreaseCeilingMultiplier: -1 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['metadata', 'autoIncreaseCeilingMultiplier']);
    }
  });

  it('treats both fields as optional', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3AAAAAAAAAAAAAAAAAA',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: {},
    });
    expect(result.success).toBe(true);
  });

  it('accepts a file with no metadata block (backward compat with old project.json)', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3AAAAAAAAAAAAAAAAAA',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
    });
    expect(result.success).toBe(true);
  });

  it('accepts autoIncreaseBudgets: false', () => {
    const result = projectMetadataSchema.safeParse({
      id: '01KSB8C3AAAAAAAAAAAAAAAAAA',
      name: 'pythonetl',
      createdAt: '2026-05-23T20:28:06.332Z',
      factoryVersion: '0.x',
      metadata: { autoIncreaseBudgets: false },
    });
    expect(result.success).toBe(true);
  });
});

describe('projectBudgetDefaultsSchema — taskStreamTimeoutMs', () => {
  it('projectMetadata accepts taskStreamTimeoutMs', () => {
    const parsed = projectBudgetDefaultsSchema.parse({
      maxUsd: 100,
      taskStreamTimeoutMs: 3600000,
    });
    expect(parsed.taskStreamTimeoutMs).toBe(3600000);
  });

  it('projectMetadata taskStreamTimeoutMs is optional', () => {
    const parsed = projectBudgetDefaultsSchema.parse({ maxUsd: 100 });
    expect(parsed.taskStreamTimeoutMs).toBeUndefined();
  });
});

describe('projectBudgetDefaultsSchema — transcriptLevel', () => {
  it('accepts transcriptLevel', () => {
    const parsed = projectBudgetDefaultsSchema.parse({
      maxUsd: 100,
      transcriptLevel: 'tools',
    });
    expect(parsed.transcriptLevel).toBe('tools');
  });

  it('rejects invalid values', () => {
    expect(() =>
      projectBudgetDefaultsSchema.parse({ transcriptLevel: 'verbose' }),
    ).toThrow();
  });

  it('defaults to undefined (full is applied at runtime)', () => {
    const parsed = projectBudgetDefaultsSchema.parse({ maxUsd: 100 });
    expect(parsed.transcriptLevel).toBeUndefined();
  });
});
