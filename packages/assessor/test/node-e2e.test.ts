/**
 * End-to-end integration test for the Node/TypeScript runtime (Phase 10.2).
 *
 * Seeds a minimal TypeScript project into an OS tmpdir, then calls
 * `assess({ runtime: 'node' })` with real subprocesses wired. Covers the
 * full pipeline — host-tool pre-flight → pnpm install → tsc --noEmit →
 * vitest — against an actual toolchain, complementing the seam-injected
 * unit tests under `src/runtimes/node.test.ts`.
 *
 * No skipping: `pnpm` and `node` are table-stakes for anyone working on
 * factory5 itself (ADR 0001). The test fails loudly on a misconfigured
 * host rather than silently skipping.
 *
 * Performance: the first run pulls `typescript` + `vitest` + `@types/node`
 * into pnpm's global store (~20–30 s cold; <5 s warm on subsequent runs).
 * Budget is 3 minutes per test, bounded by the timeouts below.
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initLogger } from '@factory5/logger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assess } from '../src/assess.js';

const E2E_TIMEOUT_MS = 180_000; // 3 min — covers cold pnpm install on slow networks.

async function seedMinimalTsProject(projectDir: string): Promise<void> {
  await mkdir(join(projectDir, 'src'), { recursive: true });
  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify(
      {
        name: 'factory5-assessor-node-e2e-fixture',
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: {
          typecheck: 'tsc --noEmit',
          test: 'vitest run',
        },
        devDependencies: {
          '@types/node': '^20.14.0',
          typescript: '^5.5.0',
          vitest: '^2.0.0',
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(projectDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          types: ['node'],
          skipLibCheck: true,
          isolatedModules: true,
        },
        include: ['src/**/*', '**/*.test.ts'],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(projectDir, 'src', 'math.ts'),
    `export function add(a: number, b: number): number {\n  return a + b;\n}\n`,
  );
  await writeFile(
    join(projectDir, 'src', 'math.test.ts'),
    `import { describe, expect, it } from 'vitest';\nimport { add } from './math.js';\n\ndescribe('add', () => {\n  it('sums two numbers', () => {\n    expect(add(2, 3)).toBe(5);\n  });\n});\n`,
  );
  // README + LICENSE + .gitignore so the artifact checks pass and gate.verify
  // can be true. Phase 5-era constraint: README ≥ 30 non-empty lines.
  await writeFile(
    join(projectDir, 'README.md'),
    Array.from(
      { length: 30 },
      (_, i) => `Line ${String(i + 1)} describes the factory5 assessor e2e fixture.`,
    ).join('\n') + '\n',
  );
  await writeFile(
    join(projectDir, 'LICENSE'),
    'Apache-2.0 placeholder for factory5 e2e fixture.\n',
  );
  await writeFile(join(projectDir, '.gitignore'), 'node_modules\ndist\n.factory\n');
  await mkdir(join(projectDir, 'docs'), { recursive: true });
  await writeFile(
    join(projectDir, 'docs', 'architecture.md'),
    '# Architecture\n\nFixture for ADR 0026 end-to-end verification.\n',
  );
}

describe('node runtime — end-to-end', () => {
  let projectDir: string;

  beforeAll(async () => {
    initLogger({ processName: 'node-e2e-test', noFile: true });
    projectDir = await mkdtemp(join(tmpdir(), 'factory5-node-e2e-'));
    await seedMinimalTsProject(projectDir);
  }, E2E_TIMEOUT_MS);

  afterAll(async () => {
    if (projectDir !== undefined) {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it(
    'assesses a minimal TS project green through the full pipeline',
    async () => {
      const result = await assess({ projectPath: projectDir, runtime: 'node' });

      // Failure modes surface with enough detail to debug without re-running.
      if (result.failureMode !== undefined) {
        console.error('unexpected failureMode', {
          failureMode: result.failureMode,
          testsFailed: result.testsFailed,
          testsErrors: result.testsErrors,
          preflight: result.provisioning?.preflight,
        });
      }

      expect(result.runtime).toBe('node');
      expect(result.failureMode).toBeUndefined();
      expect(result.gateResults.build).toBe(true);
      expect(result.gateResults.integration).toBe(true);
      expect(result.testsPassed).toBeGreaterThan(0);
      expect(result.testsFailed).toBe(0);
      expect(result.testsErrors).toBe(0);
      expect(result.testFramework).toBe('vitest');
      expect(result.provisioning?.runtime).toBe('node');
      expect(result.provisioning?.preflight?.ok).toBe(true);
    },
    E2E_TIMEOUT_MS,
  );
});
