/**
 * Parse `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): <prose>` markers from
 * agent output. Mirrors {@link parseFindings}'s shape — line-anchored
 * header regex with multi-line description capture.
 *
 * Marker grammar (case-insensitive on the keyword and the status):
 *
 *     RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): <description>
 *
 * Where `<FID>` is `F<digits>` per the project-scoped finding ID
 * convention (`@factory5/core` `findingId`). Description may span
 * multiple lines; a new resolution starts at the next top-level
 * `RESOLUTION` line, a blank line, or end of text.
 *
 * The fixer agent is the canonical emitter (per
 * `prompts/agents/fixer.md`); other agents typically do not emit
 * RESOLUTION markers, but the parser runs on every agent's output to
 * stay future-proof — output without markers returns `[]`.
 *
 * Strict by design: missing parens around the status, missing colon,
 * status outside the enum, FID without the `F` prefix, or RESOLUTION
 * mentioned mid-line all reject. The fixer prompt documents the exact
 * shape; loose matching would create silent false-positive flips.
 */

import type { FindingStatus } from '@factory5/core';

export type ResolutionStatus = Extract<FindingStatus, 'FIXED' | 'VERIFIED' | 'WONTFIX'>;

export interface ParsedResolution {
  fid: string;
  status: ResolutionStatus;
  resolution: string;
}

const HEADER_RE = /^RESOLUTION\s+(F\d+)\s+\((FIXED|VERIFIED|WONTFIX)\):\s*(.*)$/im;

export function parseResolutions(text: string): ParsedResolution[] {
  const results: ParsedResolution[] = [];
  const lines = text.split(/\r?\n/);
  let current: ParsedResolution | undefined;
  const descLines: string[] = [];

  const flush = (): void => {
    if (current === undefined) return;
    const desc = [current.resolution, ...descLines].join('\n').trim();
    results.push({ ...current, resolution: desc });
    current = undefined;
    descLines.length = 0;
  };

  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m !== null) {
      flush();
      current = {
        fid: (m[1] ?? '').trim(),
        status: (m[2] ?? 'FIXED').toUpperCase() as ResolutionStatus,
        resolution: (m[3] ?? '').trim(),
      };
      continue;
    }
    if (current !== undefined && line.trim().length > 0) {
      descLines.push(line);
    } else if (current !== undefined && line.trim().length === 0 && descLines.length > 0) {
      flush();
    }
  }
  flush();
  return results;
}
