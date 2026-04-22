/**
 * Tests for `dataDir()` + `discoverInstanceFromCwd()`.
 *
 * We don't mutate `process.env` or `process.cwd()` directly — instead,
 * {@link discoverInstanceFromCwd} takes a `startDir` argument we can
 * feed from a tmpdir, and the env-var path is exercised by mutating
 * `process.env` inside `vi.stubEnv` and restoring afterwards.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { INSTANCE_DIR_NAME, dataDir, discoverInstanceFromCwd, logsDir } from './paths.js';

// ---------------------------------------------------------------------------
// tmp instance helper
// ---------------------------------------------------------------------------

interface TmpInstance {
  rootDir: string; // the tree containing `.factory/`
  instanceDir: string; // <rootDir>/.factory/
  cleanup: () => void;
}

function makeTmpInstance(populated: boolean): TmpInstance {
  const rootDir = mkdtempSync(join(tmpdir(), 'factory5-paths-'));
  const instanceDir = join(rootDir, INSTANCE_DIR_NAME);
  mkdirSync(instanceDir, { recursive: true });
  if (populated) {
    writeFileSync(join(instanceDir, 'config.toml'), '# test fixture\n', 'utf8');
  }
  return {
    rootDir,
    instanceDir,
    cleanup: () => {
      try {
        rmSync(rootDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

// ---------------------------------------------------------------------------
// env-var isolation
// ---------------------------------------------------------------------------

const originalEnv: Record<string, string | undefined> = {};
const envKeysToIsolate = ['FACTORY5_DATA_DIR', 'FACTORY5_LOG_DIR'] as const;

beforeEach(() => {
  for (const key of envKeysToIsolate) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of envKeysToIsolate) {
    const prev = originalEnv[key];
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
});

// ---------------------------------------------------------------------------
// discoverInstanceFromCwd
// ---------------------------------------------------------------------------

describe('discoverInstanceFromCwd', () => {
  it('returns the instance dir when cwd has .factory/config.toml', () => {
    const tmp = makeTmpInstance(true);
    try {
      expect(discoverInstanceFromCwd(tmp.rootDir)).toBe(tmp.instanceDir);
    } finally {
      tmp.cleanup();
    }
  });

  it('walks up through parents to find an instance', () => {
    const tmp = makeTmpInstance(true);
    try {
      const deep = join(tmp.rootDir, 'packages', 'channels', 'src');
      mkdirSync(deep, { recursive: true });
      expect(discoverInstanceFromCwd(deep)).toBe(tmp.instanceDir);
    } finally {
      tmp.cleanup();
    }
  });

  it('ignores a .factory/ dir that lacks config.toml', () => {
    // This mirrors a per-project `.factory/project.json` directory (ADR
    // 0021): it's a `.factory/` dir, but it doesn't contain config.toml,
    // so it must not be mistaken for an instance root.
    const tmp = makeTmpInstance(false);
    try {
      writeFileSync(
        join(tmp.instanceDir, 'project.json'),
        '{"id":"01K00000000000000000000000"}',
        'utf8',
      );
      expect(discoverInstanceFromCwd(tmp.rootDir)).toBeUndefined();
    } finally {
      tmp.cleanup();
    }
  });

  it('returns undefined when no instance exists anywhere up the tree', () => {
    const isolated = mkdtempSync(join(tmpdir(), 'factory5-no-instance-'));
    try {
      // Make sure this tmp dir has no .factory/ in any parent either.
      // On typical CI/dev machines `tmpdir()` is unrelated to any
      // factory instance, so this assertion is safe.
      expect(discoverInstanceFromCwd(isolated)).toBeUndefined();
    } finally {
      rmSync(isolated, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// dataDir
// ---------------------------------------------------------------------------

describe('dataDir', () => {
  it('honours FACTORY5_DATA_DIR when set (wins over cwd-walk)', () => {
    const tmp = makeTmpInstance(true);
    try {
      const override = mkdtempSync(join(tmpdir(), 'factory5-override-'));
      process.env['FACTORY5_DATA_DIR'] = override;
      try {
        const cwdBefore = process.cwd();
        try {
          process.chdir(tmp.rootDir);
          expect(dataDir()).toBe(override);
        } finally {
          process.chdir(cwdBefore);
        }
      } finally {
        rmSync(override, { recursive: true, force: true });
      }
    } finally {
      tmp.cleanup();
    }
  });

  it('falls back to ~/.factory when no env var and no instance discoverable', () => {
    // We don't chdir — cwd in the test runner is the channels / logger
    // package root which is inside the factory5 repo. If there's already
    // a `.factory/config.toml` at the repo root (primary instance), the
    // cwd-walk would find it and this test would see THAT path. Detect
    // and skip in that case since we can't isolate from the real tree
    // without chdir-ing somewhere guaranteed-clean.
    const discovered = discoverInstanceFromCwd();
    if (discovered !== undefined) {
      // Running inside a tree that already has a populated instance.
      // dataDir() returns that discovered dir, not the homedir fallback.
      expect(dataDir()).toBe(discovered);
      return;
    }
    expect(dataDir()).toBe(join(homedir(), INSTANCE_DIR_NAME));
  });
});

// ---------------------------------------------------------------------------
// logsDir
// ---------------------------------------------------------------------------

describe('logsDir', () => {
  it('defaults to <dataDir>/logs', () => {
    const override = mkdtempSync(join(tmpdir(), 'factory5-logs-'));
    process.env['FACTORY5_DATA_DIR'] = override;
    try {
      expect(logsDir()).toBe(join(override, 'logs'));
    } finally {
      rmSync(override, { recursive: true, force: true });
    }
  });

  it('honours FACTORY5_LOG_DIR when set', () => {
    const logsOverride = mkdtempSync(join(tmpdir(), 'factory5-logs-override-'));
    process.env['FACTORY5_LOG_DIR'] = logsOverride;
    try {
      expect(logsDir()).toBe(logsOverride);
    } finally {
      rmSync(logsOverride, { recursive: true, force: true });
    }
  });
});
