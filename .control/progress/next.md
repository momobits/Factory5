# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-03T09:16:31Z by
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

Open [`../phases/phase-3-web-ui/README.md`](../phases/phase-3-web-ui/README.md) and [`steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.1 = SSE on `/api/v1/directives/:id/stream`** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.1. Adds an SSE route on the daemon emitting `task.*`, `finding.created`, `spend.updated`, `log.line`, and `directive.completed` events; replaces the polling pattern in `apps/factory-web/src/pages/directives/detail.astro`. The carried-forward Step 2.6 (`factory chat` per-turn timeout) is naturally subsumed by this work — once partial daemon-side progress streams, the 120 s false-timeout problem disappears without a constant bump.

## Notes for next session

Phase 3 brings the web UI from vanilla DOM-in-Astro to real Astro components with live updates via SSE, plus a chat surface and mobile-responsive nav. The phase splits naturally into 3a (SSE + component-library + page conversion) and 3b (chat / projects-new / cancel-pause buttons / spend charts / mobile nav / explicit logout). Issues addressed: U006, U007, U008, U009, U010, U022.

**Carried forward from Phase 2:** Step 2.6 (`factory chat` per-turn timeout) — the cheap path was a bump to 600 s; the better path is partial daemon-side progress streaming. Phase 3.1's SSE route is the natural home for the streaming work — once it ships, the 120 s false-timeout problem disappears for chat as well.

**Step 3.1 design notes:**

- The SSE route is `/api/v1/directives/:id/stream`. Events: `task.*` (created / updated / completed), `finding.created`, `spend.updated`, `log.line`, `directive.completed`. Use Fastify's reply.raw for the SSE pump.
- Author the wire shape in `packages/ipc/src/sse.ts` (or similar) so the brain emits via a single helper. Channel for events: the existing `Doorbell` infra plus a per-directive subscription map.
- Replace the polling loop in `apps/factory-web/src/pages/directives/detail.astro` with an EventSource subscription. Keep the polling fallback for browsers behind a proxy that strips SSE.
- Spend page (`/app/spend/index.astro`) should also subscribe — every `spend.updated` event refreshes the rollup. Tests: a vitest-backed harness driving the SSE route end-to-end.

**Pre-2026-05-03 baseline live-smoke (carried into Phase 3):** Discord+Telegram slash command surfaces are live-verified. Free-form chat re-routing (Telegram private chat; Discord with @-mention) verified. `factory cancel` IPC route paths verified (NOT_FOUND / ALREADY_TERMINAL / OK + CLI exit codes 0/2/3); subprocess-kill chain not live-smoked this phase but unit-test coverage is dense (30 tests across pool / registry / state / daemon / CLI).

**Loose ends from this session (operator may want to clean before Phase 3):**

- Synthetic smoke directive in DB (`01KQPDMQE6QTQZ3QMDD69019YK`, status=failed/cancelled) plus a synthetic project (`demo-project`) and its linked directive — both inserted by the live-smoke probes. `packages/state/smoke-cleanup.mjs` reaps them. The Bash sandbox denies direct `node` invocation against the DB without operator approval; run manually with `cd packages/state && node smoke-cleanup.mjs` if you want a clean `factory status`.
- factoryd PID 32436 still running (started at 09:20 UTC for live-smoke). `factory daemon stop` (or any of the §3.5 invocation forms) shuts it down.
- The `.factory1/` line that briefly appeared in `.gitignore` got cleaned at some point during this session (working tree is clean as of session-end). If it re-surfaces, source-trace via `git blame` on a future commit.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
