# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-06T21:25:48Z by
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

The factory5 first-class upgrade arc that ran from Tier 1 (doc-sweep) through Tier 4 (cli-completion) is complete. Four operator surfaces — CLI, Discord, Telegram, web dashboard — now reach feature parity for the eight-intent vocabulary; live SSE wiring on the web side; tab completion + rich `--help` on the CLI side; one Astro component library; one shared chat protocol. ADRs 0027 / 0028 / 0029 codify the pinned contracts.

No new phase is scaffolded. Operator's options:

1. **Open a new arc** — author a fresh `UPGRADE/plans/tier-5-<name>.md`, add a Phase 5 row to `.control/architecture/phase-plan.md`, then run `/phase-add` (if Control supports it) or hand-scaffold `.control/phases/phase-5-<name>/{README.md,steps.md}` from `.control/templates/`.
2. **Promote a carry-forward item to a Tier-5+ ROADMAP entry** — see "In-flight work" below; each is small and self-contained, ships as ~1 commit when authored.
3. **Park** — surfaces are stable; nothing is gated on more work.

**Recommended `/session-end`** next so STATE.md / journal.md / next.md / UPGRADE/LOG.md all transition together to the post-arc state. The phase-close commit landed the structural transition; `/session-end` records the operator-side handoff for whoever picks up next.

## Notes for next session

The factory5 first-class upgrade arc (Tiers 1 → 4) is complete. There is no scheduled Phase 5. The operator opens the next arc when a demand signal surfaces.

If you want to continue working on factory5, the cleanest paths are:

**A. Promote one of the carry-forward items.** Each is small and self-contained:

- _Pause primitive on directive detail_ — when a real workflow signal surfaces, decide between extending `directivesQ.status` with `paused`/resume vs reusing `markBlocked` with `blockedReason: 'paused-by-operator'`.
- _PageShell migration + Dashboard `<style is:global>`_ — 11-page sweep, absorbs filter-form Apply / "Clear all defaults" unstyled-button issue + inline-style audit pass; ships as ~1 commit.
- _Brain-side `log.line` forwarder_ — selective pino-stream tap; ADR 0029 future-work item.
- _Chat-page click-test_ — 30-second smoke; final piece of Phase 3.5's pre-existing baseline.
- _U005 `factory chat` 120 s timeout_ — extend or replace with streaming.
- _Control framework 2.2.3 publish_ at `G:\Projects\Small-Projects\Control` — operator owns the go.
- _`/session-end` skill structural fix_ for the "Last commit" lag-by-1 (now 11 occurrences). Two structural options unchanged: track "last work commit" rather than HEAD, or amend STATE.md post-commit.

**B. Author a new tier.** If a larger arc surfaces (e.g., persistent-session resumption, multi-tenant operator auth, Linux+Mac CI matrix, Pause primitive once a demand signal lands, eval harness for triage / architect / verify), draft a `UPGRADE/plans/tier-5-<name>.md`, add a Phase 5 row to `phase-plan.md`, then run `/phase-add` (or scaffold by hand) to bring the cursor back online.

**C. Park.** Nothing is gated. Walking away is fine; the surfaces are stable and document themselves.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across all four tiers (~10 sessions). Read [`../../UPGRADE/ROADMAP.md`](../../UPGRADE/ROADMAP.md) for the per-tier acceptance picture.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing (no current web work) but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.
