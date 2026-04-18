/**
 * @factory5/brain — orchestrator.
 *
 * Phase 1 implementation will add the inline-build path; Phase 3 adds serve
 * (claim-from-SQLite). For now this exports the agent registry shape so
 * consumers can typecheck-import.
 *
 * @packageDocumentation
 */

export * from './agents/registry.js';
export { runBrain } from './loop.js';
export type { BrainOptions, BrainHandle } from './loop.js';
