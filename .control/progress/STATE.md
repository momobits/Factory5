# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-05 23:35 UTC by `/session-end` (post step 3.10 closed; three steps landed this session — 3.8 spend charts, 3.9 mobile-responsive nav, 3.10 logout + connection-status pip)
**Current phase:** 3 — web-ui
**Current step:** 3.11 — `/phase-close` (tags `phase-3-web-ui-closed`; promotes ADR 0029 past gated state; scaffolds Phase 4)
**Status:** ready (clean working tree post step-3.10 close commit; all four `pnpm` gates green at every commit; workspace test count 1080 + 3 skipped — state +5 this session for `perDayPerProject` coverage; 3.9 + 3.10 were layout-only with no test deltas)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Run `/phase-close`. Phase 3 is complete: every step in [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md) flipped to `[x]` (3.1 → 3.10) and three deferred follow-ups remain (Pause primitive, PageShell adoption + Dashboard `<style is:global>` migration, pre-3.5 baseline live-smoke chat-page click-test) — none are 3.x acceptance dependencies, and per the steps.md "Deferred follow-ups" header all are explicitly free to land any time before `/phase-close` (or be carried into Phase 4). The `/phase-close` skill will: (i) tag `phase-3-web-ui-closed` annotated at HEAD; (ii) append a session entry to [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) summarizing the phase; (iii) tick remaining Tier 3 boxes in [`../../UPGRADE/ROADMAP.md`](../../UPGRADE/ROADMAP.md) (none left as of step-3.10 close); (iv) promote ADR 0029 (`directive-stream-protocol`) past the gated state — the Live verification carve-out can be retired since all six event types are confirmed live (closed in step 3.7's smoke); (v) scaffold Phase 4 (`cli-completion`) at `.control/phases/phase-4-cli-completion/{README.md,steps.md}` per [`../architecture/phase-plan.md`](../architecture/phase-plan.md). One smoke remaining as a 30-second click-test before the close: open `/app/chat` against a live factoryd, type a question, verify the streamed reply renders end-to-end (the only piece of Phase 3.5's pre-existing work without a dedicated live smoke). Background processes still running: factoryd PID 21776 → may have rotated again; live URL via `factory ui-token`. Astro dev on `127.0.0.1:4321`.

---

## Git state

- **Branch:** main
- **Last commit:** `80b9bec` — refactor(3.10): close step 3.10 — logout + connection pip live
- **Uncommitted changes:** none (working tree clean post session-end commit; this commit itself will create the steady-state lag-by-1 the runbook documents — 8th occurrence now, same shape as `561da90` / `1c6eeaf` / `288603e` / `06e7460`-folded predecessors)
- **Last phase tag:** `phase-2-channel-parity-closed` (annotated tag at commit `081b832`) — about to be superseded by `phase-3-web-ui-closed` at next session's `/phase-close`

---

## Open blockers

- None

---

## In-flight work

None — step 3.10 closed; tree clean.

Carry-forward items outside the work cursor (none block 3.11):

