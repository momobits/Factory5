# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-03 16:35 UTC by drift reconciliation (`/session-start` flagged `commit-mismatch`: STATE.md=`2dfd25f`, HEAD=`96f5883`; option (a) — STATE.md catches up to HEAD before any 3.6 work begins)
**Current phase:** 3 — web-ui
**Current step:** 3.6 — cancel button on directive detail (next; pause deferred per Decision 2 = option C; step 3.5 closed last session)
**Status:** ready (clean working tree; STATE.md cursor reconciled to HEAD `96f5883`; 3.5 shipped across 4 step commits + 1 session-end docs commit (preceded by 1 entering drift-reconcile), all four pnpm gates green at every step commit)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.6 = cancel + pause buttons on directive detail** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.3 (the upgrade-plan numbering lags the phase numbering; tier-3 §3.3 = phase step 3.6 because 3.4 page-conversion + 3.5 chat slotted in between). Cancel is straightforward in shape but has a route-prefix decision to resolve first: Phase 2.4 mounted the cancel route at `/directives/:id/cancel` (no `/api/v1/` prefix) per `packages/daemon/src/server.ts:410`, but the SPA's Bearer-gated namespace is `/api/v1/*` (see how 3.5 mounted `POST /api/v1/chat/messages`). Either (a) move/alias the cancel route to `/api/v1/directives/:id/cancel` and apply `requireUiAuth` (matches the SPA convention; verify CLI `packages/cli/src/commands/cancel.ts` doesn't hit the route directly before moving — Discord/Telegram channel handlers reach cancel via `runCancel` in `command-handlers.ts`, not via HTTP), or (b) keep the existing prefix and have the FE call the existing path with whatever auth gate is already there. After that decision, the FE work is: visible-only-when-`running`-or-`pending`, calls `apiPost`, disables on click, shows "Cancelling..." until SSE reports `directive.completed`. Pause is a separate open design decision — STATE.md "Notes for next session" surfaces three options (extend `directivesQ` status enum / reuse `markBlocked` / defer pause). File pointers: edit `apps/factory-web/src/pages/directives/detail.astro` (the live SSE render path that already owns the page chrome) for the button + handler; edit `packages/daemon/src/server.ts` to land the route move if option (a). Acceptance: click cancel during a build, see status flip to `failed` within a few seconds, see workers terminate (live-smoke against a real factoryd).

---

## Git state

- **Branch:** main
- **Last commit:** `96f5883` — docs(state): session end for step 3.5
- **Uncommitted changes:** none (working tree clean)
- **Last phase tag:** `phase-2-channel-parity-closed` (annotated tag at commit `081b832`)

---

## Open blockers

- None

---

## In-flight work

None. Step 3.5 closed cleanly across 4 step commits (`10efe20..2dfd25f`) plus a session-start drift-reconcile (`d7a366c`); all four `pnpm` gates green at every commit. Three deferred items remain on the 3.x backlog rather than as in-flight work:

- **`<PageShell>` adoption** — optional structural sugar; `<Dashboard>`'s inner `<h2>` still owns each page's title across all 11 pages (10 pre-3.5 + chat). PageShell wiring is gated on the same focused follow-up step that removes Dashboard's `<h2>` and shifts Dashboard's class-based styles to `<style is:global>` (otherwise pages get double `<h2>`s). The follow-up is small and self-contained but has no acceptance dependency from 3.6+ — it can land any time.
- **Dashboard.astro `<style is:global>` adoption** — current `.cards` / `.card` / `.empty` / `.err` / `.btn*` / `.alert*` / `.form-*` / `table`/`th`/`td` rules are scoped, which (per the discovery during 3.4) means Astro doesn't propagate the layout's `data-astro-cid-*` attribute to slot content, so they never matched anything outside Dashboard's own `<header class="shell">` chrome. Component-level scoped CSS (Card/Table/Alert/Form/Field/Submit + chat.astro's bubble styles) carries the visible styling; converting Dashboard's primitives to global would only matter once a future page reaches outside the component library for `.cards` grid wrappers and `<p class="err">` slots that are currently unstyled-by-Dashboard but visually fine.
- **`finding.created` brain emission** — the 3.1 deferred-work counterpart to `log.line` (which shipped this session in commit `10efe20`). Spec carries the event shape; the SSE route forwards it; FE listener wiring is in place via 3.2; brain just doesn't emit yet. Small follow-up: one event per entry in `outcome.result.findingsRaised` from `pool.ts`. No 3.6+ dependency.

---

