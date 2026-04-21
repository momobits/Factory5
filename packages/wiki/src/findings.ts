/**
 * Finding lifecycle — `<project>/.factory/findings.json` is the source of
 * truth; {@link appendBuildLog} keeps the `BUILD.md` table in sync for
 * human readers.
 *
 * Findings use `F001`, `F002`, ... IDs scoped to a project (see
 * {@link findingId} in `@factory5/core`).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { findingId, findingSchema, type Finding, type FindingStatus } from '@factory5/core';
import { createLogger } from '@factory5/logger';
import { findingsRegistry, type Database } from '@factory5/state';
import { z } from 'zod';

import { projectPaths } from './paths.js';

const log = createLogger('wiki.findings');

const findingsFileSchema = z.object({
  nextSequence: z.number().int().positive().default(1),
  findings: z.array(findingSchema).default([]),
});

type FindingsFile = z.infer<typeof findingsFileSchema>;

async function loadFile(path: string): Promise<FindingsFile> {
  try {
    const raw = await readFile(path, 'utf8');
    return findingsFileSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { nextSequence: 1, findings: [] };
    }
    throw err;
  }
}

async function writeFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, contents, 'utf8');
  // On Windows, rename fails if target exists; write+replace via truncate-write for cross-platform simplicity.
  await writeFile(path, contents, 'utf8');
  try {
    await writeFile(tmp, '', 'utf8');
  } catch {
    /* best-effort cleanup */
  }
}

export interface AddFindingInput {
  source: Finding['source'];
  target: string;
  severity: Finding['severity'];
  description: string;
  /** If omitted, uses current ISO timestamp. */
  createdAt?: string;
  /** Initial status — defaults to `OPEN`. */
  status?: FindingStatus;
  /**
   * Mark the finding advisory (doesn't contribute to the gate — see ADR 0018).
   * When omitted, `source === 'verifier'` defaults to `true`; every other
   * source defaults to blocking (`advisory` field omitted entirely).
   */
  advisory?: boolean;
}

/**
 * Optional binding to the cross-project `findings_registry` (Phase 6a).
 * When supplied, {@link addFinding} and {@link updateFindingStatus}
 * dual-write: the per-project `findings.json` remains the source of
 * truth and the registry row is upserted best-effort afterwards. A
 * registry failure logs a warning but does not fail the per-project
 * write — the backfill (6a.5) is the recovery path.
 */
export interface FindingRegistryBinding {
  db: Database;
  /** Stable project handle — defaults to `basename(projectPath)`. */
  projectId?: string;
  /** Directive that raised this finding; recorded as `origin_directive_id`. */
  originDirectiveId?: string;
}

function mirrorToRegistry(
  finding: Finding,
  projectPath: string,
  registry: FindingRegistryBinding,
): void {
  try {
    findingsRegistry.upsert(registry.db, {
      projectId: registry.projectId ?? basename(projectPath),
      projectPath,
      finding,
      ...(registry.originDirectiveId !== undefined
        ? { originDirectiveId: registry.originDirectiveId }
        : {}),
    });
  } catch (err) {
    log.warn(
      { err, projectPath, id: finding.id },
      'wiki.findings: registry mirror failed — per-project file still authoritative',
    );
  }
}

/**
 * Resolve the `advisory` flag for a new finding. Verifier-sourced findings
 * default to advisory (ADR 0018); callers may override explicitly. Returns
 * `true` only when the resulting finding should carry the flag — consumers
 * write `advisory: true` to JSON only, leaving the field absent for the
 * blocking default so JSON stays small.
 */
function resolveAdvisory(input: AddFindingInput): boolean | undefined {
  if (input.advisory !== undefined) return input.advisory ? true : undefined;
  return input.source === 'verifier' ? true : undefined;
}

/**
 * Append a new finding. Assigns the next sequential ID and writes the
 * updated `findings.json`. Returns the assigned finding.
 *
 * When `registry` is supplied, the finding is also upserted into the
 * cross-project `findings_registry` (Phase 6a) on a best-effort basis —
 * registry failures log a warning and do not fail the per-project
 * write.
 */
