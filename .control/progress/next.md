# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-05T18:29:41Z by
> `.claude/hooks/regenerate-next-md.sh`. Edit STATE.md's "Next action"
> or "Notes for next session" to influence this prompt; **do not edit
> next.md by hand** -- it's overwritten on every session end.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` -- the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you
see a structured `[control:state]` block instead of doing them by hand.

## Next action

Live-smoke step 3.7's full flow against a restarted factoryd (the long-running daemon on `127.0.0.1:25295` is the pre-3.7 build and 404s the new `POST /api/v1/projects` route). Stop + restart factoryd (`factory daemon stop` then `factory daemon start`, or kill the process and re-run), open `/app/projects/new?t=<token>` (or via the dashboard's `+ New project` link from `/app/projects/`), submit a real project (e.g. name `node-sse-smoke`, language `node`, optional CLAUDE.md asking the architect to add a non-trivial verifier-flagged feature so the build produces findings). Verify: scaffolded files at `<workspace>/<name>/{CLAUDE.md, .factory/project.json}`, redirect to `/app/projects/detail?id=<id>`, project visible at `/app/projects/`, then kick a build at `/app/build` against the new project, watch `directives/detail` for SSE events including `finding.created` (the still-open phase-3 acceptance gap from ADR 0029's Live verification section). After the smoke lands cleanly, single close commit `refactor(3.7): close step 3.7` flips `- [ ] 3.7` → `- [x] 3.7` in [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md) and ticks the matching item in [`../../UPGRADE/ROADMAP.md`](../../UPGRADE/ROADMAP.md). Per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.7. Phase 3 has 3.8 / 3.9 / 3.10 / 3.11 still open after that.

## Notes for next session

Step 3.7 is **code-complete**. Three commits landed plus a drift reconcile; all four `pnpm` gates green at the end of every commit; workspace test count 1063 → 1075. The remaining work is the live-smoke + a single close commit.

**Live-smoke + 3.7 close (recommended next):**

1. **Restart factoryd** to pick up commit (b)'s new POST `/api/v1/projects` route — the stale background daemon on port 25295 was loaded with the pre-3.7 build. `factory daemon stop && factory daemon start` (or process kill + restart). Astro dev on 4321 already has the new page hot-reloaded.
2. **Run the smoke**, ideally combined with the still-open phase-3 acceptance smoke that closes ADR 0029's `finding.created` live-verification gap:
   - Open `/app/projects/new` (via the dashboard's `+ New project` link from `/app/projects/`, or directly).
   - Submit a real project that the assessor will produce findings on — e.g. name `node-sse-smoke`, language `node`, optional CLAUDE.md asking the architect to add a verifier-flagged feature (per the prior smoke lesson: pick a project that naturally produces findings, not the trivial `add(a, b)`). Use `--autonomy autonomous` if you want unattended; `assisted` parks at architect→planning + planning→execution and needs 2 askUser answers.
   - Verify: scaffolded `<workspace>/<name>/{CLAUDE.md, .factory/project.json}`, redirect to `/app/projects/detail?id=<id>` on success, project visible at `/app/projects/`.
   - Kick a build at `/app/build` against the new project; watch `directives/detail` SSE for `finding.created` events (the gap pinned in ADR 0029's Live verification section).
3. **Close commit** `refactor(3.7): close step 3.7` — flips `- [ ] 3.7` → `- [x] 3.7` in `.control/phases/phase-3-web-ui/steps.md` and ticks the matching item in `UPGRADE/ROADMAP.md`. Same shape as `dfd1a07` (3.4 close) and `0f5775a` (3.6 close).

**After 3.7 closes**, Phase 3 still has 4 step commits + one phase-close commit ahead:

- **3.8** — Spend page charts. Sparkline per project (last 14 days) + 30-day stacked bar of daily totals split by project. Vanilla SVG, no chart-lib dep. Per `tier-3-web-ui-live-and-complete.md` §3.8.
- **3.9** — Mobile-responsive nav. Hamburger drawer at ≤768px; primary actions reachable in two taps at 375px.
- **3.10** — Explicit logout + connection-status indicator in header. SSE-heartbeat-backed pip; clears session token on logout.
- **3.11** — `/phase-close` (tags `phase-3-web-ui-closed`, scaffolds Phase 4).
- Plus the **Deferred follow-ups** still open in `phase-3-web-ui/steps.md`: pause primitive (when a workflow signal demands it), PageShell + `<style is:global>` migration (11-page structural sweep — would also fix the Submit-invisible bug), pre-3.5 baseline live-smoke (mostly closed by the 2026-05-05 smoke + the upcoming 3.7 acceptance).

**Carry-forward bugs / cleanup (not blocking 3.8 or beyond):**

- **Submit button invisible** (`Submit.astro` `.btn-primary` `color: Canvas` issue) will repro on the new `/app/projects/new` form too — same `<style is:global>` follow-up will fix all dashboard buttons in one sweep.
- **Control framework repo** at `G:\Projects\Small-Projects\Control` — operator's go on 2.2.3 publish.
- **Smoke residue from prior session** — optional reap via `cd packages/state && node smoke-cleanup.mjs` + `rm -rf C:\Users\Momo\factory5-workspace\smoke-demo\`.

**Frontend-design judgement calls captured during 3.7 commit (c)** worth recalling for 3.8 / 3.9 / 3.10:

- **Inherit, don't invent.** The dashboard's existing aesthetic is utilitarian-functional (`system-ui`, `color-mix(currentColor)` palette adapting to `color-scheme: light dark`); the page-design move is to apply frontend-design *principles* (hierarchy, affordance copy, friction-aware errors, smart defaults) within that aesthetic, not introduce a new palette / typography.
- **Hint copy teaches the consequence, not the shape.** "Drives the per-language CLAUDE.md scaffold and the assessor runtime on subsequent builds" beats "Pick a language" — the operator already knows what a select does; what they don't know is what choosing affects downstream.
- **Empty submit fields ≠ explicit empty.** `body.claudeMd` is sent only when the textarea has non-whitespace content; sending `claudeMd: ''` would override the per-language scaffold with nothing. Same pattern transfers to 3.8/3.9 forms (don't conflate "not specified" with "explicitly cleared").
- **Skipping the global nav addition** when an in-context affordance covers discoverability is the cleaner UX — `+ New project` on the projects list page beats a 9th nav item. Plan recommended nav; this was an intentional deviation in the lighter direction (recorded in `53e4e98`'s body).

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
