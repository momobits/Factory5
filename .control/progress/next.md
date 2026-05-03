# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-03T14:14:07Z by
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

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.5 = add `/app/chat` page — browser mirror of `factory chat`** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.5. Three new surfaces: (i) `apps/factory-web/src/pages/chat.astro` — history pane + composer + markdown-rendered replies + auto-scroll-with-pause-on-user-scroll; (ii) `POST /api/v1/chat/messages` route in `packages/daemon/src/server.ts` that mints an `intent=chat` directive and returns its id so the page can subscribe to its SSE stream for the reply; (iii) request/response shapes in `packages/ipc/src/schemas.ts`. Reuse Phase 2's `packages/channels/src/command-handlers.ts` for the optional `/cmd` shortcut path (web typed `/status` / `/spend` / `/findings` should hit the same handler set the chat-shaped messages from Discord/Telegram do, keeping the three surfaces in lockstep). The SSE stream wiring lands for free — `apiStream` from 3.2 already does token-auth + Zod-validate + connection-state machine + polling fallback; the chat page subscribes to the new directive's stream and renders one bubble per `log.line` event. Acceptance: chat from a real browser round-trips to a real factoryd, replies stream incrementally, the carried-forward Step 2.6 (`factory chat` per-turn timeout) resolves implicitly because streaming partial daemon-side progress means the 120 s false-timeout disappears for chat just as it did for builds.


## Notes for next session

Step 3.5 is the `/app/chat` browser mirror of `factory chat`. Per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.5, three surfaces:

1. **`apps/factory-web/src/pages/chat.astro`** — history pane (vertical "you said X / factory replied Y" list), composer textarea + Submit, markdown rendering for replies (small lib like `marked` or hand-rolled basics — prefer hand-rolled to avoid a new dep unless the markdown is genuinely complex), auto-scroll-to-bottom-with-pause-on-user-scroll (mirror the log-tail pip pattern from `directives/detail.astro` lines 290–317). Subscribes to the new chat directive's SSE stream via the `apiStream` helper that 3.2 shipped — one bubble per `log.line` event, optional `directive.completed` to flip the conversation back to "type your next message".
2. **`POST /api/v1/chat/messages`** in `packages/daemon/src/server.ts` — accepts `{ message, conversationId? }`; mints an `intent=chat` directive (using the same path Discord/Telegram chat goes through); returns `{ directive: { id, ... } }` so the page can immediately subscribe to its SSE stream. Auth via the same Bearer token + non-localhost gate as the rest of `/api/v1/*`.
3. **`packages/ipc/src/schemas.ts`** — request/response Zod shapes for `POST /api/v1/chat/messages`.

**Reuse Phase 2's `command-handlers.ts`** for the optional `/cmd` shortcut path: if the operator types `/status`, `/spend`, `/findings`, etc. as the first non-whitespace token, dispatch to the shared `command-handlers.ts` module instead of going through the chat-intent path. Keeps web UI in lockstep with Discord/Telegram chat surfaces. The ChannelContext shape exists; web needs a per-page mock-or-real implementation for the `setProjectBudget` callback (CLI/web are loopback so it can be a direct `wiki.updateProjectMetadata` call vs. the daemon-supplied callback Discord/Telegram use).

**Carried forward — Step 2.6 resolves implicitly.** The 120 s `factory chat` per-turn timeout disappears once chat directives stream their partial progress through the SSE route from 3.1; the cheap `TURN_TIMEOUT_MS=600s` bump is no longer needed because the page sees per-token progress instead of waiting for the full reply.

**Step 3.1 deferred work (still open):** `finding.created` brain emission and `log.line` forwarder. The FE has the listener wiring in place via 3.2 (Map mutation + log tail append, both no-op until events flow). 3.5 specifically needs `log.line` (one bubble per agent message); without it, the chat page would never render replies. Pin `log.line` emission as part of 3.5's scope OR a 3.5-prerequisite mini-step. `finding.created` remains a separate optional follow-up.

**3.4-deferred PageShell + Dashboard `<style is:global>` step.** Optional 3.x backlog item; can land any time before phase close. Wires `<PageShell title=…>` across all 10 pages, removes Dashboard's inner `<h2>{title}</h2>`, converts Dashboard's primitives (`.cards`, `.empty`, `.err`, `.filter-form`, `.btn*`, `.alert*`, `.form-*`, table-base) to `<style is:global>` so slot-level elements actually pick up the styling. Self-contained ~1 commit.

**Pre-2026-05-03 baseline live-smoke (carried forward):** Discord+Telegram slash command surfaces verified. Free-form chat re-routing verified. `factory cancel` IPC route paths verified end-to-end. SSE route is unit/integration-tested only — full live-smoke (open a real browser to `/app/directives/detail?id=…` while a build runs) was not yet performed in this session. Pin as part of Phase 3 acceptance once 3.5+ lands; not a 3.5 blocker.

**3.4 design discoveries to remember (also recorded in `apps/factory-web/src/components/README.md`):**

1. Astro's scoped CSS does NOT propagate the layout's `data-astro-cid-*` to slot content. Dashboard's class-based rules (`.cards`, `.card`, `.empty`, `.err`, `.btn*`, `.alert*`, `.form-*`, table-base) only matched elements rendered directly inside Dashboard's own template (the `<header class="shell">` chrome and inner `<h2>`). They never matched slot content. Pruning would not visually regress anything because they were already inert; the future `<style is:global>` follow-up is what would let the layout actually style slot-level elements.
2. The `<Card>` and `<Table>` `id?`/`loading?` extensions added during 3.4 are the load-bearing pattern for runtime-fetched data. Server-render with placeholder values + stable `id`; script populates inner cells (`#card-X .value`) or replaces tbody (`#tbl-X tbody`) on `apiFetch` resolution. Empty results from the fetch render a single colspan'd `<tr><td class="empty">` row inside the table so column headers stay visible.
3. The `<Submit>` component is always `type='submit'` by design. Non-submit actions (e.g. the projects/detail "Clear all defaults" button, which has its own click handler distinct from form submit) use raw `<button class="btn btn-danger" type="button">` and rely on Dashboard's global `.btn*` rules — the only Dashboard primitives that genuinely apply to slot content because Dashboard's CSS for `.btn*` is at the chrome level (and even then, only because raw buttons end up inside `<header>`-rendered elements when Dashboard wraps them, which... actually no, see point 1 — `.btn*` is also inert for slot content. Raw buttons have been visually unstyled this whole time. Worth verifying live; if confirmed unstyled, the `<style is:global>` follow-up adds load-bearing fix here too).

**Loose ends from prior sessions (still open; not blocking 3.5):**

- Synthetic smoke directive in DB (`01KQPDMQE6QTQZ3QMDD69019YK`, status=failed/cancelled) plus a synthetic project (`demo-project`) and its linked directive. Reap with `cd packages/state && node smoke-cleanup.mjs` if you want a clean `factory status`.
- factoryd PID 32436 from prior session may still be running. `factory daemon stop` shuts it down.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).