/**
 * @factory5/wiki — per-project markdown state operations.
 *
 * Phase 1 implementation will add the read/write API. For now this is a
 * scaffold so consumers can typecheck-import the package.
 *
 * @packageDocumentation
 */

import { createLogger } from '@factory5/logger';

const log = createLogger('wiki');

/** Marker — replace with the real API in Phase 1. */
export function wikiNotYetImplemented(): never {
  log.error('@factory5/wiki API not yet implemented');
  throw new Error('@factory5/wiki API not yet implemented (Phase 1)');
}
