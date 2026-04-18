/**
 * `BUILD.md` management — human-readable findings table + timestamped decision
 * / progress log. Mirrors `findings.json` but is the thing humans read.
 */

import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename } from 'node:path';

import type { Finding } from '@factory5/core';
import { createLogger } from '@factory5/logger';

import { listFindings } from './findings.js';
import { projectPaths } from './paths.js';

const log = createLogger('wiki.build-log');

const HEADER =
  '# BUILD.md\n\n> Generated & appended-to by factory. The finding table is rebuilt from `.factory/findings.json`; the log section is append-only.\n';
const FINDINGS_SECTION = '## Findings';
const LOG_SECTION = '## Log';

function renderFindingsTable(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return `${FINDINGS_SECTION}\n\n_No findings yet._\n`;
  }
  const lines: string[] = [
    FINDINGS_SECTION,
    '',
    '| ID | Severity | Status | Source | Target | Description |',
    '|----|----------|--------|--------|--------|-------------|',
  ];
  for (const f of findings) {
    const desc = f.description.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${f.id} | ${f.severity} | ${f.status} | ${f.source} | ${f.target} | ${desc} |`);
  }
  lines.push('');
  return lines.join('\n');
}

async function ensureBuildMd(buildMdPath: string): Promise<string> {
  try {
    return await readFile(buildMdPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    await mkdir(dirname(buildMdPath), { recursive: true });
    const initial = `${HEADER}\n${FINDINGS_SECTION}\n\n_No findings yet._\n\n${LOG_SECTION}\n\n`;
    await writeFile(buildMdPath, initial, 'utf8');
    return initial;
  }
}

/**
 * Rebuild the `## Findings` table from the current state of `findings.json`.
 * Leaves the `## Log` section intact.
 */
export async function rebuildFindingsTable(projectPath: string): Promise<void> {
  const { buildMd } = projectPaths(projectPath);
  const current = await ensureBuildMd(buildMd);
  const findings = await listFindings(projectPath);
  const newTable = renderFindingsTable(findings);

  const findingsIdx = current.indexOf(FINDINGS_SECTION);
  const logIdx = current.indexOf(LOG_SECTION);

  let rebuilt: string;
  if (findingsIdx === -1) {
    rebuilt = `${current}\n${newTable}\n`;
  } else if (logIdx === -1 || logIdx < findingsIdx) {
    rebuilt = `${current.slice(0, findingsIdx)}${newTable}\n`;
  } else {
    rebuilt = `${current.slice(0, findingsIdx)}${newTable}\n${current.slice(logIdx)}`;
  }

  await writeFile(buildMd, rebuilt, 'utf8');
  log.debug({ projectPath, buildMd: basename(buildMd) }, 'BUILD.md findings table rebuilt');
}

/**
 * Append an entry to the `## Log` section. Each entry is prefixed with an
 * ISO timestamp.
 */
export async function appendBuildLog(
  projectPath: string,
  entry: string,
  now: Date = new Date(),
): Promise<void> {
  const { buildMd } = projectPaths(projectPath);
  await ensureBuildMd(buildMd);
  const line = `- \`${now.toISOString()}\` — ${entry.replace(/\n/g, ' ')}\n`;
  await appendFile(buildMd, line, 'utf8');
}
