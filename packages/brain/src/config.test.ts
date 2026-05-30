import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configExists, configPath, defaultConfig, loadConfig, saveConfig } from './config.js';

// Each test redirects the data dir via FACTORY5_DATA_DIR so we don't touch
// the user's real ~/.factory during the workspace test run.

let tmp: string;
let originalDataDir: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'factory5-config-'));
  originalDataDir = process.env['FACTORY5_DATA_DIR'];
  process.env['FACTORY5_DATA_DIR'] = tmp;
});

afterEach(async () => {
  if (originalDataDir === undefined) {
    delete process.env['FACTORY5_DATA_DIR'];
  } else {
    process.env['FACTORY5_DATA_DIR'] = originalDataDir;
  }
  await rm(tmp, { recursive: true, force: true });
});

describe('configPath', () => {
  it('lives under FACTORY5_DATA_DIR when overridden', () => {
    expect(configPath().startsWith(tmp)).toBe(true);
    expect(configPath().endsWith('config.toml')).toBe(true);
  });
});

describe('loadConfig / saveConfig', () => {
  it('returns undefined when no config file exists', async () => {
    expect(await configExists()).toBe(false);
    expect(await loadConfig()).toBeUndefined();
  });

  it('round-trips a default config', async () => {
    const cfg = defaultConfig();
    await saveConfig(cfg);
    expect(await configExists()).toBe(true);
    const loaded = await loadConfig();
    expect(loaded?.general.autonomy).toBe('assisted');
    expect(loaded?.categories['quick']).toEqual({
      provider: 'claude-cli',
      model: 'claude-haiku-4-5',
    });
  });

  it('round-trips an override on a specific category', async () => {
    const cfg = defaultConfig();
    cfg.categories['reasoning'] = { provider: 'anthropic-api', model: 'claude-opus-4-7' };
    await saveConfig(cfg);
    const loaded = await loadConfig();
    expect(loaded?.categories['reasoning']?.provider).toBe('anthropic-api');
  });

  it('preserves providers.claudeCliPath when set', async () => {
    const cfg = defaultConfig();
    cfg.providers.claudeCliPath = 'C:\\custom\\claude.cmd';
    await saveConfig(cfg);
    const loaded = await loadConfig();
    expect(loaded?.providers.claudeCliPath).toBe('C:\\custom\\claude.cmd');
  });

  it('defaults budget.defaults to empty (unlimited) when unspecified', async () => {
    const cfg = defaultConfig();
    expect(cfg.budget.defaults.maxUsd).toBeUndefined();
    expect(cfg.budget.defaults.maxSteps).toBeUndefined();
  });

  it('round-trips budget.defaults.maxUsd and maxSteps when set (ADR 0020)', async () => {
    const cfg = defaultConfig();
    cfg.budget.defaults.maxUsd = 5.0;
    cfg.budget.defaults.maxSteps = 50;
    await saveConfig(cfg);
    const loaded = await loadConfig();
    expect(loaded?.budget.defaults.maxUsd).toBeCloseTo(5.0);
    expect(loaded?.budget.defaults.maxSteps).toBe(50);
  });

  it('throws a helpful error on malformed TOML', async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    const path = configPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, 'this is = not [valid toml', 'utf8');
    await expect(loadConfig()).rejects.toThrow(/could not parse|failed schema/i);
  });
});
