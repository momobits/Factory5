# Phase 3 Steps

- [x] 3.1 — SSE on `/api/v1/directives/:id/stream` — events: `task.*`, `finding.created`, `spend.updated`, `log.line`, `directive.completed`; per-directive subscription map; heartbeat; close on `directive.completed`
- [x] 3.2 — Wire `directives/detail.astro` to the SSE stream — replace polling with EventSource; live tasks, findings, spend, log tail; polling fallback for SSE-stripped proxies
- [x] 3.3 — Astro component library — `<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>`, `<PageShell>`; consistent prop conventions; documented in `apps/factory-web/src/components/README.md`
- [x] 3.4 — Convert all 10 pages to use components; retire `el()` (and `loadInto()`) from `lib/api.ts`; matching tests / smoke
- [x] 3.5 — Add `/app/chat` page — mirror of `factory chat` in browser; reuses Phase 2's `command-handlers.ts` for read-side dispatch; live token streaming
- [x] 3.6 — Cancel button on directive detail — POST `/api/v1/directives/:id/cancel` (new SPA-namespace alias of Phase 2's CLI route, gated by `requireUiAuth`). Pause deferred — see follow-up bullet at the end of this list.
- [x] 3.7 — Add `/app/projects/new` — mirror of `factory init <project>` for a single project; same shape as the chat-side build kickoff
- [x] 3.8 — Spend page charts — sparkline per project + 30-day daily stacked bar; vanilla SVG (no chart-lib dep)
- [x] 3.9 — Mobile-responsive nav — hamburger drawer at narrow widths (≤768px); primary actions reachable in two taps at 375px
- [x] 3.10 — Explicit logout + connection-status indicator in header — clears session token; "Connected" / "Disconnected" / "Reconnecting" pip backed by a heartbeat
- [x] 3.11 — `/phase-close` — tag `phase-3-web-ui-closed`; append session entry to [`../../../UPGRADE/LOG.md`](../../../UPGRADE/LOG.md); tick Tier 3 boxes in [`../../../UPGRADE/ROADMAP.md`](../../../UPGRADE/ROADMAP.md); scaffold Phase 4

### Deferred follow-ups (no acceptance dependency for any 3.x step; land any time before `/phase-close`)

- [ ] 3.x — Pause primitive on directive detail. Deferred at 3.6 per Decision 2 = option C: cancel solves the primary operator-pain case (a build going wrong needs to die, not pause-then-think). Pause is the kind of feature worth designing once a real workflow demands it. When a workflow signal lands, choose between Option A (extend `directivesQ.status` with a `paused`/resume pair + brain claim-loop skip + 2 routes + 2 buttons) and Option B (reuse `markBlocked` with `blockedReason: 'paused-by-operator'`).
- [ ] 3.x — PageShell adoption + Dashboard `<style is:global>` migration. Wire `<PageShell title=…>` across all 11 pages (10 pre-3.5 + chat); remove Dashboard's inner `<h2>{title}</h2>`; convert Dashboard's primitives (`.cards`, `.empty`, `.err`, `.filter-form`, `.btn*`, `.alert*`, `.form-*`, `table`/`th`/`td` base) to `<style is:global>` so slot-level elements pick them up. Self-contained ~1 commit.
- [ ] 3.x — Pre-3.5 baseline live-smoke. Open a real browser to `/app/directives/detail?id=…` AND `/app/chat` during a real factoryd build to verify SSE event fidelity end-to-end. The 3.6 cancel acceptance smoke covers the detail page condition; chat page is a 30-second click-test layered on top. This is the last gate before promoting ADR 0029 (directive-stream protocol) from gated to accepted. Pin as part of phase-3 acceptance; not a per-step blocker.

## Step detail

Each step's full detail (file pointers, acceptance criteria, edge cases, suggested commit messages) is in [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) under the matching `§3.<step>` heading. Below: just the commit-message templates and step-local guardrails.

### 3.1 — SSE route on `/api/v1/directives/:id/stream`

Per [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.1.

**Acceptance:** vitest harness drives the route end-to-end — emits expected events on simulated brain progress; close-on-completion works; heartbeats fire on idle; per-directive subscription map cleans up on client disconnect. The carried-forward Phase 2.6 fix (chat per-turn timeout) lands implicitly: streaming partial progress means the 120 s false-timeout disappears for chat too.

**Commit:** `feat(3.1): SSE on /api/v1/directives/:id/stream`

### 3.2 — Wire `directives/detail.astro` to SSE

Per [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.2.

**Acceptance:** loading the directive page during a live build shows tasks, findings, spend, and log tail updating without F5. EventSource reconnects on transient disconnect. Polling fallback exercised under a stub that strips SSE.

**Commit:** `feat(3.2): wire directive detail page to SSE stream`

### 3.3 — Astro component library

Per [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.3.

**Acceptance:** six components ship with prop interfaces, consistent styling tokens, and a short README. No usage in pages yet (that's 3.4) — this step is library-only.

**Commit:** `feat(3.3): astro component library — Card / Table / EmptyState / Alert / Form / PageShell`

### 3.4 — Convert all 9 pages

Per [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.4.

**Acceptance:** every page in `apps/factory-web/src/pages/` uses the new components; `el()` is gone from `lib/api.ts` (or whatever survives is type/utility-only, not DOM); visual regression on each page (manual or screenshot harness).

**Commit:** `refactor(3.4): convert all 9 pages to component library; retire el()`

### 3.5 — `/app/chat`

Per [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.5.

**Acceptance:** end-to-end against a real factoryd: typing a question gets a streamed reply; chat-shaped reads (`status`, `spend`, `findings`) re-route to the same `command-handlers.ts` shared with Discord/Telegram. Token streaming works (no full-message buffering).

**Commit:** `feat(3.5): /app/chat — browser mirror of factory chat`

### 3.6 — Cancel + pause buttons

Per [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.6.

**Acceptance:** Cancel button on directive detail calls `POST /directives/:id/cancel` (Phase 2's route) and the page reflects the new `failed`/`cancelled` state via SSE. Pause is a status flip; resume is a separate button (already existed).

**Commit:** `feat(3.6): cancel + pause buttons on directive detail page`

### 3.7 — `/app/projects/new`

Per [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.7.

**Acceptance:** form mirrors the `factory init <project>` flags (language picker, optional CLAUDE.md upload, max-usd / max-steps); on submit, scaffolds the project via the existing init path. New project shows up in `/app/projects` and is kickoff-able.

**Commit:** `feat(3.7): /app/projects/new — browser mirror of factory init`

### 3.8 — Spend page charts

Per [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.8.

**Acceptance:** sparkline per project shows the last 14 days of daily spend; the 30-day stacked bar shows daily totals split by project. Vanilla SVG — no chart library added.

**Commit:** `feat(3.8): spend page charts — sparkline + 30-day stacked bar`

### 3.9 — Mobile-responsive nav

Per [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.9.

**Acceptance:** at 375px (iPhone SE width) the nav collapses to a hamburger drawer; tapping reveals all primary destinations (Dashboard / Projects / Spend / Findings / Chat). All actions reachable in two taps from any page.

**Commit:** `feat(3.9): mobile-responsive nav with hamburger drawer`

### 3.10 — Explicit logout + connection-status indicator

Per [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.10.

**Acceptance:** Logout button clears the session token; a coloured pip in the header backs by an SSE heartbeat — green Connected, amber Reconnecting, red Disconnected.

**Commit:** `feat(3.10): explicit logout + connection-status indicator`

### 3.11 — Phase close

Run `/phase-close` after all steps green and acceptance criteria met. Tags `phase-3-web-ui-closed`. Scaffolds Phase 4 — cli-completion at `.control/phases/phase-4-cli-completion/`.

**Commit:** auto-generated by `/phase-close`, shape: `chore(phase-3): close phase 3, kick off phase 4`
