/**
 * F001 regression reproducer — Phase 6c step 6c.1.
 *
 * Captures the verifier hallucination observed on directive
 * `01KPKRNB2V08QZZD02SKTK6MWP` (I007 live run, 2026-04-19, workspace
 * `/c/Users/Momo/factory5-v5f-example-2`). The verifier raised a
 * CRITICAL finding claiming six Python source files were absent. All
 * six files were in fact present on main — the assessor's green gate
 * and 78 passing tests confirmed that — yet F001 still landed in
 * `findings.json` because nothing between the LLM's text response and
 * the persisted record verifies the claim against the filesystem.
 *
 * This reproducer mounts a workspace matching the 2026-04-19 state
 * (`src/models.py`, `src/api.py`, `src/formatter.py`, `src/cli.py`,
 * `tests/test_*.py`, `pyproject.toml` all present on disk), scripts the
 * stub provider to return the exact F001-style hallucination, invokes
 * `runWorker` on a verifier task, and asserts that the false CRITICAL
 * still persists — proving the defect is faithfully reproduced before
 * the fix (6c.3) lands.
 *
 * After 6c.3 + 6c.5, this file's assertions flip: the verifier must
 * either refuse to raise the absence claim, have it downgraded to
 * advisory, or otherwise not contribute the false CRITICAL to the
 * gate. See `.control/phases/phase-6c-verifier-overhaul/steps.md`.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newId, taskSchema, type Task } from '@factory5/core';
import { ProviderRegistry, StubProvider } from '@factory5/providers';
import { listFindings } from '@factory5/wiki';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runWorker } from './run-worker.js';

/**
 * The verifier's scripted output. Reproduces the shape of F001 from the
 * 2026-04-19 live run — a `FINDING [CRITICAL] src/: ...` header with a
 * multi-line description claiming absence of files that actually exist.
 */
const F001_HALLUCINATED_RESPONSE = [
  'FINDING [CRITICAL] src/: Python project `example-cli-app` source files are absent — src/models.py, src/api.py, src/formatter.py, src/cli.py, tests/, and pyproject.toml all missing. The project must be scaffolded (by the scaffolder agent) before the assessor/verifier can run pytest --cov=src --cov-fail-under=80.',
  'Specific blockers:',
  '1. No src/ package — pytest has nothing to collect',
  '2. No tests/ directory — no test suite exists',
  '3. No pyproject.toml — no pytest config, no dependency list, no package definition',
  '4. No requirements.txt / virtual environment — httpx, rich, click not installed',
].join('\n');

async function scaffoldRealWorkspace(root: string): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'tests'), { recursive: true });
  await writeFile(join(root, 'src', 'models.py'), '# models\n', 'utf8');
  await writeFile(join(root, 'src', 'api.py'), '# api\n', 'utf8');
  await writeFile(join(root, 'src', 'formatter.py'), '# formatter\n', 'utf8');
  await writeFile(join(root, 'src', 'cli.py'), '# cli\n', 'utf8');
  await writeFile(join(root, 'tests', 'test_models.py'), '# tests\n', 'utf8');
  await writeFile(
    join(root, 'pyproject.toml'),
    '[project]\nname = "example-cli-app"\nversion = "0.1.0"\n',
    'utf8',
  );
}

function mkVerifierTask(): Task {
  const task: Task = {
    id: newId(),
    planId: newId(),
    title: 'verify example-cli-app',
    agent: 'verifier',
    category: 'planning',
    inputs: { files: [], context: '' },
    expectedOutputs: { files: [], signals: [] },
    dependsOn: [],
    status: 'pending',
    attempts: 0,
  };
  return taskSchema.parse(task);
}

function mkStubRegistry(scriptedText: string): ProviderRegistry {
  const stub = new StubProvider({ defaultText: scriptedText });
  const entry = [{ provider: 'stub', model: 'stub' }];
  return new ProviderRegistry({
    providers: { stub },
    fallbackChains: {
      quick: entry,
      planning: entry,
      reasoning: entry,
      deep: entry,
      documentation: entry,
    },
  });
}

let projectPath: string;

beforeEach(async () => {
  projectPath = await mkdtemp(join(tmpdir(), 'factory5-f001-'));
  await scaffoldRealWorkspace(projectPath);
});

afterEach(async () => {
  await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
});

describe('F001 regression — verifier hallucinates file absence (red reproducer)', () => {
  it('persists a verifier-sourced CRITICAL absence finding even though src/, tests/, and pyproject.toml are on disk', async () => {
    const task = mkVerifierTask();
    const registry = mkStubRegistry(F001_HALLUCINATED_RESPONSE);

    const outcome = await runWorker({
      task,
      projectPath,
      registry,
      systemPrompt:
        'You are the verifier. Run the full verification checklist and report findings.',
      userPrompt: 'Verify the example-cli-app project.',
    });

    expect(outcome.result.exitCode).toBe(0);
    expect(outcome.result.findingsRaised).toHaveLength(1);

    const findings = await listFindings(projectPath);
    expect(findings).toHaveLength(1);

    const f = findings[0];
    expect(f).toBeDefined();
    expect(f?.id).toBe('F001');
    expect(f?.source).toBe('verifier');
    expect(f?.severity).toBe('CRITICAL');
    expect(f?.target).toBe('src/');
    expect(f?.status).toBe('OPEN');
    expect(f?.description).toMatch(/absent/i);
    expect(f?.description).toMatch(/src\/models\.py/);
    expect(f?.description).toMatch(/pyproject\.toml/);
  });
});
