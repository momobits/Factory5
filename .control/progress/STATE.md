# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-03 13:11 UTC by /session-end (post step 3.3 — Astro component library shipped after 3.2 SSE FE wiring)
**Current phase:** 3 — web-ui
**Current step:** 3.4 — convert all 9 pages to use components; retire `el()` (next; steps 3.2 + 3.3 closed this session)
**Status:** ready (clean working tree; SSE FE wiring + component library both shipped, all four pnpm gates green)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.4 = convert every page in `apps/factory-web/src/pages/` to consume the component library** shipped in 3.3 per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.4. Retire `el()` from `apps/factory-web/src/lib/api.ts` once every page is converted. Suggested order (simple → complex): `index.astro` (overview cards → `<Card>`), `findings/index.astro`, `projects/index.astro`, `questions/index.astro`, `spend/index.astro`, `directives/index.astro`, `projects/detail.astro`, `questions/detail.astro`, `build.astro` (forms → `<Form>` + `<Field>` + `<Submit>`), `directives/detail.astro` (live SSE — last; the live-event render path is the trickiest because tasks Map + log tail + connection pip stay JS-driven inside the component shell). After every page is migrated, gut the matching CSS from `layouts/Dashboard.astro` (the per-component scoped CSS replaces it). Acceptance: every page in `pages/` uses the new components; `el()` is gone from `lib/api.ts`; visual regression on each page is identical or better; all four `pnpm` gates green; manual smoke against a real factoryd shows every page renders + functions identically.

---

## Git state

- **Branch:** main
- **Last commit:** `94b8b71` — feat(3.3): astro component library — Card / Table / EmptyState / Alert / Form / PageShell
- **Uncommitted changes:** none (working tree clean)
- **Last phase tag:** `phase-2-channel-parity-closed` (annotated tag at commit `081b832`)

---

## Open blockers

- None

---

## In-flight work

None. Steps 3.2 and 3.3 both closed cleanly; all four `pnpm` gates green at every commit. The component library (3.3) is shipped but **not yet consumed by any page** — that's 3.4's job. Until 3.4 lands, each component duplicates the matching CSS from `layouts/Dashboard.astro` under Astro's auto-scoping; the Dashboard-level CSS is gutted as part of 3.4 once every page has migrated. The drift between `Dashboard.astro` global CSS and the new scoped component CSS is intentional for the duration of the 3.3 → 3.4 transition.

---

## Test / eval status

- **Last test run:** 2026-05-03 — full workspace passes (1040 tests across 73 files, +0 from prior baseline — neither 3.2 nor 3.3 added test files; the SSE FE wiring relies on the existing 152 daemon SSE-route tests for wire shape, and `factory-web` has no vitest harness yet). All four `pnpm` gates green: build / test / lint / format:check.
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness

---

## Recent decisions (last 3 ADRs)

- ADR 0028 — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- ADR 0027 — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)
- ADR 0026 — pluggable-runtime-contract (assessor pluggable across Python / Node / Go / Rust; env-owning vs env-assuming provisioner; failure-mode taxonomy)

Steps 3.2 and 3.3 did not promote new ADRs — the SSE protocol shape is still pinned in `UPGRADE/specs/sse-directive-stream.md` (promotion to **ADR 0029 — directive-stream protocol** is gated on the FE consumer being smoke-tested end-to-end against a real factoryd, which lands in 3.4 once the detail page conversion + manual smoke close the loop). The component library is too small for an ADR — the migration map in `apps/factory-web/src/components/README.md` documents its conventions.

---

## Recently completed (last 5 steps)

- Step 3.3 — `feat(3.3)`: Astro component library — eight server-rendered components under `apps/factory-web/src/components/` (Card / Table / EmptyState / Alert / Form / Field / Submit / PageShell) with typed Props interfaces, scoped CSS mirroring Dashboard.astro's `color-mix(currentColor)` palette, and a README documenting each component + the 3.4 migration map. Library-only — no page consumes them yet. — 2026-05-03 — `94b8b71`
- Step 3.2 — `feat(3.2)`: wire directive detail page to SSE stream — new `apiStream<T>(path, callbacks)` helper in `apps/factory-web/src/lib/api.ts` (token-auth via `?t=` query param, Zod-validated against `directiveStreamEventSchema`, six-state connection machine: connecting → live → reconnecting → polling | disconnected → completed, 5 s polling fallback when EventSource gives up). `directives/detail.astro` rewritten: incremental `Map<taskId, Task>` render, atomic spend swap, log tail panel rendered only after the first `log.line` arrives, connection-state pip in the header. New `./sse` sub-export on `@factory5/ipc` keeps undici / logger out of the FE bundle (multi-entry tsup build emits `dist/sse.js` + `dist/sse.d.ts`). `apps/factory-web` now depends on `@factory5/ipc` workspace:*. — 2026-05-03 — `998e7d8`
- State reconcile — `docs(state)`: reconcile STATE.md last-commit pointer to current HEAD (post-session-end pointer drift surfaced at session start, same pattern as `cce7065`) — 2026-05-03 — `db61baf`
- Session-end docs — `docs(state)`: session end for step 3.1 (STATE.md / journal / next.md updated by `/session-end`) — 2026-05-03 — `15bbad3`
- Step 3.1 — `feat(3.1)`: SSE on `/api/v1/directives/:id/stream` — spec, six Zod event schemas, `DirectiveStreamHub` (subscribe / emit / closeDirective / shutdown), Fastify route via `reply.hijack()` with header-or-`?t=` auth, backfill on connect, 15 s heartbeats, cleanup on disconnect, brain emission threaded through `BrainOptions.emitDirectiveEvent`. — 2026-05-03 — `772f9f3`

