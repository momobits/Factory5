/**
 * Brain-internal test helpers — shared across brain unit tests.
 *
 * Do NOT import from production code; this file is for tests only.
 * Named `test-helpers.ts` (not `*.test.ts`) so it isn't picked up as
 * a test suite by vitest, but is treated as a plain TypeScript module
 * that test files can import.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// makeFakeRegistry
// ---------------------------------------------------------------------------

export interface FakeRegistryOpts {
  /** Text the fake provider returns as `response.text`. */
  response: string;
  /** If set, the resolved category is appended here on each `resolve()` call. */
  captureCategoryTo?: string[];
  /** If set, the full `ProviderRequest` is appended here on each `call()`. */
  captureTo?: unknown[];
  /** If set, `{ userPrompt }` is appended here on each `call()`. */
  capturePromptTo?: { userPrompt: string }[];
}

/**
 * Build a minimal fake `ProviderRegistry` whose single provider returns a
 * fixed response string. All shapes match the real `ProviderRegistry` /
 * `CategoryResolution` / `ProviderResponse` contracts.
 *
 * This is the SUPERSET of all per-test-file copies — it supports all four
 * capture hooks (`captureCategoryTo`, `captureTo`, `capturePromptTo`).
 */
export function makeFakeRegistry(opts: FakeRegistryOpts) {
  return {
    resolve: async (category: string) => {
      opts.captureCategoryTo?.push(category);
      return {
        provider: {
          id: 'fake',
          call: async (req: {
            systemPrompt: string;
            messages: { role: string; content: string }[];
          }) => {
            if (opts.captureTo !== undefined) opts.captureTo.push(req);
            if (opts.capturePromptTo !== undefined) {
              opts.capturePromptTo.push({
                userPrompt: req.messages.map((m) => m.content).join('\n'),
              });
            }
            return {
              text: opts.response,
              usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
              resolvedProvider: 'fake',
              resolvedModel: 'fake-model',
            };
          },
          available: async () => true,
          stream: async function* () {
            yield { delta: '', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
          },
        },
        model: 'fake-model',
        chainIndex: 0,
        category,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// tmpProjectWithClaudeMd
// ---------------------------------------------------------------------------

/**
 * Create a temp directory containing a minimal `CLAUDE.md` so
 * `readArchitect` (and any function that reads CLAUDE.md) won't throw.
 *
 * Callers are responsible for cleanup (e.g. `rmSync(path, { recursive: true,
 * force: true })` in a `finally` block or `afterEach`).
 */
export async function tmpProjectWithClaudeMd(): Promise<string> {
  const projectPath = mkdtempSync(join(tmpdir(), 'factory5-architect-tier14-'));
  writeFileSync(join(projectPath, 'CLAUDE.md'), '# Test Project\n\nA minimal test project.\n');
  return projectPath;
}
