/**
 * @factory5/assessor — ground-truth project assessment.
 *
 * No LLM is involved. Every check is a real subprocess, real file read, or
 * real git query. Agents cannot fabricate a pass — that's the whole point.
 *
 * Language-pluggable per ADR 0026: the assessor dispatches on
 * `AssessOptions.runtime` to a registered {@link RuntimeAssessor}
 * (`pythonRuntime`, `nodeRuntime`, …) before the runtime-neutral artifact
 * / module / git checks run.
 *
 * @packageDocumentation
 */

export * from './types.js';
export * from './assess.js';
export * from './runners/pytest.js';
export * from './runners/imports.js';
export * from './artifacts.js';
export { pythonRuntime } from './runtimes/python.js';
export { nodeRuntime, buildNodeRuntime, parseNodeTestSummary } from './runtimes/node.js';
export {
  goRuntime,
  buildGoRuntime,
  parseGoTestSummary,
  countListedGoTests,
} from './runtimes/go.js';
export { rustRuntime, buildRustRuntime, parseCargoTestSummary } from './runtimes/rust.js';
