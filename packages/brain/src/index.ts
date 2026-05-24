/**
 * @factory5/brain — orchestrator: triage → architect → plan → delegate → verify.
 *
 * Phase 1 wires the inline-build path (see {@link runBrain}). Phase 3 adds
 * the long-running serve loop.
 *
 * @packageDocumentation
 */

export * from './agents/registry.js';
export * from './ask-user.js';
export * from './auto-answer.js';
export * from './cancellation.js';
export * from './loop.js';
export * from './triage.js';
export * from './architect.js';
// `runWikiCritic` (critic.ts) intentionally not exported here — consumed internally by
// runArchitectWithCritique in architect-loop.ts (Task 7, ADR 0033).
export * from './planner.js';
export * from './prompts.js';
export * from './provider-config.js';
export * from './serve.js';
export * from './config.js';
export * from './daemon-endpoint.js';
export * from './pool-usage.js';
export * from './usage.js';
