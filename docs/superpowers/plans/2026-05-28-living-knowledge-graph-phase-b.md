# Living Knowledge Graph — Phase B: Deeper Checks + Coherence Reviewer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisites:** Phase A is complete (`docs/superpowers/plans/2026-05-28-living-knowledge-graph-phase-a.md`). Specifically: `@factory5/coherence-validator` exists with `validateKnowledgeGraph`, `findingSchema` has structured fields, and the worker invokes the validator post-task.

**Goal:** Add the deeper validation layers — programmatic doc-fiction (engine + JSON config), dead-code scan, the new `coherence-reviewer` agent — plus brain integration (post-merge + final-verification) and backward-compat migration for existing projects.

**Architecture:** Phase B extends the Phase A validator with checks that need the integrated codebase, not just per-task changes. The doc-fiction check is built as a runtime-agnostic engine consuming a declarative JSON config (v1 ships `python.json`). The coherence-reviewer is a new read-only agent that does semantic doc/code comparison. The brain runs validation at post-merge (after each task) and final-verification (before directive complete); the existing brain task pipeline gains a backward-compat migration task for projects that lack the graph.

**Tech Stack:** TypeScript, Zod, vitest, gray-matter, Python AST (for dead-code), better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-05-28-living-knowledge-graph-design.md`

---

## Section 1: Brain integration (post-merge + final-verification)

### Task 1: Post-merge validator in pool dispatcher

**Files:**
- Modify: `packages/brain/src/pool.ts:791-870` (after worker invocation, before next task dispatch)
- Modify: `packages/brain/package.json` (add @factory5/coherence-validator dep)
- Test: `packages/brain/src/pool.test.ts`

**Spec reference:** Component 3 → "Where the validator runs — Post-merge"

- [ ] **Step 1: Add coherence-validator dependency**

In `packages/brain/package.json` `dependencies`:
```json
"@factory5/coherence-validator": "workspace:*",
```
Run: `pnpm install 2>&1 | tail -3`

- [ ] **Step 2: Locate the post-worker section**

Run: `sed -n '785,825p' packages/brain/src/pool.ts`
Identify the section after `runWorker()` returns and before the function returns its result.

- [ ] **Step 3: Add post-merge validator call**

In `packages/brain/src/pool.ts`, after `runWorker` completes successfully and the worktree has merged to main (i.e., after the worker's `cleanupWorktree` ran with `outcome: 'success'`), but before `executeTask` returns:

```typescript
// Tier 15.13 — post-merge knowledge graph validation. Runs against the
// project root (post-merge state) to catch cross-task issues that only
// become detectable after integration. Findings go into the directive's
// findings store; the next task or final-verification will see them.
import { validateKnowledgeGraph } from '@factory5/coherence-validator';
import * as tasksInflight from '@factory5/state/queries/tasks-inflight';
import { addFinding } from '@factory5/wiki';

// After: const outcome = await runWorker(...); and after the worker has merged
if (outcome.result.exitCode === 0) {
  const taskIds = tasksInflight
    .listByDirective(db, directiveId)
    .map((t) => t.id);
  const validation = await validateKnowledgeGraph({
    projectPath,
    taskIds,
  });
  if (!validation.ok) {
    log.warn(
      { directiveId, taskId: task.id, findingCount: validation.findings.length },
      'pool: post-merge validation surfaced findings',
    );
    for (const pf of validation.findings) {
      await addFinding(projectPath, {
        source: task.agent,
        target: pf.location.file,
        severity: pf.severity === 'high' ? 'HIGH' : pf.severity === 'medium' ? 'MEDIUM' : 'LOW',
        description: pf.title,
        category: pf.category,
        location: pf.location,
        title: pf.title,
        why: pf.why,
        suggested_fix: pf.suggested_fix,
        auto_fixable: pf.auto_fixable,
      });
    }
  }
}
```

- [ ] **Step 4: Build + test**

Run: `pnpm build && pnpm --filter @factory5/brain test 2>&1 | tail -10`
Expected: build success; existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/pool.ts packages/brain/package.json
git commit -m "feat(15.13): brain runs coherence validator post-merge per task"
```

---

### Task 2: Final-verification validator in loop

**Files:**
- Modify: `packages/brain/src/loop.ts:560` (before terminal-status update)
- Test: `packages/brain/src/loop.test.ts`

**Spec reference:** Component 3 → "Where the validator runs — Final verification"

- [ ] **Step 1: Read the terminal section of executeDirective**

Run: `sed -n '550,580p' packages/brain/src/loop.ts`
Confirm the structure: `taskResults` returned, `hadFailures` computed, then `terminalStatus` set.

- [ ] **Step 2: Add final-verification validator call**

In `packages/brain/src/loop.ts`, after `runPlanTasks` returns but BEFORE `terminalStatus` is computed:

```typescript
// Tier 15.13 — final knowledge graph validation. Runs against the
// fully-integrated project at directive end. This is the gate that
// catches doc-fiction + dead-code + reference integrity issues that
// only become detectable once all task merges are in main.
if (!hadFailures) {
  const taskIds = taskResults.map((r) => r.task.id);
  const finalValidation = await validateKnowledgeGraph({
    projectPath: directive.projectPath,
    taskIds,
  });
  if (!finalValidation.ok) {
    log.info(
      { directiveId: directive.id, findingCount: finalValidation.findings.length },
      'loop: final-verification surfaced findings',
    );
    // Persist findings (same shape as post-merge); directive transitions
    // to 'blocked' so the operator (or Phase C self-healing loop) sees them.
    for (const pf of finalValidation.findings) {
      await addFinding(directive.projectPath, {
        source: 'verifier',
        target: pf.location.file,
        severity: pf.severity === 'high' ? 'HIGH' : pf.severity === 'medium' ? 'MEDIUM' : 'LOW',
        description: pf.title,
        category: pf.category,
        location: pf.location,
        title: pf.title,
        why: pf.why,
        suggested_fix: pf.suggested_fix,
        auto_fixable: pf.auto_fixable,
      });
    }
    hadFailures = true;
  }
}

const terminalStatus: Directive['status'] = hadFailures ? 'blocked' : 'complete';
```