---

## Attempts that didn't work (current step only)

- None yet — Step 3.4 not started.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host

---

## Notes for next session

Step 3.4 is the longest sub-step in Phase 3 — converting every page in `apps/factory-web/src/pages/` to consume the component library shipped in 3.3 and retiring `el()` from `apps/factory-web/src/lib/api.ts`. There are 10 page files (the audit said 9 pre-build.astro; current state is 10):

- `index.astro` (Overview — 5 metric cards + intro paragraph)
- `build.astro` (the heavy form — primary candidate for `<Form>` + `<Field>` + `<Submit>`)
- `directives/index.astro`, `directives/detail.astro`
- `findings/index.astro`
- `projects/index.astro`, `projects/detail.astro`
- `questions/index.astro`, `questions/detail.astro`
- `spend/index.astro`

**Suggested order (simple → complex):**

1. `index.astro` — 5 cards. Replace the `card()` helper closure with five `<Card>` invocations server-side (the totals are fetched at runtime, so the value is filled by the `<script>`; either render placeholders and set `.value` from the script, OR fetch in the frontmatter via SSR — but SSR needs the daemon up at build time and we don't want that, so client-side fill is the right call).
2. `findings/index.astro`, `projects/index.astro`, `questions/index.astro`, `spend/index.astro` — each is a list/table page. Replace the inline `<table>` building with `<Table columns rows>` rendered with `rows={[]}` server-side; the script queries `tbody` and appends rows. Empty states swap to `<EmptyState>`.
3. `directives/index.astro`, `projects/detail.astro`, `questions/detail.astro` — same shape but with deeper detail.
4. `build.astro` — convert the form to `<Form>` + `<Field>` + `<Submit>`. The submit handler stays in the page's `<script>` (queries field values by id and posts via `apiPost`).
5. `directives/detail.astro` — last, because it just got rewritten in 3.2 and the live SSE render path stays JS-driven. The conversion here is mostly: header replaced with `<PageShell title="…">` shell + the existing live-event render path still runs in `<script>`.

**`el()` retirement:** After every page is converted, delete the `el()` export from `apps/factory-web/src/lib/api.ts` and grep for any straggler imports. The DOM-creation pattern within `<script>` blocks moves to `document.createElement` + `setAttribute` + `textContent` / `appendChild` directly (or a per-page helper if the page genuinely needs a wrapper).

**Dashboard.astro CSS prune:** Once every page is converted, the duplicated CSS in `layouts/Dashboard.astro` (`.card`, `.cards`, `form.form`, `.form-field`, `.btn`, `.alert`, table styles, `.empty`) can be removed — the per-component scoped CSS replaces it. Keep `.shell`, `header.shell`, `main.shell`, `a.link`, and the chrome / table-base styles in Dashboard since those aren't owned by a single component.

**Acceptance smoke:** Run `pnpm --filter factory-web build` after each page conversion to catch typecheck regressions early. Manual smoke against a real factoryd (open every page in a browser) for the final acceptance — there's no FE vitest harness yet to automate this.

**Optional Solid/Preact island:** Per the tier-3 plan, _"Solid/Preact island per page is optional"_. The detail page's live-event render is a candidate (state + reactivity), but the current vanilla approach works and the Astro design intent is islands-only-where-needed. Defer the island decision until 3.5 (chat) genuinely requires reactive state.

**Carried forward from Phase 2 (Step 2.6 — `factory chat` per-turn timeout):** infrastructure now in place via 3.1's SSE route. Full resolution lands in step 3.5 when the `/app/chat` page routes chat directives through this stream.

**Step 3.1 deferred work (still open):** `finding.created` brain emission and `log.line` forwarder. The FE now has the listener wiring in place via 3.2; emission is still deferred. Either land in a 3.x sub-step or defer to a follow-up tier — neither blocks 3.4.

**Pre-2026-05-03 baseline live-smoke (carried into Phase 3):** Discord+Telegram slash command surfaces are live-verified. Free-form chat re-routing verified. `factory cancel` IPC route paths verified end-to-end. SSE route is unit/integration-tested only — full live-smoke (open a real browser to `/app/directives/detail?id=…` while a build runs) is now testable since 3.2 wired the FE; pin this as part of 3.4's acceptance.

**Loose ends from prior sessions (still open; not blocking 3.4):**

- Synthetic smoke directive in DB (`01KQPDMQE6QTQZ3QMDD69019YK`, status=failed/cancelled) plus a synthetic project (`demo-project`) and its linked directive. Reap with `cd packages/state && node smoke-cleanup.mjs` if you want a clean `factory status`.
- factoryd PID 32436 from prior session may still be running. `factory daemon stop` shuts it down.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
