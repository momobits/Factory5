import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_ASK_USER_DEADLINE_MS, loadConfig, writeConfig } from './config.js';

describe('@factory5/state config — loadConfig / writeConfig', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'factory5-config-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns defaults when the config file is absent', () => {
    expect(loadConfig(dataDir)).toEqual({
      askUserDeadlineMs: DEFAULT_ASK_USER_DEADLINE_MS,
    });
  });

  it('returns defaults when the config file is empty', () => {
    writeFileSync(join(dataDir, 'config.json'), '', 'utf8');
    expect(loadConfig(dataDir)).toEqual({
      askUserDeadlineMs: DEFAULT_ASK_USER_DEADLINE_MS,
    });
  });

  it('honours an explicit askUserDeadlineMs', () => {
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({ askUserDeadlineMs: 60_000 }),
      'utf8',
    );
    expect(loadConfig(dataDir).askUserDeadlineMs).toBe(60_000);
  });

  it('fills in defaults for missing keys when the file is partial', () => {
    // Empty object — file present, no askUserDeadlineMs key.
    writeFileSync(join(dataDir, 'config.json'), '{}', 'utf8');
    expect(loadConfig(dataDir).askUserDeadlineMs).toBe(DEFAULT_ASK_USER_DEADLINE_MS);
  });

  it('throws on invalid JSON', () => {
    writeFileSync(join(dataDir, 'config.json'), 'not json', 'utf8');
    expect(() => loadConfig(dataDir)).toThrow(/JSON/i);
  });

  it('throws on a schema mismatch (string instead of number)', () => {
    writeFileSync(
      join(dataDir, 'config.json'),
      JSON.stringify({ askUserDeadlineMs: '5m' }),
      'utf8',
    );
    expect(() => loadConfig(dataDir)).toThrow();
  });

  it('throws on negative deadlines (must be positive integer)', () => {
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ askUserDeadlineMs: -1 }), 'utf8');
    expect(() => loadConfig(dataDir)).toThrow();
  });

  it('writeConfig + loadConfig round-trip preserves values', () => {
    writeConfig({ askUserDeadlineMs: 120_000 }, dataDir);
    expect(loadConfig(dataDir).askUserDeadlineMs).toBe(120_000);
  });

  it('writeConfig merges with existing keys instead of replacing', () => {
    writeConfig({ askUserDeadlineMs: 60_000 }, dataDir);
    // Imagine a hypothetical second config key landing in the file
    // out of band — merging shouldn't drop it. Smuggle it in directly:
    const path = join(dataDir, 'config.json');
    writeFileSync(
      path,
      JSON.stringify({ askUserDeadlineMs: 60_000, futureKey: 'preserve me' }),
      'utf8',
    );
    writeConfig({ askUserDeadlineMs: 30_000 }, dataDir);
    // Re-read the raw file to confirm the unrelated key survived the
    // merge; loadConfig only surfaces the validated schema.
    const fileContent = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(fileContent['askUserDeadlineMs']).toBe(30_000);
    expect(fileContent['futureKey']).toBe('preserve me');
  });

  it('writeConfig creates the dataDir if missing', () => {
    const nested = join(dataDir, 'does', 'not', 'exist');
    writeConfig({ askUserDeadlineMs: 90_000 }, nested);
    expect(loadConfig(nested).askUserDeadlineMs).toBe(90_000);
  });

  it('writeConfig refuses to persist an invalid value', () => {
    expect(() =>
      writeConfig({ askUserDeadlineMs: -5 } as Parameters<typeof writeConfig>[0], dataDir),
    ).toThrow();
  });
});

// ----------------------------------------------------------------------------
// Per-agent category override layer (ADR 0004 amendment, Phase 14)
// ----------------------------------------------------------------------------

import { DEFAULT_AGENT_CATEGORIES, agentsConfigSchema, resolveAgentCategory } from './config.js';

describe('agentsConfigSchema', () => {
  it('accepts empty object', () => {
    expect(() => agentsConfigSchema.parse({})).not.toThrow();
  });

  it('accepts architect-only override', () => {
    const result = agentsConfigSchema.parse({ architect: 'planning' });
    expect(result?.architect).toBe('planning');
  });

  it('accepts architect + critic', () => {
    const result = agentsConfigSchema.parse({ architect: 'deep', critic: 'reasoning' });
    expect(result?.architect).toBe('deep');
    expect(result?.critic).toBe('reasoning');
  });

  it('rejects unknown agent role (strict mode)', () => {
    expect(() => agentsConfigSchema.parse({ triage: 'quick' })).toThrow();
  });

  it('rejects unknown category', () => {
    expect(() => agentsConfigSchema.parse({ architect: 'cheap' })).toThrow();
  });
});

describe('DEFAULT_AGENT_CATEGORIES', () => {
  it('architect defaults to planning (Sonnet)', () => {
    expect(DEFAULT_AGENT_CATEGORIES.architect).toBe('planning');
  });

  it('critic defaults to reasoning (Opus)', () => {
    expect(DEFAULT_AGENT_CATEGORIES.critic).toBe('reasoning');
  });
});

describe('resolveAgentCategory', () => {
  it('returns config value when present', () => {
    expect(resolveAgentCategory({ agents: { architect: 'deep' } }, 'architect')).toBe('deep');
  });

  it('returns default when config absent', () => {
    expect(resolveAgentCategory({}, 'architect')).toBe('planning');
    expect(resolveAgentCategory({}, 'critic')).toBe('reasoning');
  });

  it('returns default when role key absent in agents', () => {
    expect(resolveAgentCategory({ agents: { critic: 'deep' } }, 'architect')).toBe('planning');
  });
});