- [ ] **Step 3: Build + test**

Run: `pnpm build && pnpm --filter @factory5/brain test 2>&1 | tail -10`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/loop.ts
git commit -m "feat(15.13): brain runs final-verification validator before directive complete"
```

---

## Section 2: Doc-fiction engine + Python JSON config

### Task 3: Define the validator config schema

**Files:**
- Create: `packages/coherence-validator/src/config-schema.ts`
- Create: `packages/coherence-validator/src/config-schema.test.ts`

**Spec reference:** Component 3 → "Programmatic checks: engine + config architecture"

- [ ] **Step 1: Write failing tests**

```typescript
// packages/coherence-validator/src/config-schema.test.ts
import { describe, expect, it } from 'vitest';
import { validatorConfigSchema } from './config-schema.js';

describe('validatorConfigSchema', () => {
  it('accepts the minimal Python config shape', () => {
    const config = {
      runtime: 'python',
      interpreter: '.factory/assessor-env/Scripts/python.exe',
      doc_globs: ['README.md'],
      doc_fiction: {
        section_headings: 'Quick Start|Configuration|Example|Usage|Reference',
        code_block_runners: {
          python: {
            command: ['<interpreter>', '-c', '<CODE>'],
            timeout_ms: 30000,
          },
        },
      },
      dead_code: {
        package_globs: ['etl/**/*.py'],
        public_symbol_rule: 'no_underscore_prefix',
        exposed_via: [
          { kind: 'entry_points', source: 'pyproject.toml::project.scripts' },
        ],
        caller_scan: {
          method: 'ast_imports_and_calls',
          exclude_globs: ['tests/**'],
        },
      },
    };
    expect(() => validatorConfigSchema.parse(config)).not.toThrow();
  });

  it('rejects config missing runtime field', () => {
    expect(() => validatorConfigSchema.parse({ interpreter: 'x' })).toThrow();
  });

  it('accepts config with only doc_fiction (dead_code omitted)', () => {
    const config = {
      runtime: 'python',
      interpreter: 'python',
      doc_globs: ['README.md'],
      doc_fiction: {
        section_headings: 'Example',
        code_block_runners: {},
      },
    };
    expect(() => validatorConfigSchema.parse(config)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

Run: `pnpm --filter @factory5/coherence-validator test -- --reporter=verbose -t "validatorConfigSchema"`
Expected: FAIL — schema doesn't exist.

- [ ] **Step 3: Implement config-schema.ts**

```typescript
// packages/coherence-validator/src/config-schema.ts
import { z } from 'zod';

const codeBlockRunnerSchema = z.object({
  command: z.array(z.string().min(1)).min(1),
  timeout_ms: z.number().int().positive().optional(),
  wrapper_template: z.string().optional(),
  binary_lookup: z.string().optional(),
  failure_pattern: z.string().optional(),
});

const docFictionSchema = z.object({
  section_headings: z.string().min(1),
  code_block_runners: z.record(z.string(), codeBlockRunnerSchema),
});

const exposureSourceSchema = z.object({
  kind: z.enum(['entry_points', 'explicit_export', 'feature_surface']),
  source: z.string().min(1),
});

const callerScanSchema = z.object({
  method: z.enum(['ast_imports_and_calls']),
  exclude_globs: z.array(z.string()).default([]),
});

const deadCodeSchema = z.object({
  package_globs: z.array(z.string().min(1)).min(1),
  public_symbol_rule: z.enum(['no_underscore_prefix']),
  exposed_via: z.array(exposureSourceSchema).default([]),
  caller_scan: callerScanSchema,
});

export const validatorConfigSchema = z.object({
  runtime: z.string().min(1),
  interpreter: z.string().min(1),
  doc_globs: z.array(z.string().min(1)).min(1),
  doc_fiction: docFictionSchema.optional(),
  dead_code: deadCodeSchema.optional(),
});

export type ValidatorConfig = z.infer<typeof validatorConfigSchema>;
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @factory5/coherence-validator test -- --reporter=verbose -t "validatorConfigSchema"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coherence-validator/src/config-schema.ts packages/coherence-validator/src/config-schema.test.ts
git commit -m "feat(15.13): validator config JSON schema"
```

---

### Task 4: Ship the Python validator config

**Files:**
- Create: `packages/coherence-validator/configs/python.json`

**Spec reference:** Component 3 → "Three-tier config resolution"

- [ ] **Step 1: Write the python.json**

```json
{
  "runtime": "python",
  "interpreter": ".factory/assessor-env/Scripts/python.exe",
  "doc_globs": ["README.md", "docs/**/*.md"],
  "doc_fiction": {
    "section_headings": "Quick Start|Configuration|Example|Usage|Reference|CLI Reference",
    "code_block_runners": {
      "python": {
        "command": ["<interpreter>", "-c", "<CODE>"],
        "timeout_ms": 30000
      },
      "yaml": {
        "wrapper_template": "import sys; sys.path.insert(0, '.'); from <project_pkg>.config import load_yaml; load_yaml(open('<BLOCK_FILE>').read())",
        "command": ["<interpreter>", "-c", "<WRAPPED>"],
        "timeout_ms": 30000
      },
      "bash": {
        "binary_lookup": "pyproject.toml::project.scripts",
        "command": ["<binary>", "<ARGS>"],
        "timeout_ms": 30000
      }
    }
  },
  "dead_code": {
    "package_globs": ["<project_pkg>/**/*.py"],
    "public_symbol_rule": "no_underscore_prefix",
    "exposed_via": [
      { "kind": "entry_points", "source": "pyproject.toml::project.scripts" },
      { "kind": "explicit_export", "source": "__all__" },
      { "kind": "feature_surface", "source": "docs/knowledge/features/*.md::documented_in" }
    ],
    "caller_scan": {
      "method": "ast_imports_and_calls",
      "exclude_globs": ["tests/**", "**/*_test.py", "**/test_*.py"]
    }
  }
}
```

- [ ] **Step 2: Make tsup include configs/ in the published dist**

In `packages/coherence-validator/package.json`, add to `files`:
```json
"files": ["dist", "configs"],
```

- [ ] **Step 3: Commit**

```bash
git add packages/coherence-validator/configs/python.json packages/coherence-validator/package.json
git commit -m "feat(15.13): ship default python.json validator config"
```

---

### Task 5: Config loader with three-tier resolution

**Files:**
- Create: `packages/coherence-validator/src/config-loader.ts`
- Create: `packages/coherence-validator/src/config-loader.test.ts`

**Spec reference:** Component 3 → "Three-tier config resolution"

- [ ] **Step 1: Write failing tests**

```typescript
// packages/coherence-validator/src/config-loader.test.ts
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadValidatorConfig } from './config-loader.js';

describe('loadValidatorConfig', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-config-loader-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns project override when .factory/coherence-validator.json exists', async () => {
    await mkdir(join(projectPath, '.factory'), { recursive: true });
    await writeFile(
      join(projectPath, '.factory', 'coherence-validator.json'),
      JSON.stringify({
        runtime: 'custom',
        interpreter: '/custom/python',
        doc_globs: ['CUSTOM.md'],
      }),
    );
    const result = await loadValidatorConfig({ projectPath, runtime: 'python' });
    expect(result.config?.runtime).toBe('custom');
    expect(result.source).toBe('project-override');
  });

  it('returns shipped default for known runtime when no override exists', async () => {
    const result = await loadValidatorConfig({ projectPath, runtime: 'python' });
    expect(result.config?.runtime).toBe('python');
    expect(result.source).toBe('shipped-default');
  });

  it('returns no-config for unknown runtime with no override', async () => {
    const result = await loadValidatorConfig({ projectPath, runtime: 'haskell' });
    expect(result.config).toBeUndefined();
    expect(result.source).toBe('none');
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm --filter @factory5/coherence-validator test -- --reporter=verbose -t "loadValidatorConfig"`
Expected: FAIL.

- [ ] **Step 3: Implement config-loader.ts**

```typescript
// packages/coherence-validator/src/config-loader.ts
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLogger } from '@factory5/logger';

import { validatorConfigSchema, type ValidatorConfig } from './config-schema.js';

const log = createLogger('coherence-validator.config');

export interface LoadConfigOptions {
  projectPath: string;
  runtime: string;
}

export interface LoadConfigResult {
  config?: ValidatorConfig;
  source: 'project-override' | 'shipped-default' | 'none';
}

function getConfigsDir(): string {
  const here = fileURLToPath(import.meta.url);
  return join(dirname(here), '..', 'configs');
}

async function tryRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

export async function loadValidatorConfig(opts: LoadConfigOptions): Promise<LoadConfigResult> {
  // Tier 2: project override
  const overridePath = join(opts.projectPath, '.factory', 'coherence-validator.json');
  const overrideText = await tryRead(overridePath);
  if (overrideText !== undefined) {
    try {
      const parsed = validatorConfigSchema.parse(JSON.parse(overrideText));
      log.debug({ projectPath: opts.projectPath, path: overridePath }, 'config: using project override');
      return { config: parsed, source: 'project-override' };
    } catch (err) {
      log.warn({ err, path: overridePath }, 'config: project override invalid; falling back');
    }
  }

  // Tier 1: shipped default
  const shippedPath = join(getConfigsDir(), `${opts.runtime}.json`);
  const shippedText = await tryRead(shippedPath);
  if (shippedText !== undefined) {
    try {
      const parsed = validatorConfigSchema.parse(JSON.parse(shippedText));
      return { config: parsed, source: 'shipped-default' };
    } catch (err) {
      log.warn({ err, path: shippedPath }, 'config: shipped default invalid (should never happen)');
    }
  }

  // Tier 3: would be agent-generated (deferred to v3, per spec)
  log.info(
    { runtime: opts.runtime, projectPath: opts.projectPath },
    'config: no validator config for runtime — doc-fiction + dead-code checks skipped',
  );
  return { source: 'none' };
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm --filter @factory5/coherence-validator test -- --reporter=verbose -t "loadValidatorConfig"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coherence-validator/src/config-loader.ts packages/coherence-validator/src/config-loader.test.ts
git commit -m "feat(15.13): validator config loader with three-tier resolution"
```

---

### Task 6: Doc-fiction engine

**Files:**
- Create: `packages/coherence-validator/src/doc-fiction.ts`
- Create: `packages/coherence-validator/src/doc-fiction.test.ts`

**Spec reference:** Component 3 → "Doc-fiction in detail"

- [ ] **Step 1: Write failing tests**

```typescript
// packages/coherence-validator/src/doc-fiction.test.ts
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDocFiction } from './doc-fiction.js';

describe('checkDocFiction', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-doc-fiction-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('returns empty findings when no in-scope code blocks present', async () => {
    await writeFile(
      join(projectPath, 'README.md'),
      '# Project\n\n## Architecture\n\nProse only.\n',
    );
    const config = {
      runtime: 'python',
      interpreter: 'python',
      doc_globs: ['README.md'],
      doc_fiction: {
        section_headings: 'Quick Start|Configuration',
        code_block_runners: {
          python: { command: ['python', '-c', '<CODE>'] },
        },
      },
    };
    const findings = await checkDocFiction({ projectPath, config });
    expect(findings).toEqual([]);
  });

  it('flags a python block that fails to execute under "Quick Start"', async () => {
    await writeFile(
      join(projectPath, 'README.md'),
      '# Project\n\n## Quick Start\n\n```python\nimport nonexistent_module\n```\n',
    );
    const config = {
      runtime: 'python',
      interpreter: 'python',
      doc_globs: ['README.md'],
      doc_fiction: {
        section_headings: 'Quick Start',
        code_block_runners: {
          python: { command: ['python', '-c', '<CODE>'], timeout_ms: 10000 },
        },
      },
    };
    const findings = await checkDocFiction({ projectPath, config });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.category).toBe('doc-fiction');
    expect(findings[0]?.location.file).toBe('README.md');
  });

  it('skips blocks under non-matching headings', async () => {
    await writeFile(
      join(projectPath, 'README.md'),
      '# Project\n\n## Internal Notes\n\n```python\nimport nonexistent\n```\n',
    );
    const config = {
      runtime: 'python',
      interpreter: 'python',
      doc_globs: ['README.md'],
      doc_fiction: {
        section_headings: 'Quick Start',
        code_block_runners: {
          python: { command: ['python', '-c', '<CODE>'] },
        },
      },
    };
    const findings = await checkDocFiction({ projectPath, config });
    expect(findings).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm --filter @factory5/coherence-validator test -- --reporter=verbose -t "checkDocFiction"`
Expected: FAIL.

- [ ] **Step 3: Implement doc-fiction.ts**

```typescript
// packages/coherence-validator/src/doc-fiction.ts
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createLogger } from '@factory5/logger';
import { glob } from 'glob';

import type { ValidatorConfig } from './config-schema.js';
import type { PartialFinding } from './schema-check.js';

const log = createLogger('coherence-validator.doc-fiction');

export interface DocFictionOptions {
  projectPath: string;
  config: ValidatorConfig;
}

interface CodeBlock {
  filePath: string;
  language: string;
  content: string;
  startLine: number;
  sectionHeading: string;
  sectionAnchor: string;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function extractCodeBlocks(filePath: string, content: string, headingsRegex: RegExp): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split(/\r?\n/);
  let currentHeading = '';
  let inBlock = false;
  let blockLang = '';
  let blockStart = 0;
  let blockBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (headingMatch && !inBlock) {
      currentHeading = headingMatch[1] ?? '';
      continue;
    }
    const fenceMatch = line.match(/^```(\S*)\s*$/);
    if (fenceMatch && !inBlock) {
      inBlock = true;
      blockLang = fenceMatch[1] ?? '';
      blockStart = i + 1;
      blockBuffer = [];
      continue;
    }
    if (fenceMatch && inBlock) {
      inBlock = false;
      if (headingsRegex.test(currentHeading) && blockLang.length > 0) {
        blocks.push({
          filePath,
          language: blockLang,
          content: blockBuffer.join('\n'),
          startLine: blockStart + 1,
          sectionHeading: currentHeading,
          sectionAnchor: slugify(currentHeading),
        });
      }
      continue;
    }
    if (inBlock) blockBuffer.push(line);
  }
  return blocks;
}

async function runWithTimeout(cmd: readonly string[], timeoutMs: number, cwd: string): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolveFn) => {
    const [bin, ...args] = cmd;
    if (bin === undefined) {
      resolveFn({ exitCode: 1, stderr: 'empty command' });
      return;
    }
    const child = spawn(bin, args, { cwd, shell: false });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
      resolveFn({ exitCode: 124, stderr: stderr + '\n<timed out>' });
    }, timeoutMs);
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveFn({ exitCode: code ?? 1, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolveFn({ exitCode: 1, stderr: err.message });
    });
  });
}

