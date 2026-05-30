/**
 * Three-tier config resolution for the coherence validator:
 *   1. Project override at `<projectPath>/.factory/coherence-validator.json`
 *   2. Shipped default at `<package>/configs/<runtime>.json`
 *   3. None (returns source: 'none', config undefined) — agent-generated
 *      config is deferred to a future v3.
 *
 * An invalid project override logs a warning and falls back to the shipped
 * default; an invalid shipped default logs a warning and falls through to
 * 'none' (and would indicate a bug in the package itself).
 */

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
  // both `src/config-loader.ts` (dev) and `dist/index.js` (built) sit one level
  // under the package root, so `../configs` resolves to the package's configs/.
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
      log.debug(
        { projectPath: opts.projectPath, path: overridePath },
        'config: using project override',
      );
      return { config: parsed, source: 'project-override' };
    } catch (err) {
      log.warn(
        { err, path: overridePath },
        'config: project override invalid; falling back to shipped default',
      );
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
      log.warn(
        { err, path: shippedPath },
        'config: shipped default invalid (should never happen — package bug)',
      );
    }
  }

  // Tier 3: agent-generated (deferred to v3 per spec)
  log.info(
    { runtime: opts.runtime, projectPath: opts.projectPath },
    'config: no validator config for runtime — doc-fiction + dead-code checks skipped',
  );
  return { source: 'none' };
}
