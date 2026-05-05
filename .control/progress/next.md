# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-05T21:50:14Z by
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

Run `/phase-close`. Phase 3 is complete: every step in [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md) flipped to `[x]` (3.1 → 3.10) and three deferred follow-ups remain (Pause primitive, PageShell adoption + Dashboard `<style is:global>` migration, pre-3.5 baseline live-smoke chat-page click-test) — none are 3.x acceptance dependencies, and per the steps.md "Deferred follow-ups" header all are explicitly free to land any time before `/phase-close` (or be carried into Phase 4). The `/phase-close` skill will: (i) tag `phase-3-web-ui-closed` annotated at HEAD; (ii) append a session entry to [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) summarizing the phase; (iii) tick remaining Tier 3 boxes in [`../../UPGRADE/ROADMAP.md`](../../UPGRADE/ROADMAP.md) (none left as of step-3.10 close); (iv) promote ADR 0029 (`directive-stream-protocol`) past the gated state — the Live verification carve-out can be retired since all six event types are confirmed live (closed in step 3.7's smoke); (v) scaffold Phase 4 (`cli-completion`) at `.control/phases/phase-4-cli-completion/{README.md,steps.md}` per [`../architecture/phase-plan.md`](../architecture/phase-plan.md). One smoke remaining as a 30-second click-test before the close: open `/app/chat` against a live factoryd, type a question, verify the streamed reply renders end-to-end (the only piece of Phase 3.5's pre-existing work without a dedicated live smoke). Background processes still running: factoryd PID 21776 → may have rotated again; live URL via `factory ui-token`. Astro dev on `127.0.0.1:4321`.

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