function substituteTemplate(
  template: string,
  vars: { code?: string; blockFile?: string; binary?: string; args?: string; interpreter: string },
): string {
  return template
    .replace(/<interpreter>/g, vars.interpreter)
    .replace(/<CODE>/g, vars.code ?? '')
    .replace(/<BLOCK_FILE>/g, vars.blockFile ?? '')
    .replace(/<binary>/g, vars.binary ?? '')
    .replace(/<ARGS>/g, vars.args ?? '');
}

export async function checkDocFiction(opts: DocFictionOptions): Promise<PartialFinding[]> {
  if (opts.config.doc_fiction === undefined) return [];
  const findings: PartialFinding[] = [];
  const headingsRegex = new RegExp(`^(${opts.config.doc_fiction.section_headings})$`, 'i');

  // Resolve interpreter path relative to project
  const interpreter = opts.config.interpreter.startsWith('.')
    ? resolve(opts.projectPath, opts.config.interpreter)
    : opts.config.interpreter;

  const tmpDir = await mkdtemp(join(tmpdir(), 'factory5-doc-fiction-'));

  for (const pattern of opts.config.doc_globs) {
    const files = await glob(pattern, { cwd: opts.projectPath, absolute: false });
    for (const rel of files) {
      const abs = resolve(opts.projectPath, rel);
      let content: string;
      try { content = await readFile(abs, 'utf8'); }
      catch { continue; }

      const blocks = extractCodeBlocks(rel, content, headingsRegex);
      for (const block of blocks) {
        const runner = opts.config.doc_fiction.code_block_runners[block.language];
        if (runner === undefined) continue;

        // Write block to tmp file for path substitution
        const blockFile = join(tmpDir, `block-${Date.now()}-${Math.random().toString(36).slice(2)}.${block.language}`);
        await writeFile(blockFile, block.content, 'utf8');

        const cmd = runner.command.map((c) =>
          substituteTemplate(c, {
            code: block.content,
            blockFile,
            interpreter,
          }),
        );

        const { exitCode, stderr } = await runWithTimeout(cmd, runner.timeout_ms ?? 30000, opts.projectPath);

        if (exitCode !== 0) {
          findings.push({
            category: 'doc-fiction',
            severity: 'high',
            title: `Documented example fails to execute: ${rel} §${block.sectionHeading}`,
            why: `The ${block.language} code block under "${block.sectionHeading}" produced exit code ${exitCode}. Users following this example will hit the same error.`,
            suggested_fix: `Either fix the code so the example runs, update the documented surface to match working code, or move the block out of an example-section heading.`,
            auto_fixable: false,
            location: { file: rel, line: block.startLine, anchor: `#${block.sectionAnchor}` },
          });
          log.debug({ filePath: rel, exitCode, stderr: stderr.slice(0, 200) }, 'doc-fiction: block failed');
        }
      }
    }
  }

  return findings;
}
```

- [ ] **Step 4: Add glob dep**

Run: `pnpm --filter @factory5/coherence-validator add glob@^11.0.0`

- [ ] **Step 5: Verify pass**

Run: `pnpm --filter @factory5/coherence-validator test -- --reporter=verbose -t "checkDocFiction"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/coherence-validator/src/doc-fiction.ts packages/coherence-validator/src/doc-fiction.test.ts packages/coherence-validator/package.json
git commit -m "feat(15.13): doc-fiction engine — executes README code blocks per config"
```

---

### Task 7: Wire doc-fiction into validator entry point

**Files:**
- Modify: `packages/coherence-validator/src/validator.ts`
- Modify: `packages/coherence-validator/src/index.ts` (export config-loader for callers)

- [ ] **Step 1: Update validator.ts to accept config + run doc-fiction**

Update `validateKnowledgeGraph` to optionally accept a `runtime` parameter and run doc-fiction when a config resolves:

```typescript
// Add to ValidateOptions:
export interface ValidateOptions {
  projectPath: string;
  taskIds: readonly string[];
  /** Runtime hint; when set, the engine loads the matching config and runs deeper checks. */
  runtime?: string;
}

