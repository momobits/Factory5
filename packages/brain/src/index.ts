/**
 * @factory5/brain — orchestrator: triage → architect → plan → delegate → verify.
 *
 * Phase 1 wires the inline-build path (see {@link runBrain}). Phase 3 adds
 * the long-running serve loop.
 *
 * @packageDocumentation
 */

export * from './agents/registry.js';
export * from './loop.js';
export * from './triage.js';
export * from './architect.js';
export * from './planner.js';
export * from './prompts.js';
export * from './provider-config.js';
export * from './serve.js';
export * from './config.js';
export * from './usage.js';
