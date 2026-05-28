import { mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initLogger } from '@factory5/logger';

import { validateKnowledgeGraph } from './validator.js';

beforeAll(() => {
  initLogger({ processName: 'coherence-validator-test', noFile: true, noConsole: true });
});

describe('validateKnowledgeGraph', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-validator-test-'));
    await mkdir(join(projectPath, 'docs', 'knowledge', 'features'), { recursive: true });
    await mkdir(join(projectPath, 'docs', 'knowledge', 'decisions'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns ok=true and empty findings for a valid graph', async () => {
    await writeFile(
      join(projectPath, 'README.md'),
      '# Project\n\n## CLI Reference\n\nThe CLI.\n',
    );
    await writeFile(
      join(projectPath, 'docs', 'knowledge', 'features', 'cli.md'),
      `---
kind: feature
id: cli
status: documented
documented_in:
  - README.md#cli-reference
---

# Feature: CLI
`,
    );
    const result = await validateKnowledgeGraph({ projectPath, taskIds: [] });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('returns ok=false and findings for an invalid graph', async () => {
    await writeFile(
      join(projectPath, 'docs', 'knowledge', 'features', 'cli.md'),
      `---
kind: feature
id: cli
status: documented
documented_in:
  - README.md#nonexistent
---

Body
`,
    );
    // Note: README.md does not exist
    const result = await validateKnowledgeGraph({ projectPath, taskIds: [] });
    expect(result.ok).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('handles a project with no knowledge area gracefully (relaxed mode)', async () => {
    // No docs/knowledge directory at all
    await rm(join(projectPath, 'docs'), { recursive: true, force: true });
    const result = await validateKnowledgeGraph({ projectPath, taskIds: [] });
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.skippedReason).toBe('no-knowledge-area');
  });

  it('validates a decision file with all required sections', async () => {
    await writeFile(
      join(projectPath, 'docs', 'knowledge', 'decisions', '2026-05-28-test.md'),
      `---
kind: decision
id: 2026-05-28-test
date: 2026-05-28
made_by_task: 01HZZZZZZZZZZZZZZZZZZZZZZZ
modifies:
  - some-feature
---

# Decision: Test

## Context
Why we needed this.

## Decision
What we chose.

## Consequences
What happens next.
`,
    );
    const result = await validateKnowledgeGraph({ projectPath, taskIds: [] });
    expect(result.ok).toBe(true);
  });
});
