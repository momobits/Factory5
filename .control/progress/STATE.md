# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-03 14:25 UTC by drift reconciliation (`/session-start` flagged `commit-mismatch`: STATE.md=`dfd1a07`, HEAD=`1a845f5`; option (b) — STATE.md catches up to HEAD before any 3.5 work begins)
**Current phase:** 3 — web-ui
**Current step:** 3.5 — `/app/chat` page (next; step 3.4 closed this session)
**Status:** ready (clean working tree; STATE.md cursor reconciled to HEAD `1a845f5`; 3.4 shipped across 7 step commits + 1 session-end docs commit, all four pnpm gates green at the closing commit)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.5 = add `/app/chat` page — browser mirror of `factory chat`** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.5. Three new surfaces: (i) `apps/factory-web/src/pages/chat.astro` — history pane + composer + markdown-rendered replies + auto-scroll-with-pause-on-user-scroll; (ii) `POST /api/v1/chat/messages` route in `packages/daemon/src/server.ts` that mints an `intent=chat` directive and returns its id so the page can subscribe to its SSE stream for the reply; (iii) request/response shapes in `packages/ipc/src/schemas.ts`. Reuse Phase 2's `packages/channels/src/command-handlers.ts` for the optional `/cmd` shortcut path (web typed `/status` / `/spend` / `/findings` should hit the same handler set the chat-shaped messages from Discord/Telegram do, keeping the three surfaces in lockstep). The SSE stream wiring lands for free — `apiStream` from 3.2 already does token-auth + Zod-validate + connection-state machine + polling fallback; the chat page subscribes to the new directive's stream and renders one bubble per `log.line` event. Acceptance: chat from a real browser round-trips to a real factoryd, replies stream incrementally, the carried-forward Step 2.6 (`factory chat` per-turn timeout) resolves implicitly because streaming partial daemon-side progress means the 120 s false-timeout disappears for chat just as it did for builds.

---

## Git state

- **Branch:** main
- **Last commit:** `1a845f5` — docs(state): session end for step 3.4
- **Uncommitted changes:** none (working tree clean)
- **Last phase tag:** `phase-2-channel-parity-closed` (annotated tag at commit `081b832`)

---

## Open blockers

- None

---

## In-flight work

None. Step 3.4 closed cleanly across 7 commits (`32bdfb6..dfd1a07`); all four `pnpm` gates green at every commit. Two items deferred during 3.4 are filed as 3.x backlog rather than in-flight work:

- **`<PageShell>` adoption** — optional structural sugar; `<Dashboard>`'s inner `<h2>` still owns each page's title across all 10 pages. PageShell wiring is gated on the same focused follow-up step that removes Dashboard's `<h2>` and shifts Dashboard's class-based styles to `<style is:global>` (otherwise pages get double `<h2>`s). The follow-up is small and self-contained but has no acceptance dependency from 3.5+ — it can land any time.
- **Dashboard.astro `<style is:global>` adoption** — current `.cards` / `.card` / `.empty` / `.err` / `.btn*` / `.alert*` / `.form-*` / `table`/`th`/`td` rules are scoped, which (per discovery during 3.4) means Astro doesn't propagate the layout's `data-astro-cid-*` attribute to slot content, so they never matched anything outside Dashboard's own `<header class="shell">` chrome. Component-level scoped CSS (Card/Table/Alert/Form/Field/Submit) carries the visible styling; converting Dashboard's primitives to global would only matter once a future page reaches outside the component library for `.cards` grid wrappers and `<p class="err">` slots that are currently unstyled-by-Dashboard but visually fine.

---

## Test / eval status

- **Last test run:** 2026-05-03 — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package counts: state 152, channels 175, daemon 152, brain 93, worker 38, worker-sandbox 86 (+ 3 skipped Windows/Linux branches), assessor 79, wiki 64, cli 82, providers 39, ipc 28, events 3 — same baseline as the prior session. Step 3.4 added zero test files (page conversions; `factory-web` still has no vitest harness).
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness

---

## Recent decisions (last 3 ADRs)

- ADR 0028 — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- ADR 0027 — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)
- ADR 0026 — pluggable-runtime-contract (assessor pluggable across Python / Node / Go / Rust; env-owning vs env-assuming provisioner; failure-mode taxonomy)

Step 3.4 did not promote new ADRs — refactor-only step. ADR 0029 — directive-stream protocol — remains gated on FE consumer being smoke-tested end-to-end against a real factoryd; the FE consumer is now structurally complete (3.2 wired + 3.4 converted), so the manual smoke against a running daemon is the last gate before promotion. Component library is too small for an ADR — `apps/factory-web/src/components/README.md` documents conventions + the (now-completed) migration map + the two design notes from 3.4 (Dashboard CSS scoping discovery + PageShell deferral).

---

## Recently completed (last 5 steps)

- Session-end docs — `docs(state)`: session end for step 3.4. Captures the 3.4 close cursor in STATE.md / journal.md / UPGRADE/LOG.md / next.md; no code changes. — 2026-05-03 — `1a845f5`
- Step 3.4 closing — `refactor(3.4)`: retire el() + loadInto() from lib/api.ts; close step 3.4 (flips steps.md + ROADMAP.md boxes; documents the Dashboard-CSS scoping discovery and the deferred-PageShell decision in components/README.md). Final commit of a 7-commit run spanning `32bdfb6..dfd1a07`. — 2026-05-03 — `dfd1a07`
- Step 3.4 detail — `refactor(3.4)`: inline el() helper into directives/detail.astro (the live SSE render path's per-page DOM helper exception per the migration map). — 2026-05-03 — `a405556`
- Step 3.4 detail — `refactor(3.4)`: convert build.astro to <Form> + <Field> + <Submit> (the primary form use case; project options runtime-populated by script via `id`-based targeting; hidden-Alert-placeholder pattern for top-error / form-error / empty-projects slots). — 2026-05-03 — `58d4584`
- Step 3.4 detail — `refactor(3.4)`: convert directives list + project/question detail pages (introduces hidden-Alert-placeholder pattern for dynamic conflict/success swapping; conditional answer-form-wrapper pattern for questions/detail). — 2026-05-03 — `e849aa7`

(Earlier 3.4 commits in this session: `a876608` projects/questions/spend list pages → <Table> + <Alert>; `d55c41d` findings list + Table id?/loading? extension; `32bdfb6` index.astro → <Card> with Card id? extension; `54c0f20` post-3.3 reconcile.)

---

## Attempts that didn't work (current step only)

- None yet — Step 3.5 not started.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host

---

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
