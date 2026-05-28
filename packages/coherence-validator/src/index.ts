/**
 * @factory5/coherence-validator — entry point.
 *
 * Validates the project's knowledge graph. Phase A ships schema +
 * reference integrity checks; Phase B adds doc-fiction + dead-code.
 */

export {
  validateKnowledgeGraph,
  type ValidateOptions,
  type ValidationResult,
} from './validator.js';
export { type PartialFinding } from './schema-check.js';
export { type FeatureEntry, type ReferenceCheckContext } from './reference-check.js';
