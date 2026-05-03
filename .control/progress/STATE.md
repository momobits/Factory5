# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-03 12:10 UTC by /session-end (post step 3.1 — SSE backend + brain wiring shipped)
**Current phase:** 3 — web-ui
**Current step:** 3.2 — wire `directives/detail.astro` to the SSE stream (next; step 3.1 closed)
**Status:** ready (clean working tree; SSE backend infrastructure complete with brain emission wired)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.2 = wire `apps/factory-web/src/pages/directives/detail.astro` to the SSE stream** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.2. Replace the existing one-shot `loadInto<Detail>` polling with an EventSource subscription that incrementally renders task / spend / completion events as they arrive. Add an `apiStream<T>(path)` helper to `apps/factory-web/src/lib/api.ts` that wraps EventSource with token-auth (`?t=<UI_TOKEN>` query param) and reconnect. UX: connection-state pip ("Live" / "Reconnecting" / "Disconnected"), auto-scroll log tail with pause-on-user-scroll, on `directive.completed` stop showing the live indicator and surface the final status. Acceptance: open detail in a second browser tab during a live build and see updates without F5; EventSource reconnects on transient disconnect; polling fallback exercised under a stub that strips SSE.

---

## Git state

- **Branch:** main
- **Last commit:** `772f9f3` — feat(3.1): SSE on /api/v1/directives/:id/stream
- **Uncommitted changes:** none (working tree clean)
- **Last phase tag:** `phase-2-channel-parity-closed` (annotated tag at commit `081b832`)

---

## Open blockers

- None

---

## In-flight work

None. Step 3.1 closed cleanly with all four `pnpm` gates green and the matching `- [x]` flipped in `.control/phases/phase-3-web-ui/steps.md` + `UPGRADE/ROADMAP.md`. The `directive-stream-route.test.ts` "client disconnect" case takes ~4 s (waiting for Node's socket close handler to fire) — not a flake, just a slow path; no follow-up needed unless the suite gets noticeably slower.

---

## Test / eval status

- **Last test run:** 2026-05-03 — full workspace passes (1040 tests across 76 files; +29 from prior baseline: 14 new SSE schemas in `@factory5/ipc` + 15 new SSE route end-to-end tests in `@factory5/daemon`). Daemon now at 152/152, brain at 93/93, channels still 175/175, cli 82/82. All four `pnpm` gates green: build / test / lint / format:check.
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness

---

## Recent decisions (last 3 ADRs)

- ADR 0028 — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- ADR 0027 — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)
- ADR 0026 — pluggable-runtime-contract (assessor pluggable across Python / Node / Go / Rust; env-owning vs env-assuming provisioner; failure-mode taxonomy)

Step 3.1 did not promote a new ADR — the SSE protocol shape is pinned in `UPGRADE/specs/sse-directive-stream.md`; promotion to **ADR 0029 — directive-stream protocol** is deferred until 3.2 ships and the FE consumer validates the wire contract end-to-end.

---

## Recently completed (last 5 steps)

- Step 3.1 — `feat(3.1)`: SSE on `/api/v1/directives/:id/stream` — spec, six Zod event schemas (`task.started` / `task.completed` / `finding.created` / `spend.updated` / `log.line` / `directive.completed`), `DirectiveStreamHub` (subscribe / emit / closeDirective / shutdown), Fastify route via `reply.hijack()` with header-or-`?t=` auth, backfill on connect, 15 s heartbeats, cleanup on disconnect, brain emission threaded through `BrainOptions.emitDirectiveEvent` → serve → inline → loop+pool. `finding.created` and `log.line` emission deferred. — 2026-05-03 — `772f9f3`
- State reconcile — `docs(state)`: reconcile STATE.md last-commit pointer to current HEAD (closed the post-session-end self-reference drift surfaced at the start of this session) — 2026-05-03 — `cce7065`
- Post-phase-2 docs polish — `docs(2)`: documented `factory`/`factoryd` PATH setup in `docs/ONBOARDING.md` §3.5 (three options: pnpm dev scripts / `pnpm link --global` / shell-wrapper functions) — 2026-05-03 — `f7c78ce`
- Phase 2 closed (`chore(phase-2): close phase 2, kick off phase 3`); tag `phase-2-channel-parity-closed` on `081b832`; Phase 3 scaffolded — 2026-05-03 — `384d2d3`
- Post-2.2 UX fix — `fix(2.2)`: project name column in `/status` output across CLI, Discord, Telegram (shared `makeProjectNameLookup` helper) — 2026-05-03 — `081b832`

---

## Attempts that didn't work (current step only)

- None yet — Step 3.2 not started.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace)
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host

---

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