// In validateKnowledgeGraph, after the existing schema + reference checks:
if (opts.runtime !== undefined) {
  const { loadValidatorConfig } = await import('./config-loader.js');
  const { checkDocFiction } = await import('./doc-fiction.js');
  const cfg = await loadValidatorConfig({ projectPath: opts.projectPath, runtime: opts.runtime });
  if (cfg.config !== undefined) {
    const docFictionFindings = await checkDocFiction({
      projectPath: opts.projectPath,
      config: cfg.config,
    });
    allFindings.push(...docFictionFindings);
  }
}
```

- [ ] **Step 2: Update index.ts**

```typescript
export { validateKnowledgeGraph, type ValidationResult, type ValidateOptions } from './validator.js';
export { loadValidatorConfig } from './config-loader.js';
export type { ValidatorConfig } from './config-schema.js';
```

- [ ] **Step 3: Build + test**

Run: `pnpm --filter @factory5/coherence-validator build && pnpm --filter @factory5/coherence-validator test 2>&1 | tail -10`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/coherence-validator/src/validator.ts packages/coherence-validator/src/index.ts
git commit -m "feat(15.13): validator entry point runs doc-fiction when runtime config available"
```

---

## Section 3: Dead-code scanner

### Task 8: Python dead-code scanner

**Files:**
- Create: `packages/coherence-validator/src/dead-code-python.ts`
- Create: `packages/coherence-validator/src/dead-code-python.test.ts`

