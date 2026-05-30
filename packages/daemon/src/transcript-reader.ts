/**
 * Reads NDJSON transcript files with pagination and level filtering.
 *
 * Transcript files are produced by the worker heartbeat subsystem (Task 6)
 * and stored at `.factory/transcripts/<taskId>.ndjson`. Each line is a
 * self-contained JSON object emitted by the worker's tool-use / result
 * pipeline.
 *
 * Three levels:
 *   - `full`   — every line (no filter).
 *   - `tools`  — only tool_use, tool_result, and result lines.
 *   - `errors` — only error / is_error lines and result lines.
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** Options for {@link readTranscriptLines}. */
export interface ReadTranscriptOpts {
  /** Number of matching lines to skip before collecting. */
  offset: number;
  /** Maximum number of lines to return. */
  limit: number;
  /** Level filter applied to each NDJSON line. */
  level: 'full' | 'tools' | 'errors';
}

/**
 * Read and filter NDJSON transcript lines with offset/limit pagination.
 *
 * @param filePath - Absolute path to the `.ndjson` transcript file.
 * @param opts     - Pagination and level-filter options.
 * @returns Parsed lines and the total count of lines matching the filter.
 */
export async function readTranscriptLines(
  filePath: string,
  opts: ReadTranscriptOpts,
): Promise<{ lines: unknown[]; total: number }> {
  const rl = createInterface({
    input: createReadStream(filePath, 'utf8'),
    crlfDelay: Infinity,
  });
  const lines: unknown[] = [];
  let matchIndex = 0;
  let total = 0;

  for await (const raw of rl) {
    total++;
    if (opts.level !== 'full') {
      const isToolLine = raw.includes('"type":"tool_use"') || raw.includes('"type":"tool_result"');
      const isResultLine = raw.includes('"type":"result"');
      const isErrorLine = raw.includes('"is_error":true') || raw.includes('"error"');
      if (opts.level === 'tools' && !isToolLine && !isResultLine) continue;
      if (opts.level === 'errors' && !isErrorLine && !isResultLine) continue;
    }
    if (matchIndex >= opts.offset && lines.length < opts.limit) {
      try {
        lines.push(JSON.parse(raw));
      } catch {
        lines.push({ raw });
      }
    }
    matchIndex++;
  }

  return { lines, total };
}
