/**
 * `@factory5/worker-sandbox` — worker filesystem-scoping gate.
 *
 * Implements ADR 0028. The hook script entry lives at `./hook-runtime`
 * (loaded as a subprocess by claude-cli; not imported in-process).
 *
 * @packageDocumentation
 */

export {
  evaluateToolCall,
  type EvaluateInput,
  type EvaluateOptions,
} from './evaluate-tool-call.js';

export { normaliseForCompare, pathInsideAny, resolveAgainst } from './path-prefix.js';

export {
  buildHookCommand,
  buildSandboxSettings,
  getHookScriptPath,
  writeWorktreeSandbox,
  type WrittenSandbox,
} from './settings.js';

export {
  GATED_TOOL_NAMES,
  type EvaluationResult,
  type GatedToolName,
  type HookInput,
  type HookOutput,
  type WorkerSandboxConfig,
} from './types.js';
