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

import {
  newId,
  projectBudgetDefaultsSchema,
  projectMetadataSchema,
  type DirectiveLimits,
  type ProjectBudgetDefaults,
} from '@factory5/core';
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
 * Recognised assessor runtimes (mirrors `@factory5/assessor`'s `Runtime`
 * union). Inlined here to avoid a wiki → assessor dependency for a single
 * literal type; both packages stay in sync because the union is enumerated
 * in `pickLanguageFromMeta` below and tested at the boundary.
 */
export type ProjectLanguage = 'python' | 'node' | 'go' | 'rust';

/**
 * Read the per-project language recorded by `factory init <project>`
 * (Phase 10.8) or any other writer that lands a value in
 * `metadata.language`. Returns `undefined` when the metadata key is
 * absent or carries an unrecognised value — callers fall through to
 * the next language-resolution tier (CLI flag, assessor default).
 *
 * Single source of truth for the language read shared by the CLI's
 * `factory build` and the web UI's `POST /api/v1/builds` (ADR 0027).
 */
export function languageFromProjectMeta(meta: ProjectMetadata): ProjectLanguage | undefined {
  const raw = meta.metadata['language'];
  if (raw === 'python' || raw === 'node' || raw === 'go' || raw === 'rust') return raw;
  return undefined;
}

/**
 * Read the per-project budget defaults written by the Web UI's
 * `PUT /api/v1/projects/:id/budget` route (ADR 0027 §4). Returns
 * `undefined` when the `budgetDefaults` key is absent or doesn't parse
 * against {@link projectBudgetDefaultsSchema} — callers fall through
 * to the next budget-resolution tier (instance config, then unlimited).
 *
 * Mirrors {@link languageFromProjectMeta}'s shape; both helpers share
 * the silent-fallback-on-malformed contract so a stray edit to
 * project.json doesn't crash a build.
 */
