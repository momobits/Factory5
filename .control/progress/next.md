# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-05T20:09:10Z by
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

Pick step 3.8 — spend page charts. Per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.8: two charts on `/app/spend`, both vanilla SVG (no chart-library dep). (i) **Per-project sparkline** — last 14 days of daily spend, one row per project, inline mini-line + USD label. (ii) **30-day stacked bar** — daily totals across the workspace, color-coded segments per project. Inherit-don't-invent — keep the existing utilitarian aesthetic (`color-mix(currentColor)` palette adapting to `color-scheme: light dark`); apply frontend-design *principles* (hierarchy, affordance copy, smart defaults) within that aesthetic. **Invoke the `frontend-design` skill before authoring** per saved feedback. First step is to read `apps/factory-web/src/pages/spend/index.astro` (the current flat-array consumer) and `packages/state/src/queries-spend.ts` (or wherever the spend query lives) to determine whether `/api/v1/spend` already has the daily/project decomposition or whether 3.8 needs a new query/route too. Background processes still running: factoryd PID 37148 on `127.0.0.1:25295` (fresh on the 3.7 build, ADR 0029 wired correctly); astro dev on `127.0.0.1:4321`. After 3.8: 3.9 (mobile-responsive nav) → 3.10 (logout + connection-status indicator) → 3.11 (`/phase-close`).


## Notes for next session

Step 3.7 is **closed**. All of the prior session's pending work landed cleanly: the live-smoke acceptance + 2 in-flight fix commits + the close commit. ADR 0029's `finding.created` live-verification gap is closed; the ADR can promote past the gated state at `/phase-close` (step 3.11) without further smokes.

**Step 3.8 — Spend page charts (recommended next):**

Per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.8. Two charts on `/app/spend`:

1. **Per-project sparkline** — one row per project, last 14 days of daily spend rendered as an inline mini-line + USD label. Hover (or click on touch) shows `<date>: $<amount>`.
2. **30-day stacked bar** — daily totals across the workspace, color-coded segments per project; legend below or hover-tooltip.

Hard requirements:

- **Vanilla SVG only.** No chart-library dep (D3, Chart.js, recharts, etc.). Per `tier-3-web-ui-live-and-complete.md` §3.8.
- **Inherit, don't invent.** Use the existing `color-mix(currentColor)` palette adapting to `color-scheme: light dark`. Per-project colors can either (a) reuse a small fixed palette indexed by project insertion order or (b) hash the project id to a hue — either works; pick the simpler one.
- **Invoke the `frontend-design` skill before authoring** per saved feedback. The skill is calibrated for greenfield design but its principles (hierarchy, affordance copy, friction-aware errors, smart defaults) still apply within the existing aesthetic.

First-step investigation:

- Read `apps/factory-web/src/pages/spend/index.astro` to see the current shape (flat-array consumer of `/api/v1/spend`).
- Read `packages/state/src/queries-spend.ts` (or wherever spend lives — grep `'queries-spend'` if the path differs) to see whether the daily/project decomposition is already available or whether 3.8 needs a new query helper.
- Read `packages/daemon/src/server.ts` for the `/api/v1/spend` route shape — if a daily-rollup endpoint is missing, decide whether to add it as a separate route or extend the existing one.

If the daily decomposition needs new daemon work, 3.8 is a 2-commit step (route + schema → page); otherwise it's a single-commit step (page only). Plan the split when the investigation is done.

**After 3.8:**

- **3.9** — Mobile-responsive nav. Hamburger drawer at ≤768px; primary actions reachable in two taps at 375px (iPhone SE width).
- **3.10** — Explicit logout + connection-status indicator in header. SSE-heartbeat-backed pip; clears session token on logout.
- **3.11** — `/phase-close`. Tags `phase-3-web-ui-closed`; ADR 0029 promoted past gated state (Live verification carve-out retired); scaffolds Phase 4.

**Deferred follow-ups still open in `phase-3-web-ui/steps.md`** (no 3.x acceptance dependency):

- **Pause primitive on directive detail.** Defer until a real workflow signal demands it. Choose between Option A (`directivesQ.status` enum extension) and Option B (`markBlocked` reuse with `blockedReason: 'paused-by-operator'`) when the signal lands.
- **PageShell adoption + Dashboard `<style is:global>` migration.** 11-page structural sweep that would also (a) eliminate the carry-forward "Clear all defaults" + 4× filter-form Apply buttons unstyled-button issue, (b) consolidate inline `style=` attributes scattered across pages (e.g., `pages/projects/detail.astro:14-30` etc.), (c) move Dashboard.astro's currently-scoped `.btn*` / `.alert*` / `.form-*` rules to global so raw page buttons inherit them. Self-contained ~1 commit when authored. Not a per-step blocker.
- **Pre-3.5 baseline live-smoke** is now mostly closed by the 2026-05-05 session's smokes (3.6 cancel + 3.7 acceptance + ADR 0029 verification). The chat-page click-test is the remaining 30-second piece; pin it as part of the `/phase-close` smoke.

**Carry-forward bugs / cleanup (not blocking 3.8 or beyond):**

- **Smoke residue cleanup** is optional. Two projects + 2 cancelled directives in DB; corresponding workspace dirs on disk. See In-flight work § for paths.
- **Control framework repo** at `G:\Projects\Small-Projects\Control` — operator's go on 2.2.3 publish.
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 drift, now at 7 occurrences. Not load-bearing; ergonomic.

**Frontend-design judgement calls captured this session worth carrying forward to 3.8/3.9/3.10:**

- **Root-cause CSS fixes over global rewrites.** The `currentColor` self-reference bug in `.btn-primary` had three identical instances; each one fixed with a 2-character change (`currentColor` → `CanvasText`) without redesigning the filled-accent button concept. Applies generally: when a CSS bug surfaces, look for the *anti-pattern's other instances* before reaching for a redesign.
- **Astro `<ClientRouter />` is fragile when page scripts use module-level top-level setup.** Either drop the router or refactor every page script into `astro:page-load` callbacks. Mid-state ("router on, no listeners") is the worst of both worlds. Same applies if any future page wants SPA-like nav back: the listener wrap is the prerequisite.
- **Inline-style audit pass.** Multiple pages have inline `style=` attributes for colors. When the PageShell migration lands, fold these into the global stylesheet — they're harder to maintain inline.
- **Frontend-design judgement calls already captured in last session's notes** (inherit-don't-invent, hint-copy-teaches-consequence, empty-fields-aren't-explicit-empty, in-context-affordance-vs-nav) still apply for 3.8/3.9/3.10.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).