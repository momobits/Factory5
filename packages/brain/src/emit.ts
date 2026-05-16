/**
 * Brain → SSE-hub event emitters. Extracted from `loop.ts` so per-stage
 * modules (`architect.ts`, `planner.ts`, `pool.ts`) can import without
 * the loop ↔ stage circular dependency. ADR 0031 — log-forwarder design.
 *
 * Both helpers are fire-and-forget: emit failures don't propagate. When
 * `emit` is `undefined` (CLI inline runs, tests without a hub) the call
 * is silent. The brain's `index.ts` re-exports `emitLogLine` for tests
 * that wired it directly; the integration call sites use these as
 * internal helpers rather than a public API surface.
 */

import type { Directive } from '@factory5/core';
import type { DirectiveEventEmitter } from '@factory5/ipc';

/**
 * Emit `directive.completed` to the SSE hub when the directive reaches
 * a terminal status. Every terminal-status branch in `runInline` ends
 * with one of these so the FE flips its `state.finalStatus` reliably.
 */
export function emitDirectiveCompleted(
  emit: DirectiveEventEmitter | undefined,
  directiveId: string,
  status: Directive['status'],
  blockedReason: string | undefined,
): void {
  if (emit === undefined) return;
  emit({
    type: 'directive.completed',
    directiveId,
    status,
    blockedReason: blockedReason ?? null,
  });
}

/**
 * Emit a `log.line` event for SSE subscribers (ADR 0029 + ADR 0031).
 * Brain stages call this at every narrative breakpoint — entry, exit,
 * error path — per ADR 0031 §4's guardrail. Error-level events carry
 * the first 500 chars of any offending LLM output in `attrs.detail`
 * (ADR 0031 §3).
 *
 * The helper sets `ts` to the current wall-clock instant so callers
 * don't each have to format an ISO string.
 */
export function emitLogLine(
  emit: DirectiveEventEmitter | undefined,
  directiveId: string,
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
  component: string,
  msg: string,
  attrs?: Record<string, unknown>,
): void {
  if (emit === undefined) return;
  emit({
    type: 'log.line',
    directiveId,
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...(attrs !== undefined ? { attrs } : {}),
  });
}
