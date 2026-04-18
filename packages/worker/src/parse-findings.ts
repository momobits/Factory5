/**
 * Parse `FINDING [SEV] target: description` markers from agent output.
 *
 * Marker grammar (case-insensitive on the severity):
 *   FINDING [LOW|MEDIUM|HIGH|CRITICAL] <target>: <description>
 *
 * Description may span multiple lines; a new finding starts at the next
 * top-level `FINDING [` line or at end of text.
 */

import type { Severity } from '@factory5/core';

export interface ParsedFinding {
  severity: Severity;
  target: string;
  description: string;
}

const HEADER_RE = /^FINDING\s*\[(LOW|MEDIUM|HIGH|CRITICAL)\]\s+([^:\n]+?):\s*(.*)$/im;

export function parseFindings(text: string): ParsedFinding[] {
  const results: ParsedFinding[] = [];
  const lines = text.split(/\r?\n/);
  let current: ParsedFinding | undefined;
  const descLines: string[] = [];

  const flush = (): void => {
    if (current === undefined) return;
    const desc = [current.description, ...descLines].join('\n').trim();
    results.push({ ...current, description: desc });
    current = undefined;
    descLines.length = 0;
  };

  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m !== null) {
      flush();
      current = {
        severity: (m[1] ?? 'LOW').toUpperCase() as Severity,
        target: (m[2] ?? '').trim(),
        description: (m[3] ?? '').trim(),
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