- **Smoke residue accumulated.** Two projects from prior sessions persist in the DB + workspace: `node-sse-smoke` (id `01KQWT6T6STXT4BFB5MC9QF9E6`) at `C:\Users\Momo\factory5-workspace\node-sse-smoke\`; `smoke-demo` (id `01KQW30T5274QGSEHHVZTRQ953`) at `C:\Users\Momo\factory5-workspace\smoke-demo\`. Plus 2 cancelled directives (`01KQW3D4CZ84ZFHFKYEP7BWQBX`, `01KQWDWRQD08X3BEYEQNAD6M23`) and the new node-sse-smoke build's directive (`01KQWTCSTNTXXKYAGC75FM3BJ3`). Optional cleanup via `cd packages/state && node smoke-cleanup.mjs` + workspace dir removal.
- **Filter-form Apply buttons + "Clear all defaults"** still render as user-agent default `<button>` on five sites: `pages/spend/index.astro:20`, `pages/findings/index.astro:40`, `pages/questions/index.astro:20`, `pages/directives/index.astro:24` (all `<button type="submit">Apply</button>` raw), and `pages/projects/detail.astro:64` (raw `<button class="btn btn-danger">Clear all defaults</button>`). Dashboard.astro's scoped styles don't reach slotted page content. The deferred PageShell + `<style is:global>` migration absorbs all five — self-contained ~1 commit when authored. Could land before /phase-close as a "loose-ends sweep" or carry into Phase 4.
- **Inline `style=` attributes** scattered across pages (e.g., `pages/projects/detail.astro:14-30`, the chart titles in `pages/spend/index.astro` `style="margin-top: 1.5rem;"`, etc.) — same PageShell migration absorbs these. Multiple-target inline-style audit pass when the migration lands.
- **Control framework repo** (`G:\Projects\Small-Projects\Control`) still has uncommitted upstream patches matching local `e5ec723`. Operator owns the go for 2.2.2 → 2.2.3 publish.
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 self-reference drift remains unaddressed across **8 occurrences** now (`cce7065` / `db61baf` / `54c0f20` / `d7a366c` / `288603e` / `317d94b` / `06e7460`-folded reconcile / this session's pending session-end commit). Two structural options: track "last work commit" rather than HEAD (semantic shift), or amend STATE.md post-commit (hook complexity). Worth filing as ergonomic infrastructure work in the next quiet session — could happen during Phase 4's CLI completion if convenient.
- **ADR 0029 promotion past gated state** still pinned to `/phase-close` (3.11) per the ADR's Live verification section. The live-verification gap was closed in 3.7's smoke (six event types confirmed end-to-end); the structural promotion (retire the unit-test-only carve-out via amendment) happens at phase close.
- **Plan-vs-steps.md numbering offset.** The tier-3 plan (`UPGRADE/plans/tier-3-web-ui-live-and-complete.md`) numbers 3.8 = mobile-responsive nav and 3.9 = logout + connection pip; steps.md numbers 3.9 = mobile-responsive nav and 3.10 = logout + connection pip (because steps.md added 3.4 "convert all pages" which the plan didn't enumerate, then swapped 3.3/3.4 + 3.5/3.6). Documented in step-3.9 close commit body. Not blocking — STATE.md tracks steps.md as cursor.

---

## Test / eval status

- **Last test run:** 2026-05-05 — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package counts updated this session: **state 152 → 157** (+5 for `perDayPerProject` coverage in 3.8). Other packages unchanged: channels 175, daemon 173, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli 78, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. **Workspace total 1080 passing + 3 skipped** (was 1075 + 3 skipped before this session).
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness. ADR 0029's `finding.created` live-verification gap remains **closed** (closed in 3.7's smoke, F001 emitted live by the assessor on `node-sse-smoke`'s build). Step 3.10's heartbeat exercises the pre-existing `/api/v1/status` route; that route is covered by `server.test.ts` 401-without-bearer + bearer-gated happy-path cases — no new test layer needed for layout-side polling.

---

## Recent decisions (last 3 ADRs)

- **ADR 0029 — directive-stream-protocol** (Accepted 2026-05-05) — Live verification § gap closed in 3.7's smoke; ADR is ready for promotion past gated state at `/phase-close` via a docs amendment retiring the unit-test-only carve-out.
- **ADR 0028 — worker-sandbox-contract** (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- **ADR 0027 — web-ui-mutation-surface** (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)

---

## Recently completed (last 5 steps)

- Step 3.10 close — `refactor(3.10)`: close step 3.10 — logout + connection pip live. Flipped `[x] 3.10` in [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md) and the matching tick in [`../../UPGRADE/ROADMAP.md`](../../UPGRADE/ROADMAP.md). Three commits this step: `d544192` (feat: header pip + heartbeat + signed-out banner + dual logout buttons), `3cecb72` (fix: 401 short-circuit + named recovery command in pip hover + ONBOARDING.md amendment), `80b9bec` (close). Live smoke validated against factoryd PID 21776 + post-restart fresh PID/token: pip cycled green → amber Reconnecting → red Disconnected on daemon stop, recovered to green on restart-with-fresh-URL, signed-out flow lands on the banner, and the 401 short-circuit now surfaces "Session expired" with `factory ui-token` named in the hover tooltip. — 2026-05-05 — `80b9bec`
- Step 3.10 fix — `fix(3.10)`: surface stale-token case + name the recovery command. Operator smoke surfaced the gap: post-daemon-restart, the page's stored bearer goes stale (token rotates per startup per ADR 0025); the heartbeat's generic 3-failure cycle was misleading because polling can't recover from 401. Short-circuit on 401 directly to red `disconnected` with terse visible label "Session expired" and a verbose hover tooltip naming `factory ui-token`. ONBOARDING.md §6 troubleshooting entry extended to mention the in-UI signal alongside the DevTools 401 cue. — 2026-05-05 — `3cecb72`
- Step 3.10 feat — `feat(3.10)`: explicit logout + connection-status pip in header. Header gains a status pip + Sign out button; layout-level heartbeat (30s poll on `/api/v1/status`) drives the pip across all pages. State machine: 0 failures → green `Connected`; 1-2 → amber `Reconnecting…`; 3+ consecutive failures → red `Disconnected`; no token in store → straight to red labeled `Signed out`. Two `data-logout` buttons (one in the desktop header, one inside the hamburger drawer at mobile) share a single click handler — `clearToken()` + redirect to `/app/?logged-out=1`. Logged-out banner rendered hidden in the layout; JS unhides on `?logged-out=1` URL param then strips it via `history.replaceState`. Intentional theme-independent green/amber/red colors (#2a8 / #d80 / #c24) so traffic-light semantics read in both light + dark via muscle memory. `aria-live="polite"` on the pip wrapper announces state transitions. — 2026-05-05 — `d544192`
- Step 3.9 close — `refactor(3.9)`: close step 3.9 — mobile-responsive nav live. Flipped `[x] 3.9` + ROADMAP tick. — 2026-05-05 — `8364e75`
- Step 3.9 feat — `feat(3.9)`: mobile-responsive nav with hamburger drawer. Header gains a `<details>`-based hamburger drawer at ≤768px (zero JS, native semantics, keyboard- + screen-reader-friendly, auto-closes on link nav since each click is a fresh page load); Dashboard CSS adds `@media (max-width: 768px)` to hide inline nav + reveal the drawer; `@media (max-width: 640px)` stacks paired-column `.form-row` to single column so two-up form fields don't compress at phone widths. `Table.astro` now wraps the `<table>` in a `.table-wrap` div with `overflow-x: auto` so wide data-dense tables can scroll horizontally inside their container at narrow viewports without forcing the whole page to h-scroll. Hamburger glyph (three currentColor bars) animates into a × via 120ms transform when the drawer is open; 44×44px tap target per Apple HIG. — 2026-05-05 — `5a15b1a`

---

## Attempts that didn't work (current step only)

- None — step 3.10 closed cleanly. Cleared on step boundary (cursor moves to 3.11 next session).
- Worth recording from this session for future reference: the 3.10 heartbeat's initial design treated all `apiFetch` failures uniformly via the 3-consecutive-failures cycle. Operator smoke caught the resulting bad UX immediately: after a daemon restart the stored token is stale (token rotates per startup), so the 401 cycle pinned the pip in `Reconnecting…` indefinitely (or progressed to `Disconnected` after 90s) without telling the operator the actionable fix. Single-commit fix in `3cecb72`: detect 401 via `err instanceof ApiError && err.status === 401`, short-circuit to disconnected with a "Session expired" label, and use the hover tooltip (separate from the visible label) to name `factory ui-token` directly. The lesson: error-class differentiation matters when the recovery path differs — generic retry semantics hide actionable signals.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host
- **Background processes still running:** `factoryd` on `127.0.0.1:25295` — fresh PID from this session's mid-session restart (was PID 37148 at session start, restarted to PID 21776 mid-session for the 3.8 daemon-side build, may have rotated again during 3.10 smoke). Stop with `node apps/factory/dist/main.js daemon stop` (CLI library exports at `packages/cli/dist/index.js` are NOT runnable — see prior session's tooling discovery). Get the live URL via `factory ui-token` (or `node apps/factory/dist/main.js ui-token`). `astro dev` on `127.0.0.1:4321` — hot-reloading. **Note:** the layout-level `<script>` runs once per pageload; if you change Dashboard.astro's script during dev, hard-refresh (Ctrl+Shift+R) to pick up the new bundle.

---

## Notes for next session

Step 3.10 is **closed**. Three steps landed this session: 3.8 spend charts (2 commits: daemon-side perDayPerProject rollup + page-side SVG charts), 3.9 mobile-responsive nav (1 feat + 1 close), 3.10 logout + connection pip (1 feat + 1 follow-up fix + 1 close). Workspace tests 1075 → 1080 + 3 skipped (state +5 from `perDayPerProject` coverage; 3.9/3.10 are layout-only).

**Step 3.11 — `/phase-close` (recommended next):**

Run `/phase-close`. The skill:
1. **Verifies done criteria.** All sub-step checkboxes in `phase-3-web-ui/steps.md` flipped to `[x]` (3.1 → 3.10) — confirmed at session-end. Three deferred follow-ups remain in the "Deferred follow-ups" section but are explicitly not 3.x acceptance dependencies.
2. **Tags the phase boundary.** Annotated tag `phase-3-web-ui-closed` at HEAD per `${CONTROL_PHASE_CLOSE_TAG_FORMAT}`.
3. **Appends to UPGRADE/LOG.md.** Phase summary covering the 11 sub-steps (3.1-3.10 + the deferred bucket) and the cumulative test-count delta from phase-2 baseline.
4. **Ticks remaining ROADMAP boxes.** All Tier 3 ROADMAP items already ticked through step-3.10 close — no remaining Tier 3 boxes; the Tier 3 close itself is the wrap.
5. **Promotes ADR 0029 past gated state.** Docs amendment to `docs/decisions/0029-directive-stream-protocol.md` retiring the unit-test-only carve-out in the Live verification section — six event types now confirmed live end-to-end (4 from 2026-05-05 prior session smokes + cancel round-trip + this session's `finding.created` from 3.7's smoke).
6. **Scaffolds Phase 4.** `.control/phases/phase-4-cli-completion/{README.md,steps.md}` per `phase-plan.md`'s Phase 4 entry. The Phase 4 plan in `UPGRADE/plans/tier-4-cli-completion.md` lists the sub-steps to enumerate.

**One smoke remaining as a 30-second click-test before the close** (carry-forward from prior session, recorded in steps.md "Deferred follow-ups"): open `/app/chat` against a live factoryd, type a question, verify the streamed reply renders end-to-end. The 3.6 cancel acceptance smoke + 3.7 acceptance smoke covered the directive-detail page condition; the chat-page click-test is the remaining piece of Phase 3.5 without a dedicated live smoke. Pin this as part of the `/phase-close` smoke.

**Deferred follow-ups still open in `phase-3-web-ui/steps.md`** (three items, none block /phase-close):

- **Pause primitive on directive detail.** Defer until a real workflow signal demands it. Choose between Option A (`directivesQ.status` enum extension) and Option B (`markBlocked` reuse with `blockedReason: 'paused-by-operator'`) when the signal lands.
- **PageShell adoption + Dashboard `<style is:global>` migration.** 11-page structural sweep that would also (a) eliminate the carry-forward "Clear all defaults" + 4× filter-form Apply buttons unstyled-button issue, (b) consolidate inline `style=` attributes scattered across pages, (c) move Dashboard.astro's currently-scoped `.btn*` / `.alert*` / `.form-*` rules to global so raw page buttons inherit them. Self-contained ~1 commit when authored. Could land before /phase-close as a "loose-ends sweep" or carry into Phase 4 — operator's call.
- **Pre-3.5 baseline live-smoke (chat-page click-test)** — the remaining 30-second piece. Pin as part of the /phase-close smoke per #6 above.

**Carry-forward bugs / cleanup (not blocking 3.11 or beyond):**

- **Smoke residue cleanup** is optional. Two projects + 3 cancelled-or-completed directives in DB; corresponding workspace dirs on disk. See In-flight work § for paths.
- **Control framework repo** at `G:\Projects\Small-Projects\Control` — operator's go on 2.2.3 publish.
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 drift, now at 8 occurrences. Not load-bearing; ergonomic.

**Frontend-design judgement calls captured this session worth carrying forward:**

- **Smart defaults read better than manual rendering at the empty case.** 3.8's sparkline + stacked bar always render the 14- and 30-day windows anchored on today UTC, regardless of data — trailing empty days render as visible gaps, which is honest and avoids "no chart at all" empty states for fresh databases. Same principle would apply to any future dashboard widget.
- **Native HTML elements beat custom widgets when semantics align.** 3.9's hamburger uses `<details>`/`<summary>` — zero JS, native a11y, keyboard support out of the box, auto-closes on navigation since each click is a fresh page load. The aesthetic restraint (no animation flourishes beyond the 120ms hamburger→× rotate) keeps the operator tool feeling like a tool.
- **Theme-independent intentional colors for status semantics.** 3.10's pip uses fixed `#2a8` (green) / `#d80` (amber) / `#c24` (red) instead of theme-aware colors because operators recognize traffic-light semantics on muscle memory; mid-luminance shades read on both light and dark canvases without per-theme branching.
- **Error-class differentiation matters when the recovery path differs.** 3.10's initial heartbeat treated all failures uniformly via 3-consecutive-failures cycle; operator smoke caught that 401 (stale token) needs a different treatment because polling can't recover from it. Short-circuit on 401 with a label that names the recovery command — generic retry semantics hide actionable signals.
- **Visible label vs. hover title separation.** 3.10's `setStatus(state, label, hover?)` keeps the visible chrome terse ("Session expired") while the hover tooltip carries the actionable detail (`Daemon restarted — run \`factory ui-token\` for a fresh URL`). Future labeled-with-action UI can reuse this pattern.
- **Frontend-design judgement calls carried from prior sessions still apply** for /phase-close polish and Phase 4: inherit-don't-invent, hint-copy-teaches-consequence, in-context-affordance-vs-nav, root-cause CSS fixes over global rewrites.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
