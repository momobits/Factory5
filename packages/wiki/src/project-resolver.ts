/**
 * Resolve a project-name argument to an absolute workspace path.
 *
 * Shared between the CLI (`factory build <name>`) and the channel
 * inbound handlers (Telegram / Discord `/build <name>`) so that a
 * build kicked off via any route ends up with a consistent absolute
 * `projectPath` on the directive. Before this lived here, only the
 * CLI performed the resolution and channel-initiated directives
 * landed with `payload.project` unresolved — see issue I011.
 *
 * Resolution order (first match wins):
 *   1. Absolute path that exists on disk — return as-is.
 *   2. `./` or `../` relative path that exists under `cwd` — absolute-ify and return.
 *   3. `<workspace>/<name>` — return if present.
 *   4. Template: `<repo>/templates/<name>/` — copy into the workspace, return.
 *   5. Empty workspace directory — create and return.
 *
 * Callers that want to force a specific rung (e.g. tests that only
 * want the template-copy behaviour) can inject `templatesDir` and
 * `cwd` explicitly via the options bag.
 */

import { constants as fsConstants } from 'node:fs';
import { access, cp, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { cwd as processCwd } from 'node:process';
import { fileURLToPath } from 'node:url';

import { createLogger } from '@factory5/logger';

const log = createLogger('wiki.project-resolver');

/** `~/factory5-workspace`. */
export function defaultWorkspace(): string {
  return join(homedir(), 'factory5-workspace');
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk up from `startFrom` (defaults to this module's compiled
 * location) until a `templates/` directory is found. Works for both
 * dev (`tsx` → `src/`) and prod (`dist/`) layouts.
 *
 * Tests and callers in non-standard deployments can override
 * `startFrom` to avoid depending on the runtime's module location.
 */
export async function findRepoTemplatesDir(
  opts: {
    startFrom?: string;
  } = {},
): Promise<string | undefined> {
  const start = opts.startFrom ?? dirname(fileURLToPath(import.meta.url));
  let dir = start;
  while (true) {
    const candidate = join(dir, 'templates');
    if (await fileExists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface ResolveProjectPathOptions {
  /**
   * Override the templates directory used for the template-copy rung.
   * Typically unset — {@link findRepoTemplatesDir} will locate it. Tests
   * set this to a fixture so behaviour is deterministic.
   */
  templatesDir?: string;
  /**
   * Override the cwd used to resolve `./` / `../` relative names.
   * Defaults to `process.cwd()`.
   */
  cwd?: string;
}

/**
 * Resolve `name` to an absolute project path under `workspace`. See the
 * module docstring for the resolution order. Creates directories and
 * copies template contents as a side effect when needed — callers who
 * want a pure lookup should pre-check themselves.
 */
export async function resolveProjectPath(
  name: string,
  workspace: string,
  opts: ResolveProjectPathOptions = {},
): Promise<string> {
  const baseCwd = opts.cwd ?? processCwd();

  if (isAbsolute(name) && (await fileExists(name))) return name;
  if (
    (name.startsWith('./') || name.startsWith('../')) &&
    (await fileExists(resolve(baseCwd, name)))
  ) {
    return resolve(baseCwd, name);
  }

  const inWorkspace = join(workspace, name);
  if (await fileExists(inWorkspace)) return inWorkspace;

  const templates = opts.templatesDir ?? (await findRepoTemplatesDir());
  if (templates !== undefined) {
    const inTemplates = join(templates, name);
    if (await fileExists(inTemplates)) {
      await mkdir(workspace, { recursive: true });
      await cp(inTemplates, inWorkspace, { recursive: true });
      log.info({ name, from: inTemplates, to: inWorkspace }, 'template copied into workspace');
      return inWorkspace;
    }
  }

  await mkdir(inWorkspace, { recursive: true });
  log.warn({ name, created: inWorkspace }, 'project dir did not exist — created empty');
  return inWorkspace;
}
