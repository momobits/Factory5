/**
 * F001 regression — Phase 6c steps 6c.1 (red reproducer) → 6c.5 (green).
 *
 * The 2026-04-19 live run on directive `01KPKRNB2V08QZZD02SKTK6MWP`
 * (workspace `/c/Users/Momo/factory5-v5f-example-2`) produced a
 * verifier-raised CRITICAL finding claiming six Python source files
 * were absent. All six were present on main — the assessor's green
 * gate plus 78 passing tests confirmed it — yet F001 landed in
 * `findings.json` and showed up as an open CRITICAL in `factory
 * findings` output, misleading operators about build status.
 *
 * Step 6c.1 landed this file as a red reproducer: it mounts the
 * 2026-04-19 workspace state (src/*.py, tests/, pyproject.toml all on
 * disk), scripts the stub provider to emit the exact F001 hallucination,
 * and shows the finding lands with source=verifier + target=src/ +
 * description claiming absence. That much is unchanged — the underlying
 * defect (an LLM can still hallucinate through the FINDING marker) is
 * not fixable without either worktree+evidence-citations (rejected in
 * ADR 0018) or a post-parse filesystem guard (also rejected — same
 * reason).
 *
 * Step 6c.3 + 6c.5 close the defect at the gate boundary instead:
 * the persisted finding now carries `advisory: true` per ADR 0018, so
 * the hallucinated CRITICAL cannot contribute to `gate.verify` and
 * cannot block the build. This test asserts that invariant. A second
 * case asserts the verifier-specific default: a reviewer raising the
 * same-shape finding does NOT get marked advisory — the flag is the
 * verifier's, not a universal cap.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newId, taskSchema, type AgentRole, type Task } from '@factory5/core';
import { ProviderRegistry, StubProvider } from '@factory5/providers';
import { isAdvisory, listFindings } from '@factory5/wiki';
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

function mkTask(agent: AgentRole, title: string): Task {
  const task: Task = {
    id: newId(),
    planId: newId(),
    title,
    agent,
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

describe('F001 regression — verifier hallucination is advisory, not blocking', () => {
  it('persists the hallucinated CRITICAL but marks it advisory so the gate is unaffected (ADR 0018)', async () => {
    const task = mkTask('verifier', 'verify example-cli-app');
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

    // The ADR 0018 invariant: the hallucinated finding is marked advisory
    // and therefore cannot contribute to gate.verify. Severity is NOT
    // capped — the LLM's CRITICAL claim is preserved as operator signal,
    // but the advisory flag is the gate guardrail.
    expect(f?.advisory).toBe(true);
    if (f !== undefined) expect(isAdvisory(f)).toBe(true);
  });

  it('does NOT mark the same-shape finding advisory when raised by a non-verifier source', async () => {
    const task = mkTask('reviewer', 'review example-cli-app');
    const registry = mkStubRegistry(F001_HALLUCINATED_RESPONSE);

    const outcome = await runWorker({
      task,
      projectPath,
      registry,
      systemPrompt: 'You are the reviewer. Inspect the code and report findings.',
      userPrompt: 'Review the example-cli-app project.',
    });

    expect(outcome.result.exitCode).toBe(0);
    const findings = await listFindings(projectPath);
    expect(findings).toHaveLength(1);

    const f = findings[0];
    expect(f?.source).toBe('reviewer');
    expect(f?.severity).toBe('CRITICAL');
    expect(f?.advisory).toBeUndefined();
    if (f !== undefined) expect(isAdvisory(f)).toBe(false);
  });
});