**Spec reference:** Component 3 → "Dead-code in detail"

- [ ] **Step 1: Write failing tests**

```typescript
// packages/coherence-validator/src/dead-code-python.test.ts
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDeadCodePython } from './dead-code-python.js';

describe('checkDeadCodePython', () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'factory5-dead-code-'));
    await mkdir(join(projectPath, 'mypkg'), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  });

  it('flags an unused public function', async () => {
    await writeFile(join(projectPath, 'mypkg', '__init__.py'), '');
    await writeFile(
      join(projectPath, 'mypkg', 'lib.py'),
      'def used_helper(): pass\ndef orphan_func(): pass\n',
    );
    await writeFile(
      join(projectPath, 'mypkg', 'main.py'),
      'from mypkg.lib import used_helper\nused_helper()\n',
    );
    const findings = await checkDeadCodePython({
      projectPath,
      packageGlobs: ['mypkg/**/*.py'],
      exposedVia: [],
      excludeGlobs: ['tests/**'],
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.title.includes('orphan_func'))).toBe(true);
    expect(findings.every((f) => !f.title.includes('used_helper'))).toBe(true);
  });

  it('does not flag a symbol referenced via __all__', async () => {
    await writeFile(join(projectPath, 'mypkg', '__init__.py'), '');
    await writeFile(
      join(projectPath, 'mypkg', 'api.py'),
      '__all__ = ["public_api"]\ndef public_api(): pass\n',
    );
    const findings = await checkDeadCodePython({
      projectPath,
      packageGlobs: ['mypkg/**/*.py'],
      exposedVia: [{ kind: 'explicit_export', source: '__all__' }],
      excludeGlobs: [],
    });
    expect(findings.every((f) => !f.title.includes('public_api'))).toBe(true);
  });

  it('does not flag underscore-prefixed (private) symbols', async () => {
    await writeFile(join(projectPath, 'mypkg', '__init__.py'), '');
    await writeFile(
      join(projectPath, 'mypkg', 'lib.py'),
      'def _internal(): pass\n',
    );
    const findings = await checkDeadCodePython({
      projectPath,
      packageGlobs: ['mypkg/**/*.py'],
      exposedVia: [],
      excludeGlobs: [],
    });
    expect(findings.every((f) => !f.title.includes('_internal'))).toBe(true);
  });
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm --filter @factory5/coherence-validator test -- --reporter=verbose -t "checkDeadCodePython"`
Expected: FAIL.

- [ ] **Step 3: Implement dead-code-python.ts**

Use a subprocess to invoke Python's AST module (since we don't have a TypeScript Python parser). The Python script reads the file paths, returns JSON describing public symbols, imports, and calls.

```typescript
// packages/coherence-validator/src/dead-code-python.ts
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createLogger } from '@factory5/logger';
import { glob } from 'glob';

import type { PartialFinding } from './schema-check.js';

const log = createLogger('coherence-validator.dead-code');

export interface DeadCodeOptions {
  projectPath: string;
  packageGlobs: readonly string[];
  exposedVia: ReadonlyArray<{ kind: string; source: string }>;
  excludeGlobs: readonly string[];
}

const ANALYZER_PY = `
import ast, json, sys