## Test / eval status

- **Last test run:** 2026-05-03 — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package counts after 3.5: state 152, channels 175, daemon **161** (+9 from chat-route tests), brain **97** (+4 from `loop.test.ts` covering `emitLogLine`), worker 38, worker-sandbox 86 (+ 3 skipped Windows/Linux branches), assessor 79, wiki 64, cli 82, providers 39, ipc 28, events 3, worker-mcp 15, core 14, logger 20. Workspace total +13 vs the prior session's baseline. `factory-web` still has no vitest harness — chat.astro is integration-tested only by the daemon's chat-route tests + manual smoke.
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness

---

## Recent decisions (last 3 ADRs)

- ADR 0028 — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- ADR 0027 — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)
- ADR 0026 — pluggable-runtime-contract (assessor pluggable across Python / Node / Go / Rust; env-owning vs env-assuming provisioner; failure-mode taxonomy)

Step 3.5 did not promote new ADRs. ADR 0029 — directive-stream protocol — remains gated on the FE consumer being smoke-tested end-to-end against a real factoryd. Both ends of the wire now exist (3.1 SSE route, 3.2 FE consumer, 3.5 chat-page consumer + brain log.line emission); the manual smoke against a running daemon is still the last gate before promotion. The chat-page surface in 3.5 is the second consumer of the SSE schemas after directives/detail.astro — the protocol is now exercised by two distinct page paths, which strengthens the case for promotion once the live smoke confirms wire fidelity.

---

## Recently completed (last 5 steps)

- Session-end docs — `docs(state)`: session end for step 3.5. Captures the 3.5 close cursor in STATE.md / journal.md / UPGRADE/LOG.md / next.md; no code changes. — 2026-05-03 — `96f5883`
- Step 3.5 closing — `refactor(3.5)`: close step 3.5 — /app/chat lands; CLI 120s gate stays (flips steps.md + ROADMAP.md boxes; documents the chat-page patterns — bubble layout, auto-scroll-pin, hand-rolled markdown subset, /cmd shortcut path, per-turn stream lifecycle — in `apps/factory-web/src/components/README.md`; carried-forward 2.6 closes implicitly per STATE.md's prior notes — WEB chat surface supersedes the CLI cheap-bump path; CLI's 120s gate stays as a sanity bound). — 2026-05-03 — `2dfd25f`
- Step 3.5 detail — `feat(3.5)`: /app/chat page — composer + history + markdown + /cmd shortcuts (apps/factory-web/src/pages/chat.astro: free-form messages POST /api/v1/chat/messages and subscribe to the directive's SSE stream rendering one bubble per `log.line` event with `component: 'brain.chat'`; slash-prefixed input dispatches client-side to existing /api/v1/{status,spend,findings} GETs; hand-rolled markdown for fenced code / inline code / bold / italic / paragraphs from blank lines; auto-scroll-with-pause-on-user-scroll mirrors directives/detail.astro:284-336 log-tail pattern; ⌘/Ctrl+Enter submits; Clear button purges in-page conversation; astro:before-swap teardown so streams don't outlive their page; Chat link added to dashboard nav). Frontend-design skill invoked before authoring per saved feedback. — 2026-05-03 — `1fa06fa`
- Step 3.5 detail — `feat(3.5)`: POST /api/v1/chat/messages route + IPC schemas (apiV1ChatMessageRequestSchema { message: 1..8192, conversationId?: ulid } + apiV1ChatMessageResponseSchema { directive } in @factory5/ipc; route in packages/daemon/src/server.ts mints intent=chat directive with source='cli', principal='web-ui', channelRef='web-ui-${reqId}'; +9 tests cover 401/503/400 schema rejection paths + happy path with conversationId + multi-tab channelRef distinctness). — 2026-05-03 — `7fcbd10`
- Step 3.5 detail — `feat(3.5)`: emit log.line from brain chat-path (adds emitLogLine helper alongside emitDirectiveCompleted in packages/brain/src/loop.ts; chat branch of runInline emits `{type: 'log.line', component: 'brain.chat', msg: replyText, attrs: {intent, confidence}}` before directive.completed; new `loop.test.ts` covers emitter-undefined-silent + well-formed-event + attrs pass-through + attrs-undefined-key-omitted; brain test count 93 → 97). — 2026-05-03 — `10efe20`

(Earlier this session-pair: `d7a366c` post-3.4 drift reconcile that opened the 3.5 session.)

---

## Attempts that didn't work (current step only)

- None yet — Step 3.6 not started.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host

---

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
