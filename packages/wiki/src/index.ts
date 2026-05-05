/**
 * @factory5/wiki — per-project markdown wiki + BUILD.md + findings ops.
 *
 * All project state lives in files (see ADR 0003). This package is the typed
 * read/write API consumed by brain agents and the CLI.
 *
 * @packageDocumentation
 */

export * from './paths.js';
export * from './wiki.js';
export * from './findings.js';
export * from './build-log.js';
export * from './plan.js';
export * from './readiness.js';
export * from './project-metadata.js';
export * from './project-resolver.js';
export * from './create-project.js';