class V(ast.NodeVisitor):
    def __init__(self):
        self.public_defs = []      # [(name, line)]
        self.imports = []          # ['foo.bar.baz', ...]
        self.calls = []            # ['baz', 'bar.baz', ...]
        self.all_list = None       # parsed __all__ if present

    def visit_FunctionDef(self, node):
        if not node.name.startswith('_'):
            self.public_defs.append((node.name, node.lineno))
        self.generic_visit(node)

    def visit_ClassDef(self, node):
        if not node.name.startswith('_'):
            self.public_defs.append((node.name, node.lineno))
        self.generic_visit(node)

    def visit_Assign(self, node):
        # Detect __all__ = [...]
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id == '__all__':
                if isinstance(node.value, (ast.List, ast.Tuple)):
                    self.all_list = [e.value for e in node.value.elts if isinstance(e, ast.Constant)]
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if node.module is not None:
            for alias in node.names:
                self.imports.append(f"{node.module}.{alias.name}")
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Attribute):
            parts = []
            n = node.func
            while isinstance(n, ast.Attribute):
                parts.insert(0, n.attr)
                n = n.value
            if isinstance(n, ast.Name): parts.insert(0, n.id)
            self.calls.append('.'.join(parts))
        elif isinstance(node.func, ast.Name):
            self.calls.append(node.func.id)
        self.generic_visit(node)

paths = json.loads(sys.stdin.read())
out = {}
for p in paths:
    try:
        src = open(p, 'r', encoding='utf-8').read()
        tree = ast.parse(src, p)
        v = V(); v.visit(tree)
        out[p] = {'public_defs': v.public_defs, 'imports': v.imports, 'calls': v.calls, 'all_list': v.all_list}
    except Exception as e:
        out[p] = {'error': str(e)}

print(json.dumps(out))
`;

interface SymbolInfo {
  public_defs: Array<[string, number]>;
  imports: string[];
  calls: string[];
  all_list: string[] | null;
  error?: string;
}

async function runAnalyzer(pythonBin: string, paths: readonly string[]): Promise<Record<string, SymbolInfo>> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(pythonBin, ['-c', ANALYZER_PY], { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdin.write(JSON.stringify(paths));
    child.stdin.end();
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    child.on('close', (code) => {
      if (code !== 0) {
        rejectFn(new Error(`python analyzer exit ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try { resolveFn(JSON.parse(stdout)); }
      catch (err) { rejectFn(err as Error); }
    });
    child.on('error', rejectFn);
  });
}

