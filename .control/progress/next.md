# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-03T13:14:10Z by
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

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.4 = convert every page in `apps/factory-web/src/pages/` to consume the component library** shipped in 3.3 per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.4. Retire `el()` from `apps/factory-web/src/lib/api.ts` once every page is converted. Suggested order (simple → complex): `index.astro` (overview cards → `<Card>`), `findings/index.astro`, `projects/index.astro`, `questions/index.astro`, `spend/index.astro`, `directives/index.astro`, `projects/detail.astro`, `questions/detail.astro`, `build.astro` (forms → `<Form>` + `<Field>` + `<Submit>`), `directives/detail.astro` (live SSE — last; the live-event render path is the trickiest because tasks Map + log tail + connection pip stay JS-driven inside the component shell). After every page is migrated, gut the matching CSS from `layouts/Dashboard.astro` (the per-component scoped CSS replaces it). Acceptance: every page in `pages/` uses the new components; `el()` is gone from `lib/api.ts`; visual regression on each page is identical or better; all four `pnpm` gates green; manual smoke against a real factoryd shows every page renders + functions identically.


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