/**
 * Per-directive cancellation registry (Phase 2.4).
 *
 * The brain runs each directive (inline or claimed via the serve loop) under
 * an `AbortSignal` that's wired all the way down to the worker subprocess —
 * pool → worker → provider → `child.kill`. Today the only signal source is
 * the brain's own shutdown controller. This registry adds a second source:
 * an out-of-band per-directive controller that the daemon's `POST
 * /directives/:id/cancel` route fires when the operator runs `factory
 * cancel <id>`.
 *
 * Lifetimes:
 *
 *   - {@link registerCancellation} is called when a directive starts (serve
 *     loop's claimNext, or runInline's claim path). It returns a combined
 *     `AbortSignal` that fires on either source. The caller passes this
 *     signal into the pool / runner.
 *   - {@link releaseCancellation} is called from a `finally` once the
 *     directive finishes (success, failure, or cancellation). Removes the
 *     entry so subsequent cancels for the same id are no-ops.
 *   - {@link cancelDirective} is fired by the daemon route. Returns `true`
 *     iff a controller was registered (the directive was running in this
 *     process); `false` lets the caller surface "DB updated but the brain
 *     wasn't holding the work."
 *
 * Module-level Map so a single brain process serving multiple directives
 * shares one registry. Tests can call {@link _resetCancellationRegistry}
 * between cases to keep state clean.
 */

const registry = new Map<string, AbortController>();

export interface CancellationHandle {
  /** Combined signal — fires on parent-shutdown OR per-directive cancel. */
  signal: AbortSignal;
  /**
   * Remove the registration. Idempotent. Safe to call from a `finally` even
   * if `registerCancellation` was never called for this id.
   */
  release: () => void;
}

/**
 * Build a per-directive controller, register it, and return a combined
 * signal that aborts when EITHER:
 *
 *   - the operator hits `/directives/:id/cancel` (firing this controller), or
 *   - the parent signal aborts (brain shutdown — daemon stop, ctrl-C).
 *
 * `parentSignal` is optional — passing `undefined` means "no parent
 * controller; only firing through {@link cancelDirective} will abort the
 * combined signal."
 */
export function registerCancellation(
  directiveId: string,
  parentSignal?: AbortSignal,
): CancellationHandle {
  const ours = new AbortController();

  // If a stale registration exists (shouldn't normally happen — caller
  // forgot to release — but defensively prefer the new controller), abort
  // the old one so any callers waiting on its signal unblock.
  const previous = registry.get(directiveId);
  if (previous !== undefined) previous.abort(new Error('superseded by new registration'));

  registry.set(directiveId, ours);

  // Bridge parent abort → ours. Caller may not pass a parent (inline runs
  // outside the daemon); in that case only `cancelDirective` fires.
  let onParentAbort: (() => void) | undefined;
  if (parentSignal !== undefined) {
    if (parentSignal.aborted) {
      ours.abort(parentSignal.reason);
    } else {
      onParentAbort = (): void => ours.abort(parentSignal.reason);
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    if (parentSignal !== undefined && onParentAbort !== undefined) {
      parentSignal.removeEventListener('abort', onParentAbort);
    }
    // Only delete if the entry still points at us — a superseding
    // registration may have already replaced our slot.
    if (registry.get(directiveId) === ours) registry.delete(directiveId);
  };

  return { signal: ours.signal, release };
}

/**
 * Fire the per-directive controller, if one is registered. Returns `true`
 * iff a controller existed for this id — letting the caller distinguish
 * "DB row updated AND in-flight work was signalled" from "DB row updated
 * but no in-flight work in this process to signal."
 *
 * `reason` is attached to the AbortSignal so downstream listeners (e.g.
 * the claude-cli provider) can surface it in their error message.
 */
export function cancelDirective(directiveId: string, reason?: string): boolean {
  const controller = registry.get(directiveId);
  if (controller === undefined) return false;
  controller.abort(new Error(reason ?? 'cancelled'));
  return true;
}

/** True iff a controller is registered for this directive. */
export function isCancellationRegistered(directiveId: string): boolean {
  return registry.has(directiveId);
}

/** Test helper — clear the registry between cases. */
export function _resetCancellationRegistry(): void {
  for (const c of registry.values()) {
    try {
      c.abort(new Error('registry reset'));
    } catch {
      /* ignore */
    }
  }
  registry.clear();
}
