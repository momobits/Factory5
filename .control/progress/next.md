# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-03T12:13:11Z by
> `.claude/hooks/regenerate-next-md.ps1`. Edit STATE.md's "Next action"
> or "Notes for next session" to influence this prompt; **do not edit
> next.md by hand** -- it's overwritten on every session end.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` -- the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you
see a structured `[control:state]` block instead of doing them by hand.

## Next action

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.2 = wire `apps/factory-web/src/pages/directives/detail.astro` to the SSE stream** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.2. Replace the existing one-shot `loadInto<Detail>` polling with an EventSource subscription that incrementally renders task / spend / completion events as they arrive. Add an `apiStream<T>(path)` helper to `apps/factory-web/src/lib/api.ts` that wraps EventSource with token-auth (`?t=<UI_TOKEN>` query param) and reconnect. UX: connection-state pip ("Live" / "Reconnecting" / "Disconnected"), auto-scroll log tail with pause-on-user-scroll, on `directive.completed` stop showing the live indicator and surface the final status. Acceptance: open detail in a second browser tab during a live build and see updates without F5; EventSource reconnects on transient disconnect; polling fallback exercised under a stub that strips SSE.


## Notes for next session

Step 3.1 shipped the backend half of the live-updates uplift. Step 3.2 wires the front-end. Two anchor files: `apps/factory-web/src/lib/api.ts` (new `apiStream<T>(path)` helper) and `apps/factory-web/src/pages/directives/detail.astro` (replace `loadInto<Detail>` with EventSource subscription).

**Step 3.2 design notes:**

- **Auth.** EventSource cannot set custom headers, so `apiStream` must append `?t=<UI_TOKEN>` to the URL. The token already lives in `apps/factory-web/src/lib/api.ts` (the existing `apiFetch`/`apiPost` paths read it). Strip the token from `history.replaceState` after the initial page load so it doesn't appear in browser history.
- **Reconnect.** The browser's EventSource auto-reconnects on transient disconnect. Wrap it so `apiStream` emits a "Reconnecting" connection-state to the page.
- **Render.** Detail page tracks `Map<taskId, Task>` for live tasks; on `task.started` insert; on `task.completed` flip status + finishedAt; on `spend.updated` rewrite the spend line; on `directive.completed` stop showing the live indicator and surface the final status prominently. Keep a polling fallback (every 5 s `apiFetch('/api/v1/directives/:id')`) for browsers behind an SSE-stripping proxy — only used when the EventSource fires `error` and `readyState === CLOSED` repeatedly.
- **Spend page.** `/app/spend/index.astro` should also subscribe (per-directive or one-shot reconnect) so spend rolls up live. Out-of-scope for 3.2 if 3.2 stays focused on `directive/detail`; pencil it in for 3.8 (spend page charts).

**Step 3.1 deferred work that 3.2 may want to wire:**

- **`finding.created` brain emission.** Tier-3 plan calls for it; spec carries the shape; route forwards it. The cheapest place is `pool.ts` after a task finishes — emit one `finding.created` per entry in `outcome.result.findingsRaised` (look up the registry row by id for the body fields). Self-contained (~20 LOC). 3.2 may need it for the "findings list grows live" UX, or it can defer to a 3.x sub-step.
- **`log.line` forwarder.** Selective pino-stream tap that filters by directive correlation id. More invasive — a Pino transport or a custom serializer. Defer to a separate sub-step (or skip entirely for 3.x; the page can show task-level log via the existing `BUILD.md` poll).

**Carried forward from Phase 2 (Step 2.6 — `factory chat` per-turn timeout):** infrastructure now in place via 3.1's SSE route. Full resolution lands in step 3.5 when the `/app/chat` page routes chat directives through this stream — until then the 120 s false-timeout could still bite a chat directive that takes longer than 120 s for the first turn. Not a regression vs prior state; the cheap-path bump remains an option if 3.5 slips.

**Pre-2026-05-03 baseline live-smoke (carried into Phase 3):** Discord+Telegram slash command surfaces are live-verified. Free-form chat re-routing verified. `factory cancel` IPC route paths verified end-to-end. SSE route is unit/integration-tested only — full live-smoke (open a real browser to `/app/directives/detail?id=…` while a build runs) lands with 3.2.

**Loose ends from prior session (still open; not blocking 3.2):**

- Synthetic smoke directive in DB (`01KQPDMQE6QTQZ3QMDD69019YK`, status=failed/cancelled) plus a synthetic project (`demo-project`) and its linked directive. Reap with `cd packages/state && node smoke-cleanup.mjs` if you want a clean `factory status`.
- factoryd PID 32436 from prior session still running. `factory daemon stop` shuts it down.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).