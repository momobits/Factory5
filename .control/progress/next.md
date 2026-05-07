# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-07T18:11:59Z by
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

Run sub-step **6.1**: open two issues in `UPGRADE/ISSUES.md` per Tier 6 plan §6.1.

- `U026 — skills/* — 12 ported-from-factory2 skills with no factory5 audit` (Severity: low, Tier: 6, Area: docs / skills). All 12 skills in `skills/` are explicitly "ported from factory2/skills/" per `docs/SKILLS.md` line 7. Tier 5 5.4–5.7 referenced 6 of them by name without deep-reading their bodies; this is the audit they didn't do.
- `U027 — Fixer agent output → updateFindingStatus has no parser path` (Severity: medium, Tier: 6, Area: brain). `packages/wiki/src/findings.ts:196` exports the API but it's only invoked from tests; no `packages/brain/src/` code parses agent output for `RESOLUTION <FID>` markers. Tier 5 5.5 confirmed the gap; the fixer prompt documents the prose-only contract today. Resolution wiring promotes the prompt's marker grammar into a runtime contract.

Each issue follows the existing `### UNNN — Short title` template (severity / tier / area / description / hypothesis). Append to the Open section. Then commit `chore(6.1): open U026 + U027`.

After 6.1 lands, proceed to **6.2** (skills audit pass — read each of the 12 skill bodies, classify each as `clean` / `hot-fix` / `rewrite`; commit body documents 12-line per-skill verdict; this plan + steps.md updated with explicit per-skill rewrite rows in the 6.4..6.N range).

**One pre-write homework item lurking** for 6.3 (re-verify on entry, don't assume):

- **6.3 fixer parser attach point** — re-grep `packages/brain/src/` for any agent-output → `updateFindingStatus` parser path (Tier 5 5.5 confirmed none; verify on entry to catch any sibling work that may have landed). Find where verifier's `FINDING` markers get parsed today — that's the model. Read `packages/wiki/src/findings.ts` around the `updateFindingStatus` export to confirm signature + idempotency. If no clean attach point exists, surface and split into refactor (6.3a) + parser (6.3b) — don't paper over a structural gap with a one-off hook.

Full Tier 6 plan: [`../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../UPGRADE/plans/tier-6-skills-rewrites.md). Phase scaffold: [`../phases/phase-6-skills-rewrites/{README.md,steps.md}`](../phases/phase-6-skills-rewrites/).

## Notes for next session

**Phase 6 active at 6.1.** Open U026 + U027 in `UPGRADE/ISSUES.md` per Tier 6 plan §6.1. After landing as `chore(6.1): open U026 + U027`, proceed to 6.2 (skills audit pass — 12 bodies read, classified `clean` / `hot-fix` / `rewrite`; verdicts in commit body; plan + steps.md updated with explicit per-skill rewrite rows in 6.4..6.N).

**Read first** when next session resumes:

- [`UPGRADE/plans/tier-6-skills-rewrites.md`](../../UPGRADE/plans/tier-6-skills-rewrites.md) — full Tier 6 plan with file pointers, acceptance criteria, verification branches.
- [`.control/phases/phase-6-skills-rewrites/README.md`](../phases/phase-6-skills-rewrites/README.md) + [`steps.md`](../phases/phase-6-skills-rewrites/steps.md) — phase kickoff + checklist.
- [`UPGRADE/LOG.md`](../../UPGRADE/LOG.md) — full upgrade-side narrative across all five tiers (Tier 6 entry added at session end).
- [`.control/progress/journal.md`](journal.md) — session-by-session control narrative.
- This file (`STATE.md`).

**6.3 pre-write homework** (read before writing the parser):

- Re-grep `packages/brain/src/` for any agent-output → `updateFindingStatus` parser path. Tier 5 5.5 confirmed none; verify on entry to catch any sibling work that landed in the meantime.
- Find where verifier's `FINDING` markers get parsed today — that's the model for the new `RESOLUTION` parser.
- Read `packages/wiki/src/findings.ts` around the `updateFindingStatus` export to confirm signature + idempotency.
- If no clean attach point exists, surface and split into refactor (6.3a) + parser (6.3b). Don't paper over a structural gap with a one-off hook.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for Phase 6 but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.

**Tier 5 in retrospect:** 8 work commits (5.1 → 5.8) plus the phase-close commit. Total session output ~1100 lines added across the codebase (most in 4 prompt files + ISSUES.md). All 4 `pnpm` gates green throughout. No new ADRs; pre-write homework for 5.4 + 5.5 confirmed runtime contracts that didn't need pinning. Two of the Tier-6-candidates surfaced in Tier 5 are now in scope here (skills audit, fixer parser path); U005 stays carry-forward.