export function budgetDefaultsFromProjectMeta(
  meta: ProjectMetadata,
): ProjectBudgetDefaults | undefined {
  const raw = meta.metadata['budgetDefaults'];
  const parsed = projectBudgetDefaultsSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Resolve a directive's `limits` from the three known tiers, per ADR 0027 §4
 * resolution order:
 *
 *   `explicitFlags` → `projectDefaults` → `configDefaults` → unlimited
 *
 * Per-field independent — `--max-usd 5` can apply even when the project's
 * `metadata.budgetDefaults.maxSteps` is set. Returns `undefined` when no
 * tier supplies any field (the unlimited path; brain treats absent
 * `limits` as no cap).
 *
 * Single source of truth shared by every directive-creation path
 * (`factory build`, `POST /api/v1/builds`, Telegram inbound `/build`,
 * Discord inbound `/build`) so a future tier-shape change lands in one
 * file. Issue I009 is the regression that motivated extracting this:
 * Telegram + Discord plugins were creating directives with no `limits`
 * because they never reached this resolution.
 */
export function resolveDirectiveLimits(opts: {
  /** Per-invocation overrides (e.g. CLI `--max-usd` flag, web body). */
  explicitFlags?: { maxUsd?: number | undefined; maxSteps?: number | undefined } | undefined;
  /** Per-project tier (Web UI–writable). Read with {@link budgetDefaultsFromProjectMeta}. */
  projectDefaults?: ProjectBudgetDefaults | undefined;
  /** Instance config tier (`config.toml [budget.defaults]`). */
  configDefaults?: { maxUsd?: number | undefined; maxSteps?: number | undefined } | undefined;
}): DirectiveLimits | undefined {
  const maxUsdRaw =
    opts.explicitFlags?.maxUsd ?? opts.projectDefaults?.maxUsd ?? opts.configDefaults?.maxUsd;
  const maxStepsRaw =
    opts.explicitFlags?.maxSteps ?? opts.projectDefaults?.maxSteps ?? opts.configDefaults?.maxSteps;
  // 0 is the documented "unlimited" sentinel for budgetsSchema (ADR 0035 §6),
  // but directiveLimitsSchema uses `.positive()` and rejects 0 — so passing a
  // stored `maxUsd: 0` / `maxSteps: 0` through would make directiveSchema.parse
  // throw a ZodError and crash every mint path. Normalize the sentinel to
  // "absent = no cap" here, at the single resolution chokepoint shared by all
  // four directive-creation surfaces.
  const maxUsd = maxUsdRaw === 0 ? undefined : maxUsdRaw;
  const maxSteps = maxStepsRaw === 0 ? undefined : maxStepsRaw;
  if (maxUsd === undefined && maxSteps === undefined) return undefined;
  return {
    ...(maxUsd !== undefined ? { maxUsd } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
  };
}

/**
 * Thrown by {@link updateProjectMetadata} when the project directory has
 * no `.factory/project.json` to update. The Web UI's budget route
 * (ADR 0027 §3) maps this to `404 PROJECT_PATH_UNREADABLE` — the project
 * is in the registry but the workspace path no longer carries the
 * identity file (moved or deleted out-of-band).
 */
export class ProjectMetadataNotFoundError extends Error {
  readonly projectPath: string;
  readonly filePath: string;
  constructor(projectPath: string) {
    const filePath = join(projectPath, '.factory', 'project.json');
    super(`project.json not found at ${filePath} — project may have been moved or deleted`);
    this.name = 'ProjectMetadataNotFoundError';
    this.projectPath = projectPath;
    this.filePath = filePath;
  }
}

/**
 * Read-modify-write cycle on `<projectPath>/.factory/project.json`.
 * Reads via {@link readProjectMetadata} (throws
 * {@link ProjectMetadataCorruptError} on a present-but-invalid file,
 * {@link ProjectMetadataNotFoundError} when absent), applies `mutate`,
 * writes back atomically. Returns the mutated metadata.
 *
 * Used by the Web UI's `PUT /api/v1/projects/:id/budget` (ADR 0027) to
 * land per-project `metadata.budgetDefaults` updates. Other future
 * `metadata.*` writers should reuse this helper rather than open-coding
 * the read-modify-write — keeps the atomic-write pattern in one place.
 *
 * The mutator is given the parsed metadata and should return a new
 * {@link ProjectMetadata} (deep copy if it wants to preserve referential
 * stability for the input — the helper does not enforce immutability).
 */
export async function updateProjectMetadata(
  projectPath: string,
  mutate: (meta: ProjectMetadata) => ProjectMetadata,
): Promise<ProjectMetadata> {
  const existing = await readProjectMetadata(projectPath);
  if (existing === undefined) {
    throw new ProjectMetadataNotFoundError(projectPath);
  }
  const updated = mutate(existing);
  const filePath = join(projectPath, '.factory', 'project.json');
  await writeFileAtomic(filePath, `${JSON.stringify(updated, null, 2)}\n`);
  log.info(
    { filePath, projectId: updated.id, projectName: updated.name },
    'project.json: metadata updated',
  );
  return updated;
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

/**
 * Write a {@link ProjectMetadata} object to `<projectPath>/.factory/project.json`.
 *
 * Validates the metadata bag via {@link projectMetadataSchema} from
 * `@factory5/core` before writing — both the read and write paths now share
 * the same Zod schema (single source of truth; see issue S1 / dual-validators).
 *
 * Throws a Zod `ZodError` when the metadata fails schema validation (e.g.
 * `autoIncreaseCeilingMultiplier: -1`). Creates the `.factory/` directory if
 * absent.
 */
export async function writeProjectMetadata(
  projectPath: string,
  meta: ProjectMetadata,
): Promise<ProjectMetadata> {
  // Validate through the typed Zod schema — catches malformed scalars at write time.
  projectMetadataSchema.parse(meta);
  const factoryDir = join(projectPath, '.factory');
  await mkdir(factoryDir, { recursive: true });
  const filePath = join(factoryDir, 'project.json');
  await writeFileAtomic(filePath, `${JSON.stringify(meta, null, 2)}\n`);
  log.info({ filePath, projectId: meta.id, projectName: meta.name }, 'project.json: written');
  return meta;
}

/**
 * Validate parsed JSON against the {@link ProjectMetadata} shape via the
 * canonical Zod schema ({@link projectMetadataSchema} from `@factory5/core`).
 * Returns the validated object on success, or a short reason string on
 * failure (which the caller wraps in {@link ProjectMetadataCorruptError}).
 *
 * Single source of truth — both the read and write paths now share the same
 * schema. Previously the read path used a hand-rolled validator that could
 * drift from the write path's Zod parse (see issue S1 / dual-validators).
 */
function validateMetadataOrReason(raw: unknown): ProjectMetadata | string {
  const result = projectMetadataSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    return first ? `${first.path.join('.')}: ${first.message}` : 'unknown validation error';
  }
  const data = result.data;
  return {
    id: data.id,
    name: data.name,
    createdAt: data.createdAt,
    factoryVersion: data.factoryVersion,
    metadata: (data.metadata as Record<string, unknown> | undefined) ?? {},
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
