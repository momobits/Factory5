# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-05 19:55 UTC by `/session-end` (post step 3.7 closed; live-smoke acceptance verified, ADR 0029 `finding.created` live-verification gap closed, two CSS/router fixes landed in-flight)
**Current phase:** 3 — web-ui
**Current step:** 3.8 — spend page charts (sparkline per project + 30-day stacked bar; vanilla SVG, no chart-lib dep)
**Status:** ready (clean working tree post step-3.7 close commit; all four `pnpm` gates green at every commit; workspace test count unchanged at 1075 + 3 skipped since the two in-flight fixes were CSS / layout-only; ADR 0029's last live-verification gap closed by the 3.7 acceptance smoke — six event types now confirmed end-to-end)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Pick step 3.8 — spend page charts. Per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.8: two charts on `/app/spend`, both vanilla SVG (no chart-library dep). (i) **Per-project sparkline** — last 14 days of daily spend, one row per project, inline mini-line + USD label. (ii) **30-day stacked bar** — daily totals across the workspace, color-coded segments per project. Inherit-don't-invent — keep the existing utilitarian aesthetic (`color-mix(currentColor)` palette adapting to `color-scheme: light dark`); apply frontend-design *principles* (hierarchy, affordance copy, smart defaults) within that aesthetic. **Invoke the `frontend-design` skill before authoring** per saved feedback. First step is to read `apps/factory-web/src/pages/spend/index.astro` (the current flat-array consumer) and `packages/state/src/queries-spend.ts` (or wherever the spend query lives) to determine whether `/api/v1/spend` already has the daily/project decomposition or whether 3.8 needs a new query/route too. Background processes still running: factoryd PID 37148 on `127.0.0.1:25295` (fresh on the 3.7 build, ADR 0029 wired correctly); astro dev on `127.0.0.1:4321`. After 3.8: 3.9 (mobile-responsive nav) → 3.10 (logout + connection-status indicator) → 3.11 (`/phase-close`).

---

## Git state

- **Branch:** main
- **Last commit:** `06e7460` — refactor(3.7): close step 3.7 — /app/projects/new live, ADR 0029 finding.created verified
- **Uncommitted changes:** none (working tree clean post session-end commit; this commit itself will create the steady-state lag-by-1 the runbook documents — same shape as `561da90` / `1c6eeaf` / `288603e` predecessors)
- **Last phase tag:** `phase-2-channel-parity-closed` (annotated tag at commit `081b832`)

---

## Open blockers

- None

---

## In-flight work

None — step 3.7 closed; tree clean.

Carry-forward items outside the work cursor (none block 3.8):

- **Smoke residue accumulated.** This session's `node-sse-smoke` project (id `01KQWT6T6STXT4BFB5MC9QF9E6`) at `C:\Users\Momo\factory5-workspace\node-sse-smoke\` plus build artifacts under `.factory/` (BUILD.md, plan.json/plan.md, findings.json, worktrees/). Prior session's `smoke-demo` project (`01KQW30T5274QGSEHHVZTRQ953`) at `C:\Users\Momo\factory5-workspace\smoke-demo\` and two cancelled directives (`01KQW3D4CZ84ZFHFKYEP7BWQBX`, `01KQWDWRQD08X3BEYEQNAD6M23`). Optional cleanup via `cd packages/state && node smoke-cleanup.mjs` + workspace dir removal.
- **Filter-form Apply buttons + "Clear all defaults"** still render as user-agent default `<button>`. Five sites: `pages/spend/index.astro:20`, `pages/findings/index.astro:40`, `pages/questions/index.astro:20`, `pages/directives/index.astro:24` (all `<button type="submit">Apply</button>` raw), and `pages/projects/detail.astro:64` (raw `<button class="btn btn-danger">Clear all defaults</button>`). Dashboard.astro's scoped styles don't reach slotted page content. The deferred PageShell + `<style is:global>` migration absorbs all five — self-contained ~1 commit when authored.
- **Control framework repo** (`G:\Projects\Small-Projects\Control`) still has uncommitted upstream patches matching local `e5ec723`. Operator owns the go for 2.2.2 → 2.2.3 publish.
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 self-reference drift remains unaddressed across 7 occurrences now (`cce7065` / `db61baf` / `54c0f20` / `d7a366c` / `288603e` / `317d94b` / this session's `06e7460`-folded reconcile). Two structural options: track "last work commit" rather than HEAD (semantic shift), or amend STATE.md post-commit (hook complexity). Worth filing as ergonomic infrastructure work in the next quiet session.
- **ADR 0029 promotion past gated state** still pinned to `/phase-close` (3.11) per the ADR's Live verification section. This session closed the live-verification gap (six event types now confirmed end-to-end including `finding.created`); the structural promotion happens at phase close.

---

## Test / eval status

- **Last test run:** 2026-05-05 — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package counts unchanged from the prior STATE.md baseline (this session's two fix commits were CSS / layout-only, no test deltas): state 152, channels 175, daemon 173, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli 78, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. **Workspace total 1075 passing + 3 skipped.**
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness. ADR 0029's `finding.created` live-verification gap is **closed** via the 3.7 acceptance smoke: F001 (LOW / OPEN, source `builder`, target `docs/knowledge/testing.md`) emitted live by the assessor on `node-sse-smoke`'s build — the docs prescribe `node --test tests/` which fails on Node 22 with `ERR_MODULE_NOT_FOUND` resolving the bare directory; builder patched `package.json` to `node --test tests/*.test.js` and surfaced the docs divergence as a finding. Visible at `/app/findings/`. All six ADR 0029 event types now confirmed live end-to-end across the 2026-05-05 smokes (4 from prior session + cancel round-trip + this session's `finding.created`).

---

## Recent decisions (last 3 ADRs)

- **ADR 0029 — directive-stream-protocol** (Accepted 2026-05-05) — Live verification §'s `finding.created` gap **closed** by this session's step-3.7 acceptance smoke (F001 emitted live by the assessor on `node-sse-smoke`'s build). All six event types now confirmed live end-to-end. ADR can promote past the gated state at `/phase-close` (step 3.11) without further smokes; the unit-test-only carve-out in the Live verification section can be retired in a docs amendment when 3.11 lands.
- **ADR 0028 — worker-sandbox-contract** (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- **ADR 0027 — web-ui-mutation-surface** (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)

---

## Recently completed (last 5 steps)

- Step 3.7 close — `refactor(3.7)`: close step 3.7 — /app/projects/new live, ADR 0029 finding.created verified. Flipped `- [x] 3.7` in [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md) and the matching tick in [`../../UPGRADE/ROADMAP.md`](../../UPGRADE/ROADMAP.md); folded the STATE.md "Last commit" pointer reconcile in (vs. the standalone `317d94b`-shape last cycle). Smoke evidence pinned in the body: project `01KQWT6T6STXT4BFB5MC9QF9E6` (`node-sse-smoke`, language=node) created via the new `/app/projects/new` form, redirected to detail page, scaffolded files on disk verified, build kicked at `/app/build`, F001 finding emitted live from the assessor (target `docs/knowledge/testing.md`). Closes ADR 0029's last open live-verification gap. — 2026-05-05 — `06e7460`
- Step 3.7 fix (b) — `fix(3.7)`: drop `<ClientRouter />` so page setup runs on every nav. Astro 5 view-transitions router was preventing page-setup scripts from re-running on nav (Astro module scripts dedupe across swaps; none of the 11 page scripts wrap their DOM-setup in `astro:page-load`). F5 forced a fresh load that bypassed the router. Smaller blast radius to drop the router than to refactor 11 page scripts; zero current pages use ClientRouter-specific events (the `apps/factory-web/src/components/README.md:272` mention of `astro:before-swap` for SSE cleanup is forward-looking, no consumers). One-import + one-element removal in `Dashboard.astro`. Found during the 3.7 live smoke; same root cause for every nav-driven page. — 2026-05-05 — `e3aca18`
- Step 3.7 fix (a) — `fix(3.7)`: button text invisible on filled-accent buttons (CanvasText, not currentColor). Three sites had the same self-referential bug: `background: color-mix(in srgb, currentColor 85%, transparent); color: Canvas;` — `color: Canvas` rebinds `currentColor` for that element to `Canvas`, so the same rule's background also collapses onto Canvas → both fg and bg evaluate to (almost) the system canvas colour. Fixed in `Submit.astro` (`.btn-primary`), `EmptyState.astro` (`.empty-state-cta`), `Dashboard.astro` (`.btn-primary`, scoped so currently dead but included for the deferred `<style is:global>` migration). Reference is `CanvasText` (the system pair to Canvas, guaranteed contrast under `color-scheme: light dark`). Found during the 3.7 live smoke at `/app/projects/new` (Submit) + `/app/projects/detail` (Save defaults). — 2026-05-05 — `3ff0ea0`
- Step 3.7 commit (c) — `feat(3.7)`: `/app/projects/new` page. Mirrors `build.astro`'s `<Form>`+`<Field>`+`<Submit>` shape; fields are name (required text), language (required select; python default), claudeMd (optional textarea, 12 rows). On submit, `apiPost('/api/v1/projects', …)` then redirects to `/app/projects/detail?id=<id>`; on error, hidden-`<Alert>`-placeholder pattern surfaces inline with `ALREADY_EXISTS` / `SCHEMA_VALIDATION_FAILED` / `UI_AUTH_REQUIRED` / `UI_DISABLED` headings. `captureTokenFromUrl()` first executable statement (per saved-feedback memory + lesson from `00d2bc4`). `+ New project` outline-button affordance added to `projects/index.astro`; empty-state copy updated to surface the new web flow. Top nav left at 8 items intentionally — the contextual affordance covers discoverability without nav clutter (intentional deviation from plan's nav-link recommendation, recorded in commit body). — 2026-05-05 — `53e4e98`
- Step 3.7 commit (b) — `feat(3.7)`: POST /api/v1/projects route + schemas. New `apiV1CreateProject{Request,Response}Schema` in `@factory5/ipc` (request: `name (≥1) / language (enum) / claudeMd?`; response: `{ id (ULID), path }`). New route in `packages/daemon/src/server.ts` near the GET counterparts; bearer-gated via `requireUiAuth`; pipeline parses body → joins workspace + name → `wiki.createProject` (maps `CreateProjectAlreadyExistsError` → 409) → `projectsQ.upsert` → respond. New `IpcServerOptions.workspace?` opt for test override. +6 route tests in `server.test.ts` mirroring the build route's 401/503/400/happy/409 shape. — 2026-05-05 — `50e8b33`

---

## Attempts that didn't work (current step only)

- None — step 3.7 closed cleanly. Cleared on step boundary (cursor moves to 3.8 next session).
- One tooling discovery worth recording so future sessions don't repeat it: `node packages/cli/dist/index.js daemon stop` produces no output and exits 0 because `packages/cli/dist/index.js` is the **library exports** for `@factory5/cli` (`buildCli` + types), not a runnable CLI binary. The actual `factory` binary is `apps/factory/dist/main.js` per the `factory` package's `bin` field. Use `node apps/factory/dist/main.js daemon {start|stop|status|restart}` until the binary lands on PATH (a global `pnpm link` would close that gap; out of scope here).

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host
- **Background processes still running:** `factoryd` on `127.0.0.1:25295` — **fresh PID 37148 from this session's restart, on the 3.7 build with the new POST `/api/v1/projects` route + ADR 0029 SSE wired correctly.** Stop with `node apps/factory/dist/main.js daemon stop`. `astro dev` on `127.0.0.1:4321` — hot-reloading. **Note:** the CSS fixes are live via Vite HMR but the `<ClientRouter />` removal touches Astro's runtime — a hard refresh (Ctrl+Shift+R) or astro dev restart (`pnpm --filter factory-web dev`) ensures the router runtime drops cleanly. Stop astro by killing its process by PID.

---

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
