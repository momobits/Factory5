/**
 * @factory5/coherence-validator — entry point.
 *
 * Validates the project's knowledge graph. Phase A ships schema +
 * reference integrity checks; Phase B adds doc-fiction + dead-code
 * via the validator config (shipped default → project override
 * three-tier resolution).
 */

export {
  validateKnowledgeGraph,
  type ValidateOptions,
  type ValidationResult,
} from './validator.js';
export { type PartialFinding } from './schema-check.js';
export { type FeatureEntry, type ReferenceCheckContext } from './reference-check.js';
export {
  loadValidatorConfig,
  type LoadConfigOptions,
  type LoadConfigResult,
} from './config-loader.js';
export { validatorConfigSchema, type ValidatorConfig } from './config-schema.js';
