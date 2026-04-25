/**
 * Per-project identity file — `<project>/.factory/project.json` (ADR 0021).
 *
 * The file is the canonical source of project identity. Every directive
 * that references a project resolves through {@link loadOrCreateProjectMetadata}:
 * the file's id is read if present, a fresh ULID is generated and written
 * if absent. The runtime helper and the one-shot backfill in migration 006
 * agree on what the file means, so an operator copying a project to a new
 * folder (file in tow) carries identity along; deleting the file before the
 * next build is the explicit fork action.
 *
 * The helper never silently re-tags a corrupted file — losing the existing
 * id would sever spend / findings / build history, exactly the failure mode
 * ADR 0021 is meant to prevent. Callers must catch
 * {@link ProjectMetadataCorruptError} and surface it to the operator
 * (recover from backup, or accept-as-new by deleting the file).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { newId } from '@factory5/core';
import { createLogger } from '@factory5/logger';

const log = createLogger('wiki.project-metadata');

/** Bumped when the file shape evolves; must match migration 006's constant. */
export const PROJECT_FILE_VERSION = '0.x';

/** Standard relative path inside a project. */
export const PROJECT_FILE_RELATIVE = '.factory/project.json';

/**
 * Shape of `<project>/.factory/project.json`.
 *
 * `id` is the canonical project handle (ULID). `name` is the human label —
 * not unique, never used for joins. `metadata` is a free-form extension
 * point so future per-project state (spec ref, default budget overrides,
 * project-scoped flags) can land without a schema migration.
 */
export interface ProjectMetadata {
  id: string;
  name: string;
  createdAt: string;
  factoryVersion: string;
  metadata: Record<string, unknown>;
}

/**
 * Thrown when `<project>/.factory/project.json` exists but cannot be parsed
 * back into a valid {@link ProjectMetadata}. Silent re-tag would lose the
 * project's existing identity and downstream history; the caller must
 * decide between recovering the file (from backup, manual edit) or
 * accepting the project as new by deleting the file.
 */
export class ProjectMetadataCorruptError extends Error {
  readonly filePath: string;
  constructor(filePath: string, reason: string) {
    super(
      `project.json at ${filePath} exists but is not a valid identity file (${reason}); ` +
        `refusing to re-tag — that would lose this project's spend, findings, and build history. ` +
        `Restore from backup, or delete the file to claim a new identity.`,
    );
    this.name = 'ProjectMetadataCorruptError';
    this.filePath = filePath;
  }
}

export interface LoadOrCreateOptions {
  /** Override the wall clock; tests use this to make `createdAt` deterministic. */
  now?: () => Date;
  /** Override ULID generation; tests use this to assert against a known id. */
  generateId?: () => string;
  /**
   * Seed the `metadata` object when creating a brand-new file. Ignored when
   * the file already exists (existing identity must not be silently rewritten).
   * Use this from `factory init` to record per-project flags at creation time
   * (e.g. `{ language: 'node' }` per ADR 0026).
   */
  initialMetadata?: Record<string, unknown>;
}

/**
 * Read `<projectPath>/.factory/project.json` (canonical project identity)
 * or create one if absent. Returns the resolved metadata.
 *
 * Behaviour:
 *   - File exists and parses cleanly → returns parsed metadata. The project
 *     keeps its existing identity; nothing on disk changes.
 *   - File absent → generates a fresh ULID, writes the file atomically,
 *     returns the new metadata. The project claims a new identity.
 *   - File exists but does not parse → throws
 *     {@link ProjectMetadataCorruptError}. Never silently re-tags.
 *
 * `projectPath` is the project root (the directory that contains
 * `.factory/`). Callers from the directive-creation path typically have
 * `<workspace>/<project>` already joined.
 */
export async function loadOrCreateProjectMetadata(
  projectPath: string,
  projectName: string,
  opts: LoadOrCreateOptions = {},
): Promise<ProjectMetadata> {
  const now = opts.now ?? ((): Date => new Date());
  const generateId = opts.generateId ?? newId;
  const factoryDir = join(projectPath, '.factory');
  const filePath = join(factoryDir, 'project.json');

  let raw: string | undefined;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }

  if (raw !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ProjectMetadataCorruptError(filePath, `invalid JSON: ${(err as Error).message}`);
    }
    const validated = validateMetadataOrReason(parsed);
    if (typeof validated === 'string') {
      throw new ProjectMetadataCorruptError(filePath, validated);
    }
    log.debug(
      { filePath, projectId: validated.id, projectName: validated.name },
      'project.json: existing identity adopted',
    );
    return validated;
  }

  const meta: ProjectMetadata = {
    id: generateId(),
    name: projectName,
    createdAt: now().toISOString(),
    factoryVersion: PROJECT_FILE_VERSION,
    metadata: opts.initialMetadata ?? {},
  };
  await mkdir(factoryDir, { recursive: true });
  await writeFileAtomic(filePath, `${JSON.stringify(meta, null, 2)}\n`);
  log.info({ filePath, projectId: meta.id, projectName }, 'project.json: new identity claimed');
  return meta;
}

/**
 * Resolve metadata read-only — does not create the file. Returns
 * `undefined` when the file is absent. Throws
 * {@link ProjectMetadataCorruptError} on a present-but-invalid file.
 *
 * Used by callers that want to inspect identity without claiming a new one
 * (e.g. status / list flows that report "this workspace has no project
 * file" rather than tagging it).
 */
export async function readProjectMetadata(
  projectPath: string,
): Promise<ProjectMetadata | undefined> {
  const filePath = join(projectPath, '.factory', 'project.json');
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ProjectMetadataCorruptError(filePath, `invalid JSON: ${(err as Error).message}`);
  }
  const validated = validateMetadataOrReason(parsed);
  if (typeof validated === 'string') {
    throw new ProjectMetadataCorruptError(filePath, validated);
  }
  return validated;
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Validate parsed JSON against the {@link ProjectMetadata} shape.
 * Returns the validated object on success, or a short reason string on
 * failure (which the caller wraps in {@link ProjectMetadataCorruptError}).
 *
 * Hand-validated rather than Zod-ed because the file is read at every
 * directive-creation path — keeping this dependency-light is worth the
 * handful of explicit checks.
 */
function validateMetadataOrReason(raw: unknown): ProjectMetadata | string {
  if (typeof raw !== 'object' || raw === null) return 'not an object';
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !ULID_RE.test(obj.id)) return 'id missing or not a ULID';
  if (typeof obj.name !== 'string' || obj.name.length === 0) return 'name missing or empty';
  if (typeof obj.createdAt !== 'string' || obj.createdAt.length === 0) {
    return 'createdAt missing or empty';
  }
  if (typeof obj.factoryVersion !== 'string' || obj.factoryVersion.length === 0) {
    return 'factoryVersion missing or empty';
  }
  const metadata =
    typeof obj.metadata === 'object' && obj.metadata !== null && !Array.isArray(obj.metadata)
      ? (obj.metadata as Record<string, unknown>)
      : {};
  return {
    id: obj.id,
    name: obj.name,
    createdAt: obj.createdAt,
    factoryVersion: obj.factoryVersion,
    metadata,
  };
}

/**
 * Atomic-ish file write following the existing pattern in
 * `wiki/src/findings.ts` — Windows rename does not atomically replace,
 * so we write twice (temp + final) and best-effort-clear the temp.
 */
async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, contents, 'utf8');
  await writeFile(filePath, contents, 'utf8');
  try {
    await writeFile(tmp, '', 'utf8');
  } catch {
    /* best-effort cleanup */
  }
}