async function collectExposedSymbols(
  opts: DeadCodeOptions,
  analysis: Record<string, SymbolInfo>,
): Promise<Set<string>> {
  const exposed = new Set<string>();

  for (const source of opts.exposedVia) {
    if (source.kind === 'explicit_export' && source.source === '__all__') {
      for (const info of Object.values(analysis)) {
        if (info.all_list !== null) {
          for (const name of info.all_list) exposed.add(name);
        }
      }
    } else if (source.kind === 'entry_points' && source.source === 'pyproject.toml::project.scripts') {
      try {
        const text = await readFile(resolve(opts.projectPath, 'pyproject.toml'), 'utf8');
        const scripts = text.match(/\[project\.scripts\]\s*\n([^\[]*)/);
        if (scripts !== null) {
          const lines = (scripts[1] ?? '').split(/\r?\n/);
          for (const line of lines) {
            const m = line.match(/^\s*\S+\s*=\s*"[^"]+:(\w+)"/);
            if (m && m[1] !== undefined) exposed.add(m[1]);
          }
        }
      } catch { /* no pyproject — skip */ }
    } else if (source.kind === 'feature_surface') {
      // Stub: would parse features/*.md documented_in; treat as out-of-scope for v1
      // since the schema-check covers most cases. Future enhancement.
    }
  }

  return exposed;
}

export async function checkDeadCodePython(opts: DeadCodeOptions): Promise<PartialFinding[]> {
  const allPaths = new Set<string>();
  for (const pattern of opts.packageGlobs) {
    const matched = await glob(pattern, { cwd: opts.projectPath, absolute: true, ignore: [...opts.excludeGlobs] });
    for (const p of matched) allPaths.add(p);
  }

  if (allPaths.size === 0) return [];

  const analysis = await runAnalyzer('python', [...allPaths]);
  const exposed = await collectExposedSymbols(opts, analysis);

  // Build a set of all called names across the package.
  const calledNames = new Set<string>();
  const importedTargets = new Set<string>();
  for (const info of Object.values(analysis)) {
    for (const c of info.calls) {
      const last = c.split('.').pop() ?? '';
      calledNames.add(last);
    }
    for (const i of info.imports) {
      const last = i.split('.').pop() ?? '';
      importedTargets.add(last);
    }
  }

  const findings: PartialFinding[] = [];
  for (const [path, info] of Object.entries(analysis)) {
    if (info.error !== undefined) continue;
    for (const [symbolName, line] of info.public_defs) {
      if (exposed.has(symbolName)) continue;
      if (calledNames.has(symbolName)) continue;
      if (importedTargets.has(symbolName)) continue;
      findings.push({
        category: 'dead-code',
        severity: 'low',
        title: `Public symbol ${symbolName} appears unused`,
        why: `Defined in ${path}:${line} but no other module in the package imports or calls it, and it is not exposed via __all__ or entry_points.`,
        suggested_fix: `Either wire it up (write a caller) or remove it. If it's a public API surface, declare it in __all__ or reference it from a feature's documented_in.`,
        auto_fixable: false,
        location: { file: path.replace(opts.projectPath + '/', '').replace(/\\/g, '/'), line },
      });
    }
  }

  log.debug({ projectPath: opts.projectPath, candidateCount: findings.length }, 'dead-code: scan complete');
  return findings;
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm --filter @factory5/coherence-validator test -- --reporter=verbose -t "checkDeadCodePython"`
Expected: PASS.

- [ ] **Step 5: Wire into validator entry point**

In `validator.ts`, after the doc-fiction call:

```typescript
if (opts.runtime === 'python' && cfg.config?.dead_code !== undefined) {
  const { checkDeadCodePython } = await import('./dead-code-python.js');
  const deadFindings = await checkDeadCodePython({
    projectPath: opts.projectPath,
    packageGlobs: cfg.config.dead_code.package_globs,
    exposedVia: cfg.config.dead_code.exposed_via,
    excludeGlobs: cfg.config.dead_code.caller_scan.exclude_globs,
  });
  allFindings.push(...deadFindings);
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/coherence-validator/src/dead-code-python.ts packages/coherence-validator/src/dead-code-python.test.ts packages/coherence-validator/src/validator.ts
git commit -m "feat(15.13): Python dead-code scanner via AST subprocess"
```

---

## Section 4: Coherence-reviewer agent

### Task 9: Create coherence-reviewer agent prompt

**Files:**
- Create: `prompts/agents/coherence-reviewer.md`

**Spec reference:** Component 3 → "Semantic doc-fiction check (coherence-reviewer agent)"

- [ ] **Step 1: Write the prompt**

```markdown
<!-- prompts/agents/coherence-reviewer.md -->
# Role: Coherence Reviewer

You are the coherence reviewer for a factory5 project. Your job is to
verify that the project's user-facing documentation matches the
project's actual code. You produce structured findings. You never
fix anything — you report only.

## Inputs

You have read-only access to the project tree. Read the following:

- `docs/knowledge/overview.md`, `modules.md`, `testing.md`,
  `decisions.md` — the project's intent and architecture
- `docs/knowledge/features/*.md` — every documented feature, with
  its `documented_in:` pointing at user-facing surfaces
- `docs/knowledge/decisions/*.md` — any decisions that modified
  features mid-build
- `README.md` and any docs/*.md the features reference
- The project source code, especially modules referenced in
  `modules.md` and features

## What to check

For each `feature` file:

1. **Does the implementation match the documented surface?**
   - If `documented_in:` says "README.md#cli-reference" includes a
     specific CLI flag, does the actual CLI code accept that flag?
   - If a feature claims `status: implemented`, is there code that
     a user can actually invoke to use it?

2. **Are there capabilities the code exposes that no feature
   documents?**
   - Public functions/classes that look like a user surface but
     have no `feature` file describing them
   - CLI commands present in code but not in any feature's
     `documented_in:`

3. **Are the decisions consistent with the current code?**
   - For each decision file, does the current code reflect the
     decided outcome? (E.g., if a decision dropped a feature, is
     the feature actually absent from the docs and the surface?)

## What you do NOT check

- Schema validity of front-matter (the validator already does this)
- Reference integrity of anchors (the validator already does this)
- Doc-fiction in executable code blocks (the programmatic check
  already does this — README example python that fails to run)
- Test failures (the test runner does this)

You focus on the SEMANTIC layer that those checks can't catch:
prose claims, conceptual coherence, decisions that should have
been written but weren't.

## Output

Emit findings using the standard marker format:

```
FINDING [HIGH] README.md#cli-reference: README CLI Reference lists
"--pipeline-name" flag but etl/cli.py argparser does not register it.
Either add the flag (and corresponding decision in
docs/knowledge/decisions/) or remove the doc reference.
```

Severity:
- **HIGH** — user-facing claim that doesn't work (broken contract)
- **MEDIUM** — code surface that users can find but isn't documented
- **LOW** — minor wording / inconsistency

Target: the documentation file with anchor, or the code file with
line number.

Description must include:
- WHAT is divergent (be specific — name the flag, the function, the claim)
- WHERE the divergence is (doc location + code location)
- SUGGESTED FIX (concrete: "add X to Y", "remove Z from W")

Emit one finding per distinct divergence. Don't deduplicate across
multiple instances of the same issue — each finding is one location.

## Rules

- You never modify code or docs. Read-only.
- You never invent issues — only report divergences you verified.
- You include file:line citations for code and file#anchor for docs.
- You finish with a summary line: `REVIEW COMPLETE: <N> findings raised`.
```

- [ ] **Step 2: Commit**

```bash
git add prompts/agents/coherence-reviewer.md
git commit -m "feat(15.13): coherence-reviewer agent prompt"
```

---

### Task 10: Register coherence-reviewer in agent registry

**Files:**
- Modify: `packages/brain/src/agents/registry.ts`

- [ ] **Step 1: Add the entry**

In `packages/brain/src/agents/registry.ts`, after the `verifier` entry:

```typescript
'coherence-reviewer': {
  role: 'coherence-reviewer',
  category: 'reasoning',
  tools: ['Read', 'Glob', 'Grep'],
  defaultSkills: ['knowledge-graph', 'code-review'],
  promptPath: 'coherence-reviewer.md',
},
```

- [ ] **Step 2: Update AgentRole type if needed**

If `AgentRole` is a literal-string union in `packages/core/src/schemas.ts` or similar, add `'coherence-reviewer'`. Find it:

Run: `grep -n "agentRoleSchema" packages/core/src/schemas.ts`

Update the enum to include `'coherence-reviewer'`.

- [ ] **Step 3: Build**

Run: `pnpm build 2>&1 | tail -5`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/agents/registry.ts packages/core/src/schemas.ts
git commit -m "feat(15.13): register coherence-reviewer agent role"
```

---

### Task 11: Planner inserts coherence-reviewer task at directive end

**Files:**
- Modify: `packages/brain/src/planner.ts` (after the LLM-emitted plan is materialized)
- Test: `packages/brain/src/planner.test.ts`

**Spec reference:** Component 3 → "When the planner inserts it"

- [ ] **Step 1: Write failing test**

```typescript
it('appends a coherence-reviewer task at directive end', () => {
  const plannerTasks = [{
    title: 'Build CLI',
    agent: 'builder' as const,
    category: 'deep' as const,
    inputs: { files: [], context: '' },
    expectedOutputs: { files: [], signals: [] },
    dependsOn: [],
  }];
  const tasks = materialisePlannerTasks(plannerTasks, 'pln-1');
  // Phase B addition: a terminal coherence-reviewer task should follow
  expect(tasks.find((t) => t.agent === 'coherence-reviewer')).toBeDefined();
});
```

- [ ] **Step 2: Verify fail**

Run: `pnpm --filter @factory5/brain test -- -t "coherence-reviewer task"`
Expected: FAIL.

- [ ] **Step 3: Implement task insertion**

In `packages/brain/src/planner.ts`, after the `materialisePlannerTasks` function builds the tasks array but before returning:

```typescript
// Tier 15.13 — append a terminal coherence-reviewer task. Runs after
// all builder/fixer tasks complete; produces structured findings about
// doc/code drift.
if (tasks.length > 0 && !tasks.some((t) => t.agent === 'coherence-reviewer')) {
  const reviewerId = newUlid();
  const dependsOnAll = tasks.map((t) => t.id);
  tasks.push({
    id: reviewerId,
    planId,
    title: 'Final coherence review',
    agent: 'coherence-reviewer',
    category: 'reasoning',
    inputs: { files: [], context: 'Read the knowledge area and verify docs match code.' },
    expectedOutputs: { files: [], signals: [] },
    dependsOn: dependsOnAll,
    status: 'pending',
    attempts: 0,
    featureIds: [],
  });
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm --filter @factory5/brain test -- -t "coherence-reviewer task"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/planner.ts packages/brain/src/planner.test.ts
git commit -m "feat(15.13): planner appends terminal coherence-reviewer task"
```

---

## Section 5: Backward-compat migration

### Task 12: Brain detects missing graph and inserts migration task

**Files:**
- Modify: `packages/brain/src/loop.ts` (early in executeDirective, before plan dispatch)
- Test: `packages/brain/src/loop.test.ts`

**Spec reference:** Component 1 → "Existing projects (backward compat)"

- [ ] **Step 1: Write failing test**

```typescript
it('inserts graph-migration task when project lacks docs/knowledge/_schema.md', async () => {
  // Mock a project with docs/knowledge/modules.md but no _schema.md
  // Run executeDirective with a plan that has builder tasks
  // Assert: the plan's first task is a graph-migration task
});
```

- [ ] **Step 2: Implement detection + injection**

In `packages/brain/src/loop.ts`, in `executeDirective` near where the plan is loaded:

```typescript
import { existsSync } from 'node:fs';

// Tier 15.13 — backward-compat: if the project has docs/knowledge/ but
// no _schema.md, insert a migration task to seed the graph.
const knowledgePath = join(directive.projectPath, 'docs', 'knowledge');
const schemaPath = join(knowledgePath, '_schema.md');
const hasKnowledge = existsSync(knowledgePath);
const hasSchema = existsSync(schemaPath);

if (hasKnowledge && !hasSchema) {
  log.info(
    { projectPath: directive.projectPath },
    'loop: graph migration needed — inserting graph-migration task',
  );
  const migrationTaskId = newUlid();
  const migrationTask: Task = {
    id: migrationTaskId,
    planId: plan.id,
    title: 'Migrate to knowledge graph (one-shot)',
    agent: 'architect',
    category: 'reasoning',
    inputs: {
      files: ['docs/knowledge/modules.md'],
      context: 'This project predates the knowledge graph. Read modules.md, infer features (status=implemented since code exists), copy _schema.md and _templates/ from factory5 assets, write features/*.md and decisions.md heading. Single commit.',
    },
    expectedOutputs: {
      files: ['docs/knowledge/_schema.md', 'docs/knowledge/_templates/feature.md', 'docs/knowledge/features/'],
      signals: [],
    },
    dependsOn: [],
    status: 'pending',
    attempts: 0,
    featureIds: [],
  };
  // Make all existing tasks depend on the migration
  for (const t of plan.tasks) {
    if (!t.dependsOn.includes(migrationTaskId)) {
      t.dependsOn = [migrationTaskId, ...t.dependsOn];
    }
  }
  plan.tasks.unshift(migrationTask);
}
```

- [ ] **Step 3: Build + test**

Run: `pnpm build && pnpm --filter @factory5/brain test 2>&1 | tail -10`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/loop.ts packages/brain/src/loop.test.ts
git commit -m "feat(15.13): brain inserts graph-migration task for projects without _schema.md"
```

---

## Section 6: End-to-end Phase B verification

### Task 13: Phase B verification

- [ ] **Step 1: Build, lint, test**

Run: `pnpm build && pnpm lint && pnpm test 2>&1 | tail -20`
Expected: clean (note any pre-existing failures).

- [ ] **Step 2: Manual smoke test against pythonetl**

```bash
node packages/cli/dist/index.js graph check "C:\Users\Momo\factory5-workspace\pythonetl"
```
Expected: now reports findings about missing knowledge graph, OR runs doc-fiction against the existing README and reports the known doc-fiction findings.

- [ ] **Step 3: Verify coherence-reviewer task lands in planner output**

Trigger a small build (via CLI or web UI). Check the resulting plan.json — should contain a terminal task with `agent: "coherence-reviewer"`.

- [ ] **Step 4: Commit completion marker**

```bash
git commit --allow-empty -m "chore(15.13): Phase B complete — deeper validation + coherence-reviewer wired"
```

---

## Phase B coverage check

- [x] Component 3 (post-merge): wired in pool.ts — Task 1
- [x] Component 3 (final-verification): wired in loop.ts — Task 2
- [x] Component 3 (config schema): validatorConfigSchema — Task 3
- [x] Component 3 (shipped config): python.json — Task 4
- [x] Component 3 (config loader): three-tier resolution — Task 5
- [x] Component 3 (doc-fiction engine): checkDocFiction — Task 6
- [x] Component 3 (validator wiring for doc-fiction) — Task 7
- [x] Component 3 (dead-code scanner): checkDeadCodePython — Task 8
- [x] Component 3 (coherence-reviewer agent prompt) — Task 9
- [x] Component 3 (coherence-reviewer registry) — Task 10
- [x] Component 3 (planner inserts coherence-reviewer task) — Task 11
- [x] Component 1 (backward compat: graph-migration task) — Task 12

**Deferred to Phase C:**
- Self-healing fix loop (consumes the findings Phase B produces)
- Workspace hygiene (cleanup CLI, abandoned worktree detection)

**Deferred beyond v1:**
- node.json, go.json, rust.json shipped configs (per the engine + config architecture, these are config additions, not engine work)
- Agent-generated config for unknown runtimes (v3 tier-3)
