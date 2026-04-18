/**
 * ID generation — ULIDs (time-sortable, 26-char Crockford base32).
 *
 * ULIDs sort by creation time, are URL-safe, and have no central coordinator
 * (collision risk is cryptographically negligible). Used for every directive,
 * event, task, plan, and message ID in factory5.
 */

import { ulid } from 'ulid';

/**
 * Generate a fresh ULID.
 *
 * @returns A 26-character ULID string, lexicographically sortable by creation time.
 *
 * @example
 * ```ts
 * const id = newId(); // "01HQXM5ZK3..."
 * ```
 */
export function newId(): string {
  return ulid();
}

/**
 * Generate a finding ID for a project-scoped sequence.
 *
 * Findings use a different scheme (F001, F002, ...) for human readability in
 * BUILD.md tables. The caller is responsible for tracking the sequence per
 * project (typically via a counter in `findings.json`).
 *
 * @param sequence - The next sequence number (1-based).
 * @returns A finding ID like "F001".
 */
export function findingId(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`findingId sequence must be a positive integer, got ${String(sequence)}`);
  }
  return `F${String(sequence).padStart(3, '0')}`;
}
