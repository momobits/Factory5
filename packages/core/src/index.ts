/**
 * @factory5/core — shared types, schemas, and constants.
 *
 * Single source of truth for all data shapes that cross package boundaries.
 * Types are derived from Zod schemas via `z.infer` to prevent drift.
 *
 * @packageDocumentation
 */

export * from './budget-defaults.js';
export * from './constants.js';
export * from './schemas.js';
export * from './types.js';
export * from './ulid.js';
