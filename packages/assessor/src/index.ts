/**
 * @factory5/assessor — ground-truth project assessment.
 *
 * No LLM is involved. Every check is a real subprocess, real file read, or
 * real git query. Agents cannot fabricate a pass — that's the whole point.
 *
 * @packageDocumentation
 */

export * from './types.js';
export * from './assess.js';
export * from './runners/pytest.js';
export * from './runners/imports.js';
export * from './artifacts.js';
