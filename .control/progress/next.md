# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-03T15:10:39Z by
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

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.6 = cancel + pause buttons on directive detail** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.3 (the upgrade-plan numbering lags the phase numbering; tier-3 §3.3 = phase step 3.6 because 3.4 page-conversion + 3.5 chat slotted in between). Cancel is straightforward in shape but has a route-prefix decision to resolve first: Phase 2.4 mounted the cancel route at `/directives/:id/cancel` (no `/api/v1/` prefix) per `packages/daemon/src/server.ts:410`, but the SPA's Bearer-gated namespace is `/api/v1/*` (see how 3.5 mounted `POST /api/v1/chat/messages`). Either (a) move/alias the cancel route to `/api/v1/directives/:id/cancel` and apply `requireUiAuth` (matches the SPA convention; verify CLI `packages/cli/src/commands/cancel.ts` doesn't hit the route directly before moving — Discord/Telegram channel handlers reach cancel via `runCancel` in `command-handlers.ts`, not via HTTP), or (b) keep the existing prefix and have the FE call the existing path with whatever auth gate is already there. After that decision, the FE work is: visible-only-when-`running`-or-`pending`, calls `apiPost`, disables on click, shows "Cancelling..." until SSE reports `directive.completed`. Pause is a separate open design decision — STATE.md "Notes for next session" surfaces three options (extend `directivesQ` status enum / reuse `markBlocked` / defer pause). File pointers: edit `apps/factory-web/src/pages/directives/detail.astro` (the live SSE render path that already owns the page chrome) for the button + handler; edit `packages/daemon/src/server.ts` to land the route move if option (a). Acceptance: click cancel during a build, see status flip to `failed` within a few seconds, see workers terminate (live-smoke against a real factoryd).


## Notes for next session

Step 3.6 is the cancel + pause buttons on directive detail. Per [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md) line 8 and [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.3 (numbering shift: tier-3 plan §3.3 = phase step 3.6).

**Cancel — straightforward:**

1. **`apps/factory-web/src/pages/directives/detail.astro`** — add a "Cancel build" button to the page header (visible only when `effectiveStatus()` returns `running` or `pending`). On click: disable the button, change its text to "Cancelling…", call `apiPost('/api/v1/directives/' + encodeURIComponent(directiveId) + '/cancel', {})`. The existing SSE subscription will land `directive.completed` with `status: 'failed'` and `blockedReason: 'cancelled'` (or whatever `cancelDirective` writes) — the page's existing `applyEvent` handler reflects the status flip without further work.
2. **Verify the route prefix** — `packages/daemon/src/server.ts:410` currently mounts the cancel route at `/directives/:id/cancel` (no `/api/v1/` prefix), distinct from where the FE expects to call it. Either: (a) move/alias the route to `/api/v1/directives/:id/cancel` and apply `requireUiAuth` (matches the rest of the SPA's surface and how 3.5's chat route is mounted); (b) keep the existing prefix and add a separate worker-token-style auth gate. Recommendation: (a) — the cancel route is operator-facing and belongs in the same UI-token-gated namespace.

**Pause — needs a small design decision before code:**

Phase-3 steps.md frames pause as "a status flip via existing route" but no pause primitive exists today. Three options:

- **Option A — extend `directivesQ` with a pause/resume status pair.** Adds two new directive states (`paused` + a path back to `running` via resume); migration adds them to the CHECK constraint. Brain claim loop must skip `paused` directives. Most invasive but cleanest semantics.
- **Option B — reuse `markBlocked` as the pause primitive.** `markBlocked` already moves a directive to `blocked` with a free-text `blockedReason`; pause becomes a marker like `blockedReason: 'paused-by-operator'`. Resume is a status flip back to `running` (or re-claim via a new doorbell ring). Cheaper but conflates two semantically different things in one column.
- **Option C — defer pause to a 3.x follow-up; ship cancel only under 3.6.** Pause is a soft requirement; cancel is the primary operator escape hatch. Lets 3.6 close in one focused commit and avoids a sticky design call mid-step.

Recommendation: **Option C** unless an operator reports needing pause. The phase-3-web-ui/steps.md line conflates them; in practice cancel solves the operator-pain case (a build going wrong needs to die, not pause-then-think). Pause is the kind of feature that's worth designing once a real workflow demands it.

**Operational reminders for 3.6 acceptance:**

- **Live-smoke required.** Cancel during a real build needs verifying end-to-end: kick off `factory build <project>` in one terminal, open `/app/directives/detail?id=<id>` in the browser during the run, click cancel, watch tasks terminate. The SSE FE consumer is structurally complete since 3.2 + 3.5; this is the pre-3.5-pinned smoke that's been carried forward.
- **Cancel route auth move (option a above)** — if we move `/directives/:id/cancel` to `/api/v1/*`, that's a contract shift for any non-FE caller. Discord/Telegram channel handlers reach the cancel path through `runCancel` in `command-handlers.ts` (not via HTTP); the only external caller of the route is `packages/cli/src/commands/cancel.ts` (verify by grep before moving). If CLI hits it, both must move together.

**3.x backlog still open (no 3.6 acceptance dependency):**

- PageShell + Dashboard `<style is:global>` follow-up — wire `<PageShell title=…>` across all 11 pages (10 pre-3.5 + chat), remove Dashboard's inner `<h2>{title}</h2>`, convert Dashboard's primitives (`.cards`, `.empty`, `.err`, `.filter-form`, `.btn*`, `.alert*`, `.form-*`, table-base) to `<style is:global>` so slot-level elements actually pick up the styling. Self-contained ~1 commit.
- `finding.created` brain emission — small follow-up to commit `10efe20`'s `log.line` work; one event per entry in `outcome.result.findingsRaised` from `packages/brain/src/pool.ts`. Same `emitLogLine`-style helper pattern (e.g. `emitFindingCreated`).
- Pre-3.5 baseline live-smoke — open a real browser to `/app/directives/detail?id=…` AND `/app/chat` during a build run to verify SSE event fidelity. Pin as part of phase-3 acceptance; not a 3.6 blocker.

**3.5 design discoveries to remember (also recorded in `apps/factory-web/src/components/README.md` "Patterns introduced by /app/chat" section):**

1. The chat page is the second site (after `directives/detail.astro`) where the static-component library can't carry the load — bubble layouts, hand-rolled markdown, and per-turn `apiStream` lifecycle don't fit static-component shape. The component library README documents these patterns inline rather than promoting them to components prematurely. Lift to a shared component only when a third site emerges.
2. The `/cmd` shortcut path uses the existing `/api/v1/{status,spend,findings}` GET endpoints client-side rather than a new chat-cmd route on the daemon. This keeps the operator surface in lockstep across Discord/Telegram (which dispatch via `command-handlers.ts` server-side) and the web (which dispatches via fetch client-side); both surfaces hit the same SQL queries underneath, so behavior stays consistent.
3. `apiStream` close-on-`directive.completed` makes per-turn lifecycle straightforward — each user message closes any prior stream, opens a fresh one against the new directive, and listens for log.line events filtered by `component === 'brain.chat'`. `astro:before-swap` teardown prevents leaked EventSources across page navigation.

**Loose ends from prior sessions (still open; not blocking 3.6):**

- Synthetic smoke directive in DB (`01KQPDMQE6QTQZ3QMDD69019YK`, status=failed/cancelled) plus a synthetic project (`demo-project`) and its linked directive. Reap with `cd packages/state && node smoke-cleanup.mjs` if you want a clean `factory status`.
- factoryd PID 32436 from prior session may still be running. `factory daemon stop` shuts it down.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).