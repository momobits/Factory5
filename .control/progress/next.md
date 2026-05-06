# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-06T13:22:28Z by
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

Begin Phase 4 (cli-completion). Read [`../phases/phase-4-cli-completion/README.md`](../phases/phase-4-cli-completion/README.md) and [`steps.md`](../phases/phase-4-cli-completion/steps.md) plus the full plan at [`../../UPGRADE/plans/tier-4-cli-completion.md`](../../UPGRADE/plans/tier-4-cli-completion.md). Two pre-kickoff items the operator should fill in: (i) `## Where we were, end of Phase 3` section in the new README — terse summary of the 10-step Phase 3 arc that 4.x can rely on (SSE protocol, Astro component library, web cancel/chat/projects-new, mobile nav, logout/connection pip); (ii) `## Why this phase exists` section — the carry-forward block (3 deferred items from Phase 3) is already seeded; add the operator-facing motivation (CLI is the third operator surface, Phase 4 closes parity with web + channels). Then start step 4.1: verify `factory cancel <directive-id>` works against a real factoryd (Phase 2's plumbing + DB-direct fallback already shipped — this is a smoke-only verification or a small fix). 4.2 (`factory budget set`) is the first feature step. Background processes still running from Phase 3: factoryd PID may have rotated; live URL via `factory ui-token`. Astro dev on `127.0.0.1:4321` (not load-bearing for Phase 4 work).

## Notes for next session

Phase 3 is **closed** (tag `phase-3-web-ui-closed`). Phase 4 (cli-completion) is the active phase — small but high-leverage tier estimated at ~1 session.

**Step 4.1 — Verify `factory cancel` (recommended start):**

Phase 2 step 2.4 shipped the brain hook + IPC route + DB-direct fallback. The CLI surface (`factory cancel <directive-id> [--reason <text>]`) was wired then; this Phase 4 step is the verification commit. If everything works as expected against a real factoryd, this might be a no-op or a tiny doc tweak. If something needs a fix (e.g., exit codes or `--reason` handling), land it as `fix(4.1): factory cancel — <issue>`.

**Phase 4 sub-step roadmap:**

1. **4.1** — Verify `factory cancel` end-to-end (smoke, possibly no-op).
2. **4.2** — `factory budget set <project>` reusing wiki helpers; same code path as `PUT /api/v1/projects/:id/budget`.
3. **4.3** — `factory project list / show / delete` (with `--purge` for explicit destructive variant).
4. **4.4** — `factory ask "<question>"` single-shot chat (`--json` for scripting); reuses chat.ts via extracted `submitOneDirective` helper.
5. **4.5** — Tab completion via `factory completion <shell>` (bash/zsh/pwsh, static).
6. **4.6** — Rich `--help` examples via `addHelpText('after', '...')` on every command.
7. **4.7** — `packages/cli/README.md` refresh.
8. **4.8** — Resolve issues U018, U019, U020, U021 in `UPGRADE/ISSUES.md` + tick Tier 4 boxes in `UPGRADE/ROADMAP.md`.
9. **4.9** — `/phase-close`.

Full plan + sub-task detail in [`../../UPGRADE/plans/tier-4-cli-completion.md`](../../UPGRADE/plans/tier-4-cli-completion.md).

**Pre-kickoff README edits the operator should make:**

The Phase 4 README has two `<Fill in during phase kickoff.>` placeholders:
- `## Where we were, end of Phase 3` — terse summary of the 10-step Phase 3 arc.
- `## Why this phase exists` — the carry-forward block (3 deferred items) is already seeded; add the operator-facing motivation paragraph (e.g., "CLI is the third operator surface; Phase 4 closes parity with web + channels — `cancel`, budget mutation, project introspection, single-shot chat, plus the polish — tab completion + worked help examples").

These are conventionally filled at the start of the first Phase 4 sub-step session.

**Carry-forward items (none block 4.x):** Pause primitive (defer-until-signal); PageShell + `<style is:global>` migration (1-commit sweep, available any time); brain-side `log.line` forwarder (ADR 0029 future-work; not gating); chat-page click-test (Phase 3 deferred follow-up — natural fit during Phase 4 visual checks); Control framework repo 2.2.3 publish (operator's go); `/session-end` skill lag-by-1 fix (8 occurrences; ergonomic).

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).

**Frontend-design judgement calls carried from Phase 3** (worth recalling for any Phase 4 web-side work, even though Phase 4 is CLI-only):

- Smart defaults read better than empty states.
- Native HTML beats custom widgets when semantics align.
- Theme-independent intentional colors for status semantics (traffic-light pip).
- Error-class differentiation matters when recovery paths differ.
- Visible-label vs. hover-title separation.
- Inherit-don't-invent; root-cause CSS fixes over global rewrites; hint-copy-teaches-consequence; in-context-affordance-vs-nav.
