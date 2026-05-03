# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-03T09:00:00Z by
> `/phase-close` (phase 2 closed). Edit STATE.md's "Next action"
> or "Notes for next session" to influence this prompt; **do not edit
> next.md by hand** — it's overwritten on every session end.

## Bootstrap

Run `/session-start` first — it surfaces the current `[control:state]` block, drift warnings, and a recommended next action. This file mirrors STATE.md's "Next action" so you can read it directly if you'd rather skip the slash command.

## Status snapshot

- **Branch:** main
- **Last commit:** `081b832` — fix(2.2): show project name in /status output
- **Last phase tag:** `phase-2-channel-parity-closed` (annotated, on `081b832`)
- **Working tree:** clean as of `/phase-close`
- **Tests:** all four `pnpm` gates green; full workspace passes (channels 175, cli 82, total ≥ 938 plus the new Phase 2 tests).

## Next action

Open [`../phases/phase-3-web-ui/README.md`](../phases/phase-3-web-ui/README.md) and [`steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.1 = SSE on `/api/v1/directives/:id/stream`** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.1.

Adds an SSE route on the daemon emitting `task.*`, `finding.created`, `spend.updated`, `log.line`, and `directive.completed` events; replaces the polling pattern in `apps/factory-web/src/pages/directives/detail.astro`. The carried-forward Step 2.6 (`factory chat` per-turn timeout) is naturally subsumed by this work — once partial daemon-side progress streams, the 120 s false-timeout problem disappears without a constant bump.

## Notes for next session

Phase 3 brings the web UI from vanilla DOM-in-Astro to real Astro components with live updates via SSE, plus a chat surface and mobile-responsive nav. The phase splits naturally into 3a (SSE + component-library + page conversion: 3.1–3.4) and 3b (chat / projects-new / cancel-pause buttons / spend charts / mobile nav / explicit logout: 3.5–3.10). Issues addressed: U006, U007, U008, U009, U010, U022.

**Carried forward from Phase 2:** Step 2.6 (`factory chat` per-turn timeout) — Phase 3.1's SSE route is the natural home for the streaming work; once it ships, the 120 s false-timeout problem disappears for chat as well.

**Pre-Phase-3 baseline live-smoke (carried from Phase 2):** Discord+Telegram slash commands, free-form chat re-routing (Telegram private chat; Discord with @-mention), `factory cancel` IPC route paths verified. Subprocess-kill chain not live-smoked but unit-test coverage is dense.

**Code-touching surfaces likely for Phase 3:**

- `packages/daemon/src/server.ts` — new SSE route + per-directive subscription map
- `packages/ipc/src/sse.ts` (new) — wire shape for SSE events
- `apps/factory-web/src/components/` (new dir) — Astro component library
- `apps/factory-web/src/pages/` — convert all 9 pages; new chat / projects-new pages
- `apps/factory-web/src/lib/api.ts` — retire `el()`

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