export async function addFinding(
  projectPath: string,
  input: AddFindingInput,
  registry?: FindingRegistryBinding,
): Promise<Finding> {
  const { findings } = projectPaths(projectPath);
  const file = await loadFile(findings);
  const id = findingId(file.nextSequence);
  const advisory = resolveAdvisory(input);
  const newFinding: Finding = {
    id,
    source: input.source,
    target: input.target,
    severity: input.severity,
    status: input.status ?? 'OPEN',
    description: input.description,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(advisory === true ? { advisory: true } : {}),
  };
  findingSchema.parse(newFinding);
  const updated: FindingsFile = {
    nextSequence: file.nextSequence + 1,
    findings: [...file.findings, newFinding],
  };
  await writeFileAtomic(findings, JSON.stringify(updated, null, 2));
  if (registry !== undefined) {
    mirrorToRegistry(newFinding, projectPath, registry);
  }
  log.info(
    { projectPath, id, severity: newFinding.severity, advisory: advisory === true },
    'finding added',
  );
  return newFinding;
}

/**
 * Predicate: does this finding contribute to the gate? Advisory findings
 * (per ADR 0018) do not — they are operator-facing informational signal only.
 * Use this helper so every consumer has a single definition of the rule.
 */
export function isAdvisory(f: Finding): boolean {
  return f.advisory === true;
}

/**
 * Update a finding's status (+ optional resolution note). Sets `resolvedAt`
 * automatically when transitioning to `FIXED`, `VERIFIED`, or `WONTFIX`.
 *
 * When `registry` is supplied, the updated finding is also upserted
 * into the cross-project `findings_registry` (Phase 6a) on a
 * best-effort basis.
 */
export async function updateFindingStatus(
  projectPath: string,
  id: string,
  status: FindingStatus,
  resolution?: string,
  registry?: FindingRegistryBinding,
): Promise<Finding> {
  const { findings } = projectPaths(projectPath);
  const file = await loadFile(findings);
  const idx = file.findings.findIndex((f) => f.id === id);
  if (idx === -1) {
    throw new Error(`updateFindingStatus: no finding with id ${id}`);
  }
  const prev = file.findings[idx] as Finding;
  const isTerminal = status === 'FIXED' || status === 'VERIFIED' || status === 'WONTFIX';
  const next: Finding = {
    ...prev,
    status,
    ...(resolution !== undefined ? { resolution } : {}),
    ...(isTerminal && prev.resolvedAt === undefined
      ? { resolvedAt: new Date().toISOString() }
      : {}),
  };
  findingSchema.parse(next);
  const nextList = [...file.findings];
  nextList[idx] = next;
  const updated: FindingsFile = { nextSequence: file.nextSequence, findings: nextList };
  await writeFileAtomic(findings, JSON.stringify(updated, null, 2));
  if (registry !== undefined) {
    mirrorToRegistry(next, projectPath, registry);
  }
  log.info({ projectPath, id, status }, 'finding updated');
  return next;
}

export interface ListFindingsFilter {
  status?: FindingStatus | FindingStatus[];
  source?: Finding['source'];
}

/** List findings, optionally filtered. Returns chronological order. */
export async function listFindings(
  projectPath: string,
  filter: ListFindingsFilter = {},
): Promise<Finding[]> {
  const { findings } = projectPaths(projectPath);
  const file = await loadFile(findings);
  const wantStatuses: FindingStatus[] | undefined =
    filter.status === undefined
      ? undefined
      : Array.isArray(filter.status)
        ? filter.status
        : [filter.status];
  return file.findings.filter((f) => {
    if (wantStatuses !== undefined && !wantStatuses.includes(f.status)) return false;
    if (filter.source !== undefined && f.source !== filter.source) return false;
    return true;
  });
}

/** Get a single finding by id, or `undefined`. */
export async function getFinding(projectPath: string, id: string): Promise<Finding | undefined> {
  const { findings } = projectPaths(projectPath);
  const file = await loadFile(findings);
  return file.findings.find((f) => f.id === id);
}
